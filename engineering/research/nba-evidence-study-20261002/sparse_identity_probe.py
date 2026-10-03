"""Reuse existing sparse human spotchecks as a biased diagnostic, not dense GT."""
import argparse,collections,hashlib,json
from pathlib import Path
from scipy.optimize import linear_sum_assignment
import numpy as np

def iou(a,b):
    inter=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    area=lambda q:max(0,q[2]-q[0])*max(0,q[3]-q[1])
    den=area(a)+area(b)-inter
    return inter/den if den>0 else 0

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(exist_ok=True,parents=True)
    label_rel='engineering/research/player-tracking-spotchecks-20261002.json';lp=a.repo/label_rel;labels=json.loads(lp.read_text(encoding='utf-8'));groups=collections.defaultdict(list)
    for x in labels['observations']:groups[x['frame']].append(x)
    report={'label_source':label_rel,'label_sha256':hashlib.sha256(lp.read_bytes()).hexdigest(),'label_method':labels['method'],'limitations':[labels['limits'],'Reference boxes came from baseline detections; matching favors baseline geometry and is not an independent spatial benchmark.','Only reviewed actor observations are used. No frame in between receives inferred human truth.','Sparse ID contradiction counts are not full-clip IDSW, identity precision, IDF1 or HOTA.'],'runs':[]}
    for variant in ('original','low','reid','optimized','team-stable'):
        rel=f'data/videos/tactics/acceptance/tracks/basketball-20261002/nba-lal-min-005-{variant}.json';p=a.repo/rel;frames=json.loads(p.read_text())
        for threshold in (.3,.5):
            matches=[];unmatched=[]
            for frame,ls in groups.items():
                ts=frames[frame]['tracks'];sim=np.array([[iou(l['box'],t) for t in ts] for l in ls]);valid=sim>=threshold
                # Maximize valid cardinality before overlap; do not lose a valid match to a rejected pair.
                ii,jj=linear_sum_assignment(-(valid.astype(float)*1000+sim));seen=set()
                for i,j in zip(ii,jj):
                    if not valid[i,j]:continue
                    seen.add(i);t=ts[j];ev=frames[frame].get('track_evidence',{}).get(str(int(t[4])),{})
                    matches.append({'frame':frame,'actor':ls[i]['actor'],'track_id':int(t[4]),'iou_to_inherited_box':float(sim[i,j]),'detector_score':t[5],'color_conflict':ev.get('color_conflict'),'identity_review_required':ev.get('identity_review_required'),'identity_verified':ev.get('identity_verified')})
                unmatched.extend({'frame':frame,'actor':ls[i]['actor']} for i in range(len(ls)) if i not in seen)
            bytrack=collections.defaultdict(list);byactor=collections.defaultdict(list)
            for m in matches:bytrack[m['track_id']].append(m);byactor[m['actor']].append(m)
            conflicting=[{'track_id':t,'observed_actor_labels':sorted({m['actor'] for m in ms}),'evidence':ms} for t,ms in bytrack.items() if len({m['actor'] for m in ms})>1]
            fragments=[{'actor':actor,'observed_track_ids':sorted({m['track_id'] for m in ms}),'evidence':ms} for actor,ms in byactor.items() if len({m['track_id'] for m in ms})>1]
            report['runs'].append({'variant':variant,'path':rel,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'minimum_iou':threshold,'reviewed_actor_observations':len(labels['observations']),'matched_reference_observations':len(matches),'unmatched_reference_observations':unmatched,'conflicting_track_label_groups':conflicting,'fragmented_actor_groups':fragments,'matches':matches,'independent_accuracy':None})
    (a.out/'sparse_identity_results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps([{'variant':r['variant'],'iou':r['minimum_iou'],'matched':r['matched_reference_observations'],'conflicts':[(c['track_id'],c['observed_actor_labels']) for c in r['conflicting_track_label_groups']],'fragmented':[(c['actor'],c['observed_track_ids']) for c in r['fragmented_actor_groups']]} for r in report['runs']],indent=2))
if __name__=='__main__':main()
