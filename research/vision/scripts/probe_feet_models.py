"""Compare foot-location proposals on registered basketball clips, without editing tracks.

RTMPose-s reuses E-BARD player boxes. YOLOv8s-pose performs full-frame detection;
its poses are associated to those boxes by one-to-one IoU for this comparison.
No output is a ground-contact label or an accuracy score.
"""
import argparse
import builtins
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
import zipfile
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[3]
MODEL_URL = ('https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/'
             'rtmpose-s_simcc-body7_pt-body7-halpe26_700e-256x192-7f134165_20230605.zip')
sys.path.insert(0, str(ROOT / 'tmp/ground-model-deps'))
os.environ.update(TORCH_FORCE_WEIGHTS_ONLY_LOAD='1', YOLO_AUTOINSTALL='false',
                  YOLO_OFFLINE='true', YOLO_CONFIG_DIR=str(ROOT / 'tmp/vision-benchmark-settings'))
import cv2
import numpy as np
import onnxruntime as ort
import torch
from rtmlib import RTMPose
from ultralytics import YOLO
from ultralytics.nn.modules import Bottleneck, C2f, Concat, Conv, Detect, DFL, SPPF, Pose
from ultralytics.nn.tasks import PoseModel

FEET = {'left': [20, 22, 24], 'right': [21, 23, 25]}
LANDMARK_NAMES = {20: 'left_big_toe', 21: 'right_big_toe', 22: 'left_small_toe',
                  23: 'right_small_toe', 24: 'left_heel', 25: 'right_heel'}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fetch_model(directory):
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / 'rtmpose-s-halpe26.zip'
    if not archive.exists():
        urllib.request.urlretrieve(MODEL_URL, archive)
    model_files = list((directory / 'rtmpose-s').rglob('end2end.onnx'))
    if not model_files:
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                target = (directory / 'rtmpose-s' / name).resolve()
                if not target.is_relative_to((directory / 'rtmpose-s').resolve()):
                    raise ValueError('Archive path leaves model directory')
            z.extractall(directory / 'rtmpose-s')
        model_files = list((directory / 'rtmpose-s').rglob('end2end.onnx'))
    if len(model_files) != 1:
        raise ValueError('Expected exactly one RTMPose ONNX')
    return model_files[0]


def load_yolo_pose(path):
    allowed = [PoseModel, Conv, C2f, Bottleneck, SPPF, Concat, Detect, Pose, DFL,
               torch.nn.ModuleList, torch.nn.Sequential, torch.nn.Upsample,
               torch.nn.SiLU, torch.nn.MaxPool2d, torch.nn.Conv2d,
               torch.nn.BatchNorm2d, builtins.getattr]
    names = {f'{x.__module__}.{x.__name__}' for x in allowed}
    unexpected = set(torch.serialization.get_unsafe_globals_in_checkpoint(path)) - names
    if unexpected:
        raise ValueError(f'Unexpected checkpoint globals: {sorted(unexpected)}')
    with torch.serialization.safe_globals(allowed):
        return YOLO(str(path))


def box_iou(a, b):
    lo, hi = np.maximum(a[:2], b[:2]), np.minimum(a[2:4], b[2:4])
    intersection = np.prod(np.maximum(hi - lo, 0))
    area_a, area_b = np.prod(a[2:4] - a[:2]), np.prod(b[2:4] - b[:2])
    return float(intersection / max(area_a + area_b - intersection, 1e-9))


def match_boxes(boxes, poses, threshold=.4):
    edges = sorted([(box_iou(a, b), i, j) for i, a in enumerate(boxes)
                    for j, b in enumerate(poses)], reverse=True)
    result, used = {}, set()
    for iou, i, j in edges:
        if iou >= threshold and i not in result and j not in used:
            result[i] = {'index': j, 'iou': iou}
            used.add(j)
    return result


def foot_candidate(points, scores, threshold):
    feet = {}
    for side, indices in FEET.items():
        valid = [i for i in indices if float(scores[i]) >= threshold]
        feet[side] = {
            'landmarks': [{'index': i, 'pixel': points[i].tolist(), 'score': float(scores[i])}
                          for i in indices],
            'candidatePixel': points[valid].mean(0).tolist() if len(valid) >= 2 else None,
            'acceptedLandmarkCount': len(valid), 'contactState': 'unknown',
        }
    anchors = [v['candidatePixel'] for v in feet.values() if v['candidatePixel'] is not None]
    return {'feet': feet, 'pixel': np.mean(anchors, axis=0).tolist() if anchors else None,
            'source': 'rtmpose_s_halpe26_foot_landmark_average',
            'groundPoint': False, 'contactState': 'unknown', 'needsReview': True}


