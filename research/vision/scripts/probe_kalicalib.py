"""Inference-only probe of the original KaliCalib network, without camera fallback.

Load the author's model from an ignored local checkout/archive. This probe tests
the learned heatmaps and plane homography, not the full official camera pipeline.
"""
import argparse
import hashlib
import importlib.util
import json
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from analyze_court_geometry import CONTROL, project, read_json


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True)
    parser.add_argument('--video',required=True)
    parser.add_argument('--output',default='artifacts/kalicalib-probe')
    args=parser.parse_args()
    source=Path(args.source); output=Path(args.output); output.mkdir(parents=True,exist_ok=True)
    spec=importlib.util.spec_from_file_location('kalicalib_author_network',source/'kalicalib/model_resnet.py')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    device='cuda' if torch.cuda.is_available() else 'cpu'
    cv2.setNumThreads(4); torch.manual_seed(4212); cv2.setRNGSeed(4212)
    frames={}; cap=cv2.VideoCapture(args.video); index=0
    while True:
        ok,frame=cap.read()
        if not ok:break
        if index in [0,90,242]:frames[index]=frame
        index+=1
    cap.release()
    profile=read_json('research/vision/vision-player-refinement/clip001-court-expanded.json')
    with Path(args.video).open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    if digest!=profile['videoHash']:raise ValueError('Video/reference mismatch')
    # Original model's 13 x 7 nonuniform ground grid, centimetres, excluding baskets.
    native=np.array([[i*2800/12,1500-(175*j+15*j*(j-1))] for j in range(7) for i in range(13)],np.float64)
    report={'source':'https://github.com/CEA-LIST/KaliCalib','sourceArchive':source.name,'nativeCourtMetres':[28,15],'device':device,'videoSha256':digest,'modelFiles':{},'results':[],'pipeline':'author network + winning-class centroids + plane RANSAC; omits official camera refinement and fixed default camera','metricAccuracyValidated':False}
    for weight_name in ['model_test.pth','model_challenge.pth']:
        weight=source/'models'/weight_name
        report['modelFiles'][weight_name]=hashlib.sha256(weight.read_bytes()).hexdigest()
        model=module.makeModel().to(device).eval()
        model.load_state_dict(torch.load(weight,map_location=device,weights_only=True),strict=True)
        for frame_id,original in frames.items():
            small=cv2.cvtColor(cv2.resize(original,(960,540)),cv2.COLOR_BGR2RGB)
            tensor=torch.from_numpy(small.transpose(2,0,1).copy()).float().to(device)/255
            mean=torch.tensor([.485,.456,.406],device=device)[:,None,None]
            std=torch.tensor([.229,.224,.225],device=device)[:,None,None]
            tensor=((tensor-mean)/std).unsqueeze(0)
            if device=='cuda':torch.cuda.synchronize()
            started=time.perf_counter()
            with torch.inference_mode():out=model(tensor)[0].cpu().numpy()
            duration=time.perf_counter()-started
            winners=out.argmax(axis=0); ids=[]; pixels=[]
            for k in range(91):
                yy,xx=np.nonzero(winners==k)
                if len(xx):ids.append(k);pixels.append([float(xx.mean()*4),float(yy.mean()*4)])
            h,inliers=(cv2.findHomography(native[ids],np.array(pixels),cv2.RANSAC,35,maxIters=2000) if len(ids)>=4 else (None,None))
            row={'weight':weight_name,'frame':frame_id,'networkSeconds':duration,'groundClassesVisible':len(ids),'inliers':int(inliers.sum()) if inliers is not None else 0,'homographyFound':h is not None}
            preview=original.copy()
            if h is not None:
                h=np.diag([2,2,1.])@h
                row['nativeCourtCmToImage']=h.flatten().tolist()
                for points in [[[0,0],[2800,0],[2800,1500],[0,1500],[0,0]],[[1400,0],[1400,1500]],[[0,505],[580,505],[580,995],[0,995]]]:
                    p=project(h,points)
                    if np.isfinite(p).all() and np.max(np.abs(p))<100000:cv2.polylines(preview,[p.astype(np.int32)],False,(0,180,255),4,cv2.LINE_AA)
                key=next(k for k in profile['keyframes'] if k['frame']==frame_id)
                # Diagnostic only: normalized boundary coordinates do not adapt NBA line semantics.
                floor=[np.array(CONTROL[p['id']])*[2800/28.6512,1500/15.24] for p in key['points']]
                predicted=project(h,floor)
                row['normalizedTemplateDifferencePixelsMedian']=float(np.median(np.linalg.norm(predicted-np.array([p['image'] for p in key['points']]),axis=1)))
            cv2.rectangle(preview,(0,0),(1920,62),(22,30,40),-1)
            cv2.putText(preview,f'KaliCalib {weight_name}: ORIGINAL 28 x 15 m template | NOT NBA calibrated',(20,40),cv2.FONT_HERSHEY_SIMPLEX,.76,(255,255,255),2)
            cv2.imwrite(str(output/f'{weight_name[:-4]}-{frame_id:03d}.jpg'),preview)
            report['results'].append(row)
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({**report,'results':[{k:v for k,v in r.items() if k!='nativeCourtCmToImage'} for r in report['results']]},indent=2))


if __name__=='__main__':main()
