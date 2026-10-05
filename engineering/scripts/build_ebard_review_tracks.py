"""Build independent E-BARD/ByteTrack proposals for the local acceptance library.

Player/referee trackers are separate. Ball and hoop boxes are frame detections,
not identity tracks or ground anchors. Existing candidate files are never replaced.
Run from the repository root with the existing vision environment.
"""
import argparse
import hashlib
import json
import math
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from player_proposals import box_iou, pending_candidates


ROLES = {2: 'player', 3: 'referee'}
OBJECTS = {0: 'basketball', 1: 'hoop'}
TRACKER_PARAMS = dict(track_high_thresh=.2, track_low_thresh=.07,
                      new_track_thresh=.2, track_buffer=30,
                      match_thresh=.8, fuse_score=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def global_tracks(role, raw, id_map):
    """Compact output IDs stay unique even if tracker internals reuse counters."""
    result = []
    for row in raw:
        key = (role, int(row[4]))
        if key not in id_map:
            id_map[key] = len(id_map) + 1
        result.append([*map(float, row[:4]), id_map[key], float(row[5]), int(row[6])])
    return result


def role_conflicts(tracks, threshold=.75):
    """Flag likely cross-class duplicates; preserve both for human review."""
    players = [row for row in tracks if int(row[6]) == 2]
    referees = [row for row in tracks if int(row[6]) == 3]
    return [{'playerTrackId': int(player[4]), 'refereeTrackId': int(referee[4]),
             'trackIds': [int(player[4]), int(referee[4])],
             'iou': round(overlap, 6), 'status': 'needs_review'}
            for player in players for referee in referees
            if (overlap := box_iou(player, referee)) >= threshold]


def frame_objects(raw, threshold=.25):
    return [{'kind': OBJECTS[int(row[5])], 'box': list(map(float, row[:4])),
             'score': float(row[4]), 'source': 'model', 'groundPoint': False}
            for row in raw if int(row[5]) in OBJECTS and row[4] >= threshold]


def verify_records(records, expected_frames):
    if len(records) != expected_frames:
        raise ValueError(f'Frame count mismatch: {len(records)} != {expected_frames}')
    seen_roles, previous_time = {}, -math.inf
    for index, record in enumerate(records):
        if record['frame'] != index or not math.isfinite(record['time']) or record['time'] <= previous_time:
            raise ValueError(f'Invalid frame/time order: {index}')
        previous_time = record['time']
        ids = [int(row[4]) for row in record['tracks']]
        if len(ids) != len(set(ids)):
            raise ValueError(f'Duplicate output ID at frame {index}')
        for row in record['tracks']:
            if len(row) != 7 or not all(math.isfinite(value) for value in row):
                raise ValueError('Invalid track row')
            if int(row[6]) not in ROLES:
                raise ValueError('Non-person class in identity tracks')
            role = ROLES[int(row[6])]
            key = str(int(row[4]))
            if record['track_roles'].get(key) != role or seen_roles.get(key, role) != role:
                raise ValueError('Identity role changed')
            seen_roles[key] = role
        if set(record['track_roles']) != set(map(str, ids)):
            raise ValueError('Role table differs from visible track IDs')
        for row in record['pending_detections']:
            if len(row) != 6 or int(row[5]) not in ROLES:
                raise ValueError('Invalid pending person candidate')
        for obj in record['objects']:
            if obj['kind'] not in OBJECTS.values() or obj['groundPoint'] is not False or 'trackId' in obj:
                raise ValueError('Object detection must not be a person/ground/identity track')
    return True


def summarize_tracks(records):
    observations, classes = defaultdict(list), {}
    for record in records:
        for row in record['tracks']:
            tid = str(int(row[4]))
            observations[tid].append(record['frame'])
            classes[tid] = ROLES[int(row[6])]
    summaries = []
    for tid, frames in observations.items():
        intervals = []
        for frame in frames:
            if intervals and frame == intervals[-1][1] + 1:
                intervals[-1][1] = frame
            else:
                intervals.append([frame, frame])
        summaries.append({'trackId': int(tid), 'role': classes[tid], 'observations': len(frames),
                          'firstFrame': frames[0], 'lastFrame': frames[-1], 'visibleIntervals': intervals})
    return sorted(summaries, key=lambda item: item['trackId'])


def longest_runs(summaries):
    result = {}
    for role in ROLES.values():
        spans = [{'trackId': item['trackId'], 'startFrame': start, 'endFrame': end,
                  'frames': end - start + 1}
                 for item in summaries if item['role'] == role
                 for start, end in item['visibleIntervals']]
        result[role] = max(spans, key=lambda span: span['frames']) if spans else None
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', default='data/videos/tactics/acceptance/review-library.json')
    parser.add_argument('--model', default='tmp/ebard-probe/BODD_yolov8n_0001.pt')
    parser.add_argument('--output-dir', default='data/videos/tactics/acceptance/tracks')
    parser.add_argument('--suffix', default='ebard')
    parser.add_argument('--imgsz', type=int, default=704)
    parser.add_argument('--report', default='research/vision/vision-player-refinement/ebard-tracking-probe.json')
    parser.add_argument('--previews', default='artifacts/ebard-tracking-probe')
    args = parser.parse_args()
    from benchmark_ebard import load_detector
    import av
    import cv2
    import numpy as np
    import torch
    import ultralytics
    from ultralytics.engine.results import Boxes
    from ultralytics.trackers.byte_tracker import BYTETracker

    library = json.loads(Path(args.library).read_text(encoding='utf-8'))
    targets = [Path(args.output_dir) / f'{sample["id"]}-{args.suffix}.json' for sample in library['samples']]
    protected = [Path(args.report), *targets, *(p.with_suffix('.meta.json') for p in targets)]
    if any(path.exists() for path in protected):
        parser.error('Choose fresh output paths; existing measurements are preserved')
    for sample in library['samples']:
        if sha256(sample['video']) != sample['videoSha256']:
            raise ValueError(f'Video hash mismatch: {sample["id"]}')
    model_hash = sha256(args.model)
    cv2.setNumThreads(4)
    cuda = torch.cuda.is_available()
    settings = dict(imgsz=args.imgsz, conf=.07, iou=.5, device=0 if cuda else 'cpu', half=cuda, verbose=False)
    started = time.perf_counter()
    model = load_detector(Path(args.model))
    if model.names != {0: 'basketball', 1: 'hoop', 2: 'player', 3: 'referee'}:
        raise ValueError(f'Unexpected E-BARD classes: {model.names}')
    for _ in range(3):
        model.predict(np.zeros((720, 1280, 3), dtype=np.uint8), **settings)
    load_warmup_seconds = time.perf_counter() - started
    preview_dir = Path(args.previews)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report = {'collectedAt': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
              'source': 'https://huggingface.co/GabrieleGiudici/E-BARD-detection-models',
              'pipelineVersion': 'ebard-yolov8n-bytetrack-v1',
              'device': torch.cuda.get_device_name(0) if cuda else 'cpu',
              'torch': torch.__version__, 'ultralytics': ultralytics.__version__,
              'modelSha256': model_hash, 'loadAndWarmupSeconds': load_warmup_seconds,
              'detection': settings, 'tracker': TRACKER_PARAMS,
              'identityAccuracyValidated': False, 'footAccuracyValidated': False,
              'notes': ['Separate player/referee ByteTrack instances; compact globally unique output IDs within each video.',
                        'No maximum-ten restriction, jersey filter or image-region filter.',
                        'Cross-role tracks with IoU >= 0.75 are retained and flagged; classification remains uncertain.',
                        'Basketball/hoop are per-frame detections at confidence >= 0.25, not temporal object trajectories or ground anchors.',
                        'Track count/coverage is not identity accuracy; Kalman predictions during missing frames are not exported as observed points.',
                        'Processing time includes decoding/detection/tracking/record collection, excludes loading/warmup/previews/JSON writing.'],
              'runs': []}
    for sample, output in zip(library['samples'], targets):
        trackers = {role: BYTETracker(SimpleNamespace(**TRACKER_PARAMS)) for role in ROLES.values()}
        records, id_map, snapshots, predict_timings, track_timings = [], {}, [], [], []
        start = time.perf_counter()
        with av.open(sample['video']) as container:
            stream = container.streams.video[0]
            expected = stream.frames
            preview_frames = {0, expected // 3, 2 * expected // 3, expected - 1}
            frame_rate = float(stream.average_rate)
            for index, frame in enumerate(container.decode(video=0)):
                image = frame.to_ndarray(format='bgr24')
                height, width = image.shape[:2]
                before = time.perf_counter()
                raw = model.predict(image, **settings)[0].boxes.data.cpu().numpy()
                if cuda:
                    torch.cuda.synchronize()
                predict_timings.append(time.perf_counter() - before)
                before = time.perf_counter()
                rows, pending = [], []
                for cls, role in ROLES.items():
                    candidates = raw[raw[:, 5] == cls]
                    tracked = trackers[role].update(Boxes(candidates, image.shape[:2]), image).reshape(-1, 8)
                    pending.extend(pending_candidates(candidates, tracked))
                    rows.extend(global_tracks(role, tracked, id_map))
                record = {'frame': index, 'time': float(frame.time), 'tracks': rows,
                          'track_roles': {str(row[4]): ROLES[row[6]] for row in rows},
                          'pending_detections': np.asarray(pending).tolist(),
                          'candidate_count': int(np.sum(np.isin(raw[:, 5], list(ROLES)))),
                          'role_conflicts': role_conflicts(rows), 'objects': frame_objects(raw)}
                records.append(record)
                track_timings.append(time.perf_counter() - before)
                if index in preview_frames:
                    snapshots.append((index, image.copy(), record))
        wall_seconds = time.perf_counter() - start
        verify_records(records, expected)
        summaries = summarize_tracks(records)
        metadata = {'video_sha256': sample['videoSha256'], 'frames': len(records), 'width': width, 'height': height,
                    'frame_rate': frame_rate, 'first_time': records[0]['time'], 'last_time': records[-1]['time'],
                    'model': Path(args.model).name, 'model_sha256': model_hash, 'class_names': model.names,
                    'detector_id': 'ebard_yolov8n', 'pipeline_version': report['pipelineVersion'],
                    'tracker': 'ByteTrack', 'tracker_parameters': TRACKER_PARAMS, 'detection_parameters': settings,
                    'identity_verified': False, 'object_tracking': False, 'foot_method': 'bbox_bottom_center',
                    'cross_role_policy': 'preserve_and_flag_iou_at_least_0.75',
                    'object_confidence': .25, 'candidate_filter_note': 'No jersey/image-region/fixed-count filtering',
                    'processing_seconds': wall_seconds}
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(records, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
        metadata['tracks_sha256'] = sha256(output)
        output.with_suffix('.meta.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
        run = {'sample': sample['id'], 'videoSha256': sample['videoSha256'], 'tracksSha256': metadata['tracks_sha256'],
               'output': output.as_posix(), 'frames': len(records), 'frameRate': frame_rate,
               'firstTime': records[0]['time'], 'lastTime': records[-1]['time'],
               'processingSeconds': wall_seconds, 'predictMedianMs': float(np.median(predict_timings) * 1000),
               'trackingAndRecordsMedianMs': float(np.median(track_timings) * 1000),
               'distinctTracksByRole': dict(Counter(row['role'] for row in summaries)),
               'longestConsecutiveTrackByRole': longest_runs(summaries),
               'framesWithRoleConflicts': sum(bool(record['role_conflicts']) for record in records),
               'framesWithObjects': {name: sum(any(obj['kind'] == name for obj in record['objects']) for record in records)
                                     for name in OBJECTS.values()},
               'tracks': summaries}
        report['runs'].append(run)
        for index, image, record in snapshots:
            for row in record['tracks']:
                x1, y1, x2, y2 = map(int, row[:4])
                role = record['track_roles'][str(row[4])]
                color = (60, 220, 90) if role == 'player' else (255, 180, 30)
                cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
                cv2.putText(image, f'T{row[4]} {role} {row[5]:.2f}', (x1, max(18, y1 - 4)),
                            cv2.FONT_HERSHEY_SIMPLEX, .5, color, 1, cv2.LINE_AA)
                cv2.circle(image, ((x1 + x2) // 2, y2), 4, color, -1)
            for obj in record['objects']:
                x1, y1, x2, y2 = map(int, obj['box'])
                cv2.rectangle(image, (x1, y1), (x2, y2), (240, 90, 230), 2)
                cv2.putText(image, obj['kind'], (x1, max(18, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, .45, (240, 90, 230), 1)
            cv2.imwrite(str(preview_dir / f'{sample["id"]}-{index:03d}.jpg'), cv2.resize(image, (1280, 720)))
        print(json.dumps({key: value for key, value in run.items() if key != 'tracks'}), flush=True)
    report['totalProcessingSeconds'] = sum(run['processingSeconds'] for run in report['runs'])
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
