"""Compare local basketball court proposals without treating them as calibration.

YOLO's sparse name map was checked against the author's HF image/label pairs;
it is an engineering interpretation, not a published 48-point metric template.
KaliCalib retains its native FIBA dimensions. No production state is modified.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import time
from datetime import datetime
from pathlib import Path

os.environ.update(TORCH_FORCE_WEIGHTS_ONLY_LOAD='1', YOLO_AUTOINSTALL='false',
                  YOLO_OFFLINE='true', YOLO_CONFIG_DIR=str(Path('tmp/vision-benchmark-settings').resolve()))
import cv2
import numpy as np
import torch
from ultralytics import YOLO
from ultralytics.nn import modules
from ultralytics.nn.modules import block
from ultralytics.nn.tasks import PoseModel

LENGTH, WIDTH = 28.6512, 15.24
LANDMARKS = {'A': [0, 5.1816], 'B': [5.7912, 5.1816], 'C': [5.7912, 10.0584],
             'D': [0, 10.0584], 'E': [0, 0], 'G': [0, WIDTH],
             'I': [0, .9144], 'J': [0, WIDTH-.9144]}
# Verified by inspecting original HF labels, including left/right images and flip_idx.
# Unverified center-line slots, rim centers and arc extrema are deliberately excluded.
SLOTS = {'left': {'A': 3, 'B': 12, 'C': 14, 'D': 4, 'E': 0, 'I': 1, 'J': 6},
         'right': {'A': 38, 'B': 29, 'C': 31, 'D': 39, 'E': 35, 'I': 36, 'J': 41}}


def safe_load(path):
    names = ['Bottleneck', 'SPPF', 'Conv', 'DWConv', 'DFL', 'C3k', 'C3k2',
             'PSABlock', 'C2PSA', 'Attention', 'Pose', 'Concat']
    allowed = [PoseModel, *(getattr(modules, name) if hasattr(modules, name) else getattr(block, name) for name in names),
               torch.nn.BatchNorm2d, torch.nn.MaxPool2d, torch.nn.Conv2d,
               torch.nn.Upsample, torch.nn.Identity, torch.nn.Sequential,
               torch.nn.ModuleList, torch.nn.SiLU]
    expected = {f'{item.__module__}.{item.__name__}' for item in allowed}
    unknown = set(torch.serialization.get_unsafe_globals_in_checkpoint(path))-expected
    if unknown:
        raise ValueError(f'Unexpected checkpoint globals: {sorted(unknown)}')
    with torch.serialization.safe_globals(allowed):
        return YOLO(str(path))


def project(h, points):
    p = np.column_stack([points, np.ones(len(points))]) @ h.T
    return p[:, :2] / p[:, 2:]


def court_lines(length=LENGTH, width=WIDTH, paint_length=5.7912, paint_width=4.8768):
    lines = [[[0, 0], [length, 0], [length, width], [0, width], [0, 0]],
             [[length/2, 0], [length/2, width]]]
    for right in [False, True]:
        x = (lambda v: length-v) if right else (lambda v: v)
        a, b = (width-paint_width)/2, (width+paint_width)/2
        lines.append([[x(0), a], [x(paint_length), a], [x(paint_length), b], [x(0), b]])
        if length == LENGTH:
            angles = np.linspace(-np.arcsin((WIDTH/2-.9144)/7.239), np.arcsin((WIDTH/2-.9144)/7.239), 70)
            lines.append([[x(0), .9144]]+[[x(1.6002+7.239*np.cos(t)), WIDTH/2+7.239*np.sin(t)] for t in angles]+[[x(0), WIDTH-.9144]])
    return lines


def draw_homography(image, h, lines, color):
    for line in lines:
        points = project(h, np.array(line))
        if np.isfinite(points).all() and np.abs(points).max() < 100000:
            cv2.polylines(image, [points.astype(np.int32)], False, color, 2, cv2.LINE_AA)


def estimate_named(kps, threshold=.5):
    choices = []
    for side, mapping in SLOTS.items():
        points = [{'id': name, 'image': kps[slot, :2].tolist(), 'score': float(kps[slot, 2]),
                   'modelSlot': slot, 'source': 'yolo11n-court48'} for name, slot in mapping.items()
                  if kps[slot, 2] >= threshold]
        floor = np.array([[LENGTH-LANDMARKS[p['id']][0] if side == 'right' else LANDMARKS[p['id']][0], LANDMARKS[p['id']][1]] for p in points])
        h = None
        if len(points) >= 4 and np.linalg.matrix_rank(floor-floor.mean(axis=0)) == 2:
            h, inliers = cv2.findHomography(floor, np.array([p['image'] for p in points]), cv2.RANSAC, 12)
            if h is not None and abs(np.linalg.det(h)) < 1e-10:
                h = None
        choices.append((sum(p['score'] for p in points), side, points, h))
    _, side, points, h = max(choices, key=lambda r: r[0])
    return side, points, h


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', default='data/videos/tactics/acceptance/review-library.json')
    parser.add_argument('--weights', default='tmp/court-models-v2/best.pt')
    parser.add_argument('--kalicalib', default='tmp/court-research/CEA-LIST-KaliCalib-3b3f52b')
    parser.add_argument('--output', default='artifacts/court-models-v2')
    parser.add_argument('--imgsz', type=int, default=640)
    args = parser.parse_args()
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    if (out/'report.json').exists():
        parser.error('Choose a fresh output directory to preserve measurements')
    cv2.setNumThreads(4); cv2.setRNGSeed(781); torch.manual_seed(781)
    samples = json.loads(Path(args.library).read_text(encoding='utf-8'))['samples']
    frames = []
    for sample in samples:
        video = Path(sample['video'])
        digest = hashlib.sha256(video.read_bytes()).hexdigest()
        if digest != sample['videoSha256']:
            raise ValueError(f'Wrong video hash: {sample["id"]}')
        cap = cv2.VideoCapture(str(video)); count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        wanted = sorted({0, count//3, 2*count//3, count-1})
        for frame_id in wanted:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_id); ok, frame = cap.read()
            if not ok: raise ValueError('Frame decode failed')
            frames.append((sample, frame_id, frame))
            cv2.imwrite(str(out/f'{sample["id"]}-{frame_id:03d}-original.jpg'), frame)
        cap.release()
    device = 0 if torch.cuda.is_available() else 'cpu'
    report = {'collectedAt': datetime.now().astimezone().isoformat(), 'device': torch.cuda.get_device_name(0) if device == 0 else 'cpu',
              'weightsSha256': hashlib.sha256(Path(args.weights).read_bytes()).hexdigest(),
              'weightsBytes': Path(args.weights).stat().st_size, 'imgsz': args.imgsz,
              'accuracyValidated': False, 'pointSemantics': 'Human inspection of HF original labels + flip_idx; partial map only',
              'slotMap': SLOTS, 'runs': []}
    start = time.perf_counter(); model = safe_load(args.weights)
    params = dict(imgsz=args.imgsz, conf=.25, device=device, half=device == 0, verbose=False)
    for _ in range(3): model.predict(np.zeros((720,1280,3), np.uint8), **params)
    report['yoloLoadWarmupSeconds'] = time.perf_counter()-start
    candidates = {s['id']: {'schemaVersion': 1, 'videoHash': s['videoSha256'], 'source': 'yolo11n-court48',
                  'label': 'YOLO11n 篮球场点候选 · 待人工确认', 'keyframes': []} for s in samples}
    for sample, frame_id, frame in frames:
        if device == 0: torch.cuda.synchronize()
        start=time.perf_counter(); result=model.predict(frame, **params)[0]
        kps=result.keypoints.data.cpu().numpy() if result.keypoints is not None else np.empty((0,48,3))
        if device == 0: torch.cuda.synchronize()
        duration=time.perf_counter()-start
        image=frame.copy(); row={'model': 'yolo11n-court48', 'sample': sample['id'], 'frame': frame_id, 'predictSeconds': duration, 'courtDetections': len(kps)}
        if len(kps):
            kp=kps[int(result.boxes.conf.argmax())]; side, points, h=estimate_named(kp)
            row.update(keypoints=kp.tolist(), side=side, namedPoints=points, homographyFound=h is not None)
            row['pointsAtLeast05']=int((kp[:,2]>=.5).sum())
            for n,(x,y,score) in enumerate(kp):
                if score<.5: continue
                pt=(int(x),int(y));cv2.circle(image,pt,4,(0,230,255),-1)
                cv2.putText(image,f'{n}',(pt[0]+5,pt[1]-4),cv2.FONT_HERSHEY_SIMPLEX,.55,(0,230,255),2)
            if h is not None:
                row['nbaCourtToImage']=h.flatten().tolist();draw_homography(image,h,court_lines(),(255,200,20))
            candidates[sample['id']]['keyframes'].append({'frame':frame_id,'side':side,'points':points,'status':'needs_review',
                'reliability':'Unvalidated model proposals. Inspect projected lines and edit before acceptance.'})
        cv2.putText(image,f'YOLO court48 {sample["id"]}/{frame_id} | named NBA fit: PROPOSAL ONLY',(15,32),cv2.FONT_HERSHEY_SIMPLEX,.65,(0,240,255),2)
        cv2.imwrite(str(out/f'{sample["id"]}-{frame_id:03d}-yolo.jpg'),image)
        report['runs'].append(row)
    del model
    source=Path(args.kalicalib)
    spec=importlib.util.spec_from_file_location('kalicalib_author_network',source/'kalicalib/model_resnet.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    target='cuda' if device==0 else 'cpu';network=module.makeModel().to(target).eval()
    weight=source/'models/model_challenge.pth'
    network.load_state_dict(torch.load(weight,map_location=target,weights_only=True),strict=True)
    report['kaliWeightsSha256']=hashlib.sha256(weight.read_bytes()).hexdigest()
    mean=torch.tensor([.485,.456,.406],device=target)[:,None,None];std=torch.tensor([.229,.224,.225],device=target)[:,None,None]
    native=np.array([[i*28/12,15-(1.75*j+.15*j*(j-1))] for j in range(7) for i in range(13)],np.float64)
    for _ in range(3):
        with torch.inference_mode(): network(torch.zeros((1,3,540,960),device=target))
    for sample, frame_id, frame in frames:
        start=time.perf_counter()
        small=cv2.cvtColor(cv2.resize(frame,(960,540)),cv2.COLOR_BGR2RGB)
        tensor=torch.from_numpy(small.transpose(2,0,1).copy()).float().to(target)/255
        with torch.inference_mode(): prediction=network(((tensor-mean)/std).unsqueeze(0))[0].cpu().numpy()
        winners=prediction.argmax(axis=0);ids=[];pixels=[]
        for k in range(91):
            yy,xx=np.nonzero(winners==k)
            if len(xx):ids.append(k);pixels.append([float(xx.mean()*4),float(yy.mean()*4)])
        h,inliers=(cv2.findHomography(native[ids],np.array(pixels),cv2.RANSAC,35,maxIters=2000) if len(ids)>=4 else (None,None))
        duration=time.perf_counter()-start
        row={'model':'KaliCalib-challenge','sample':sample['id'],'frame':frame_id,'pipelineSeconds':duration,
             'classesVisible':len(ids),'inliers':int(inliers.sum()) if inliers is not None else 0,'homographyFound':h is not None,'nativeCourtMetres':[28,15]}
        image=frame.copy()
        if h is not None:
            h=np.diag([frame.shape[1]/960,frame.shape[0]/540,1.])@h
            row['nativeCourtToImage']=h.flatten().tolist();draw_homography(image,h,court_lines(28,15,5.8,4.9),(255,120,20))
        cv2.putText(image,f'KaliCalib {sample["id"]}/{frame_id} | FIBA 28x15m: NOT NBA CALIBRATED',(15,32),cv2.FONT_HERSHEY_SIMPLEX,.65,(0,240,255),2)
        cv2.imwrite(str(out/f'{sample["id"]}-{frame_id:03d}-kali.jpg'),image);report['runs'].append(row)
        # Traditional LSD supplies line segments, without court semantics.
        start=time.perf_counter();grey=cv2.cvtColor(cv2.resize(frame,(960,540)),cv2.COLOR_BGR2GRAY)
        found=cv2.createLineSegmentDetector().detect(grey)[0]
        lines=[] if found is None else [x.tolist() for x in found.reshape(-1,4) if np.linalg.norm(x[:2]-x[2:])>=60]
        duration=time.perf_counter()-start;image=frame.copy()
        for x1,y1,x2,y2 in lines:
            cv2.line(image,(int(x1*frame.shape[1]/960),int(y1*frame.shape[0]/540)),(int(x2*frame.shape[1]/960),int(y2*frame.shape[0]/540)),(180,220,100),2)
        cv2.imwrite(str(out/f'{sample["id"]}-{frame_id:03d}-lsd.jpg'),image)
        report['runs'].append({'model':'OpenCV-LSD','sample':sample['id'],'frame':frame_id,'pipelineSeconds':duration,'lineCount':len(lines),'semanticNames':False})
    for sid,payload in candidates.items():
        (out/f'{sid}-court-candidates.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='runs'},ensure_ascii=False))
    for model in ['yolo11n-court48','KaliCalib-challenge','OpenCV-LSD']:
        subset=[r for r in report['runs'] if r['model']==model]
        print(model,'frames',len(subset),'median ms',np.median([r.get('predictSeconds',r.get('pipelineSeconds'))*1000 for r in subset]))


if __name__=='__main__':main()
