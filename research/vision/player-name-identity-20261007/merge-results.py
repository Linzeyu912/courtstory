"""Merge source-compatible saved model runs, then analyze canonical slot evidence."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from local_video_library import atomic_json
from player_name_identity import apply_reference_slot_identities


def read(path):return json.loads(path.read_text(encoding='utf-8'))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base',default='v4')
    parser.add_argument('--replace',action='append',default=[])
    parser.add_argument('--label',required=True)
    parser.add_argument('--boundary-review',action='store_true',help='Apply saved source-frame review only as conservative machine exclusions')
    args=parser.parse_args()
    replacements=[(value.split(':',1)[0],set(value.split(':',1)[1].split(',')) if ':' in value else None)
        for value in args.replace]
    for label in [args.base,args.label,*[label for label,_ in replacements]]:
        if not label.replace('-','').isalnum():parser.error('Use simple artifact folder names')
    root=ROOT/'artifacts/player-name-optimization-20261007'
    original=read(root/args.base/'job.json');job=deepcopy(original)
    session=read(root/args.base/'input-session.json');clip=read(root/args.base/'input-clip.json')
    components=[];owners={};requests={};source_evidence=[]
    for label,subset in [(args.base,None),*replacements]:
        folder=root/label;component=read(folder/'job.json');summary=read(folder/'summary.json')
        if component['base']!=original['base'] or read(folder/'input-session.json')!=session or read(folder/'input-clip.json')!=clip:
            raise ValueError('Model run sources or original sessions differ; cannot merge')
        if component['candidate']['algorithm']!=original['candidate']['algorithm']:
            raise ValueError('Model algorithms differ; inspect before merging')
        source_evidence.extend(deepcopy(component['candidate']['candidates']))
        selected=set(summary['selectedPlayers'])
        if subset is not None:
            if not subset<=selected:raise ValueError('Replacement subset was not actually reviewed')
            selected=subset
        if label!=args.base:
            newer=[c for c in component['candidate']['candidates'] if c['entityId'] in selected]
            # A follow-up looking at different windows is not a denial of earlier
            # successful finite proofs. Preserve them unless a newer positive
            # covers the same athlete/T/range; actual conflicts are handled below
            # by canonical identities and the finite ownership review.
            prior=[deepcopy(c) for c in job['candidate']['candidates'] if c['entityId'] in selected and c['status']=='candidate'
                and not any(n['status']=='candidate' and n['entityId']==c['entityId'] and n['trackId']==c['trackId']
                    and n.get('playerId')==c.get('playerId') and n['start']<=c['start']<=c['end']<=n['end'] for n in newer)]
            job['candidate']['candidates']=[c for c in job['candidate']['candidates'] if c['entityId'] not in selected]
            job['candidate']['issues']=[i for i in job['candidate'].get('issues',[]) if i.get('entityId') not in selected]
            job['candidate']['candidates'].extend(deepcopy([c for c in component['candidate']['candidates'] if c['entityId'] in selected]))
            for c in prior:c['retainedPriorEvidence']=True
            job['candidate']['candidates'].extend(prior)
            job['candidate']['issues'].extend(deepcopy([i for i in component['candidate'].get('issues',[]) if i.get('entityId') in selected]))
        owners.update({p:label for p in selected})
        for key,value in component['candidate'].get('usage',{}).items():
            requests[key]=requests.get(key,0)+value
        calls=read(folder/'calls.json')
        if not isinstance(calls,list):raise ValueError('Actual call log must be an array')
        components.append({'folder':label,'jobId':component['jobId'],'sourceKey':component['sourceKey'],
            'selectedPlayers':sorted(selected),'actualHttpAttempts':len(calls),
            'successfulHttpAttempts':sum(c.get('ok') is True for c in calls)})
    job['candidate']['correctedBindings']=[deepcopy(c) for c in job['candidate']['candidates'] if c.get('bindingCorrection') and c['status']=='candidate']
    job['candidate']['usage']=requests
    job['candidate']['componentRuns']=components
    job['candidate']['selectedResultByPlayer']=owners
    # Raw files stay intact; this receives a new identity so adoption cannot be
    # skipped by the browser's protection against applying the same job twice.
    job=apply_reference_slot_identities(job)
    if args.boundary_review:
        review=read(root/'diagnosis/boundary-review.json')
        if (review['videoSha256']!=clip['video_sha256'] or review['trackingFingerprint']!=clip['tracking_fingerprint']
            or review['trackingRevision']!=clip['tracking_revision'] or review.get('humanVerified') is not False):
            raise ValueError('Boundary review source mismatch')
        before=deepcopy(job['candidate']['candidates'])
        for boundary in review['boundaryReviews']:
            for limit in boundary.get('currentRunConservativeLimits',[]):
                for c in job['candidate']['candidates']:
                    if (c['entityId']==limit['entityId'] and c['trackId']==limit['trackId'] and c.get('bindingCorrection')
                        and c['start']<limit['minimumCorrectionStart']<=c['end']):
                        c['boundaryReviewOriginalRange']=[c['start'],c['end']]
                        c['start']=limit['minimumCorrectionStart']
                        c['evidence']=[e for e in c['evidence'] if c['start']<=e['frame']<=c['end']]
            for limit in boundary.get('ordinaryCandidateLimits',[]):
                for c in job['candidate']['candidates']:
                    if (c['entityId']==limit['entityId'] and c['trackId']==limit['trackId'] and not c.get('bindingCorrection')
                        and c['start']<=limit['maximumEnd']<c['end']):
                        c['boundaryReviewOriginalRange']=[c['start'],c['end']]
                        c['end']=limit['maximumEnd']
                        c['evidence']=[e for e in c['evidence'] if c['start']<=e['frame']<=c['end']]
            for gap in boundary.get('recommendedMachineReleaseGaps',[]):
                # A rejection releases an uncertain old AI observation; it never
                # assigns an athlete from the diagnostic suggested number/name.
                observed=[e for c in before if c['trackId']==gap['trackId'] for e in c['evidence']
                    if gap['start']<=e['frame']<=gap['end']]
                profile=next((p for p in job['candidate']['playerProfiles'] if p['entityId']==gap['entityId']),None)
                if observed and profile:
                    job['candidate']['issues'].append({**gap,'kind':'association_conflict',
                        'evidence':observed,'referenceEvidence':profile['evidence'],
                        'referenceNameCandidate':profile['nameCandidate'],'observedNameCandidate':None,
                        'resolution':'unassigned','reviewMethod':review['method'],'humanVerified':False,
                        'reason':'目标合框、遮挡及编号切换区间不能继续沿用旧AI人物归属；仅释放该有限段，不填新姓名。'})
                else:
                    raise ValueError('Boundary rejection lacks actual observed frame or canonical identity reference')
        job['candidate']['boundaryReview']={'file':'diagnosis/boundary-review.json','humanVerified':False,
            'method':review['method'],'effect':'Conservative exclusions only; no added names or synthetic observations'}
        for rejection in review.get('machineRejections',[]):
            observed=[e for c in source_evidence if c['entityId']==rejection['entityId'] and c['trackId']==rejection['trackId']
                for e in c['evidence'] if rejection['start']<=e['frame']<=rejection['end']]
            profile=next((p for p in job['candidate']['playerProfiles'] if p['entityId']==rejection['entityId']),None)
            if not observed or not profile:raise ValueError('Rejected target ownership lacks actual source evidence')
            for c in job['candidate']['candidates']:
                if (c['entityId']==rejection['entityId'] and c['trackId']==rejection['trackId']
                    and rejection['start']<=c['start']<=c['end']<=rejection['end']):
                    c.update(status='unknown',observedNameCandidate=c.get('nameCandidate'),nameCandidate=None,playerId=None,
                        reason='原框含两个身体；号码读数与框底锚点不属于同一目标，有限段关联未知。')
            job['candidate']['issues'].append({'kind':'association_conflict','entityId':rejection['entityId'],
                'trackId':rejection['trackId'],'start':rejection['start'],'end':rejection['end'],
                'evidence':observed,'referenceEvidence':profile['evidence'],'resolution':'unassigned',
                'humanVerified':False,'reason':rejection.get('reason','检测框号码与脚底目标归属不一致。')})
        job['candidate']['correctedBindings']=[deepcopy(c) for c in job['candidate']['candidates'] if c.get('bindingCorrection') and c['status']=='candidate']
    job['jobId']='interactive-'+args.label
    job['sourceKey']=hashlib.sha256(json.dumps(job['candidate'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    out=root/args.label;out.mkdir(parents=True,exist_ok=True)
    atomic_json(out/'input-session.json',session);atomic_json(out/'input-clip.json',clip)
    atomic_json(out/'job.json',job)
    summary={'components':components,'selectedResultByPlayer':owners,
        'referenceSlotAnalysis':job['candidate']['referenceSlotAnalysis'],
        'players':[{'id':e['id'],'names':sorted({c['nameCandidate']['name'] for c in job['candidate']['candidates']
            if c['entityId']==e['id'] and c['status']=='candidate'})} for e in session['entities'] if e['role']=='player'],
        'humanAccuracyVerified':False,'newModelRequests':0}
    atomic_json(out/'summary.json',summary);print(json.dumps(summary,ensure_ascii=True))


if __name__=='__main__':main()
