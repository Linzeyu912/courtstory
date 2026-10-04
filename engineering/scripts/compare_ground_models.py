"""Non-destructive pose comparison on the existing basketball detector's boxes.

Writes observations only to a new output directory. No tracking cache, detector,
review draft or identity binding is changed. Disagreement is not ground-truth error.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tmp/ground-model-deps'))
os.environ.setdefault('YOLO_AUTOINSTALL', 'false')
os.environ.setdefault('YOLO_CONFIG_DIR', str(ROOT / 'tmp/vision-benchmark-settings'))
os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')

RTMW_URL = ('https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/'
            'rtmw-dw-x-l_simcc-cocktail14_270e-256x192_20231122.zip')
MODELS = ['yolov8s-pose', 'yolo11n-pose', 'yolo26n-pose', 'rtmpose-s-halpe26', 'rtmw-l', 'vitpose-plus-small']


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fetch(url, path):
    path = Path(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_suffix(path.suffix + '.part')
        print('Downloading', url, flush=True)
        with urllib.request.urlopen(url, timeout=90) as source, part.open('wb') as target:
            import shutil
            shutil.copyfileobj(source, target)
        part.replace(path)
    return path


def prepare(model, cache):
    if model == 'yolov8s-pose':
        return ROOT / 'tmp/vision-deploy-bench/yolov8s-pose.pt'
    if model.startswith('yolo'):
        return fetch(f'https://github.com/ultralytics/assets/releases/download/v8.4.0/{model}.pt', cache / (model + '.pt'))
    if model == 'rtmpose-s-halpe26':
        return next((ROOT / 'tmp/feet-models-v2/rtmpose-s').rglob('end2end.onnx'))
    if model == 'rtmw-l':
        target = cache / 'rtmw-l'
        files = list(target.rglob('end2end.onnx'))
        if not files:
            archive = fetch(RTMW_URL, cache / 'rtmw-l.zip')
            with zipfile.ZipFile(archive) as z:
                for name in z.namelist():
                    if not (target / name).resolve().is_relative_to(target.resolve()):
                        raise ValueError('Model archive escapes its directory')
                z.extractall(target)
            files = list(target.rglob('end2end.onnx'))
        return files[0]
    from huggingface_hub import snapshot_download
    return Path(snapshot_download('usyd-community/vitpose-plus-small', cache_dir=cache / 'hf',
                allow_patterns=['*.json', '*.safetensors']))


def inferencer(name, path, device):
    import numpy as np
    import torch
    if name.startswith('yolo'):
        from ultralytics import YOLO
        model = YOLO(str(path))
        def run(image, boxes):
            from scipy.optimize import linear_sum_assignment
            result = model.predict(image, imgsz=1280, device=device, conf=.15, verbose=False)[0]
            candidates = result.boxes.xyxy.cpu().numpy()
            points = result.keypoints.xy.cpu().numpy()
            scores = result.keypoints.conf.cpu().numpy()
            cost = np.ones((len(boxes), len(candidates)), np.float64)
            for i, a in enumerate(boxes):
                for j, b in enumerate(candidates):
                    inter = np.maximum(0, np.minimum(a[2:], b[2:]) - np.maximum(a[:2], b[:2])).prod()
                    cost[i, j] = 1 - inter / max(np.prod(a[2:]-a[:2]) + np.prod(b[2:]-b[:2]) - inter, 1e-9)
            matched = {}
            if cost.size:
                ii, jj = linear_sum_assignment(cost)
                matched = {int(i):(points[j], scores[j], float(1-cost[i,j])) for i,j in zip(ii,jj) if cost[i,j] <= .65}
            return [matched.get(i) for i in range(len(boxes))]
        return run, {'device':device, 'inputSize':1280, 'association':'one_to_one_iou_0.35', 'weightSha256':sha(path)}
    if name.startswith('rtm'):
        from rtmlib import RTMPose
        import onnxruntime as ort
        model = RTMPose(str(path), model_input_size=(192,256), backend='onnxruntime', device='cpu')
        options = ort.SessionOptions(); options.intra_op_num_threads=4; options.inter_op_num_threads=1
        model.session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
        def run(image, boxes):
            points,scores = model(image, boxes.tolist())
            return [(p,s,None) for p,s in zip(points,scores)]
        return run, {'device':'cpu','inputSize':[192,256], 'association':'existing_detector_boxes','weightSha256':sha(path)}
    from transformers import AutoProcessor, VitPoseForPoseEstimation
    processor = AutoProcessor.from_pretrained(str(path), local_files_only=True)
    model = VitPoseForPoseEstimation.from_pretrained(str(path), local_files_only=True).to(device).eval()
    def run(image, boxes):
        xywh=boxes.copy();xywh[:,2:]-=xywh[:,:2]
        inputs=processor(image[:,:,::-1].copy(), boxes=[xywh], return_tensors='pt').to(device)
        with torch.inference_mode():
            outputs=model(**inputs, dataset_index=torch.zeros(len(boxes),dtype=torch.long,device=device))
        results=processor.post_process_pose_estimation(outputs, boxes=[xywh], threshold=0)[0]
        return [(r['keypoints'].cpu().numpy(),r['scores'].cpu().numpy(),None) for r in results]
    return run, {'device':device,'association':'existing_detector_boxes','weights':{p.name:sha(p) for p in path.glob('*.safetensors')}}


def summarize_pose(name, observation, box, threshold=.3):
    import numpy as np
    if observation is None:
        return {'matched':False, 'anchor':None, 'contactState':'unknown'}
    points,scores,iou=observation
    ankles=[15,16]
    feet=([20,22,24],[21,23,25]) if name=='rtmpose-s-halpe26' else ([17,18,19],[20,21,22]) if name=='rtmw-l' else None
    # A symmetric foot/ankle midpoint is a comparison proposal, not a contact label.
    anchors=[]
    if feet:
        for group in feet:
            valid=[i for i in group if scores[i]>=threshold and box[0]-20<=points[i,0]<=box[2]+20 and box[1]<=points[i,1]<=box[3]+30]
            if len(valid)>=2:anchors.append(points[valid].mean(0))
    else:
        anchors=[points[i] for i in ankles if scores[i]>=threshold and box[0]-20<=points[i,0]<=box[2]+20 and box[1]<=points[i,1]<=box[3]+30]
    anchor=np.mean(anchors,0).tolist() if len(anchors)==2 else None
    return {'matched':True,'matchIou':iou,'anchor':anchor,'validSides':len(anchors),
            'anchorMethod':'two_foot_landmark_midpoint' if feet else 'two_ankle_midpoint',
            'contactState':'unknown','groundContactConfirmed':False,
            'keypoints':np.round(points,3).tolist(),'scores':np.round(scores,5).tolist()}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',required=True);p.add_argument('--cache',required=True)
    p.add_argument('--models',nargs='+',default=MODELS,choices=MODELS)
    p.add_argument('--samples',nargs='+',default=['005','004','006'])
    p.add_argument('--max-frames',type=int,default=0);p.add_argument('--prepare-only',action='store_true')
    p.add_argument('--extend',action='store_true',help='Append missing frames to a source-matched partial comparison')
    args=p.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True);cache=Path(args.cache)
    import cv2
    import numpy as np
    import torch
    cv2.setNumThreads(4);torch.set_num_threads(4)
    library=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text('utf-8'))
    for name in args.models:
        started=time.perf_counter()
        try:
            path=prepare(name,cache)
            if args.prepare_only:
                print(name,'ready',path,flush=True);continue
            run,metadata=inferencer(name,path,'cuda:0' if torch.cuda.is_available() else 'cpu')
            for sid in args.samples:
                target=out/f'{sid}-{name}.json'
                if target.exists() and not args.extend:
                    print('Existing comparison retained',target,flush=True);continue
                sample=next(s for s in library['samples'] if s['id']==sid)
                video=ROOT/sample['video'];track=ROOT/next(v['tracks'] for v in sample['trackingVariants'] if v['id']=='ebard')
                before=sha(track);records=json.loads(track.read_text('utf-8'));cap=cv2.VideoCapture(str(video))
                result={'schemaVersion':1,'sample':sid,'model':name,'videoHash':sha(video),'trackingFingerprint':before,
                        'metadata':metadata,'groundTruthAvailable':False,'rawPreserved':True,'frames':[]}
                if target.exists():
                    previous=json.loads(target.read_text('utf-8'))
                    if any(previous.get(key)!=result[key] for key in ('videoHash','trackingFingerprint','metadata')):raise ValueError('Cannot extend a different model or source')
                    result=previous
                offset=len(result['frames']);limit=min(len(records),args.max_frames or len(records))
                if offset>=limit:cap.release();print('Complete comparison retained',target,flush=True);continue
                timings=[]
                for index,record in enumerate(records):
                    if args.max_frames and index>=args.max_frames:break
                    ok,image=cap.read()
                    if not ok:raise ValueError('Decode ended before tracking records')
                    if index<offset:continue
                    people=[t for t in record['tracks'] if record.get('track_roles',{}).get(str(int(t[4])))=='player']
                    boxes=np.asarray([t[:4] for t in people],np.float32).reshape(-1,4)
                    t0=time.perf_counter();observations=run(image,boxes) if len(boxes) else []
                    if torch.cuda.is_available():torch.cuda.synchronize()
                    timings.append(time.perf_counter()-t0)
                    result['frames'].append({'frame':index,'time':record['time'],'people':[
                        {'trackId':int(t[4]),'box':t[:4],'baselineAnchor':[(t[0]+t[2])/2,t[3]],
                         **summarize_pose(name,o,box)} for t,o,box in zip(people,observations,boxes)]})
                    if index%50==0:print(name,sid,index,'frames',flush=True)
                cap.release()
                if sha(track)!=before:raise RuntimeError('Source track changed during comparison')
                previous_timing=result.get('timing')
                result['timing']={'totalInferenceSeconds':sum(timings)+(previous_timing or {}).get('totalInferenceSeconds',0),'medianFrameSeconds':float(np.median(timings[1:] or timings)) if not offset else None,
                                  'extension':{'startFrame':offset,'medianFrameSeconds':float(np.median(timings))} if offset else None,'previous':previous_timing,
                                  'note':'Different devices/paradigms; not a same-hardware speed ranking.'}
                target.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
                print('Saved',target,len(result['frames']),'frames',flush=True)
            del run
            import gc
            gc.collect()
            if torch.cuda.is_available():torch.cuda.empty_cache()
        except Exception as error:
            import traceback
            traceback.print_exc()
            (out/f'{name}-error.json').write_text(json.dumps({'model':name,'error':str(error),'elapsed':time.perf_counter()-started},ensure_ascii=False),encoding='utf-8')


if __name__=='__main__':main()
