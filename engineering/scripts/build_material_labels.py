"""Build the video scenario folders from actual visual-review results.

python engineering/scripts/build_material_labels.py --results artifacts/material-labels-20261003
python engineering/scripts/build_material_labels.py --check
"""
import argparse
import json
import re
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data/videos/classification'
DIMENSIONS = {
    'camera_zoom': '镜头推拉', 'full_court_movement': '全场移动',
    'image_blur': '画面模糊', 'closeup_insertion': '特写打断',
    'view_switch': '视角切换', 'half_court_only': '仅半场画面',
    'motion_blur': '运动拖影', 'occlusion': '遮挡',
    'players_out_of_frame': '球员出画', 'replay_or_teaching': '回放或教学加工',
}
ACTION_WORDS = {
    'screen': ['掩护', '挡拆', '挡人'], 'drive': ['突破', '持球冲', '切入'],
    'pass': ['传', '分球', '手递手'], 'cut': ['空切', '跑位', '无球切', '后门'],
    'shot': ['投', '出手', '上篮', '扣篮', '三分'], 'rebound': ['篮板'],
    'transition': ['转换', '反击', '推进'], 'defense': ['防守', '封盖', '抢断', '换防'],
    'post': ['背身', '低位'], 'inbound': ['发球'],
}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    indent = 2
    if path.exists():
        match = re.search(r'^([ ]+)"', path.read_text(encoding='utf-8'), re.M)
        if match:
            indent = len(match[1])
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=indent) + '\n', encoding='utf-8', newline='\n')


def registry():
    catalog = read(ROOT / 'data/videos/catalog.json')
    rows = {}
    for dataset in catalog['datasets']:
        manifest = read(ROOT / dataset['manifest'])
        for entry in manifest['entries']:
            rows[entry['clip_id']] = {
                'clip_id': entry['clip_id'], 'dataset_id': dataset['dataset_id'],
                'video_path': dataset['root'] + '/' + entry['asset']['path'],
                'annotation_path': dataset['root'] + '/' + entry['annotation_path'],
                'sha256': entry['asset']['sha256'], 'entry': entry,
                'manifest_path': dataset['manifest'],
            }
    return catalog, rows


def intervals(values, duration):
    result = []
    for span in values:
        start, end = float(span['start']), float(span['end'])
        if not (0 <= start < end <= duration + 1):
            raise ValueError(f'Invalid interval {span}, duration={duration}')
        result.append({'start': round(start, 3), 'end': round(min(end, duration), 3)})
    return result


def schema():
    span = {'type': 'object', 'required': ['start', 'end'], 'properties': {
        'start': {'type': 'number', 'minimum': 0}, 'end': {'type': 'number', 'minimum': 0}},
        'additionalProperties': False}
    dimension = {'type': 'object', 'required': ['value', 'intervals', 'note'], 'properties': {
        'value': {'type': ['boolean', 'null']},
        'intervals': {'type': 'array', 'items': span}, 'note': {'type': 'string', 'minLength': 1}},
        'additionalProperties': False}
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        'title': 'material_labels namespace in each existing video annotation',
        'type': 'object', 'required': ['schema_version', 'clip_id', 'asset', 'source', 'quality',
            'scenarios', 'content', 'selection', 'content_relations', 'provenance'],
        'properties': {
            'schema_version': {'const': '1.0.0'}, 'clip_id': {'type': 'string'},
            'asset': {'type': 'object', 'required': ['video_path', 'annotation_path', 'sha256']},
            'source': {'type': 'object', 'required': ['manifest_path', 'url', 'source_start_seconds',
                'source_end_seconds', 'uploaded_filename', 'season', 'source_time_note']},
            'quality': {'type': 'object', 'required': ['clarity', 'core_actions_visible', 'reason'],
                'properties': {'clarity': {'enum': ['clear', 'soft', 'poor', 'uncertain']},
                    'core_actions_visible': {'type': ['boolean', 'null']}, 'reason': {'type': 'string'}}},
            'scenarios': {'type': 'object', 'required': list(DIMENSIONS),
                'properties': {key: dimension for key in DIMENSIONS}, 'additionalProperties': False},
            'content': {'type': 'object', 'required': ['scope', 'action_tags', 'description', 'usable_intervals'],
                'properties': {'scope': {'enum': ['full_possession', 'frontcourt_sequence', 'partial_action', 'uncertain']},
                    'action_tags': {'type': 'array', 'items': {'type': 'string'}},
                    'description': {'type': 'string'}, 'usable_intervals': {'type': 'array', 'items': span}}},
            'selection': {'type': 'object', 'required': ['status', 'recommended', 'reason'],
                'properties': {'status': {'enum': ['clear', 'challenge', 'excluded', 'needs_review']},
                    'recommended': {'type': 'boolean'}, 'reason': {'type': 'string'}}},
            'content_relations': {'type': 'array'},
            'provenance': {'type': 'object', 'required': ['reviewer_model', 'review_method', 'human_reviewed',
                'reviewed_at', 'sample_count', 'evidence_sheets', 'extra_frames', 'timestamp_precision'],
                'properties': {'reviewer_model': {'const': 'gpt-6.1-sol'}, 'human_reviewed': {'type': 'boolean'}}},
        }, 'additionalProperties': False,
    }


