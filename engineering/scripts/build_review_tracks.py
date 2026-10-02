"""Generate generic human candidates for explicitly supplied acceptance clips.

These are model proposals, not ten verified basketball identities. No jersey-specific
filter from the IND/OKC experiment is applied to unrelated footage.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',required=True)
    parser.add_argument('--model',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--min-foot-y-ratio',type=float,default=.15,help='Optional clip-specific lower-image candidate area; not a player classifier')
    args=parser.parse_args()
    out=Path(args.output)
    if out.exists():parser.error('Choose a fresh output path')
    os.environ.update(YOLO_CONFIG_DIR=str(Path('tmp/vision-benchmark-settings').resolve()),YOLO_OFFLINE='true',YOLO_AUTOINSTALL='false')
    import av
    import numpy as np
    import torch
    from ultralytics import YOLO,settings
    from ultralytics.engine.results import Boxes
    from ultralytics.trackers.byte_tracker import BYTETracker
    from player_proposals import pending_candidates
    settings.update({'sync':False})
    model=YOLO(args.model)
    tracker=BYTETracker(SimpleNamespace(track_high_thresh=.2,track_low_thresh=.07,new_track_thresh=.2,
        track_buffer=30,match_thresh=.8,fuse_score=True))
    records=[]
    with av.open(args.video) as c:
        for i,f in enumerate(c.decode(video=0)):
            img=f.to_ndarray(format='bgr24');h,w=img.shape[:2]
            raw=model.predict(img,classes=[0],conf=.07,imgsz=960,device=0 if torch.cuda.is_available() else 'cpu',half=torch.cuda.is_available(),verbose=False)[0].boxes.data.cpu().numpy()
            candidates=raw[(raw[:,3]-raw[:,1]>.045*h)&(raw[:,2]-raw[:,0]>.012*w)&(raw[:,3]>args.min_foot_y_ratio*h)]
            tracks=tracker.update(Boxes(candidates,img.shape[:2]),img).reshape(-1,8)
            records.append({'frame':i,'time':float(f.time),'tracks':tracks[:,:7].tolist(),
                'pending_detections':np.asarray(pending_candidates(candidates,tracks)).tolist(),'candidate_count':len(candidates)})
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(records,separators=(',',':'))+'\n',encoding='utf-8')
    metadata={'video_sha256':hashlib.sha256(Path(args.video).read_bytes()).hexdigest(),'frames':len(records),
        'model':Path(args.model).name,'tracker':'ByteTrack','identity_verified':False,'width':w,'height':h,
        'min_foot_y_ratio':args.min_foot_y_ratio,'candidate_filter_note':'Clip-specific image area proposal filter; may omit occluded or far-side players'}
    out.with_suffix('.meta.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(metadata))


if __name__=='__main__':main()
