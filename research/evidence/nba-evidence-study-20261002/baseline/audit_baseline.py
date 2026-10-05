#!/usr/bin/env python3
"""Offline, read-only audit of review-library inputs. Requires PyAV, no model inference.

python -X utf8 audit_baseline.py --repo REPOSITORY --out baseline-audit.json
Counts are observations / structural warning proxies, never accuracy estimates.
"""
from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import itertools
import json
import math
from pathlib import Path
import platform
import runpy
import statistics
import subprocess
import sys

import av

LIBRARY = 'data/videos/tactics/acceptance/review-library.json'
TIME_TOLERANCE = 0.001


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def finite(x):
    return type(x) in (int, float) and math.isfinite(x)


def read_frame_validator(path):
    """Compile only the three pure validation functions; never import/start the server."""
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    wanted = {'finite_number', 'whole_number', 'validate_frame_records'}
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in wanted]
    if {node.name for node in selected} != wanted:
        raise ValueError('Server frame validator contract changed; review audit before running.')
    namespace = {'math': math}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace['validate_frame_records']


def digest_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def distribution(values):
    if not values:
        return {'n': 0, 'min': None, 'median': None, 'max': None}
    return {'n': len(values), 'min': min(values), 'median': statistics.median(values), 'max': max(values)}


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True,
        text=True, encoding='utf-8', errors='replace')
    return result.stdout.strip() if result.returncode == 0 else None


class Sources:
    def __init__(self, repo):
        self.repo, self.items = repo, {}

    def file(self, relative):
        path = (self.repo / relative).resolve()
        if not path.is_relative_to(self.repo):
            raise ValueError(f'Input outside repository: {relative}')
        name = path.relative_to(self.repo).as_posix()
        if name not in self.items:
            self.items[name] = {'exists': path.is_file(), 'bytes': path.stat().st_size if path.is_file() else None,
                'sha256': sha256(path) if path.is_file() else None}
        return path, self.items[name]

    def json(self, relative):
        path, record = self.file(relative)
        return (json.loads(path.read_text(encoding='utf-8')) if record['exists'] else None), record


def decode_video(path):
    frames = []
    try:
        with av.open(str(path)) as container:
            stream = container.streams.video[0]
            info = {'readable': True, 'width': stream.width, 'height': stream.height,
                'average_rate': str(stream.average_rate), 'time_base': str(stream.time_base),
                'declared_frames': stream.frames, 'duration_seconds': float(stream.duration * stream.time_base)
                if stream.duration is not None else None,
                'audio_streams': [{'codec': s.codec_context.name, 'sample_rate': s.codec_context.sample_rate,
                    'start_seconds': float(s.start_time * s.time_base) if s.start_time is not None else None}
                    for s in container.streams.audio]}
            for frame in container.decode(stream):
                frames.append({'pts': frame.pts, 'time_base': [frame.time_base.numerator, frame.time_base.denominator],
                    'time': float(frame.pts * frame.time_base) if frame.pts is not None else None})
        times = [x['time'] for x in frames]
        good_times = [x for x in times if x is not None]
        info.update({'readable': bool(frames), 'decoded_frames': len(frames), 'missing_pts': len(times) - len(good_times),
            'first_pts': frames[0]['pts'] if frames else None, 'last_pts': frames[-1]['pts'] if frames else None,
            'first_time_seconds': times[0] if times else None, 'last_time_seconds': times[-1] if times else None,
            'nonincreasing_pts_steps': sum(b <= a for a, b in zip(good_times, good_times[1:])),
            'pts_sequence_sha256': digest_json(frames)})
        return info, frames
    except Exception as error:
        return {'readable': False, 'error': f'{type(error).__name__}: {error}', 'decoded_frames': len(frames)}, frames


