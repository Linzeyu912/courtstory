"""Read-only court audit: non-YOLO line candidates and floor-motion tracking.

The motion experiment starts from named manual/reference controls. It does not
recognize court semantics autonomously. Cached person boxes only mask players.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np

L, W = 28.6512, 15.24
CONTROL = {"A": [0, 5.1816], "B": [5.7912, 5.1816], "C": [5.7912, 10.0584],
           "D": [0, 10.0584], "E": [0, 0], "F": [L/2, 0], "G": [0, W],
           "H": [L/2, W], "I": [0, .9144], "J": [0, W-.9144]}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def project(h, points):
    return cv2.perspectiveTransform(np.array(points, np.float64).reshape(-1, 1, 2), h).reshape(-1, 2)


def fit_key(key):
    points = key.get("points") or [{"id": i, "image": p} for i, p in zip("ABCD", key["image"])]
    points = [p for p in points if p.get("enabled", True)]
    floor = np.array([CONTROL[p['id']] for p in points], np.float64)
    if key.get('side') == 'right':
        floor[:, 0] = L-floor[:, 0]
    image = np.array([p['image'] for p in points], np.float64)
    return cv2.findHomography(floor, image, 0)[0]


def template_lines():
    result = [('far sideline', [[0, 0], [L, 0]], (100, 190, 0)),
              ('near sideline', [[0, W], [L, W]], (100, 190, 0)),
              ('midline', [[L/2, 0], [L/2, W]], (220, 80, 170)),
              ('baseline', [[0, 0], [0, W]], (30, 170, 255)),
              ('key', [CONTROL[c] for c in 'ABCD'], (255, 160, 50))]
    theta = np.arcsin((7.62-.9144)/7.239)
    arc = [[1.6002+7.239*np.cos(a), 7.62+7.239*np.sin(a)] for a in np.linspace(-theta, theta, 65)]
    result.append(('three-point line', [[0, .9144], *arc, [0, W-.9144]], (50, 70, 245)))
    return result


def ground_mask(shape, h, boxes):
    height, width = shape
    mask = np.zeros(shape, np.uint8)
    polygon = np.clip(project(h, [[0, 0], [L, 0], [L, W], [0, W]]), -10000, 10000).astype(np.int32)
    cv2.fillPoly(mask, [polygon], 255)
    mask[int(height*.87):] = 0  # Exclude this clip's lower broadcast graphics.
    for box in boxes:
        x1, y1, x2, y2 = np.array(box[:4])*.5
        cv2.rectangle(mask, (int(x1)-6, int(y1)-6), (int(x2)+6, int(y2)+6), 0, -1)
    return mask


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', required=True)
    parser.add_argument('--profile', default='engineering/research/vision-player-refinement/clip001-court-expanded.json')
    parser.add_argument('--original', default='engineering/research/vision-player-refinement/clip001-court-reference.json')
    parser.add_argument('--cached-people', default='artifacts/vision-tracking-repair/detections.json')
    parser.add_argument('--output', default='artifacts/court-calibration-audit')
    args = parser.parse_args()
    cv2.setNumThreads(4)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    profile, original = read_json(args.profile), read_json(args.original)
    with Path(args.video).open('rb') as stream:
        video_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    if video_hash != profile['videoHash'] or video_hash != original['videoHash']:
        raise ValueError('Reference controls belong to another video')
    records = read_json(args.cached_people) if Path(args.cached_people).is_file() else []
    cap = cv2.VideoCapture(args.video)
    if cap.get(cv2.CAP_PROP_FRAME_WIDTH) != 1920 or cap.get(cv2.CAP_PROP_FRAME_HEIGHT) != 1080:
        raise ValueError('This diagnostic uses the verified 1920 x 1080 clip')
    fps = cap.get(cv2.CAP_PROP_FPS)
    start = time.perf_counter()
    ok, frame = cap.read()
    if not ok:
        raise ValueError('Cannot decode video')
    old_h, initial_h = fit_key(original['keyframes'][0]), fit_key(profile['keyframes'][0])
    for title, h in [('original', old_h), ('expanded', initial_h)]:
        preview = frame.copy()
        for name, points, color in template_lines():
            p = project(h, points).round().astype(np.int32)
            cv2.polylines(preview, [p], False, color, 3, cv2.LINE_AA)
        cv2.putText(preview, f'{title}: projected court lines, calibration still requires review', (25, 40), cv2.FONT_HERSHEY_SIMPLEX, .7, (255, 255, 255), 2)
        cv2.imwrite(str(output/f'{title}-projection.jpg'), preview)
    # Detect straight image segments. They remain unlabelled candidates.
    small = cv2.resize(frame, (960, 540))
    scale = np.diag([.5, .5, 1.])
    h = scale @ initial_h
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    boxes = records[0]['raw_detections'] if records else []
    mask = ground_mask(gray.shape, h, boxes)
    line_start = time.perf_counter()
    segments = cv2.createLineSegmentDetector().detect(gray)[0]
    kept = []
    for raw in np.asarray(segments).reshape(-1, 4) if segments is not None else []:
        x1, y1, x2, y2 = raw
        mid = np.array([(x1+x2)/2, (y1+y2)/2]).astype(int)
        if np.hypot(x2-x1, y2-y1) >= 35 and mask[mid[1], mid[0]]:
            kept.append([round(float(v)*2, 2) for v in raw])
    line_seconds = time.perf_counter()-line_start
    preview = frame.copy()
    for n, (x1,y1,x2,y2) in enumerate(kept):
        cv2.line(preview,(int(x1),int(y1)),(int(x2),int(y2)),(255,200,0),3)
        cv2.putText(preview,str(n+1),(int(x1),int(y1)),cv2.FONT_HERSHEY_SIMPLEX,.45,(0,0,255),1)
    cv2.imwrite(str(output/'line-candidates.jpg'),preview)
    # Re-estimate floor motion between every adjacent frame. No fresh detector runs.
    motion = [{'frame':0,'status':'reference_seed','courtToImage':initial_h.flatten().tolist()}]
    checks = []
    references = {k['frame']: k for k in profile['keyframes']}
    index = 0
    active = True
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        index += 1
        now = cv2.cvtColor(cv2.resize(frame,(960,540)),cv2.COLOR_BGR2GRAY)
        if not active:
            motion.append({'frame':index,'status':'requires_recalibration'})
            gray=now
            continue
        boxes = records[index-1]['raw_detections'] if records else []
        mask = ground_mask(gray.shape,h,boxes)
        points = cv2.goodFeaturesToTrack(gray,maxCorners=220,qualityLevel=.015,minDistance=7,mask=mask)
        count, ratio, residual, spread = 0, 0., None, 0.
        transform = None
        if points is not None and len(points)>=12:
            nxt, status, _ = cv2.calcOpticalFlowPyrLK(gray,now,points,None,winSize=(21,21),maxLevel=3)
            back, backstatus, _ = cv2.calcOpticalFlowPyrLK(now,gray,nxt,None,winSize=(21,21),maxLevel=3)
            valid=(status.ravel()==1)&(backstatus.ravel()==1)&(np.linalg.norm(points-back,axis=2).ravel()<1.5)
            a,b=points[valid].reshape(-1,2),nxt[valid].reshape(-1,2)
            if len(a)>=12:
                transform,inliers=cv2.findHomography(a,b,cv2.RANSAC,2.)
                if transform is not None:
                    inliers=inliers.ravel().astype(bool);count=int(inliers.sum());ratio=float(inliers.mean())
                    residual=float(np.median(np.linalg.norm(project(transform,a[inliers])-b[inliers],axis=1))*2)
                    spread=float(cv2.contourArea(cv2.convexHull(a[inliers]))/(960*540))
        accepted=transform is not None and count>=12 and ratio>=.65 and spread>=.025 and residual<3
        row={'frame':index,'status':'motion_estimate' if accepted else 'requires_recalibration','inliers':count,'inlierRatio':ratio,'medianResidualPixels':residual,'imageAreaCoverage':spread}
        if accepted:
            h=transform@h
            full_h=np.linalg.inv(scale)@h;full_h/=full_h[2,2]
            row['courtToImage']=full_h.flatten().tolist()
            if index in references:
                key=references[index]
                xy=np.array([p['image'] for p in key['points']])
                predicted=project(full_h,[CONTROL[p['id']] for p in key['points']])
                checks.append({'frame':index,'medianDifferenceFromVisualReferencePixels':float(np.median(np.linalg.norm(xy-predicted,axis=1)))})
                preview=frame.copy()
                for _,p,c in template_lines():cv2.polylines(preview,[project(full_h,p).astype(np.int32)],False,c,3,cv2.LINE_AA)
                cv2.imwrite(str(output/f'motion-{index:03d}.jpg'),preview)
        else:
            active=False  # Never silently keep applying the last camera pose.
        motion.append(row);gray=now
    cap.release()
    report={'videoSha256':video_hash,'frames':len(motion),'fps':fps,'wallSeconds':time.perf_counter()-start,'lineCandidateSeconds':line_seconds,'straightCandidatesFirstFrame':len(kept),'motionAcceptedFrames':sum(r['status']=='motion_estimate' for r in motion),'motionFailedFrames':sum(r['status']=='requires_recalibration' for r in motion),'usesNewYoloInference':False,'usesCachedPeopleMask':bool(records),'seed':'expanded reference controls at frame 0','independentMetricAccuracyValidated':False,'visualReferenceComparisons':checks,'notes':['Line candidates have no automatic court semantics.','Motion quality gates are experimental, not calibrated probabilities.','Reference comparisons are rough manual annotations, not surveyed ground truth.','Masks depend on this clip geometry and lower graphics region.']}
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (output/'motion.json').write_text(json.dumps(motion)+'\n',encoding='utf-8')
    (output/'line-candidates.json').write_text(json.dumps(kept)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
