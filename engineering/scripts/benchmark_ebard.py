"""Compare E-BARD and generic YOLO detections on registered local clips.

Outputs are offline proposals, not identity tracks or accuracy measurements.
No training, scene filter, tracker, calibration or production cache is modified.
"""
import argparse
import builtins
import hashlib
import json
import os
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ.update(TORCH_FORCE_WEIGHTS_ONLY_LOAD='1', YOLO_AUTOINSTALL='false',
                  YOLO_OFFLINE='true', YOLO_CONFIG_DIR=str(Path('tmp/vision-benchmark-settings').resolve()))

import av
import cv2
import numpy as np
import torch
import ultralytics
from ultralytics import YOLO
from ultralytics.nn.modules import Bottleneck, C2f, Concat, Conv, Detect, DFL, SPPF
from ultralytics.nn.tasks import DetectionModel


def load_detector(path):
    # Explicit known architecture allowlist; never fall back to arbitrary pickle loading.
    allowed = [DetectionModel, Conv, C2f, Bottleneck, SPPF, Concat, Detect, DFL,
               torch.nn.ModuleList, torch.nn.Sequential, torch.nn.Upsample,
               torch.nn.SiLU, torch.nn.MaxPool2d, torch.nn.Conv2d,
               torch.nn.BatchNorm2d, builtins.getattr]
    allowed_names = {f'{x.__module__}.{x.__name__}' for x in allowed}
    unexpected = set(torch.serialization.get_unsafe_globals_in_checkpoint(path)) - allowed_names
    if unexpected:
        raise ValueError(f'Unexpected checkpoint globals: {sorted(unexpected)}')
    with torch.serialization.safe_globals(allowed):
        return YOLO(str(path))


