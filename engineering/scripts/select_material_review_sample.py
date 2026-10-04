"""Create a fixed 40-clip coverage sample including already completed human reviews."""
from collections import Counter
from pathlib import Path
import random

from build_material_labels import DIMENSIONS, ROOT, write
from serve_material_label_review import ReviewStore, now

GROUPS = [
    ('season_2024_25', '24–25赛季', 19, {'nba-2024-25-library100': 19}),
    ('season_2025_26', '25–26赛季', 8, {'nba-2025-26-batch030': 6, 'nba-2025-26-batch-008': 1, 'nba-2025-26-sample-001': 1}),
    ('thy_uploads', 'THY补充上传', 5, {'user-uploads-20261003': 2, 'user-uploads-20261003-batch02': 3}),
    ('user_uploads', '本次上传', 5, {'user-uploads-20261004': 5}),
    ('acceptance', '独立验收样例', 3, {'tactics-acceptance': 3}),
]


def select(store):
    clips = list(store.clips.values())
    summaries = store.summary()
    completed = {cid for cid, r in summaries.items() if r['status'] == 'completed' and not r['stale']}
    selected = set(completed)
    assert len(completed) <= 40, 'Already reviewed more than the target; choose a new plan explicitly.'
    rng = random.Random(20261004)
    shuffled = rng.sample(clips, len(clips))
    rarity = Counter(k for c in clips for k, v in c['label']['scenarios'].items() if v['value'] is True)

    def features(c):
        label = c['label']
        result = {'scenario:' + k for k, v in label['scenarios'].items() if v['value'] is True}
        result.add('quality:' + label['quality']['clarity'])
        result.add('scope:' + label['content']['scope'])
        result.add('dataset:' + c['dataset_id'])
        # Unknown matchups remain unknown; no season is inferred from uploaded names.
        if c['matchup'] != '对阵待核实': result.add('matchup:' + c['matchup'])
        if not label['selection']['recommended']: result.add('not_default:' + c['clip_id'])
        return result

    quotas = {dataset: count for _, _, _, batches in GROUPS for dataset, count in batches.items()}
    # Include the teaching exclusion and the verified contained duplicate for retention checks.
    for c in clips:
        if not c['machine_selection']['recommended']: selected.add(c['clip_id'])
    assert all(sum(c['clip_id'] in selected for c in clips if c['dataset_id'] == ds) <= count for ds, count in quotas.items())
    covered = set().union(*(features(store.clips[cid]) for cid in selected)) if selected else set()
    while len(selected) < 40:
        candidates = [c for c in shuffled if c['clip_id'] not in selected and
                      sum(x in selected for x, v in store.clips.items() if v['dataset_id'] == c['dataset_id']) < quotas[c['dataset_id']]]
        assert candidates
        def score(c):
            unseen = features(c) - covered
            coverage = sum(10 + 100 / rarity[f.split(':', 1)[1]] if f.startswith('scenario:') else
                           6 if f.startswith('quality:') else 5 if f.startswith('scope:') else 4 for f in unseen)
            # Spread completed LAC/NYK-heavy reviews across remaining matchups and positions.
            siblings = [v for cid, v in store.clips.items() if cid in selected and v['dataset_id'] == c['dataset_id']]
            diversity = 1 / (1 + sum(v['matchup'] == c['matchup'] for v in siblings))
            spacing = min((abs(int(c['number']) - int(v['number'])) for v in siblings), default=50) / 100
            return coverage + diversity + min(spacing, .5)
        chosen = max(candidates, key=score)
        selected.add(chosen['clip_id']); covered |= features(chosen)
    groups = []
    ordered = []
    for gid, title, count, batches in GROUPS:
        members = [c for c in clips if c['dataset_id'] in batches]
        ids = [c['clip_id'] for c in members if c['clip_id'] in selected]
        assert len(ids) == count
        ordered.extend(ids)
        groups.append({'id': gid, 'title': title, 'population': len(members), 'count': count, 'clip_ids': ids,
                       'already_reviewed': sum(cid in completed for cid in ids)})
    counts = Counter(k for cid in ordered for k, d in store.clips[cid]['label']['scenarios'].items() if d['value'] is True)
    assert set(counts) == set(DIMENSIONS), 'A scenario type was omitted.'
    sample = {'schema_version': '1.0.0', 'created_at': now(), 'target_count': 40, 'population': len(clips),
        'clip_ids': ordered, 'groups': groups, 'coverage': dict(counts),
        'completed_included_at_selection': sorted(completed),
        'dataset_counts': dict(Counter(store.clips[cid]['dataset_id'] for cid in ordered)),
        'quality_counts': dict(Counter(store.clips[cid]['label']['quality']['clarity'] for cid in ordered)),
        'reason': '固定分层覆盖抽检；已有11段审核计入40段，每个来源部分和8个批次均覆盖，兼顾场景、画质、比赛与片段位置，含排除与重复备选。',
        'method': '固定批次配额，保留已审核和去杂备选，按未覆盖场景及比赛多样性补足；固定种子20261004用于平分选择。',
        'scope_note': '用于人工抽检和发现标注错误；未抽中的135段保持AI初筛，不推算全库准确率。'}
    return sample


if __name__ == '__main__':
    store = ReviewStore(ROOT / 'artifacts/material-label-human-review')
    sample = select(store)
    path = ROOT / 'data/videos/classification/review-sample-40.json'
    assert not path.exists(), 'The selected review queue already exists; keep it stable during review.'
    write(path, sample)
    print('Sample:', [(g['title'], g['count']) for g in sample['groups']])
    print('Scenario coverage:', sample['coverage'])
    print('Quality:', sample['quality_counts'])