def build(work):
    from jsonschema import Draft202012Validator
    catalog, rows = registry()
    if any(read(ROOT / row['annotation_path']).get('material_labels', {}).get('provenance', {}).get('human_reviewed')
           for row in rows.values()):
        raise ValueError('已有正式人工审核标签；请使用 --refresh 从当前标签更新目录，不要重放原AI结果。')
    inputs = {x['clip_id']: x for x in read(work / 'inventory.json')}
    reviews = {}
    for path in sorted((work / 'results').glob('batch-*.json')):
        for result in read(path):
            assert result['clip_id'] not in reviews, result['clip_id']
            reviews[result['clip_id']] = result
    assert rows.keys() == reviews.keys() == inputs.keys(), 'Incomplete results or stale registry'
    overrides_path = work / 'results/approved-overrides.json'
    overrides = read(overrides_path) if overrides_path.exists() else []
    for correction in overrides:
        assert correction['clip_id'] in reviews
        reviews[correction['clip_id']].update(correction['changes'])
    relations = []
    pairs = {}
    relation_paths = [work / 'results/overlap-pairs.json'] + sorted((work / 'results').glob('dedup-additional-*.json'))
    for path in relation_paths:
        for pair in read(path):
            pair = dict(pair)
            if pair['relation'] == 'no_overlap':
                pair['relation'] = 'different'
            assert pair['relation'] in ('full_containment', 'partial_overlap', 'different', 'uncertain')
            assert len(pair['clip_ids']) == 2 and all(cid in rows for cid in pair['clip_ids'])
            if 'overlap_intervals' in pair:
                pair['clip_overlap_intervals_seconds'] = {
                    span['clip_id']: intervals([{'start': span['start'], 'end': span['end']}],
                        rows[span['clip_id']]['entry']['video']['duration_seconds'])
                    for span in pair.pop('overlap_intervals')}
            key = tuple(sorted(pair['clip_ids']))
            if key in pairs:
                assert pairs[key]['relation'] == pair['relation'], f'Conflicting content relation: {key}'
                continue
            pairs[key] = pair
            relations.append(pair)
    now = datetime.now(ZoneInfo('America/New_York')).isoformat(timespec='seconds')
    labels = {}
    validator = Draft202012Validator(schema())
    for cid, row in rows.items():
        result, item, entry = reviews[cid], inputs[cid], row['entry']
        assert item['sha256'] == row['sha256'], f'Asset changed after review: {cid}'
        assert set(result['evidence_sheets']) == set(item['contact_sheets']), f'Incomplete viewed sheets: {cid}'
        assert all((ROOT / p).is_file() for p in result['evidence_sheets'] + result['extra_frames'])
        duration = entry['video']['duration_seconds']
        scenarios = {}
        for name in DIMENSIONS:
            d = result[name]
            assert d['value'] is None or type(d['value']) is bool
            scenarios[name] = {'value': d['value'], 'intervals': intervals(d['intervals'], duration), 'note': d['note']}
            assert d['value'] is not True or scenarios[name]['intervals'], f'Missing event timestamp: {cid} {name}'
        status = ('excluded' if result['exclude'] else 'needs_review' if result['clarity'] == 'uncertain'
                  else 'clear' if result['clarity'] == 'clear' else 'challenge')
        source = entry['source']
        labels[cid] = {
            'schema_version': '1.0.0', 'clip_id': cid,
            'asset': {key: row[key] for key in ('video_path', 'annotation_path', 'sha256')},
            'source': {'manifest_path': row['manifest_path'], 'url': source.get('url'),
                'publisher': source.get('publisher'), 'source_id': source.get('source_id'),
                'kind': source.get('kind'), 'collected_at': source.get('collected_at'),
                'unknown_reason': source.get('unknown_reason'),
                'source_start_seconds': source.get('start_seconds'), 'source_end_seconds': source.get('end_seconds'),
                'uploaded_filename': source.get('uploaded_filename'), 'season': entry['game']['season'],
                'source_time_note': '来源时间有记录时按成片偏移估算；未知上传来源保留null，不把文件接收时间当比赛时间。'},
            'quality': {'clarity': result['clarity'], 'core_actions_visible': result['core_actions_visible'],
                'reason': result['quality_reason']},
            'scenarios': scenarios,
            'content': {'scope': result['scope'], 'action_tags': result['action_tags'],
                'description': result['action_description'], 'usable_intervals': intervals(result['usable_intervals'], duration)},
            'selection': {'status': status, 'recommended': status in ('clear', 'challenge'),
                'reason': result['exclude_reason'] if result['exclude'] else
                    '保留真实转播场景；模糊、推拉、特写及切镜均可用于后续增强。'},
            'content_relations': [p for p in relations if cid in p['clip_ids']],
            'provenance': {'reviewer_model': result['reviewer_model'], 'review_method': result['review_method'],
                'human_reviewed': False, 'reviewed_at': now, 'sample_count': item['sample_count'],
                'evidence_sheets': result['evidence_sheets'], 'extra_frames': result['extra_frames'],
                'timestamp_precision': '2fps采样间隔0.5秒，区间为人工阅读抽帧后的近似定位；未验证精确边界误差，裁剪前需补看逐帧画面',
                'evidence_location': '抽帧证据在本机忽略目录artifacts/；共享标签可直接读取，无需这些图片'},
        }
        corrections = [c for c in overrides if c['clip_id'] == cid]
        if corrections:
            labels[cid]['provenance']['independent_corrections'] = corrections
        validator.validate(labels[cid])
    # Full containment means duplicate frames, not merely similar difficulty.
    contained_by = {p['contained_clip_id']: p['containing_clip_id'] for p in relations if p['relation'] == 'full_containment'}
    for smaller, larger in contained_by.items():
        visited = {smaller}
        while larger in contained_by:
            assert larger not in visited, 'Cyclic containment'
            visited.add(larger)
            larger = contained_by[larger]
        if labels[larger]['selection']['recommended'] and labels[smaller]['selection']['recommended']:
            labels[smaller]['selection'].update(recommended=False,
                reason=f'同一画面已包含在{larger}，默认集合使用较完整段；本段保留为重复备选。',
                representative_clip_id=larger)
    # Preserve existing fields and retain local backups before writing.
    for cid, row in rows.items():
        path = ROOT / row['annotation_path']
        backup = work / 'before' / row['annotation_path']
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup)
        annotation = read(path)
        annotation['material_labels'] = labels[cid]
        write(path, annotation)
    write_indexes(catalog, rows, labels, relations, now, work)


