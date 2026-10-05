"""Export the existing live-test results for synchronized, read-only replay. No API calls."""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def xy(point):
    values = [point.get('x'), point.get('y')]
    return values if all(isinstance(v, (int, float)) and math.isfinite(v) for v in values) else None


def export(source, destination, label):
    destination.mkdir(parents=True, exist_ok=True)
    samples = []
    descriptions = {
        '001': ('弗拉格片', '深蓝球衣 · 白色头带 · T10', 'left',
                '局部脚点有改善，仍需逐帧核对。', [(930, '对比脚点'), (989, '标定缺口')]),
        '002': ('阿门片', '白色 1 号 · T72', 'right',
                '存在误删：源帧 1155 的球员仍可见，Qwen 却没有给出位置。',
                [(990, '突破段'), (1063, '模型未知段'), (1155, '检查误删')]),
    }
    for case, (title, player, side, note, checkpoints) in descriptions.items():
        sample_id = f'official-training-{case}'
        folder = source / sample_id
        clip = read(folder / 'clip.json')
        session = read(folder / 'session.json')
        result = read(folder / f'result-{label}.json')
        candidate = result['candidate']
        preparation = session['courtPreparation']
        if clip['video_sha256'] != preparation['videoSha256']:
            raise ValueError(f'{sample_id}: preparation belongs to a different video')
        entity_id = candidate['entityIds'][0]
        entity = next(e for e in session['entities'] if e['id'] == entity_id)
        start = candidate['range']['startFrame']
        end = candidate['range']['endFrameExclusive']
        unknown = [r for r in candidate['unknownRanges'] if r['entityId'] == entity_id]
        frames = []
        for frame in range(start, end):
            record = clip['frames'][frame]
            binding = next((b for b in entity.get('bindings', []) if b['start'] <= frame <= b['end']), {})
            box = next((t[:4] for t in record['tracks'] if t[4] == binding.get('trackId')), None)
            raw = preparation['rawByPlayer'][entity_id][frame]
            proposed = candidate['pointsByPlayer'][entity_id][frame]
            mapping = preparation['maps'][frame]
            frames.append({
                'frame': frame, 'time': record['time'], 'bbox': box,
                'raw': xy(raw), 'qwen': xy(proposed),
                'rawImage': raw.get('imagePoint'),
                'toImage': mapping.get('toImage') if mapping else None,
                'rawState': raw.get('source'),
                'unknown': next((r['reason'] for r in unknown if r['startFrame'] <= frame < r['endFrameExclusive']), None),
            })
        summary = {
            'id': sample_id, 'title': f'官方训练 {case} · {title}', 'player': player,
            'videoHash': clip['video_sha256'], 'side': side, 'note': note,
            'status': result['status'], 'startTime': frames[0]['time'],
            'endTime': clip['frames'][end]['time'] if end < len(clip['frames']) else clip['mediaEndTime'],
            'counts': {'total': len(frames), **{k: sum(f[k] is not None for f in frames) for k in ('raw', 'qwen')}},
        }
        data = {**summary, 'schemaVersion': 1, 'jobId': result['jobId'], 'version': label,
                'width': clip['width'], 'height': clip['height'], 'entityId': entity_id,
                'checkpoints': [{'frame': f, 'label': text} for f, text in checkpoints],
                'anchors': [a['frame'] for a in candidate['anchors'] if a['entityId'] == entity_id],
                'frames': frames, 'reviewRequired': True}
        (destination / f'{sample_id}.json').write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        samples.append(summary)
    (destination / 'index.json').write_text(json.dumps({'samples': samples}, ensure_ascii=False, indent=2), encoding='utf-8')
    return samples


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'artifacts/qwen-official-20261005')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/player-review-replays')
    parser.add_argument('--label', default='optimized-v4')
    args = parser.parse_args()
    for sample in export(args.source, args.output, args.label):
        print(json.dumps({'sample': sample['id'], **sample['counts']}))
