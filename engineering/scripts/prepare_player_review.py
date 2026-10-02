"""Add per-frame jersey hints and remove duplicate pending boxes; preserve every track ID and coordinate."""
import argparse,json,os
from pathlib import Path
os.environ.update(YOLO_CONFIG_DIR=str(Path('tmp/vision-benchmark-settings').resolve()),YOLO_OFFLINE='true',YOLO_AUTOINSTALL='false')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',required=True);parser.add_argument('--tracks',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    if Path(args.output).exists():parser.error('Use a fresh output path')
    import av
    from basketball_player_filter import clothing_features
    from jersey_tracker import jersey_team
    from player_proposals import detection_matches,pending_candidates
    records=json.loads(Path(args.tracks).read_text());count=0
    with av.open(args.video) as container:
        for record,decoded in zip(records,container.decode(video=0)):
            img=decoded.to_ndarray(format='bgr24');selected=record['candidates'];tracks=record['tracks']
            matches=detection_matches(selected,tracks)
            record['pending_detections']=pending_candidates(selected,tracks)
            record['team_hints']={str(int(tracks[ti][4])):jersey_team(clothing_features(img,selected[di])) for ti,di in matches.items()}
            count+=1
    assert count==len(records)
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    Path(args.output).write_text(json.dumps(records)+'\n')
    print('Prepared',count,'frames; IDs and coordinates preserved')

if __name__=='__main__':main()