def alignment(records, video_frames):
    errors, integer_pts_errors, base_errors, deltas = [], [], [], []
    explicit = 0
    for i, record in enumerate(records):
        if record.get('frame') != i:
            errors.append({'index': i, 'reason': 'nonsequential_frame_index'})
        if i >= len(video_frames):
            continue
        source = video_frames[i]
        if not finite(record.get('time')) or source['time'] is None:
            errors.append({'index': i, 'reason': 'missing_or_invalid_time'})
        else:
            delta = abs(record['time'] - source['time'])
            deltas.append(delta)
            if delta > TIME_TOLERANCE:
                errors.append({'index': i, 'reason': 'time_vs_decoded_pts', 'seconds': delta})
        if 'source_frame_pts' in record:
            explicit += 1
            if record['source_frame_pts'] != source['pts']:
                integer_pts_errors.append(i)
            if record.get('source_time_base') != source['time_base']:
                base_errors.append(i)
    return {'frame_count_matches': len(records) == len(video_frames), 'time_tolerance_seconds': TIME_TOLERANCE,
        'time_max_abs_error_seconds': max(deltas) if deltas else None,
        'frame_or_time_error_count': len(errors), 'first_errors': errors[:5],
        'explicit_pts_rows': explicit, 'explicit_pts_mismatches': len(integer_pts_errors),
        'explicit_time_base_mismatches': len(base_errors),
        'all_pass': len(records) == len(video_frames) and not (errors or integer_pts_errors or base_errors)}


def overlap(a, b):
    area_a = max(0, a[2]-a[0]) * max(0, a[3]-a[1])
    area_b = max(0, b[2]-b[0]) * max(0, b[3]-b[1])
    intersection = max(0, min(a[2], b[2])-max(a[0], b[0])) * max(0, min(a[3], b[3])-max(a[1], b[1]))
    return (intersection / (area_a+area_b-intersection) if area_a+area_b-intersection else 0,
        intersection / min(area_a, area_b) if min(area_a, area_b) else 0,
        min(area_a, area_b) / max(area_a, area_b) if max(area_a, area_b) else 0)


def gap_summary(id_frames):
    lengths, tracks_with_gaps, cases = [], 0, []
    for identifier, frame_numbers in sorted(id_frames.items()):
        ordered = sorted(set(frame_numbers))
        gaps = [(a+1, b-1) for a, b in zip(ordered, ordered[1:]) if b-a > 1]
        tracks_with_gaps += bool(gaps)
        lengths.extend(b-a+1 for a, b in gaps)
        for a, b in gaps:
            cases.append({'track_id': identifier, 'start': a, 'end': b, 'absent_frames': b-a+1})
    return {'within_id_gap_events': len(lengths), 'tracks_with_internal_gaps': tracks_with_gaps,
        'absent_frames_sum': sum(lengths), 'gap_length_frames': distribution(lengths),
        'largest_gaps': sorted(cases, key=lambda x: (-x['absent_frames'], x['track_id'], x['start']))[:5]}


