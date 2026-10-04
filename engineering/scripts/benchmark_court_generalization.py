"""Local held-out video stress test; never train models or modify source media.

Augmented copies share a source group. Equivariance against the clean run is
consistency, not independent ground-truth accuracy. All frame indices are zero-based.
"""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

import av
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CONDITIONS = ('original', 'resolution-blur', 'zoom-pan', 'darkened')


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def read(path):
    return json.loads(Path(path).read_text('utf-8'))


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), 'utf-8')


def augmentation(name, image, t):
    height, width = image.shape[:2]
    transform = np.eye(3)
    if name == 'resolution-blur':
        image = cv2.resize(cv2.resize(image, (776, 436), interpolation=cv2.INTER_AREA),
                           (width, height), interpolation=cv2.INTER_LINEAR)
        image = cv2.GaussianBlur(image, (5, 5), 1.2)
    elif name == 'darkened':
        image = np.clip(image.astype(float)*.65+5, 0, 255).astype(np.uint8)
    elif name == 'zoom-pan':
        scale = 1.08+.04*math.sin(2*math.pi*t/12)
        dx = width*.025*math.sin(2*math.pi*t/9)
        dy = height*.015*math.cos(2*math.pi*t/11)
        transform = np.array([[scale, 0, (1-scale)*width/2+dx],
                              [0, scale, (1-scale)*height/2+dy], [0, 0, 1.]])
        image = cv2.warpAffine(image, transform[:2], (width, height), borderMode=cv2.BORDER_CONSTANT)
    return image, transform


def video_path(args, name):
    return args.video if name == 'original' else args.output / (name+'.mp4')


def prepare(args):
    source_hash = sha(args.video)
    specs = {'original': 'Unmodified source', 'resolution-blur': '776x436 downsample, restore size, Gaussian sigma=1.2, H264 CRF30',
             'zoom-pan': 'Digital zoom 1.04-1.12, translation x +/-2.5%, y +/-1.5%, H264 CRF18',
             'darkened': 'BGR intensity 0.65*x+5, H264 CRF18'}
    manifest_path = args.output/'manifest.json'
    existing_variants = [name for name in CONDITIONS[1:] if video_path(args,name).exists()]
    if manifest_path.exists():
        previous = read(manifest_path)
        if previous['sourceHash'] != source_hash or any(previous['conditions'][name]['description'] != specs[name] for name in CONDITIONS):
            raise ValueError('Existing experiment belongs to another source or protocol; use a fresh directory')
        for name in existing_variants:
            if sha(video_path(args,name)) != previous['conditions'][name]['hash']:
                raise ValueError('Existing augmented video changed; preserve evidence and use a fresh directory')
    elif existing_variants:
        raise ValueError('Unverified augmented files already exist; use a fresh experiment directory')
    targets = [name for name in CONDITIONS[1:] if not video_path(args, name).exists()]
    opened = {}; transformations = {name: [] for name in CONDITIONS}; rows = []
    with av.open(str(args.video)) as source:
        stream = source.streams.video[0]
        rate = stream.average_rate
        for name in targets:
            container = av.open(str(video_path(args, name)), 'w', options={'movflags': '+faststart'})
            output = container.add_stream('libx264', rate=rate)
            output.width = stream.width; output.height = stream.height; output.pix_fmt = 'yuv420p'
            output.options = {'crf': '30' if name == 'resolution-blur' else '18', 'preset': 'fast'}
            opened[name] = container, output
        for i, frame in enumerate(source.decode(video=0)):
            image = frame.to_ndarray(format='bgr24'); t = float(frame.time)
            rows.append({'frame': i, 'time': t, 'pts': frame.pts, 'timeBase': str(frame.time_base)})
            for name in CONDITIONS:
                transformed, matrix = augmentation(name, image, t)
                transformations[name].append(matrix.reshape(-1).tolist())
                if name in opened:
                    out_frame = av.VideoFrame.from_ndarray(transformed, format='bgr24')
                    out_frame.pts = frame.pts; out_frame.time_base = frame.time_base
                    for packet in opened[name][1].encode(out_frame): opened[name][0].mux(packet)
        for container, output in opened.values():
            for packet in output.encode(): container.mux(packet)
            container.close()
        dimensions = [stream.width, stream.height]
    assert sha(args.video) == source_hash
    for name in CONDITIONS:
        with av.open(str(video_path(args, name))) as source:
            measured = [float(frame.time) for frame in source.decode(video=0)]
        assert len(measured) == len(rows) and np.max(np.abs(np.array(measured)-[r['time'] for r in rows])) < .001
    manifest = {'sourceFile': args.video.name, 'sourceHash': source_hash, 'sourceGroup': source_hash,
                'independentVideos': 1, 'trainingPerformed': False, 'dimensions': dimensions, 'frames': rows,
                'conditions': {name: {'description': specs[name], 'hash': sha(video_path(args, name)),
                                      'sourceToVariant': transformations[name]} for name in CONDITIONS}}
    save(args.output/'manifest.json', manifest)
    print('Prepared', len(rows), 'frames x', len(CONDITIONS), flush=True)