def refresh():
    """Rebuild derived folders from current labels without replaying AI inputs."""
    from jsonschema import Draft202012Validator
    catalog, rows = registry()
    labels = {cid: read(ROOT / row['annotation_path'])['material_labels'] for cid, row in rows.items()}
    validator = Draft202012Validator(schema())
    for label in labels.values():
        validator.validate(label)
    relations = read(OUT / 'content-relations.json')['pairs']
    write_indexes(catalog, rows, labels, relations,
                  datetime.now(ZoneInfo('America/New_York')).isoformat(timespec='seconds'))


def write_indexes(catalog, rows, labels, relations, now, work=None):
    for dataset in catalog['datasets']:
        path = ROOT / dataset['manifest']
        if work is not None:
            backup = work / 'before' / dataset['manifest']
            if not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, backup)
        manifest = read(path)
        for entry in manifest['entries']:
            label = labels[entry['clip_id']]
            entry['material_labels'] = {'schema_version': '1.0.0', 'status': label['selection']['status'],
                'recommended': label['selection']['recommended'], 'annotation_field': 'material_labels',
                'human_reviewed': label['provenance']['human_reviewed'],
                'labeling_origin': label['provenance'].get('labeling_origin', 'ai_visual_review'),
                'classification_index': 'data/videos/classification/index.json'}
        manifest['material_labels_summary'] = dict(Counter(labels[e['clip_id']]['selection']['status'] for e in manifest['entries']))
        write(path, manifest)
    catalog['classification_index'] = 'data/videos/classification/index.json'
    catalog['material_label_schema'] = 'data/videos/classification/label-schema.json'
    write(ROOT / 'data/videos/catalog.json', catalog)
    write(OUT / 'label-schema.json', schema())
    write(OUT / 'taxonomy.json', {'schema_version': '1.0.0', 'scenarios': DIMENSIONS,
        'action_keyword_groups': ACTION_WORDS, 'action_group_note': '只对本轮可见动作标签分组，不由文件名推测战术。',
        'value_semantics': {'true': '观察到', 'false': '本轮采样未见', 'null': '无法判断；参见note'},
        'content_relation_types': {'full_containment': '较完整片段包含短段画面',
            'partial_overlap': '部分画面相同，但双方有独有内容', 'different': '候选已核对为不同画面',
            'uncertain': '未能确认'},
        'retention_policy': '保留真实困难场景，清晰度等级不直接决定剔除。去杂针对无价值素材和已确认包含的重复画面。'})
    refs = [{**{k: row[k] for k in ('clip_id', 'dataset_id', 'video_path', 'annotation_path', 'sha256')},
             **labels[cid]['selection'],
             'human_reviewed': labels[cid]['provenance']['human_reviewed'],
             'labeling_origin': labels[cid]['provenance'].get('labeling_origin', 'ai_visual_review')}
            for cid, row in rows.items()]
    counts = dict(Counter(x['status'] for x in refs))
    index = {'schema_version': '1.0.0', 'updated_at': now, 'path_base': 'repository_root',
        'annotation_field': 'material_labels', 'registry_count': len(refs), 'counts': counts, 'clips': refs,
        'unresolved_scenarios': [
            {'clip_id': cid, 'scenario': name, 'intervals': d['intervals'], 'note': d['note']}
            for cid, label in labels.items() for name, d in label['scenarios'].items() if d['value'] is None],
        'selections': {}, 'by_scenario': {}, 'by_action': {}}
    groups = {
        'default': [x for x in refs if x['recommended']],
        'all_usable': [x for x in refs if x['status'] in ('clear', 'challenge')],
        'clear': [x for x in refs if x['status'] == 'clear'],
        'challenge': [x for x in refs if x['status'] == 'challenge'],
        'excluded': [x for x in refs if x['status'] == 'excluded'],
        'needs_review': [x for x in refs if x['status'] == 'needs_review'],
        'redundant': [x for x in refs if x['status'] in ('clear', 'challenge') and not x['recommended']],
    }
    for name, members in groups.items():
        path = f'data/videos/classification/selections/{name}/index.json'
        write(ROOT / path, {'schema_version': '1.0.0', 'path_base': 'repository_root', 'count': len(members), 'clips': members})
        index['selections'][name] = {'path': path, 'count': len(members)}
    for name, title in DIMENSIONS.items():
        events = []
        for ref in refs:
            cid = ref['clip_id']
            label, dimension = labels[cid], labels[cid]['scenarios'][name]
            path = f'data/videos/classification/by_scenario/{name}/{cid}.json'
            if dimension['value'] is not True:
                old_path = ROOT / path
                if old_path.exists():
                    old = read(old_path)
                    assert old['clip_id'] == cid and old['scenario'] == name
                    old_path.unlink()
                continue
            offset = label['source']['source_start_seconds']
            event = {'schema_version': '1.0.0', 'path_base': 'repository_root', 'sample_id': cid + '__' + name,
                'clip_id': cid, 'scenario': name, 'video_path': ref['video_path'], 'annotation_path': ref['annotation_path'],
                'sha256': ref['sha256'], 'selection': label['selection'], 'source': label['source'],
                'clip_intervals_seconds': dimension['intervals'],
                'source_intervals_seconds': ([{'start': round(offset + s['start'], 3), 'end': round(offset + s['end'], 3)}
                    for s in dimension['intervals']] if offset is not None else None),
                'timestamp_precision': label['provenance']['timestamp_precision'], 'note': dimension['note']}
            write(ROOT / path, event)
            events.append({'clip_id': cid, 'path': path, 'status': ref['status'], 'recommended': ref['recommended']})
        folder_index = f'data/videos/classification/by_scenario/{name}/index.json'
        write(ROOT / folder_index, {'schema_version': '1.0.0', 'scenario': name, 'title': title,
            'path_base': 'repository_root', 'count': len(events),
            'usable_count': sum(x['status'] in ('clear', 'challenge') for x in events),
            'default_count': sum(x['recommended'] for x in events), 'samples': events})
        index['by_scenario'][name] = {'path': folder_index, 'count': len(events)}
    for name, words in ACTION_WORDS.items():
        members = [ref for ref in refs if ref['status'] in ('clear', 'challenge')
            and any(w in ' '.join(labels[ref['clip_id']]['content']['action_tags']) for w in words)]
        path = f'data/videos/classification/by_action/{name}/index.json'
        write(ROOT / path, {'schema_version': '1.0.0', 'path_base': 'repository_root', 'count': len(members), 'clips': members})
        index['by_action'][name] = {'path': path, 'count': len(members)}
    write(OUT / 'content-relations.json', {'schema_version': '1.0.0', 'pairs': relations})
    index['human_reviewed_count'] = sum(bool(label['provenance']['human_reviewed']) for label in labels.values())
    write(OUT / 'index.json', index)
    print(json.dumps({'clips': len(refs), 'counts': counts, 'default': len(groups['default']),
        'scenarios': {k: v['count'] for k, v in index['by_scenario'].items()}}, ensure_ascii=False))