def audit_tracks(records, metadata, width, height):
    counts, pending_counts, candidates, player_counts = [], [], [], []
    ids, roles, classes, pending_classes = defaultdict(list), Counter(), Counter(), Counter()
    evidence_fields, sources, team_labels, torso_labels = Counter(), Counter(), Counter(), Counter()
    evidence_rows = color_conflicts = identity_review = verified = 0
    conflicts_by_id, review_by_id = Counter(), Counter()
    duplicate_ids = invalid_rows = off_image_rows = iou_pairs = contained_pairs = 0
    examples = []
    objects, object_frames, object_sources, object_field_rows = Counter(), defaultdict(set), Counter(), 0
    player_class = metadata.get('player_class_id')
    for record in records:
        frame_no, tracks = record['frame'], record.get('tracks', [])
        pending = record.get('pending_detections', [])
        counts.append(len(tracks)); pending_counts.append(len(pending))
        if type(record.get('candidate_count')) is int:
            candidates.append(record['candidate_count'])
        frame_ids = Counter()
        frame_player_count = 0
        known_player_basis = player_class is not None or 'track_roles' in record
        for row in tracks:
            if len(row) != 7 or not all(finite(x) for x in row) or row[2] <= row[0] or row[3] <= row[1]:
                invalid_rows += 1
                continue
            identifier = int(row[4]); frame_ids[identifier] += 1; ids[identifier].append(frame_no)
            classes[str(int(row[6]))] += 1
            role = record.get('track_roles', {}).get(str(identifier))
            if role is not None:
                roles[role] += 1
            if (player_class is not None and row[6] == player_class) or role == 'player':
                frame_player_count += 1
            if row[0] < 0 or row[1] < 0 or row[2] > width or row[3] > height:
                off_image_rows += 1
            ev = record.get('track_evidence', {}).get(str(identifier))
            if isinstance(ev, dict):
                evidence_rows += 1; evidence_fields.update(ev.keys())
                sources[str(ev.get('source'))] += 1; team_labels[str(ev.get('team_label'))] += 1
                torso_labels[str(ev.get('torso', {}).get('label'))] += 1
                if ev.get('color_conflict') is True:
                    color_conflicts += 1; conflicts_by_id[str(identifier)] += 1
                if ev.get('identity_review_required') is True:
                    identity_review += 1; review_by_id[str(identifier)] += 1
                verified += ev.get('identity_verified') is True
        duplicate_ids += sum(max(0, n-1) for n in frame_ids.values())
        if known_player_basis:
            player_counts.append(frame_player_count)
        for row in pending:
            if len(row) == 6 and all(finite(x) for x in row):
                pending_classes[str(int(row[5]))] += 1
            else:
                invalid_rows += 1
        for a, b in itertools.combinations(tracks, 2):
            if len(a) != 7 or len(b) != 7 or a[6] != b[6]:
                continue
            iou, iom, ratio = overlap(a, b)
            high = iou >= .7
            contained = iom >= .9 and ratio <= .6
            iou_pairs += high; contained_pairs += contained
            if (high or contained) and len(examples) < 5:
                examples.append({'frame': frame_no, 'ids': [int(a[4]), int(b[4])],
                    'iou': round(iou, 4), 'intersection_over_smaller': round(iom, 4), 'area_ratio': round(ratio, 4)})
        if 'objects' in record:
            object_field_rows += 1
        for obj in record.get('objects', []):
            kind = obj.get('kind', 'unknown'); objects[kind] += 1
            object_frames[kind].add(frame_no); object_sources[f"{kind}:{obj.get('source', 'unknown')}"] += 1
    result = {'frames': len(records), 'track_observations': sum(counts), 'tracks_per_frame': distribution(counts),
        'frames_with_exactly_10_tracks': sum(x == 10 for x in counts), 'pending_observations': sum(pending_counts),
        'pending_per_frame': distribution(pending_counts), 'frames_with_pending': sum(x > 0 for x in pending_counts),
        'candidate_count': distribution(candidates), 'candidate_count_sum': sum(candidates),
        'class_observations': dict(classes), 'explicit_role_observations': dict(roles),
        'player_observations': sum(player_counts) if player_counts else None,
        'player_counts_basis': 'metadata_class_or_explicit_role' if player_counts else 'unavailable_generic_person_class',
        'player_count_per_frame': distribution(player_counts), 'pending_class_observations': dict(pending_classes),
        'unique_track_ids': len(ids), 'id_observation_length': distribution([len(v) for v in ids.values()]),
        'internal_gaps': gap_summary(ids),
        'structural_warnings': {'duplicate_same_frame_ids': duplicate_ids, 'invalid_rows': invalid_rows,
            'boxes_outside_image': off_image_rows, 'same_class_iou_ge_0_7_pair_observations': iou_pairs,
            'same_class_containment_ge_0_9_area_ratio_le_0_6_pair_observations': contained_pairs,
            'first_overlap_examples': examples},
        'evidence': {'observations_with_evidence': evidence_rows, 'source_counts': dict(sources),
            'team_label_counts': dict(team_labels), 'torso_label_counts': dict(torso_labels),
            'color_conflict_flags': color_conflicts if evidence_fields['color_conflict'] else None,
            'color_conflict_field_observations': evidence_fields['color_conflict'],
            'color_conflicts_by_track': dict(conflicts_by_id),
            'identity_review_flags': identity_review if evidence_fields['identity_review_required'] else None,
            'identity_review_field_observations': evidence_fields['identity_review_required'],
            'identity_review_by_track': dict(review_by_id),
            'identity_verified_true_observations': verified if evidence_fields['identity_verified'] else None},
        'objects': {'frames_with_objects_field': object_field_rows, 'available_in_this_variant': bool(object_field_rows),
            'observation_counts': dict(objects) if object_field_rows else None,
            'frames_by_kind': {k: len(v) for k, v in object_frames.items()} if object_field_rows else None,
            'sources': dict(object_sources) if object_field_rows else None},
        'accuracy': {'detection_precision': None, 'detection_recall': None, 'IDF1': None,
            'identity_accuracy': None, 'position_error_m': None, 'reason': 'No independent ground truth in this audit.'}}
    return result


