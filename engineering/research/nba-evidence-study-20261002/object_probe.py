"""Offline object-channel audit. Scores/coverage are NOT accuracy estimates."""
import argparse, collections, hashlib, json, math
from pathlib import Path

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def center(b): return [(b[0]+b[2])/2,(b[1]+b[3])/2]
def edge_distance(p,b): return math.hypot(max(b[0]-p[0],0,p[0]-b[2]),max(b[1]-p[1],0,p[1]-b[3]))
def channel_state(frame):
    if 'objects' not in frame:return 'not_provided'
    return 'candidate_present' if any(o['kind']=='basketball' for o in frame['objects']) else 'not_detected_reason_unknown'
def runs(values):
    out=[]
    for x in values:
        if out and x==out[-1][-1]+1: out[-1].append(x)
        else: out.append([x])
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(exist_ok=True,parents=True)
    output={'limitations':['No independent dense object or possession labels.','All nearest-player associations below are image-space candidates, never possession.','Object-channel absence is distinct from no detection in an available channel.','BBox distance is not court distance; ball and rim are not ground-plane points.'],'samples':[],'challenge_observations':[]}
    chosen={'004':[104,139],'005':[0,47,71,119,142],'006':[0,77,230]}
    for sid in ('004','005','006'):
        rel=f'data/videos/tactics/acceptance/tracks/{sid}-ebard.json';p=a.repo/rel;frames=json.loads(p.read_text(encoding='utf-8'))
        stable_rel=f'data/videos/tactics/acceptance/tracks/basketball-20261002/{sid}-team-stable.json';stable=json.loads((a.repo/stable_rel).read_text(encoding='utf-8'))
        ball=[];hoop=[];proximity=[];no_ball=[];channel_missing=[]
        for frame in frames:
            balls=[(i,o) for i,o in enumerate(frame.get('objects',[])) if o['kind']=='basketball']
            hoops=[(i,o) for i,o in enumerate(frame.get('objects',[])) if o['kind']=='hoop']
            ball.extend((frame['frame'],i,o) for i,o in balls);hoop.extend((frame['frame'],i,o) for i,o in hoops)
            if channel_state(frame)=='not_provided':channel_missing.append(frame['frame'])
            elif not balls: no_ball.append(frame['frame'])
            for i,obj in balls:
                c=center(obj['box']);players=[t for t in frame['tracks'] if int(t[6])==2]
                ranked=sorted([{'track_id':int(t[4]),'box_edge_distance_px':edge_distance(c,t),'center_distance_px':math.dist(c,center(t)),'body_height_px':t[3]-t[1],'player_score':t[5]} for t in players],key=lambda v:v['box_edge_distance_px'])
                proximity.append({'frame':frame['frame'],'source_time':frame['time'],'object_pointer':f'/{frame["frame"]}/objects/{i}','ball_score':obj['score'],'nearest':ranked[:3],'inside_player_boxes':sum(v['box_edge_distance_px']==0 for v in ranked)})
        missing_runs=runs(no_ball)
        summary={'sample':sid,'source':rel,'sha256':digest(p),'frames':len(frames),'object_kind_counts':dict(collections.Counter(o['kind'] for f in frames for o in f.get('objects',[]))),'ball_detection_frames':len(set(f for f,_,_ in ball)),'frames_without_ball_detection':len(no_ball),'multiple_ball_frames':sum(v>1 for v in collections.Counter(f for f,_,_ in ball).values()),'longest_no_ball_run':max((len(x) for x in missing_runs),default=0),'ball_centers_inside_one_or_more_player_boxes':sum(x['inside_player_boxes']>=1 for x in proximity),'ball_centers_inside_multiple_player_boxes':sum(x['inside_player_boxes']>1 for x in proximity),'stable_frames_missing_objects_field':sum('objects' not in f for f in stable),'stable_source':stable_rel,'stable_sha256':digest(a.repo/stable_rel),'no_ball_runs':[{'start':r[0],'end':r[-1],'frames':len(r),'duration_between_endpoint_timestamps_s':frames[r[-1]]['time']-frames[r[0]]['time']} for r in missing_runs]}
        summary['source_frames_objects_not_provided']=channel_missing
        output['samples'].append(summary)
        for f in chosen[sid]: output['challenge_observations'].append({'sample':sid,'frame':f,'objects':frames[f].get('objects',[]),'associations':[x for x in proximity if x['frame']==f]})
        (a.out/f'{sid}-proximity.json').write_text(json.dumps(proximity,indent=2),encoding='utf-8')
    (a.out/'object_results.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps([{k:v for k,v in s.items() if k not in ('no_ball_runs','sha256','stable_sha256','source','stable_source')} for s in output['samples']],indent=2))
if __name__=='__main__':main()
