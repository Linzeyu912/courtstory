"""Exploratory ball ambiguity policies. Returns suggestions, never rewrites raw."""
import argparse,hashlib,json,math,time
from pathlib import Path

def xy(o):b=o['box'];return ((b[0]+b[2])/2,(b[1]+b[3])/2)
def radius(o):b=o['box'];return max(1,math.hypot(b[2]-b[0],b[3]-b[1])/2)
def choices(f):return [(i,o) for i,o in enumerate(f.get('objects',[])) if o['kind']=='basketball']
def nearest_anchor(frames,t,direction,max_frames=3):
    for gap in range(1,max_frames+1):
        k=t+direction*gap
        if k<0 or k>=len(frames):break
        cs=choices(frames[k])
        if len(cs)==1:return {'frame':k,'index':cs[0][0],'object':cs[0][1],'time':frames[k]['time']}
    return None
def ranked(target,anchor):return sorted([(math.dist(xy(o),xy(anchor['object'])),i) for i,o in target])
def margin_ok(rank,target):
    # Deliberately fixed before this probe; exploratory, no calibration claim.
    return len(rank)>1 and rank[1][0]-rank[0][0] > radius(dict(target)[rank[0][1]])

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(exist_ok=True,parents=True)
    rows=[];sources=[];start=time.perf_counter()
    for sid in ('004','005','006'):
        rel=f'data/videos/tactics/acceptance/tracks/{sid}-ebard.json';p=a.repo/rel;frames=json.loads(p.read_text(encoding='utf-8'));sources.append({'path':rel,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
        for t,f in enumerate(frames):
            cs=choices(f)
            if len(cs)<2:continue
            highest=max(o['score'] for _,o in cs); tied=[i for i,o in cs if o['score']==highest]
            before=nearest_anchor(frames,t,-1);after=nearest_anchor(frames,t,1)
            r_before=ranked(cs,before) if before else [];r_after=ranked(cs,after) if after else []
            causal=r_before[0][1] if r_before and margin_ok(r_before,cs) else None
            consensus=causal if causal is not None and r_after and margin_ok(r_after,cs) and r_after[0][1]==causal else None
            decision_at=after['time'] if after else frames[min(t+3,len(frames)-1)]['time']
            rows.append({'sample':sid,'frame':t,'time':f['time'],'candidate_count':len(cs),'confidence_first_tie_broken':tied[0],'confidence_tie_aware':tied[0] if len(tied)==1 else None,'score_tied':len(tied)>1,'causal_nearest_singleton':causal,'two_sided_consensus':consensus,'before_frame':before['frame'] if before else None,'after_frame':after['frame'] if after else None,'before_distance_rank_px':r_before,'after_distance_rank_px':r_after,'future_wait_s':decision_at-f['time'],'causal_available_at_s':f['time'],'two_sided_available_at_s':decision_at,'status':'suggestion_or_abstain','raw_mutation':False})
    elapsed=time.perf_counter()-start
    result={'sources':sources,'runtime_seconds_read_parse_select':elapsed,'rules':{'max_anchor_gap_frames':3,'minimum_margin':'one candidate half diagonal','singleton_anchor_accuracy_validated':False,'camera_compensated':False,'score_is_probability':False,'shot_boundaries_checked':False},'limits':['Input is not ground truth.','Singleton neighbors may also be wrong; temporal agreement is not independent evidence.','Shot boundaries are NOT checked in this probe. Suggestions may cross a shot boundary and cannot be executed as corrections; a downstream gate must require reviewed shot scope.','No automatic correction or possession assignment.','Future evidence requires explicit wait and revises a prior view.','Selection is exploratory on existing challenge examples; it is not a held-out accuracy estimate.'],'rows':rows}
    (a.out/'selection_results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'ambiguous_frames':len(rows),'causal_suggestions':sum(r['causal_nearest_singleton'] is not None for r in rows),'two_sided_suggestions':sum(r['two_sided_consensus'] is not None for r in rows),'challenge_rows':[r for r in rows if (r['sample'],r['frame']) in [('005',4),('005',117),('006',242),('006',330)]]},indent=2))
if __name__=='__main__':main()
