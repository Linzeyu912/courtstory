"""Cache detections and compare tracking configurations without rerunning YOLO each time."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[2] / "scripts"))
import time

os.environ.update(YOLO_CONFIG_DIR=str(Path('tmp/vision-benchmark-settings').resolve()), YOLO_OFFLINE='true', YOLO_AUTOINSTALL='false')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',required=True)
    parser.add_argument('--cache',required=True)
    parser.add_argument('--profile',default='research/vision/vision-player-refinement/clip001-profile.json')
    parser.add_argument('--model',default='tmp/vision-deploy-bench/yolov8m.pt')
    parser.add_argument('--output-dir',default='artifacts/vision-tracking-repair')
    parser.add_argument('--only',help='Run only the named tracking configuration')
    args=parser.parse_args()
    import av
    import numpy as np
    from types import SimpleNamespace
    from ultralytics import YOLO,settings
    from ultralytics.engine.results import Boxes
    from ultralytics.trackers.byte_tracker import BYTETracker
    from ultralytics.trackers.bot_sort import BOTSORT
    from ultralytics.trackers.oc_sort import OCSORT
    from jersey_tracker import JerseyBYTETracker
    from player_proposals import pending_candidates
    from basketball_player_filter import detect_multiscale,filter_candidates,candidate_polygon
    from ultralytics.utils import YAML
    import ultralytics
    settings.update({'sync':False})
    dest=Path(args.output_dir);dest.mkdir(parents=True,exist_ok=True)
    cache_path=Path(args.cache)
    profile=json.loads(Path(args.profile).read_text())
    with open(args.video,'rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=profile['video_sha256']:
            parser.error('The profile and cached experiment belong to a different video')
    started=time.perf_counter()
    if cache_path.exists():
        records=json.loads(cache_path.read_text())
    else:
        model=YOLO(args.model);records=[]
        with av.open(args.video) as container:
            for index,frame in enumerate(container.decode(video=0)):
                img=frame.to_ndarray(format='bgr24')
                raw=detect_multiscale(model,img,1280)
                selected,observations=filter_candidates(img,raw,candidate_polygon(profile,index),profile)
                records.append({'frame':index,'time':float(frame.time),'raw_detections':raw.tolist(),
                                'candidates':selected.tolist(),'observations':observations})
                if index%60==0:print('Cached',index,flush=True)
        cache_path.parent.mkdir(parents=True,exist_ok=True)
        cache_path.write_text(json.dumps(records)+'\n')
    print('Cache ready',round(time.perf_counter()-started,3),flush=True)
    configs={
        'byte-original':('bytetrack',BYTETracker,{}),
        'byte-buffer60':('bytetrack',BYTETracker,{'track_buffer':60}),
        'botsort':('botsort',BOTSORT,{'with_reid':False}),
        'ocsort':('ocsort',OCSORT,{'use_byte':True}),
        'byte-jersey':('bytetrack',JerseyBYTETracker,{}),
    }
    trackers={}
    cfg_dir=Path(ultralytics.__file__).parent/'cfg/trackers'
    for name,(filename,cls,overrides) in configs.items():
        if args.only and name!=args.only:continue
        cfg=YAML.load(cfg_dir/(filename+'.yaml'))
        cfg.update(track_high_thresh=.20,track_low_thresh=.07,new_track_thresh=.20,track_buffer=30,match_thresh=.8,fuse_score=False)
        cfg.update(overrides)
        trackers[name]=cls(SimpleNamespace(**cfg))
    # Run separately because Ultralytics track counters are shared across instances.
    report={}
    for name,tracker in trackers.items():
        tracker.reset();output=[];started=time.perf_counter()
        with av.open(args.video) as container:
            for record,frame in zip(records,container.decode(video=0)):
                img=frame.to_ndarray(format='bgr24')
                selected=np.asarray(record['candidates'],dtype=np.float32).reshape(-1,6)
                tracked=tracker.update(Boxes(selected,img.shape[:2]),img).reshape(-1,8)
                pending=pending_candidates(selected.tolist(),tracked.tolist())
                output.append({'frame':record['frame'],'time':record['time'],'tracks':tracked[:,:7].tolist(),
                               'pending_detections':pending,'candidates':selected.tolist()})
        seconds=time.perf_counter()-started
        report[name]={'seconds_decode_and_tracking':seconds,'unique_ids':len({int(b[4]) for f in output for b in f['tracks']})}
        (dest/(name+'.tracks.json')).write_text(json.dumps(output)+'\n')
        print(name,report[name],flush=True)
    report_path=dest/'tracker-comparison.json'
    previous=json.loads(report_path.read_text()) if report_path.exists() else {}
    previous.update(report)
    report_path.write_text(json.dumps(previous,indent=2)+'\n')

if __name__=='__main__':main()