def tracking(args):
    manifest = read(args.output/'manifest.json')
    for name in args.conditions:
        target = args.output/(name+'-tracks.json')
        if target.exists():
            meta = read(target.with_suffix('.meta.json'))
            assert meta['video_sha256'] == manifest['conditions'][name]['hash'] and meta['frames'] == len(manifest['frames'])
            continue
        subprocess.run([sys.executable, str(ROOT/'engineering/scripts/basketball_run.py'),
                        '--video', str(video_path(args, name)), '--weights', str(ROOT/'tmp/models/BODD_yolov8n_0001.pt'),
                        '--variant', 'optimized', '--detector', 'ebard', '--output', str(target), '--evidence-frames'], check=True, cwd=ROOT)


def objects(args):
    from ultralytics import YOLO
    from court_calibration import CourtKeypointModel
    from court_orientation import estimate_court
    detector = YOLO(str(ROOT/'tmp/models/BODD_yolov8n_0001.pt'))
    model = CourtKeypointModel()
    for name in args.conditions:
        target = args.output/(name+'-scene.json')
        if target.exists(): continue
        rows = []; scans = []
        with av.open(str(video_path(args, name))) as source:
            for i, frame in enumerate(source.decode(video=0)):
                image = frame.to_ndarray(format='bgr24')
                result = detector.predict(image, imgsz=704, conf=.1, iou=.5, device=0, verbose=False)[0]
                current = [{'kind': {0: 'basketball', 1: 'hoop', 3: 'referee'}.get(int(r[5]), 'player'),
                            'box': r[:4].tolist(), 'score': float(r[4]), 'groundPoint': False}
                           for r in result.boxes.data.cpu().numpy() if int(r[5]) != 2]
                rows.append({'frame': i, 'time': float(frame.time), 'objects': current})
                if i % 30 == 0:
                    kps = model(image)
                    proposal = estimate_court(kps, current, image.shape[1], image.shape[0])
                    scans.append({'frame': i, 'keypoints': kps.tolist(), 'proposal': proposal})
                if i % 300 == 0: print(name, 'objects', i, flush=True)
        save(target, {'frames': rows, 'scan': scans, 'courtModel': model.metadata,
                      'detectorHash': sha(ROOT/'tmp/models/BODD_yolov8n_0001.pt'), 'videoHash': sha(video_path(args, name))})


def mapping(args):
    from court_calibration import CourtKeypointModel, CourtModelUnavailable, calibrate_court
    from court_propagation import propagate_court
    manifest = read(args.output/'manifest.json')
    model = CourtKeypointModel(imgsz=args.court_imgsz)
    for name in args.conditions:
        target = args.output/(name+('-mapping960.json' if args.court_imgsz == 960 else '-mapping.json'))
        if target.exists(): continue
        scene = read(args.output/(name+'-scene.json')); tracks = read(args.output/(name+'-tracks.json'))
        payload = {'width': manifest['dimensions'][0], 'height': manifest['dimensions'][1],
                   'video_sha256': manifest['conditions'][name]['hash'], 'tracking_fingerprint': sha(args.output/(name+'-tracks.json')),
                   'frames': [{**t, 'objects': s['objects']} for t, s in zip(tracks, scene['frames'])], 'sourceCuts': []}
        # Offline seed near the temporal centre. Keep the existing +/-20s
        # limit and report frames outside that window separately from failures.
        scan = read(args.output/(name+'-scan960.json'))['scan'] if args.court_imgsz == 960 else scene['scan']
        accepted = [r for r in scan if r['proposal']['status'] == 'needs_review']
        accepted.sort(key=lambda r: abs(r['frame']-(len(tracks)-1)/2))
        if not accepted:
            save(target, {'keyframes': [], 'summary': {'validFrames': 0, 'totalFrames': len(tracks)}, 'reason': 'no_automatic_seed'})
            continue
        reference = accepted[0]['frame']
        initialized = calibrate_court(video_path(args, name), payload, reference, model, propagate=False)
        if not initialized['keyframes']:
            raise RuntimeError('Seed could not be reproduced')
        seed = initialized['keyframes'][0]
        print(name, 'propagating from', reference, seed['side'], flush=True)
        result = propagate_court(video_path(args, name), payload, seed, predictor=model,
                                 object_records=payload['frames'], unavailable_error=CourtModelUnavailable)
        result['experiment'] = {'seedRule': 'nearest_valid_one_second_scan_to_temporal_midpoint',
                                'sourceGroup': manifest['sourceHash'], 'cutPolicy': 'no_hard_cut_identified; continuous_pans_preserved',
                                'videoHash': payload['video_sha256'], 'seedFrame': reference,
                                'courtInputSize': args.court_imgsz}
        save(target, result)
        print(name, 'mapped', result['summary']['validFrames'], '/', len(tracks), flush=True)