def targeted_cases(records):
    lookup = {r['frame']: r for r in records}
    cases = []
    for frame_no, identifier in itertools.product([159, 212, 266], [12, 21]):
        record = lookup.get(frame_no, {})
        row = next((r for r in record.get('tracks', []) if int(r[4]) == identifier), None)
        case = {'frame': frame_no, 'track_id': identifier, 'present': row is not None,
            'time_seconds': record.get('time'), 'source_frame_pts': record.get('source_frame_pts')}
        if row is not None:
            case.update({'box_xyxy': row[:4], 'tracking_score': row[5], 'class_id': row[6],
                'evidence': record.get('track_evidence', {}).get(str(identifier)), 'neighbor_motion': []})
            for delta in [-1, 1]:
                other = lookup.get(frame_no+delta, {})
                prior = next((r for r in other.get('tracks', []) if int(r[4]) == identifier), None)
                if prior:
                    dt = abs(record['time']-other['time'])
                    displacement = math.hypot((row[0]+row[2]-prior[0]-prior[2])/2,
                        (row[1]+row[3]-prior[1]-prior[3])/2)
                    case['neighbor_motion'].append({'neighbor_frame': frame_no+delta, 'delta_seconds': dt,
                        'center_displacement_px': displacement, 'center_speed_px_per_s': displacement/dt if dt else None})
        cases.append(case)
    return cases


def candidates(sample, versions, records_by_hash, sources, video, video_frames, validators):
    result = {}
    for kind, key in [('feet', 'feetCandidates'), ('court', 'courtCandidates')]:
        if not sample.get(key):
            result[kind] = {'available': False, 'reason': 'No library path.'}
            continue
        profile, source = sources.json(sample[key])
        if profile is None:
            result[kind] = {'available': False, 'reason': 'File missing.', 'path': sample[key],
                'contract_validation': {'pass': False, 'error': 'File missing.'}}
            continue
        matches = [v['id'] for v in versions if v['tracks_sha256'] == profile.get('trackingFingerprint')]
        rows = profile.get('frames', []) if kind == 'feet' else profile.get('keyframes', [])
        try:
            if kind == 'feet':
                validators['validate_feet_candidates'](profile, video['sha256'], records_by_hash,
                    video['width'], video['height'])
            else:
                validators['validate_court_candidates'](profile, video['sha256'], len(video_frames))
            validation = {'pass': True, 'validator': f'engineering/scripts/scene_profiles.py:validate_{kind}_candidates'}
        except Exception as error:
            validation = {'pass': False, 'error': f'{type(error).__name__}: {error}'}
        applicable = (matches if kind == 'feet' else [v['id'] for v in versions]) if validation['pass'] else []
        info = {'available': True, 'path': sample[key], 'sha256': source['sha256'],
            'video_hash_matches': profile.get('videoHash') == video['sha256'],
            'source': profile.get('source'), 'tracking_fingerprint': profile.get('trackingFingerprint'),
            'provenance_fingerprint_matches_variants': matches, 'frame_rows': len(rows),
            'contract_validation': validation, 'applicable_variants_by_server_contract': applicable,
            'independent_accuracy': None}
        if kind == 'feet':
            obs = [x for f in rows for x in f.get('feet', [])]
            points = [x[side] for x in obs for side in ['left', 'right'] if x.get(side)]
            info.update({'observations': len(obs), 'proposed_foot_points': len(points),
                'contact_states': dict(Counter(x.get('contactState') for x in obs)),
                'ground_point_true': sum(x.get('groundPoint') is True for x in obs),
                'points_needing_review': sum(x.get('needsReview') is True for x in points),
                'frame_pts_alignment': alignment(rows, video_frames)})
        else:
            info.update({'statuses': dict(Counter(x.get('status') for x in rows)),
                'noninvalid_frames_with_at_least_4_points': sum(x.get('status') != 'invalid' and len(x.get('points', [])) >= 4 for x in rows),
                'metric_accuracy_validated': profile.get('metricAccuracyValidated'),
                'review_required': profile.get('reviewRequired'),
                'contract_note': 'Court is video-level: server validates video hash and frame range; stored trackingFingerprint is provenance, not a version gate.'})
        result[kind] = info
    return result