def draw(frame, boxes, names, heading):
    preview = frame.copy()
    colors = {'player': (60, 210, 80), 'person': (50, 170, 255),
              'referee': (255, 180, 30), 'basketball': (230, 50, 230), 'hoop': (20, 220, 250)}
    for x1, y1, x2, y2, confidence, cls in boxes:
        name = names[int(cls)]
        color = colors.get(name, (200, 200, 200))
        a, b, c, d = map(int, (x1, y1, x2, y2))
        cv2.rectangle(preview, (a, b), (c, d), color, 2)
        cv2.putText(preview, f'{name} {confidence:.2f}', (a, max(22, b - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, .52, color, 2, cv2.LINE_AA)
    preview = cv2.resize(preview, (960, 540))
    cv2.rectangle(preview, (0, 0), (960, 34), (28, 32, 39), -1)
    cv2.putText(preview, heading, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 1, cv2.LINE_AA)
    return preview


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', default='data/videos/tactics/acceptance/review-library.json')
    parser.add_argument('--ebard', default='tmp/ebard-probe/BODD_yolov8n_0001.pt')
    parser.add_argument('--baseline', default='tmp/vision-deploy-bench/yolov8s.pt')
    parser.add_argument('--output', default='artifacts/ebard-probe')
    args = parser.parse_args()
    out = Path(args.output)
    if (out / 'report.json').exists():
        parser.error('Choose a fresh output directory to preserve previous measurements')
    out.mkdir(parents=True, exist_ok=True)
    library = json.loads(Path(args.library).read_text(encoding='utf-8'))
    videos = []
    for sample in library['samples']:
        path = Path(sample['video'])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != sample['videoSha256']:
            raise ValueError(f'Video hash mismatch: {sample["id"]}')
        with av.open(str(path)) as container:
            stream = container.streams.video[0]
            videos.append({**sample, 'frameCount': stream.frames,
                           'previewFrames': sorted({0, stream.frames // 3, 2 * stream.frames // 3, stream.frames - 1})})
    cv2.setNumThreads(4)
    device = 0 if torch.cuda.is_available() else 'cpu'
    half = torch.cuda.is_available()
    report = {'collectedAt': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
              'source': 'https://huggingface.co/GabrieleGiudici/E-BARD-detection-models',
              'device': torch.cuda.get_device_name(0) if half else 'cpu',
              'torch': torch.__version__, 'ultralytics': ultralytics.__version__,
              'conf': .25, 'iou': .5, 'half': half, 'accuracyValidated': False,
              'notes': ['Raw detections, no geometric/jersey filters or ByteTrack.',
                        'Detection count is not recall; identities and feet are not predicted.',
                        'Per-clip time includes decode/predict/CPU result collection; excludes loading, warmup, preview and JSON writing.',
                        'FP16 letterbox inference; imgsz is the target maximum dimension, not a square stretch.'],
              'models': {}, 'runs': []}
    previews = {}
    for label, path in [('generic_yolov8s', Path(args.baseline)), ('ebard_yolov8n', Path(args.ebard))]:
        loaded = time.perf_counter()
        model = load_detector(path)
        load_seconds = time.perf_counter() - loaded
        report['models'][label] = {'file': path.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                   'names': model.names, 'loadSeconds': load_seconds}
        if label == 'ebard_yolov8n' and model.names != {0: 'basketball', 1: 'hoop', 2: 'player', 3: 'referee'}:
            raise ValueError('Unexpected E-BARD class mapping')
        for size in [704, 960]:
            params = dict(imgsz=size, conf=.25, iou=.5, half=half, device=device, verbose=False)
            if label == 'generic_yolov8s':
                params['classes'] = [0]
            for _ in range(3):
                model.predict(np.zeros((720, 1280, 3), dtype=np.uint8), **params)
            for sample in videos:
                records, timings, sums, snapshots = [], [], {}, []
                started = time.perf_counter()
                with av.open(sample['video']) as container:
                    for index, video_frame in enumerate(container.decode(video=0)):
                        frame = video_frame.to_ndarray(format='bgr24')
                        before = time.perf_counter()
                        result = model.predict(frame, **params)[0]
                        boxes = result.boxes.data.cpu().numpy()
                        if half:
                            torch.cuda.synchronize()
                        timings.append(time.perf_counter() - before)
                        counts = {name: int(np.sum(boxes[:, 5] == cls)) for cls, name in model.names.items()
                                  if label != 'generic_yolov8s' or cls == 0}
                        for name, count in counts.items():
                            sums[name] = sums.get(name, 0) + count
                        records.append({'frame': index, 'time': float(video_frame.time), 'detections': boxes.tolist()})
                        if index in sample['previewFrames']:
                            snapshots.append((index, frame.copy(), boxes.copy(), counts))
                wall = time.perf_counter() - started
                if len(records) != sample['frameCount']:
                    raise ValueError(f'Incomplete decode: {sample["id"]}')
                run = {'sample': sample['id'], 'videoSha256': sample['videoSha256'], 'model': label,
                       'imgsz': size, 'frames': len(records), 'wallSeconds': wall,
                       'predictMedianMs': float(np.median(timings) * 1000),
                       'predictP90Ms': float(np.percentile(timings, 90) * 1000),
                       'meanDetections': {k: v / len(records) for k, v in sums.items()},
                       'snapshots': [{'frame': i, 'counts': counts} for i, _, _, counts in snapshots]}
                report['runs'].append(run)
                (out / f'{sample["id"]}-{label}-{size}.json').write_text(json.dumps(records, separators=(',', ':')) + '\n', encoding='utf-8')
                for index, frame, boxes, _ in snapshots:
                    heading = f'{sample["id"]} frame {index} | {label} | imgsz {size}, conf .25'
                    previews[(sample['id'], size, index, label)] = draw(frame, boxes, model.names, heading)
                print(json.dumps(run), flush=True)
        del model
        if half:
            torch.cuda.empty_cache()
    for sample in videos:
        for size in [704, 960]:
            for index in sample['previewFrames']:
                combined = np.vstack([previews[(sample['id'], size, index, label)]
                                      for label in ['generic_yolov8s', 'ebard_yolov8n']])
                cv2.imwrite(str(out / f'{sample["id"]}-{size}-{index:03d}.jpg'), combined)
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