def reference_feet(points, scores, threshold, image_size):
    """Return one visible landmark proposal per foot, never a claimed contact point."""
    width, height = image_size
    feet = {}
    for side, indices in FEET.items():
        landmarks = [{'index': i, 'name': LANDMARK_NAMES[i],
                      'x': round(float(points[i][0]), 2), 'y': round(float(points[i][1]), 2),
                      'score': round(float(scores[i]), 4)} for i in indices]
        valid = [p for p in landmarks if p['score'] >= threshold and
                 0 <= p['x'] < width and 0 <= p['y'] < height]
        if len(valid) >= 2:
            best = max(valid, key=lambda p: p['score'])
            feet[side] = {**best, 'sourceLandmark': best['name'], 'landmarks': landmarks,
                          'needsReview': True, 'groundPoint': False, 'contactState': 'unknown'}
        else:
            feet[side] = None
        # Raw low-score or out-of-image predictions remain inspectable, but are not proposals.
        feet[side + 'Landmarks'] = landmarks
    return feet


def load_rtm(path, threads):
    model = RTMPose(str(path), model_input_size=(192, 256), backend='onnxruntime', device='cpu')
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    model.session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
    return model


def run_cache(args):
    """Precompute only RTMPose, preserving every original track and video byte."""
    cv2.setNumThreads(args.threads)
    model_path = fetch_model(ROOT / 'tmp/feet-models-v2')
    start = time.perf_counter()
    rtm = load_rtm(model_path, args.threads)
    rtm(np.zeros((720, 1280, 3), np.uint8), [[200, 100, 300, 400]])
    initialization = time.perf_counter() - start
    library = json.loads((ROOT / 'data/videos/tactics/acceptance/review-library.json').read_text('utf-8'))
    summary = {'collectedAt': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
               'device': 'cpu', 'threads': args.threads, 'initializationSeconds': initialization,
               'timingScope': 'per-clip loop includes sequential video decode, crop, inference, postprocess, result collection; excludes load/warmup/hash/write',
               'clips': []}
    for sample in library['samples']:
        target = ROOT / f'research/vision/vision-player-refinement/feet-candidates-{sample["id"]}.json'
        if target.exists() and not args.replace_cache:
            raise ValueError(f'Cache exists: {target}; pass --replace-cache explicitly')
        video_path = ROOT / sample['video']
        if sha(video_path) != sample['videoSha256']:
            raise ValueError('Video SHA mismatch')
        tracking_path = ROOT / next(v['tracks'] for v in sample['trackingVariants'] if v['id'] == 'ebard')
        records = json.loads(tracking_path.read_text('utf-8'))
        result = {'schemaVersion': 1, 'videoHash': sample['videoSha256'],
                  'trackingFingerprint': sha(tracking_path), 'source': 'rtmpose_s_halpe26',
                  'contactState': 'unknown', 'groundPoint': False,
                  'model': {'sha256': sha(model_path), 'url': MODEL_URL, 'rtmlib': '0.0.16',
                            'threshold': args.threshold, 'inputSize': [192, 256]},
                  'proposalRule': 'At least two in-image toe/heel landmarks score >= threshold; select highest-score landmark per foot. Never average both feet or infer ground contact.',
                  'frames': []}
        cap = cv2.VideoCapture(str(video_path))
        people, left_count, right_count, pose_seconds = 0, 0, 0, 0.
        start = time.perf_counter()
        for frame_index, record in enumerate(records):
            ok, frame = cap.read()
            if not ok or record['frame'] != frame_index:
                raise ValueError(f'Frame mismatch in {sample["id"]}:{frame_index}')
            tracks = [r for r in record['tracks'] if record['track_roles'].get(str(r[4])) == 'player']
            boxes = np.asarray([t[:4] for t in tracks], dtype=np.float32).reshape(-1, 4)
            started_pose = time.perf_counter()
            if len(boxes):
                points, scores = rtm(frame, boxes)
            else:
                points, scores = np.empty((0, 26, 2)), np.empty((0, 26))
            pose_seconds += time.perf_counter() - started_pose
            observations = []
            for i, track in enumerate(tracks):
                proposal = reference_feet(points[i], scores[i], args.threshold, (frame.shape[1], frame.shape[0]))
                observations.append({'trackId': int(track[4]), **proposal,
                                     'contactState': 'unknown', 'groundPoint': False})
                left_count += proposal['left'] is not None
                right_count += proposal['right'] is not None
            people += len(tracks)
            result['frames'].append({'frame': frame_index, 'time': record['time'], 'feet': observations})
        has_extra, _ = cap.read()
        if has_extra:
            raise ValueError('Video has more frames than track cache')
        cap.release()
        loop_seconds = time.perf_counter() - start
        target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
        clip_summary = {'sampleId': sample['id'], 'frames': len(records), 'personObservations': people,
                        'leftCandidates': left_count, 'rightCandidates': right_count,
                        'loopSeconds': loop_seconds, 'poseSeconds': pose_seconds,
                        'cacheBytes': target.stat().st_size, 'cacheSha256': sha(target),
                        'trackingFingerprint': result['trackingFingerprint']}
        summary['clips'].append(clip_summary)
        print(json.dumps(clip_summary), flush=True)
    summary['totalLoopSeconds'] = sum(c['loopSeconds'] for c in summary['clips'])
    summary['totalPoseSeconds'] = sum(c['poseSeconds'] for c in summary['clips'])
    summary_path = ROOT / 'research/vision/vision-player-refinement/feet-model-full-run.json'
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))


