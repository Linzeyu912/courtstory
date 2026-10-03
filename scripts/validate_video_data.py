"""Validate shared video manifests, bytes, labels and optional staged LFS pointers."""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
MEDIA_SUFFIXES = {'.mp4', '.mov', '.mkv', '.webm', '.avi'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def safe_path(base, value):
    require(isinstance(value, str) and value, 'missing relative path')
    p = PurePosixPath(value)
    require(not p.is_absolute() and '..' not in p.parts and '\\' not in value and ':' not in value,
            'unsafe relative path: ' + value)
    result = base.joinpath(*p.parts).resolve()
    require(result.is_relative_to(base.resolve()), 'path escapes base: ' + value)
    return result


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate(metadata_only=False, check_index=False):
    catalog = read_json(ROOT / 'data/videos/catalog.json')
    require(catalog['schema_version'] == '1.0.0', 'unsupported catalog schema')
    all_entries, media, dataset_ids = {}, {}, set()
    totals = Counter()
    for dataset in catalog['datasets']:
        did = dataset['dataset_id']
        require(did not in dataset_ids, 'duplicate dataset ID: ' + did)
        dataset_ids.add(did)
        base = safe_path(ROOT, dataset['root'])
        require(base.is_relative_to(ROOT / 'data/videos'), 'dataset outside data/videos')
        manifest_path = safe_path(ROOT, dataset['manifest'])
        require(manifest_path.is_relative_to(base), 'manifest outside dataset')
        manifest = read_json(manifest_path)
        require(manifest['schema_version'] == '1.0.0' and manifest['dataset_id'] == did,
                'manifest schema or dataset ID mismatch: ' + did)
        require(manifest['season'] == dataset['season'] and manifest['timezone'] == 'Asia/Shanghai',
                'season or timezone mismatch: ' + did)
        require(safe_path(ROOT, manifest['source_manifest']).is_file(), 'source manifest missing')
        counts = Counter()
        local_ids = set()
        for entry in manifest['entries']:
            cid, local_id = entry['clip_id'], entry['local_id']
            require(cid == did + '-' + local_id and cid not in all_entries and local_id not in local_ids,
                    'duplicate or inconsistent clip ID: ' + cid)
            local_ids.add(local_id)
            all_entries[cid] = entry
            label = read_json(safe_path(base, entry['annotation_path']))
            require(str(label.get('id', label.get('clip_id'))).zfill(3) == local_id, 'annotation ID mismatch: ' + cid)
            require(label['season'] == manifest['season'] == entry['game']['season'], 'annotation season mismatch: ' + cid)
            source = entry['source']
            user_upload = dataset.get('purpose') == 'user_upload' and source.get('kind') == 'user_upload'
            if user_upload:
                require(isinstance(source.get('uploaded_filename'), str) and source['uploaded_filename'].strip(),
                        'uploaded filename missing: ' + cid)
                require(isinstance(source.get('unknown_reason'), str) and source['unknown_reason'].strip(),
                        'uploaded source explanation missing: ' + cid)
            require((user_upload and source['url'] is None)
                    or urlparse(source['url']).scheme in {'https', 'http'}, 'source URL missing: ' + cid)
            require((user_upload and source['start_seconds'] is None and source['end_seconds'] is None)
                    or (is_number(source['start_seconds']) and is_number(source['end_seconds'])
                        and 0 <= source['start_seconds'] < source['end_seconds']), 'invalid source interval: ' + cid)
            require(source['collected_at'] and (entry['game']['date_local'] or
                    ((dataset.get('purpose') == 'tactic_acceptance' or user_upload)
                     and isinstance(entry['game'].get('unknown_reason'), str)
                     and entry['game']['unknown_reason'].strip())),
                    'collection or game date missing without acceptance-sample explanation: ' + cid)
            require(entry['tactic']['label_status'] in {'reviewed_visible_actions', 'provisional_from_collector_notes'},
                    'invalid label status: ' + cid)
            require(entry['tactic']['tags'] and entry['tactic']['basis'], 'label tags or basis missing: ' + cid)
            asset, video, review = entry['asset'], entry['video'], entry['review']
            state = asset['availability']
            require(state in {'included', 'awaiting_upload'}, 'invalid availability: ' + cid)
            counts[state] += 1
            if state == 'awaiting_upload':
                require(asset['storage'] == 'not_shared' and all(asset[k] is None for k in ['path', 'bytes', 'sha256']),
                        'unavailable asset has invented file metadata: ' + cid)
                require(video['measurement_status'] == 'unverified'
                        and all(video[k] is None for k in ['duration_seconds', 'width', 'height', 'fps']),
                        'unavailable asset has measured video values: ' + cid)
                require(review['visual_status'] == review['decode_status'] == 'unverified'
                        and all(review[k] is None for k in ['normal_speed', 'original_broadcast', 'full_possession']),
                        'unavailable asset has confirmed visual values: ' + cid)
                require(entry['tactic']['label_status'] == 'provisional_from_collector_notes',
                        'unavailable asset has confirmed label: ' + cid)
                continue
            require(asset['storage'] == 'git-lfs' and isinstance(asset['bytes'], int) and asset['bytes'] > 0,
                    'included asset storage or size invalid: ' + cid)
            require(re.fullmatch(r'[0-9a-f]{64}', asset['sha256']) is not None, 'invalid SHA-256: ' + cid)
            path = safe_path(base, asset['path'])
            require(path.suffix in MEDIA_SUFFIXES and path not in media, 'duplicate path or unsupported media: ' + cid)
            media[path] = entry
            require(video['measurement_status'] == 'measured'
                    and all(is_number(video[k]) and video[k] > 0 for k in ['duration_seconds', 'width', 'height', 'fps']),
                    'included asset video measurements missing: ' + cid)
            require(all(isinstance(review[k], bool) or review[k] is None
                        for k in ['normal_speed', 'original_broadcast', 'full_possession']), 'invalid review boolean: ' + cid)
            require(label['sha256'] == asset['sha256'] and label['size_bytes'] == asset['bytes'],
                    'annotation file metadata mismatch: ' + cid)
            totals['bytes'] += asset['bytes']
            if not metadata_only:
                require(path.is_file(), 'missing video; run git lfs pull: ' + str(path.relative_to(ROOT)))
                with path.open('rb') as handle:
                    require(not handle.read(80).startswith(b'version https://git-lfs.github.com/spec/v1'),
                            'LFS pointer has not been downloaded: ' + cid)
                    handle.seek(0)
                    digest = hashlib.file_digest(handle, 'sha256').hexdigest()
                require(path.stat().st_size == asset['bytes'] and digest == asset['sha256'], 'video bytes differ: ' + cid)
                totals['files_hashed'] += 1
        require(len(manifest['entries']) == dataset['entry_count']
                and counts['included'] == dataset['included_count']
                and counts['awaiting_upload'] == dataset['awaiting_upload_count'], 'catalog counts differ: ' + did)
        totals.update(counts)
    for cid, entry in all_entries.items():
        for peer_id in entry['dedup']['similar_to']:
            require(peer_id in all_entries and peer_id != cid, 'unknown same-action peer: ' + cid)
            peer = all_entries[peer_id]
            require(cid in peer['dedup']['similar_to'] and peer['dedup']['action_group'] == entry['dedup']['action_group'],
                    'asymmetric or inconsistent same-action group: ' + cid)
    hashes = {}
    for path, entry in media.items():
        digest = entry['asset']['sha256']
        require(digest not in hashes or entry['dedup'].get('duplicate_of') == hashes[digest],
                'unmarked byte duplicate: ' + entry['clip_id'])
        hashes.setdefault(digest, entry['clip_id'])
    for path in (ROOT / 'data/videos').rglob('*'):
        require(path.suffix not in MEDIA_SUFFIXES or path.resolve() in media, 'unregistered video: ' + str(path))
    for item in catalog.get('historical_references', []):
        require(safe_path(ROOT, item['path']).is_file(), 'historical reference missing')
    if check_index:
        for path, entry in media.items():
            relative = path.relative_to(ROOT).as_posix()
            pointer = subprocess.run(['git', 'show', ':' + relative], cwd=ROOT, check=True, capture_output=True).stdout
            expected = ('version https://git-lfs.github.com/spec/v1\n'
                        + 'oid sha256:' + entry['asset']['sha256'] + '\n'
                        + 'size ' + str(entry['asset']['bytes']) + '\n').encode('ascii')
            require(pointer == expected, 'staged video is not the expected LFS pointer: ' + relative)
            totals['staged_lfs_pointers'] += 1
    return {'datasets': len(dataset_ids), 'entries': len(all_entries), **dict(totals),
            'metadata_only': metadata_only, 'index_checked': check_index}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata-only', action='store_true', help='Skip local video existence and byte checks')
    parser.add_argument('--check-index', action='store_true', help='Check every included staged video is an LFS pointer')
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.metadata_only, args.check_index), ensure_ascii=False))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
