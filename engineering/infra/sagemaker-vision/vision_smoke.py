"""Exercise existing CUDA tracking and court-keypoint code without modifying it."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', type=Path, required=True)
    workspace = parser.parse_args().workspace.resolve()
    sys.path.insert(0, str(workspace/'engineering/scripts'))
    import av
    import torch
    import ultralytics
    from court_calibration import CourtKeypointModel

    if not torch.cuda.is_available():
        raise RuntimeError('CUDA is required; CPU fallback is disabled.')
    video = workspace/'data/videos/nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4'
    outputs = workspace/'artifacts/gpu-smoke'
    outputs.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'fixture': video.name, 'frames_per_tracker': 30,
              'gpu': torch.cuda.get_device_name(0), 'torch': torch.__version__,
              'cuda': torch.version.cuda, 'ultralytics': ultralytics.__version__, 'tracking': []}
    for detector, variant, weights in [('ebard', 'optimized', 'BODD_yolov8n_0001.pt'),
                                        ('yolo', 'yolo', 'yolov8s.pt')]:
        output = outputs/f'{detector}-{variant}.json'
        tick = time.perf_counter()
        command = [sys.executable, str(workspace/'engineering/scripts/basketball_run.py'), '--video', str(video),
                   '--weights', str(workspace/'tmp/models'/weights), '--output', str(output),
                   '--detector', detector, '--variant', variant, '--max-frames', '30', '--evidence-frames', '0']
        subprocess.run(command, cwd=workspace, check=True, timeout=240)
        metadata = json.loads(output.with_suffix('.meta.json').read_text())
        result['tracking'].append({'detector': detector, 'variant': variant,
                                  'elapsed_seconds': round(time.perf_counter()-tick, 3),
                                  'device': metadata.get('device'), 'statistics': metadata.get('statistics'),
                                  'timing_seconds': metadata.get('timing_seconds'),
                                  'frames': metadata['frames'], 'output_bytes': output.stat().st_size})
    with av.open(str(video)) as source:
        frame = next(source.decode(video=0)).to_ndarray(format='bgr24')
    model = CourtKeypointModel(workspace/'tmp/court-models-v2/best.pt')
    tick = time.perf_counter()
    points = model(frame)
    torch.cuda.synchronize()
    result['court_keypoints'] = {'shape': list(points.shape), 'device': model.device,
                                 'confident_points': int((points[:, 2] >= .25).sum()),
                                 'elapsed_seconds': round(time.perf_counter()-tick, 3),
                                 'weights_sha256': model.metadata['sha256']}
    result['passed'] = (len(result['tracking']) == 2 and model.device == 0 and list(points.shape) == [48, 3]
                        and all(item['device']['actual_model_parameter_device'] == 'cuda:0' for item in result['tracking']))
    (workspace/'gpu-smoke-result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