def check():
    from jsonschema import Draft202012Validator
    _, rows = registry()
    index = read(OUT / 'index.json')
    refs = {x['clip_id']: x for x in index['clips']}
    assert refs.keys() == rows.keys(), 'Classification registry is stale'
    validator = Draft202012Validator(read(OUT / 'label-schema.json'))
    labels = {}
    for cid, row in rows.items():
        label = read(ROOT / row['annotation_path'])['material_labels']
        validator.validate(label)
        labels[cid] = label
        assert label['clip_id'] == cid
        for key in ('video_path', 'annotation_path', 'sha256'):
            assert label['asset'][key] == refs[cid][key] == row[key], (cid, key)
        assert label['selection'] == {k: refs[cid][k] for k in label['selection']}
        assert row['entry']['material_labels']['status'] == label['selection']['status']
        assert row['entry']['material_labels']['recommended'] == label['selection']['recommended']
        assert row['entry']['material_labels']['human_reviewed'] == refs[cid]['human_reviewed'] == label['provenance']['human_reviewed']
        duration = row['entry']['video']['duration_seconds']
        intervals(label['content']['usable_intervals'], duration)
        for d in label['scenarios'].values():
            intervals(d['intervals'], duration)
            assert d['value'] is not True or d['intervals']
    for name, info in index['by_scenario'].items():
        folder = read(ROOT / info['path'])
        expected = {cid for cid, label in labels.items() if label['scenarios'][name]['value'] is True}
        assert {x['clip_id'] for x in folder['samples']} == expected
        assert folder['count'] == info['count'] == len(expected)
        for sample in folder['samples']:
            event = read(ROOT / sample['path'])
            label = labels[sample['clip_id']]
            assert event['clip_intervals_seconds'] == label['scenarios'][name]['intervals']
            assert event['source'] == label['source'] and event['selection'] == label['selection']
            assert event['sha256'] == label['asset']['sha256']
            offset = label['source']['source_start_seconds']
            expected_source = ([{'start': round(offset + s['start'], 3), 'end': round(offset + s['end'], 3)}
                for s in label['scenarios'][name]['intervals']] if offset is not None else None)
            assert event['source_intervals_seconds'] == expected_source
        actual_files = {p.stem for p in (ROOT / info['path']).parent.glob('*.json') if p.name != 'index.json'}
        assert actual_files == expected, f'Stale scenario files: {name}'
    for name, info in index['by_action'].items():
        members = read(ROOT / info['path'])['clips']
        expected = {cid for cid, label in labels.items() if label['selection']['status'] in ('clear', 'challenge')
            and any(word in ' '.join(label['content']['action_tags']) for word in ACTION_WORDS[name])}
        assert len(members) == info['count']
        assert {x['clip_id'] for x in members} == expected
        assert all(x == refs[x['clip_id']] for x in members)
    for group, info in index['selections'].items():
        members = read(ROOT / info['path'])['clips']
        assert len(members) == info['count']
        assert all(x == refs[x['clip_id']] for x in members)
        expected = {cid for cid, label in labels.items() if
            (label['selection']['recommended'] if group == 'default' else
             label['selection']['status'] in ('clear', 'challenge') if group == 'all_usable' else
             label['selection']['status'] in ('clear', 'challenge') and not label['selection']['recommended'] if group == 'redundant' else
             label['selection']['status'] == group)}
        assert {x['clip_id'] for x in members} == expected, group
    relations = read(OUT / 'content-relations.json')['pairs']
    for cid, label in labels.items():
        assert label['content_relations'] == [p for p in relations if cid in p['clip_ids']]
        representative = label['selection'].get('representative_clip_id')
        if representative:
            assert representative in labels and labels[representative]['selection']['recommended']
    assert index['counts'] == dict(Counter(x['selection']['status'] for x in labels.values()))
    assert index['human_reviewed_count'] == sum(bool(label['provenance']['human_reviewed']) for label in labels.values())
    print(f'Structured labels OK: {len(labels)} clips, {len(DIMENSIONS)} explicit scenario fields each')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', type=Path)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    if args.results:
        build(args.results)
    if args.refresh:
        refresh()
    if args.check or args.results or args.refresh:
        check()