def scan960(args):
    from court_calibration import CourtKeypointModel
    from court_orientation import estimate_court
    model = CourtKeypointModel(imgsz=960)
    for name in args.conditions:
        target = args.output/(name+'-scan960.json')
        if target.exists(): continue
        scene = read(args.output/(name+'-scene.json')); rows = []
        with av.open(str(video_path(args, name))) as source:
            for i, frame in enumerate(source.decode(video=0)):
                if i % 30: continue
                image = frame.to_ndarray(format='bgr24'); kps = model(image)
                proposal = estimate_court(kps, scene['frames'][i]['objects'], image.shape[1], image.shape[0])
                rows.append({'frame': i, 'keypoints': kps.tolist(), 'proposal': proposal})
        save(target, {'scan': rows, 'courtModel': model.metadata, 'videoHash': sha(video_path(args, name))})
        print(name, '960 accepted', sum(r['proposal']['status'] == 'needs_review' for r in rows), '/', len(rows), flush=True)


def windows(args):
    """Experimental offline reference handoff, separate from real shot cuts.

    Each side run needs multiple accepted independent frame estimates; bracket
    a handoff between the last old-side and first new-side observation. Keep an
    overlap for discrepancy measurement. Never splice or smooth source tracks.
    """
    from court_calibration import CourtKeypointModel, CourtModelUnavailable, calibrate_court
    from court_propagation import propagate_court
    manifest = read(args.output/'manifest.json'); model = CourtKeypointModel(imgsz=960)
    for name in args.conditions:
        target = args.output/(name+'-windows.json')
        if target.exists(): continue
        tracks = read(args.output/(name+'-tracks.json')); scene = read(args.output/(name+'-scene.json'))
        scan = read(args.output/(name+'-scan960.json'))['scan']; groups = []
        for row in scan:
            if row['proposal']['status'] != 'needs_review': continue
            if groups and groups[-1]['side'] == row['proposal']['side']: groups[-1]['frames'].append(row['frame'])
            else: groups.append({'side': row['proposal']['side'], 'frames': [row['frame']]})
        if not groups or any(len(g['frames']) < 2 for g in groups):
            raise ValueError('Reference handoff lacks repeated side evidence; manual review required')
        boundaries = [0, *[round((a['frames'][-1]+b['frames'][0])/2) for a,b in zip(groups,groups[1:])],len(tracks)]
        payload = {'width': manifest['dimensions'][0], 'height': manifest['dimensions'][1],
                   'video_sha256': manifest['conditions'][name]['hash'], 'tracking_fingerprint': sha(args.output/(name+'-tracks.json')),
                   'frames': [{**t, 'objects': s['objects']} for t,s in zip(tracks,scene['frames'])], 'sourceCuts': []}
        combined = {}; details = []
        for index, group in enumerate(groups):
            start,end = boundaries[index:index+2]
            seed_frame = min(group['frames'], key=lambda i: abs(i-(start+end-1)/2))
            initialized = calibrate_court(video_path(args,name),payload,seed_frame,model,propagate=False)
            if not initialized['keyframes']: raise RuntimeError('Window seed could not be reproduced')
            seed = initialized['keyframes'][0]
            support_start,support_end = max(0,start-30),min(len(tracks),end+30)
            print(name,'window',index,start,end,'seed',seed_frame,group['side'],flush=True)
            # The cuts parameter bounds this experimental propagation call only.
            # These are calibration windows, not detected cuts or tracking cuts.
            result = propagate_court(video_path(args,name),payload,seed,cuts=[support_start,support_end],
                                     predictor=model,object_records=payload['frames'],unavailable_error=CourtModelUnavailable)
            save(args.output/f'{name}-window-{index}.json',result)
            details.append({'coreFrames':[start,end],'supportFrames':[support_start,support_end],
                            'seedFrame':seed_frame,'side':group['side'],'independentSeedEvidenceFrames':group['frames']})
            for row in result['keyframes']:
                if start <= row['frame'] < end:
                    row['quality']['experimentalCalibrationWindow'] = index
                    combined[row['frame']] = row
        rows = [combined[i] for i in sorted(combined)]
        assert len(rows) == len(tracks), 'Window processing did not cover every source frame'
        save(target, {'keyframes':rows,'invalidFrames':[r['frame'] for r in rows if not r['points']],
                      'summary':{'totalFrames':len(tracks),'validFrames':sum(bool(r['points']) for r in rows)},
                      'experiment':{'name':'offline_same_sideline_reference_handoff','windows':details,
                                    'sourceCuts':[],'calibrationBoundariesAreNotCameraCuts':True,
                                    'videoHash':payload['video_sha256'],'groundTruthAvailable':False}})
        print(name,'windowed valid',sum(bool(r['points']) for r in rows),'/',len(tracks),flush=True)