def dot(image, point, color, radius=4):
    cv2.circle(image, tuple(np.round(point).astype(int)), radius, color, -1, cv2.LINE_AA)


def draw(frame, observations, threshold):
    overlay = frame.copy()
    for obs in observations:
        x1, y1, x2, y2 = np.round(obs['box']).astype(int)
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (105, 112, 124), 1)
        cv2.putText(overlay, f"T{obs['trackId']}", (x1, max(y1 - 4, 16)),
                    cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 2, cv2.LINE_AA)
        dot(overlay, obs['bboxBottomCenter'], (0, 220, 255), 5)
        for side, foot in obs['rtmpose']['feet'].items():
            color = (255, 230, 20) if side == 'left' else (220, 50, 255)
            for kpt in foot['landmarks']:
                if kpt['score'] >= threshold:
                    dot(overlay, kpt['pixel'], color, 3)
        if obs['yoloPose']:
            for point in obs['yoloPose']['ankles']:
                if point['score'] >= threshold:
                    loc = tuple(np.round(point['pixel']).astype(int))
                    cv2.circle(overlay, loc, 6, (255, 255, 255), 2, cv2.LINE_AA)
    return overlay


def make_crops(frame, observations, path, threshold):
    width, height = frame.shape[1], frame.shape[0]
    tile_w, tile_h = 320, 330
    tiles = []
    for obs in observations:
        # Draw only this person's proposals so nearby players do not obscure association.
        overlay = draw(frame, [obs], threshold)
        x1, y1, x2, y2 = obs['box']
        span_x, span_y = max(x2-x1, 25), max(y2-y1, 25)
        left, right = max(int(x1-.5*span_x), 0), min(int(x2+.5*span_x), width)
        top, bottom = max(int(y2-.52*span_y), 0), min(int(y2+.15*span_y), height)
        crop = overlay[top:bottom, left:right]
        if not crop.size:
            continue
        ratio = min(tile_w / crop.shape[1], (tile_h - 38) / crop.shape[0])
        resized = cv2.resize(crop, None, fx=ratio, fy=ratio, interpolation=cv2.INTER_NEAREST)
        tile = np.full((tile_h, tile_w, 3), 27, np.uint8)
        tile[38:38+resized.shape[0], :resized.shape[1]] = resized
        accepted = sum(f['acceptedLandmarkCount'] for f in obs['rtmpose']['feet'].values())
        cv2.putText(tile, f"T{obs['trackId']} feet {accepted}/6  box {span_y:.0f}px",
                    (8, 24), cv2.FONT_HERSHEY_SIMPLEX, .52, (245, 245, 245), 1, cv2.LINE_AA)
        tiles.append(tile)
    while len(tiles) % 4:
        tiles.append(np.full((tile_h, tile_w, 3), 27, np.uint8))
    if tiles:
        cv2.imwrite(str(path), np.vstack([np.hstack(tiles[i:i+4]) for i in range(0, len(tiles), 4)]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='artifacts/feet-models-v2')
    parser.add_argument('--frames-per-clip', type=int, default=4)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--yolo-device', default='cpu')
    parser.add_argument('--threshold', type=float, default=.3)
    parser.add_argument('--cache-only', action='store_true', help='Generate full-frame independent RTMPose proposal caches, without YOLO inference')
    parser.add_argument('--replace-cache', action='store_true', help='Explicitly regenerate existing foot proposal caches')
    args = parser.parse_args()
    if args.cache_only:
        run_cache(args)
        return
    output = ROOT / args.output
    if (output / 'report.json').exists():
        parser.error('Choose a fresh output directory to preserve measurements')
    output.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(args.threads)
    torch.set_num_threads(args.threads)
    model_path = fetch_model(ROOT / 'tmp/feet-models-v2')
    start = time.perf_counter()
    rtm = load_rtm(model_path, args.threads)
    rtm_load = time.perf_counter() - start
    yolo_path = ROOT / 'tmp/vision-deploy-bench/yolov8s-pose.pt'
    start = time.perf_counter()
    yolo = load_yolo_pose(yolo_path)
    yolo_load = time.perf_counter() - start
    dummy = np.zeros((720, 1280, 3), np.uint8)
    rtm(dummy, [[200, 100, 300, 400]])
    yolo.predict(dummy, imgsz=704, device=args.yolo_device, half=args.yolo_device != 'cpu', conf=.15, verbose=False)
    library = json.loads((ROOT / 'data/videos/tactics/acceptance/review-library.json').read_text('utf-8'))
    report = {
        'collectedAt': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
        'scope': 'Foot location proposals; no contact labels or ground truth accuracy',
        'rtmpose': {'url': MODEL_URL, 'sha256': sha(model_path), 'bytes': model_path.stat().st_size,
                    'runtime': f'onnxruntime {ort.__version__}', 'device': 'cpu', 'threads': args.threads,
                    'rtmlib': '0.0.16', 'inputSize': [192, 256], 'loadSeconds': rtm_load},
        'yoloPose': {'path': str(yolo_path.relative_to(ROOT)).replace('\\', '/'),
                     'sha256': sha(yolo_path), 'bytes': yolo_path.stat().st_size,
                     'device': args.yolo_device, 'imgsz': 704, 'conf': .15, 'loadSeconds': yolo_load},
        'method': {'rtmInput': 'precomputed E-BARD player box, 1.25 padding by rtmlib',
                   'yoloInput': 'full frame; one-to-one descending IoU match >= 0.4',
                   'threshold': args.threshold, 'candidateRule': '>=2 accepted landmarks per foot; mean each foot, then mean accepted feet',
                   'timing': 'warm inference + preprocess + postprocess; excludes decode/load/warmup/render/write and E-BARD detection'},
        'frames': [],
    }
    for sample in library['samples']:
        video = ROOT / sample['video']
        if sha(video) != sample['videoSha256']:
            raise ValueError('Video SHA mismatch')
        records = json.loads((ROOT / next(v['tracks'] for v in sample['trackingVariants'] if v['id'] == 'ebard')).read_text('utf-8'))
        cap = cv2.VideoCapture(str(video))
        indices = sorted(set(np.linspace(0, len(records)-1, args.frames_per_clip, dtype=int).tolist()))
        for frame_index in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                raise ValueError(f'Cannot decode {sample["id"]}:{frame_index}')
            record = records[frame_index]
            tracks = [r for r in record['tracks'] if record['track_roles'].get(str(r[4])) == 'player']
            boxes = np.asarray([t[:4] for t in tracks], dtype=np.float32).reshape(-1, 4)
            start = time.perf_counter()
            if len(boxes):
                points, scores = rtm(frame, boxes)
            else:
                points, scores = np.empty((0, 26, 2)), np.empty((0, 26))
            rtm_seconds = time.perf_counter()-start
            start = time.perf_counter()
            pose_result = yolo.predict(frame, imgsz=704, device=args.yolo_device,
                                       half=args.yolo_device != 'cpu', conf=.15, verbose=False)[0]
            yolo_seconds = time.perf_counter()-start
            yolo_boxes = pose_result.boxes.xyxy.cpu().numpy()
            matches = match_boxes(boxes, yolo_boxes)
            kp = pose_result.keypoints.data.cpu().numpy()
            observations = []
            for i, track in enumerate(tracks):
                matched = matches.get(i)
                yolo_observation = None
                if matched:
                    j = matched['index']
                    yolo_observation = {'matchIou': matched['iou'], 'ankles': [
                        {'index': k, 'pixel': kp[j, k, :2].tolist(), 'score': float(kp[j, k, 2])} for k in (15, 16)]}
                observations.append({'trackId': int(track[4]), 'box': boxes[i].tolist(),
                                     'bboxBottomCenter': [float((track[0]+track[2])/2), float(track[3])],
                                     'rtmpose': foot_candidate(points[i], scores[i], args.threshold),
                                     'yoloPose': yolo_observation})
            name = f'{sample["id"]}-{frame_index:03d}'
            overlay = draw(frame, observations, args.threshold)
            cv2.imwrite(str(output / f'{name}.jpg'), overlay)
            make_crops(frame, observations, output / f'{name}-feet.jpg', args.threshold)
            report['frames'].append({'sampleId': sample['id'], 'videoSha256': sample['videoSha256'],
                                     'frame': frame_index, 'time': record['time'],
                                     'rtmposeSeconds': rtm_seconds, 'yoloSeconds': yolo_seconds,
                                     'observations': observations})
            print(f'{name}: people={len(boxes)} RTM={rtm_seconds:.3f}s YOLO={yolo_seconds:.3f}s', flush=True)
        cap.release()
    all_obs = [o for f in report['frames'] for o in f['observations']]
    accepted = [o for o in all_obs if o['rtmpose']['pixel'] is not None]
    matched = [o for o in all_obs if o['yoloPose'] is not None]
    ankle_valid = [o for o in matched if any(k['score'] >= args.threshold for k in o['yoloPose']['ankles'])]
    displacement = [np.linalg.norm(np.array(o['rtmpose']['pixel'])-o['bboxBottomCenter']) for o in accepted]
    report['summary'] = {
        'frames': len(report['frames']), 'personObservations': len(all_obs),
        'rtmposeCandidateCount': len(accepted),
        'rtmposeBothFeetCandidateCount': sum(all(f['candidatePixel'] is not None for f in o['rtmpose']['feet'].values()) for o in all_obs),
        'rtmposeAllSixLandmarksCount': sum(all(f['acceptedLandmarkCount']==3 for f in o['rtmpose']['feet'].values()) for o in all_obs),
        'yoloMatchedPersonCount': len(matched), 'yoloAtLeastOneAcceptedAnkleCount': len(ankle_valid),
        'rtmposeSeconds': sum(f['rtmposeSeconds'] for f in report['frames']),
        'yoloSeconds': sum(f['yoloSeconds'] for f in report['frames']),
        'rtmVersusBoxPixelsMedian': float(np.median(displacement)) if displacement else None,
        'rtmVersusBoxPixelsP90': float(np.percentile(displacement,90)) if displacement else None,
        'note': 'Coverage and displacement are not accuracy; poses and boxes can both be wrong.'}
    text = json.dumps(report, ensure_ascii=False, indent=2)
    (output / 'report.json').write_text(text+'\n', encoding='utf-8')
    shared = ROOT / 'research/vision/vision-player-refinement/feet-model-comparison.json'
    shared.write_text(text+'\n', encoding='utf-8')
    cards = ''.join(f'<section><h2>{f["sampleId"]} / frame {f["frame"]}</h2><a href="{f["sampleId"]}-{f["frame"]:03d}.jpg"><img src="{f["sampleId"]}-{f["frame"]:03d}.jpg"></a><img src="{f["sampleId"]}-{f["frame"]:03d}-feet.jpg"></section>' for f in report['frames'])
    (output / 'index.html').write_text('<!doctype html><html lang="zh"><meta charset="utf-8"><title>脚部候选模型对照</title><style>body{background:#eee9df;color:#182d34;font:17px system-ui;margin:30px auto;max-width:1280px}img{width:100%;margin:12px 0}section{background:white;padding:16px;margin:24px 0;border-radius:12px}p{line-height:1.7}</style><h1>脚部候选模型对照</h1><p>黄点：人物框底中心；青色：RTMPose 左脚趾/脚跟；紫色：右脚；白圈：YOLOv8s-pose 脚踝。只画分数 ≥ 0.3 的点。所有自动候选仍需人工确认是否接地；没有把关键点写进正式轨迹。</p>'+cards+'</html>', encoding='utf-8')
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