def run(repo, out):
    sources = Sources(repo)
    library, library_source = sources.json(LIBRARY)
    if library is None:
        raise FileNotFoundError(LIBRARY)
    # run_path reads/compiles this inspected, standard-library-only validator without
    # importing the project package or creating __pycache__ in the read-only repo.
    validator_path, _ = sources.file('engineering/scripts/scene_profiles.py')
    validators = runpy.run_path(str(validator_path))
    frame_validator_path, _ = sources.file('engineering/scripts/serve_player_review.py')
    validate_frames = read_frame_validator(frame_validator_path)
    start_status = git(repo, 'status', '--porcelain')
    report = {'schema_version': 1, 'created_at_utc': datetime.now(timezone.utc).isoformat(),
        'scope': 'Offline source audit, no inference, no edits to repository, no accuracy claims.',
        'environment': {'python': platform.python_version(), 'pyav': av.__version__,
            'audit_script_sha256': sha256(Path(__file__))},
        'repository': {'head': git(repo, 'rev-parse', 'HEAD'), 'cached_origin_main': git(repo, 'rev-parse', 'origin/main'),
            'branch': git(repo, 'branch', '--show-current'), 'remote_refreshed': False, 'status_before': start_status},
        'library': {'path': LIBRARY, 'sha256': library_source['sha256']},
        'metric_contract': {'observations': 'One stored row in one frame; repeated variant files remain separate views.',
            'pending': 'Stored pending_detections, not missed-player truth.',
            'gaps': 'Absences strictly between first/last appearance of same temporary T ID; not true missed detections.',
            'overlap_warnings': 'Same-class box overlap proxies only; occlusion can trigger them; not verified duplicate detections.',
            'color_flags': 'Existing source flags only; absent field is null, not zero.',
            'identity': 'Temporary T IDs and proposed P slots are not verified player identities.',
            'accuracy': 'Null without independent ground truth; model confidence is not identity accuracy.'},
        'samples': []}
    for sample in library['samples']:
        video_path, video_source = sources.file(sample['video'])
        video, frame_pts = decode_video(video_path)
        video.update({'path': sample['video'], 'sha256': video_source['sha256'],
            'library_sha256': sample.get('videoSha256'), 'hash_matches': video_source['sha256'] == sample.get('videoSha256')})
        item = {'id': sample['id'], 'default_variant': sample.get('defaultVariant', 'original'), 'video': video, 'variants': []}
        records_by_hash = {}
        definitions = [{'id': 'original', 'tracks': sample['tracks']}] + sample.get('trackingVariants', [])
        if sample.get('alternativeTracks'):
            definitions.insert(1, {'id': 'jersey', 'tracks': sample['alternativeTracks']})
        for definition in definitions:
            path = definition['tracks']; records, track_source = sources.json(path)
            meta_path = definition.get('metadata') or str(Path(path).with_suffix('.meta.json')).replace('\\', '/')
            metadata, meta_source = sources.json(meta_path); metadata = metadata or {}
            variant = {'id': definition['id'], 'path': path, 'tracks_sha256': track_source['sha256'],
                'metadata_path': meta_path, 'metadata_sha256': meta_source['sha256'],
                'metadata_required': definition['id'] not in ('original', 'jersey'),
                'metadata_available': meta_source['exists'],
                'available': records is not None, 'metadata_video_hash_matches': metadata.get('video_sha256') == video['sha256'] if metadata else None,
                'metadata_frame_count_matches': metadata.get('frames') == len(frame_pts) if metadata else None}
            if records is not None:
                try:
                    validate_frames(records, [f['time'] for f in frame_pts], definition['id'])
                    variant['frame_contract_validation'] = {'pass': True,
                        'validator': 'engineering/scripts/serve_player_review.py:validate_frame_records'}
                except Exception as error:
                    variant['frame_contract_validation'] = {'pass': False, 'error': f'{type(error).__name__}: {error}'}
                    item['variants'].append(variant)
                    continue
                records_by_hash[track_source['sha256']] = records
                variant['frame_pts_alignment'] = alignment(records, frame_pts)
                variant.update(audit_tracks(records, metadata, video.get('width', 0), video.get('height', 0)))
                variant['metadata_claims'] = {k: metadata[k] for k in ['variant', 'tracker', 'model', 'pipeline_version',
                    'identity_verified', 'metric_accuracy_validated', 'weights_sha256', 'configuration_sha256', 'implementation_sha256'] if k in metadata}
                suggestions = metadata.get('identitySuggestions')
                variant['identity_suggestions'] = {'available': bool(suggestions),
                    'entities': len(suggestions.get('entities', [])) if suggestions else None,
                    'verified': suggestions.get('verified') if suggestions else None,
                    'linked_fragments': len(suggestions.get('links', [])) if suggestions else None,
                    'has_team_grouping': bool(suggestions.get('teamGrouping')) if suggestions else None}
                if sample['id'] == 'nba-lal-min-005' and definition['id'] == 'team-stable':
                    variant['document_flagged_cases_raw_evidence'] = targeted_cases(records)
            item['variants'].append(variant)
        groups = defaultdict(list)
        for variant in item['variants']:
            if variant['tracks_sha256']:
                groups[variant['tracks_sha256']].append(variant['id'])
        item['byte_identical_track_groups'] = [v for v in groups.values() if len(v) > 1]
        item['independent_track_files'] = len(groups)
        item['candidates'] = candidates(sample, item['variants'], records_by_hash, sources, video, frame_pts, validators)
        report['samples'].append(item)
        print(f"Audited {sample['id']}: {video['decoded_frames']} decoded frames, {len(item['variants'])} variants", flush=True)
    # Hash the source-code contracts used in interpreting candidates and review flags.
    for path in ['AGENTS.md', 'engineering/scripts/serve_player_review.py', 'engineering/scripts/scene_profiles.py',
        'research/vision/player-tracking-workbench-20261002.md',
        'research/vision/player-team-overlay-20261002.md',
        'data/videos/tactics/acceptance/tracks/basketball-20261002/README.md',
        'handoffs/chuali-zi/2026-10-02-1002-remote-sync-overview.md']:
        sources.file(path)
    report['source_inventory'] = sources.items
    changed = [name for name, entry in sources.items.items() if entry['exists'] and sha256(repo/name) != entry['sha256']]
    report['source_files_changed_during_audit'] = changed
    report['repository']['status_after'] = git(repo, 'status', '--porcelain')
    report['repository']['status_unchanged'] = start_status == report['repository']['status_after']
    samples, variants = report['samples'], [v for s in report['samples'] for v in s['variants']]
    report['totals'] = {'samples': len(samples), 'variants': len(variants),
        'independent_track_files': sum(s['independent_track_files'] for s in samples),
        'decoded_unique_video_frames': sum(s['video']['decoded_frames'] for s in samples),
        'video_hashes_match': all(s['video']['hash_matches'] for s in samples),
        'all_videos_readable': all(s['video']['readable'] for s in samples),
        'all_decoded_pts_monotonic': all(s['video'].get('missing_pts') == 0 and s['video'].get('nonincreasing_pts_steps') == 0 for s in samples),
        'all_variant_pts_checks_pass': all(v.get('frame_pts_alignment', {}).get('all_pass', False) for v in variants),
        'all_frame_contract_checks_pass': all(v.get('frame_contract_validation', {}).get('pass', False) for v in variants),
        'variants_with_complete_explicit_integer_pts': sum(v.get('frame_pts_alignment', {}).get('explicit_pts_rows') == v.get('frames') for v in variants),
        'all_metadata_checks_pass': all((not v['metadata_required'] or v['metadata_available']) and
            (not v['metadata_available'] or (v['metadata_video_hash_matches'] and v['metadata_frame_count_matches'])) for v in variants),
        'all_candidate_contract_checks_pass': all(c.get('contract_validation', {'pass': True})['pass'] for s in samples for c in s['candidates'].values()),
        'default_track_observations': sum(next(v.get('track_observations', 0) for v in s['variants'] if v['id'] == s['default_variant']) for s in samples)
            if all(v.get('frame_contract_validation', {}).get('pass', False) for v in variants) else None,
        'independent_ground_truth_available': False}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps(report['totals'], ensure_ascii=False), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True, help='JSON file outside the repository')
    args = parser.parse_args()
    repo, out = args.repo.resolve(), args.out.resolve()
    if out.is_relative_to(repo):
        parser.error('--out must be outside the read-only repository')
    report = run(repo, out)
    gates = ['all_videos_readable', 'video_hashes_match', 'all_variant_pts_checks_pass', 'all_decoded_pts_monotonic', 'all_frame_contract_checks_pass',
        'all_metadata_checks_pass', 'all_candidate_contract_checks_pass']
    return 0 if all(report['totals'][key] for key in gates) and not report['source_files_changed_during_audit'] else 2


if __name__ == '__main__':
    sys.exit(main())