def poses(args):
    from compare_ground_models import inferencer, summarize_pose
    paths = {'yolov8s-pose': ROOT/'tmp/vision-deploy-bench/yolov8s-pose.pt',
             'rtmw-l': args.pose_cache/'rtmw-l/end2end.onnx'}
    for model_name, path in paths.items():
        runner, metadata = inferencer(model_name, path, 'cuda:0')
        for name in args.conditions:
            target = args.output/(name+'-'+model_name+'.json')
            if target.exists(): continue
            tracks = read(args.output/(name+'-tracks.json')); rows = []
            with av.open(str(video_path(args, name))) as source:
                for i, frame in enumerate(source.decode(video=0)):
                    # Matched, prespecified 3 Hz across the whole clip; never
                    # present this subset as a per-source-frame pose result.
                    if i % 10: continue
                    image = frame.to_ndarray(format='bgr24'); people = tracks[i]['tracks']
                    boxes = np.asarray([t[:4] for t in people], np.float32).reshape(-1, 4)
                    observed = runner(image, boxes) if len(boxes) else []
                    rows.append({'frame': i, 'time': float(frame.time), 'people': [
                        {'trackId': int(t[4]), 'box': t[:4], 'baselineAnchor': [(t[0]+t[2])/2, t[3]],
                         **summarize_pose(model_name, result, box)} for t, result, box in zip(people, observed, boxes)]})
                    if i % 300 == 0: print(name, model_name, i, flush=True)
            save(target, {'frames': rows, 'model': model_name, 'metadata': metadata,
                          'sampling': {'stride': 10, 'hz': 3}, 'videoHash': sha(video_path(args, name)), 'groundTruthAvailable': False})
        del runner


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', choices=['prepare', 'tracking', 'objects', 'mapping', 'poses', 'scan960', 'windows'], required=True)
    parser.add_argument('--conditions', nargs='+', choices=CONDITIONS, default=list(CONDITIONS))
    parser.add_argument('--pose-cache', type=Path)
    parser.add_argument('--court-imgsz', type=int, choices=(640, 960), default=640)
    args = parser.parse_args()
    args.video = args.video.resolve(); args.output = args.output.resolve(); args.output.mkdir(parents=True, exist_ok=True)
    if args.video.parent == args.output or args.video.is_relative_to(args.output):
        parser.error('Use a separate output directory, not the source directory')
    os.environ.setdefault('YOLO_AUTOINSTALL', 'false')
    os.environ.setdefault('YOLO_CONFIG_DIR', str(ROOT/'tmp/vision-benchmark-settings'))
    cv2.setNumThreads(4)
    import torch
    torch.set_num_threads(4)
    if args.stage != 'prepare':
        manifest = read(args.output/'manifest.json')
        assert sha(args.video) == manifest['sourceHash']
        for name in args.conditions: assert sha(video_path(args, name)) == manifest['conditions'][name]['hash']
    if args.stage == 'poses' and not args.pose_cache: parser.error('--pose-cache required for poses')
    globals()[args.stage](args)


if __name__ == '__main__':
    main()
