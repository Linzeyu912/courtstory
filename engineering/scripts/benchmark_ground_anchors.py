"""Compare bbox proxies with pose ankles; neither is labelled ground truth."""
import argparse
import hashlib
import json
import os
import time
from pathlib import Path

os.environ['YOLO_CONFIG_DIR'] = str(Path('tmp/vision-benchmark-settings').resolve())
os.environ['YOLO_AUTOINSTALL'] = 'false'

import cv2
import numpy as np
import torch
from ultralytics import YOLO
from analyze_court_geometry import fit_key, project


def iou(a, b):
    lo, hi = np.maximum(a[:2], b[:2]), np.minimum(a[2:4], b[2:4])
    overlap = np.maximum(0, hi-lo).prod()
    return float(overlap/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-overlap+1e-9))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', required=True)
    parser.add_argument('--tracks', default='artifacts/vision-tracking-repair/original-review.tracks.json')
    parser.add_argument('--profile', default='engineering/research/vision-player-refinement/clip001-court-expanded.json')
    parser.add_argument('--model', default='tmp/vision-deploy-bench/yolov8s-pose.pt')
    parser.add_argument('--output', default='artifacts/ground-anchor-audit')
    args = parser.parse_args()
    cv2.setNumThreads(4)
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    profile = json.loads(Path(args.profile).read_text(encoding='utf-8'))
    records = json.loads(Path(args.tracks).read_text(encoding='utf-8'))
    with Path(args.video).open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != profile['videoHash']: raise ValueError('Video/reference mismatch')
    keys = {k['frame']: k for k in profile['keyframes']}
    started = time.perf_counter()
    model = YOLO(args.model)
    device = 0 if torch.cuda.is_available() else 'cpu'
    model.predict(np.zeros((1080,1920,3),np.uint8),imgsz=1280,device=device,verbose=False)
    warmup_seconds = time.perf_counter()-started
    cap = cv2.VideoCapture(args.video)
    rows, frame, timings = [], -1, []
    started = time.perf_counter()
    while True:
        ok, image = cap.read(); frame += 1
        if not ok: break
        if frame not in keys: continue
        begin = time.perf_counter()
        result = model.predict(image,imgsz=1280,conf=.25,device=device,verbose=False)[0]
        boxes = result.boxes.xyxy.cpu().numpy()
        keypoints = result.keypoints.data.cpu().numpy()
        if torch.cuda.is_available(): torch.cuda.synchronize()
        timings.append(time.perf_counter()-begin)
        pairs = sorted([(iou(track,box),i,j) for i,track in enumerate(records[frame]['tracks']) for j,box in enumerate(boxes)],reverse=True)
        matches, used = {}, set()
        for score,i,j in pairs:
            if score>=.5 and i not in matches and j not in used:
                matches[i]=(j,score); used.add(j)
        inverse = np.linalg.inv(fit_key(keys[frame]))
        preview = image.copy()
        for i,track in enumerate(records[frame]['tracks']):
            bbox_point = [(track[0]+track[2])/2,track[3]]
            bbox_court = project(inverse,[bbox_point])[0]
            row = {'frame':frame,'trackId':int(track[4]),'bboxPoint':bbox_point,'bboxCourt':bbox_court.tolist(),'contactState':'unknown','status':'pose_unmatched'}
            cv2.drawMarker(preview,tuple(np.round(bbox_point).astype(int)),(0,210,255),cv2.MARKER_CROSS,16,2)
            cv2.putText(preview,str(int(track[4])),(int(track[0]),int(track[1])-5),cv2.FONT_HERSHEY_SIMPLEX,.6,(0,210,255),2)
            if i in matches:
                j,score=matches[i]; ankles=keypoints[j,[15,16]]
                row.update({'matchIou':score,'ankles':ankles.tolist(),'status':'ankle_low_confidence'})
                for ankle,color in zip(ankles,[(255,100,220),(255,230,50)]):
                    if ankle[2]>=.5: cv2.circle(preview,tuple(np.round(ankle[:2]).astype(int)),7,color,2)
                if np.all(ankles[:,2]>=.5):
                    # Project each ankle first. Averaging image points is not a ground-plane average.
                    court = project(inverse,ankles[:,:2]).mean(axis=0)
                    row.update({'status':'ankle_candidate','ankleCourtProxy':court.tolist(),'differenceMetres':float(np.linalg.norm(court-bbox_court))})
            rows.append(row)
        cv2.rectangle(preview,(0,0),(1920,70),(25,30,35),-1)
        cv2.putText(preview,'Yellow +: box bottom proxy | Pink/cyan circles: ankles >= 0.5 | Ground contact UNKNOWN',(20,42),cv2.FONT_HERSHEY_SIMPLEX,.72,(255,255,255),2)
        cv2.imwrite(str(output/f'anchors-{frame:03d}.jpg'),preview)
    cap.release()
    diff=[r['differenceMetres'] for r in rows if 'differenceMetres' in r]
    report={'videoSha256':digest,'model':args.model,'modelSha256':hashlib.sha256(Path(args.model).read_bytes()).hexdigest(),'source':'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8s-pose.pt','device':str(device),'inputSize':1280,'sampleFrames':len(timings),'trackObservations':len(rows),'matchedPoseObservations':sum('ankles' in r for r in rows),'bothAnklesAboveThreshold':len(diff),'ankleConfidenceThreshold':.5,'loadAndWarmupSeconds':warmup_seconds,'wallSecondsExcludingWarmup':time.perf_counter()-started,'predictMedianSeconds':float(np.median(timings)),'proxyDifferenceMetresMedian':float(np.median(diff)) if diff else None,'proxyDifferenceMetresP90':float(np.percentile(diff,90)) if diff else None,'metricAccuracyValidated':False,'notes':['Ankles are above the floor. Contact, occlusion and jumping remain unresolved.','Difference between proxies is not error against ground truth.','Court transform uses unvalidated visual references.','Runtime is nine sampled frames plus decoding; not a full-pipeline benchmark.']}
    (output/'observations.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
