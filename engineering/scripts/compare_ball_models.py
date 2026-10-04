"""Read-only basketball-weight comparison; source detector data never changes.

Uses the WASB repository's published HRNet / TrackNetV2 basketball weights,
three consecutive RGB frames, ImageNet normalization and connected components.
No metric projection is made from the airborne image center.
"""
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import sys
import time
import types

ROOT=Path(__file__).resolve().parents[2]
class Config(dict):
    __getattr__=dict.__getitem__
def config(value):
    if isinstance(value,dict):return Config({k:config(v) for k,v in value.items()})
    if isinstance(value,list):return [config(v) for v in value]
    return value
def digest(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--upstream',required=True);p.add_argument('--weights',required=True);p.add_argument('--output',required=True);p.add_argument('--max-frames',type=int,default=180)
    a=p.parse_args();upstream=Path(a.upstream);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    import cv2
    import numpy as np
    import torch
    import yaml
    cv2.setNumThreads(4);torch.set_num_threads(4)
    # Import only the two inspected model modules, without unrelated factories.
    package=types.ModuleType('_wasb_models');package.__path__=[str(upstream/'src/models')];sys.modules[package.__name__]=package
    HRNet=importlib.import_module('_wasb_models.hrnet').HRNet
    TrackNetV2=importlib.import_module('_wasb_models.unet2d').TrackNetV2
    mean=np.array([.485,.456,.406],np.float32);std=np.array([.229,.224,.225],np.float32)
    library=json.loads((ROOT/'data/videos/tactics/acceptance/review-library.json').read_text('utf-8'))
    for name in ('wasb','tracknetv2'):
        weight=Path(a.weights)/f'{name}-basketball.pth'
        model=HRNet(config(yaml.safe_load((upstream/'src/configs/model/wasb.yaml').read_text()))) if name=='wasb' else TrackNetV2(9,3,bilinear=True,halve_channel=False)
        checkpoint=torch.load(weight,map_location='cpu',weights_only=True)
        model.load_state_dict(checkpoint['model_state_dict'],strict=True);model.to('cuda').eval()
        for sid in ('004','005','006'):
            target=out/f'{sid}-{name}.json'
            previous=json.loads(target.read_text('utf-8')) if target.exists() else None
            sample=next(s for s in library['samples'] if s['id']==sid);video=ROOT/sample['video'];track=ROOT/next(v['tracks'] for v in sample['trackingVariants'] if v['id']=='ebard')
            before=digest(track);records=json.loads(track.read_text('utf-8'));limit=min(len(records),a.max_frames)
            if previous and (previous['trackingFingerprint']!=before or previous['weightSha256']!=digest(weight)):raise ValueError('Cannot extend a different source or model')
            if previous and len(previous['frames'])>=limit:continue
            cap=cv2.VideoCapture(str(video));images=[];times=[]
            for i in range(limit):
                ok,image=cap.read()
                if not ok:raise ValueError('Video ended before selected records')
                h,w=image.shape[:2]
                if abs(w/h-16/9)>.01:raise ValueError('This comparison supports original 16:9 samples only; preserve upstream affine transform otherwise')
                rgb=cv2.resize(image[:,:,::-1],(512,288),interpolation=cv2.INTER_LINEAR)
                images.append(((rgb.astype(np.float32)/255.-mean)/std).transpose(2,0,1))
            cap.release();offset=len(previous['frames'])//3*3 if previous else 0;result=previous['frames'][:offset] if previous else []
            for start in range(offset,limit,3):
                group=[images[min(start+j,limit-1)] for j in range(3)]
                x=torch.from_numpy(np.concatenate(group,axis=0)[None]).to('cuda')
                t0=time.perf_counter()
                with torch.inference_mode():heatmaps=model(x)[0].sigmoid().cpu().numpy()[0]
                times.append(time.perf_counter()-t0)
                for j,hm in enumerate(heatmaps):
                    frame=start+j
                    if frame>=limit:break
                    count,labels=cv2.connectedComponents((hm>.5).astype(np.uint8));candidates=[]
                    for label in range(1,count):
                        ys,xs=np.where(labels==label);weights=hm[ys,xs];score=float(weights.sum())
                        candidates.append({'x':float((xs*weights).sum()/score*w/512),'y':float((ys*weights).sum()/score*h/288),
                                           'heatmapMass':score,'peak':float(weights.max()),'pixels':int(len(xs))})
                    candidates.sort(key=lambda c:-c['heatmapMass'])
                    result.append({'frame':frame,'time':records[frame]['time'],'candidates':candidates,'selected':candidates[0] if candidates else None,
                                   'paddedContext':start+2>=limit})
                if start%90==0:print(name,sid,start,flush=True)
            if digest(track)!=before:raise RuntimeError('Original tracks changed')
            target.write_text(json.dumps({'model':name,'sample':sid,'videoHash':digest(video),'trackingFingerprint':before,'weightSha256':digest(weight),
                'groundTruthAvailable':False,'rawPreserved':True,'frames':result,'medianThreeFrameSeconds':float(np.median(times)),
                'method':'published_basketball_weights; RGB normalized; 3 non-overlapping frames; heatmap>.5; largest weighted component; last context repeats final selected frame',
                'source':'https://github.com/nttcom/WASB-SBDT'},separators=(',',':')),encoding='utf-8')
        del model
        torch.cuda.empty_cache()

if __name__=='__main__':main()
