"""Recover saved P9 vision requests without decoding video or editing raw runs."""
import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
import shutil
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'engineering/scripts'))
from local_video_library import atomic_json
from player_name_identity import (ALGORITHM, create_qwen_token_plan_provider, _comparison_frame,
    apply_reference_slot_identities, _effective_ranges)
from player_name_evidence import _supported, _anchor_bounds, _confidence, _clear
from player_game_roster import PlayerGameRoster


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def emit(value):
    print(json.dumps(value,ensure_ascii=True),flush=True)


class RecoveryProvider:
    def __init__(self,folder,proxy):
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':proxy,'http':proxy}))
        self.provider=create_qwen_token_plan_provider(opener=opener.open,timeout=90)
        self.folder=folder
        self.calls=[]
    def review(self,images,labels,context=None):
        for attempt in (1,2):
            started=time.monotonic()
            emit({'event':'model_start','images':len(images),'attempt':attempt,'labels':labels})
            try:
                output=self.provider.review(images,labels,context)
                if not isinstance(output,dict) or not isinstance(output.get('readings'),list):
                    raise ValueError('视觉号码读取结构无效。')
                entry={'ok':True,'images':len(images),'labels':labels,'context':context,
                    'attempt':attempt,'output':output,'elapsedSeconds':round(time.monotonic()-started,3)}
            except ValueError as error:
                message=str(error)
                entry={'ok':False,'images':len(images),'labels':labels,'context':context,
                    'attempt':attempt,'message':message,'elapsedSeconds':round(time.monotonic()-started,3)}
                self.calls.append(entry);atomic_json(self.folder/'calls.json',self.calls)
                emit({k:v for k,v in entry.items() if k not in ('output','context','labels')})
                transient=any(tag in message for tag in ('tls_error','connection_','timeout','url_error','HTTP 429','HTTP 5'))
                if attempt==1 and transient:
                    continue
                raise
            self.calls.append(entry);atomic_json(self.folder/'calls.json',self.calls)
            emit({k:v for k,v in entry.items() if k not in ('output','context','labels')})
            return output


def analyze(originals,readings,continuities,evidence,roster):
    season='2025-26';team='DAL'
    qa=[row for row in readings if evidence.get(row.get('evidenceId'),{}).get('quality',{}).get('qaReference')]
    anchors,_,_=_supported(qa,evidence,roster,season,team)
    number=next(iter(anchors)) if len(anchors)==1 else None
    reference_ids={row['evidenceId'] for row in anchors.get(number,[])}
    output=[]
    for original in originals:
        own=[row for row in evidence.values() if row['trackId']==original['trackId'] and original['start']<=row['frame']<=original['end']]
        own_ids={row['evidenceId'] for row in own}
        reads=[row for row in readings if row.get('evidenceId') in own_ids]
        local,votes,_=_supported(reads,evidence,roster,season,team)
        segment={'start':original['start'],'end':original['end'],'trackId':original['trackId'],
            'values':[(row['frame'],[0,0,1,1,row['trackId']]) for row in own]}
        repair=any(row.get('source')=='visual_correction_target' for row in own)
        for part,support in _anchor_bounds(segment,local,votes,evidence):
            value=next(iter(support)) if len(support)==1 else None
            links=[];refs=[];method='direct_jersey'
            rows=[row for row in own if part['start']<=row['frame']<=part['end']]
            if repair and not part.get('identitySwitchGap') and number is not None:
                # Independent source frames, never two labels for one reused image.
                links=[link for link in continuities if link.get('targetEvidenceId') in own_ids and
                    link.get('referenceEvidenceId') in reference_ids and link.get('samePerson') is True and
                    _confidence(link)>=.9 and str(link.get('reason','')).strip() and
                    evidence[link['targetEvidenceId']].get('comparisonReference')==link['referenceEvidenceId'] and
                    (link.get('targetVisible') is True or evidence[link['targetEvidenceId']].get('targetConfirmed') is True)]
                independent=len({evidence[x['targetEvidenceId']]['frame'] for x in links})>=2
                direct_frames={evidence[x['evidenceId']]['frame'] for x in support.get(value,[])
                    if x.get('targetConfirmed') is True}
                if not (value==number and len(direct_frames)>=2):
                    value=number if independent else None
                    method='visual_same_person'
                    refs=[evidence[x] for x in sorted({link['referenceEvidenceId'] for link in links})]
            candidate={**deepcopy(original),'status':'unknown','nameCandidate':None,'playerId':None,
                'start':part['start'],'end':part['end'],'evidence':rows,'jersey':value,
                'reason':'保存原图的目标号码／同人证据不足。','verified':False,'reviewRequired':True,
                'evidenceMethod':method,'method':ALGORITHM}
            candidate.pop('_recoveryOwnerIds',None)
            if value is not None:
                lookup=roster.lookup(season,team,value)
                if lookup['status']=='unique_candidate':
                    person=lookup['candidates'][0]
                    candidate.update(status='candidate',playerId=person['player_id'],nameCandidate={
                        'name':person['name'],'player_id':person['player_id'],'namespace':'normalized_name_key',
                        'season':season,'team':team,'jersey':value,'lookupStatus':lookup['status'],
                        'seasonRoster':person.get('season_roster',[])},
                        reason='保存的真实目标证据与当场唯一名单匹配，仍未经人类确认。')
                    if repair:
                        candidate.update(bindingCorrection=True)
                        owners=original.get('_recoveryOwnerIds',[])
                        if len(owners)==1:
                            candidate['originalEntityId']=owners[0]
                    else:
                        # Ordinary evidence from this recovery supplies anchors;
                        # previous validated finite ranges are preserved separately.
                        supported_frames=[evidence[x['evidenceId']]['frame'] for x in support.get(value,[])]
                        if supported_frames:
                            candidate.update(start=min(supported_frames),end=max(supported_frames))
                    if method=='visual_same_person':
                        candidate.update(referenceEvidence=refs,continuity={
                            'referenceEvidenceIds':[row['evidenceId'] for row in refs],
                            'targetEvidenceIds':[link['targetEvidenceId'] for link in links],
                            'comparisons':links,'reason':'；'.join(link['reason'] for link in links)})
            output.append(candidate)
    return output,reference_ids,number


def run_late(args,source,folder):
    job=load(source/'job.json');session=load(source/'input-session.json');clip=load(source/'input-clip.json')
    manifest_path=ROOT/'artifacts/player-name-optimization-20261007/diagnosis/p9-late-evidence/manifest.json'
    manifest=load(manifest_path)
    if (manifest['sourceVideoSha256']!=job['base']['videoHash'] or
        manifest['trackingFingerprint']!=job['base']['trackingFingerprint']):
        raise ValueError('晚段图像与当前视频／跟踪来源不匹配。')
    reference=next(deepcopy(row) for x in job['candidate']['candidates'] if x['status']=='candidate'
        for row in x['evidence'] if row['frame']==338 and row.get('targetConfirmed') is True
        and row.get('jerseyText') and row.get('quality',{}).get('qaReference'))
    original_ref_id=reference['evidenceId'];reference['evidenceId']='P9-T10-F338'
    reference['readingSourceEvidenceId']=original_ref_id
    anchor=next(deepcopy(x) for x in job['candidate']['candidates'] if x['status']=='candidate' and
        any(row.get('evidenceId')==original_ref_id for row in x['evidence']))
    anchor.update(start=338,end=338,evidence=[reference],evidenceMethod='direct_jersey')
    evidence={reference['evidenceId']:reference};readings=[];links=[]
    provider=RecoveryProvider(folder,args.proxy);started=time.monotonic()
    package={x['evidenceId']:x for x in manifest['images']}
    comparisons=manifest['comparisons']
    for item in comparisons:
        record=package[item['targetEvidenceId']]
        frame,track=record['frame'],record['trackId']
        from initial_identity_review import rows_at
        row=rows_at(clip,frame).get(track)
        if row is None or any(abs(a-b)>.01 for a,b in zip(row[:4],record['originalbox'])):
            raise ValueError('晚段目标图框与实际登记观察不匹配。')
        evidence[record['evidenceId']]={'evidenceId':record['evidenceId'],'frame':frame,'trackId':track,
            'box':list(row[:4]),'time':clip['frames'][frame]['time'],'source':'saved_source_crop',
            'teamText':'','jerseyText':'','comparisonReference':reference['evidenceId'],
            'fullFrameContextAvailable':False}
    for offset in (0,3):
        batch=comparisons[offset:offset+3]
        labels=[x['targetEvidenceId'] for x in batch]
        context={'comparisons':[{'targetEvidenceId':x['targetEvidenceId'],
            'referenceEvidenceId':reference['evidenceId']} for x in batch],
            'limits':manifest['limits']}
        response=provider.review([ROOT/x['modelImage'] for x in batch],labels,context)
        for row in response['readings']:
            if isinstance(row,dict) and row.get('evidenceId') in labels:
                readings.append(row);evidence[row['evidenceId']].update({k:row[k] for k in
                    ('teamText','jerseyText','jerseyNameText','targetConfirmed','visibility','confidence','reason') if k in row})
        links.extend(x for x in response.get('continuities',[]) if isinstance(x,dict))
    roster=PlayerGameRoster(ROOT/'data/player-rosters','0022500701')
    additions=[]
    for segment in _effective_ranges(session,clip):
        if segment['entity']['id']!='P9' or segment['trackId'] not in (66,81,8):
            continue
        own=[row for row in evidence.values() if row['trackId']==segment['trackId'] and
            segment['start']<=row['frame']<=segment['end']]
        ids={row['evidenceId'] for row in own};reads=[x for x in readings if x.get('evidenceId') in ids]
        support,_,_=_supported(reads,evidence,roster,'2025-26','DAL')
        number=next(iter(support)) if len(support)==1 else None
        comparisons_ok=[x for x in links if x.get('targetEvidenceId') in ids and
            x.get('referenceEvidenceId')==reference['evidenceId'] and x.get('samePerson') is True
            and _confidence(x)>=.9 and str(x.get('reason','')).strip() and
            (x.get('targetVisible') is True or evidence[x['targetEvidenceId']].get('targetConfirmed') is True)]
        unique_targets=len({evidence[x['targetEvidenceId']]['frame'] for x in comparisons_ok})
        method='direct_jersey'
        direct_frames={evidence[x['evidenceId']]['frame'] for x in support.get(number,[]) if x.get('targetConfirmed') is True}
        if number!=anchor['jersey'] or len(direct_frames)<2:
            number=anchor['jersey'] if unique_targets>=2 else None;method='visual_same_person'
        if number is None:
            continue
        candidate={**deepcopy(anchor),'trackId':segment['trackId'],'start':segment['start'],'end':segment['end'],
            'evidence':own,'evidenceMethod':method,'reason':'两份保存的真实源目标证据支持该有限观察段；完整原帧上下文未提供。',
            'fullFrameContextAvailable':False,'method':ALGORITHM}
        if method=='visual_same_person':
            candidate.update(referenceEvidence=[reference],continuity={
                'referenceEvidenceIds':[reference['evidenceId']],
                'targetEvidenceIds':[x['targetEvidenceId'] for x in comparisons_ok],
                'comparisons':comparisons_ok,'reason':'；'.join(x['reason'] for x in comparisons_ok)})
        additions.append(candidate)
    output=deepcopy(job);output['jobId']='interactive-'+args.output_label
    positive=[x for x in output['candidate']['candidates'] if x['status']=='candidate']
    unknown=[x for x in output['candidate']['candidates'] if x['status']!='candidate' and not any(
        a['trackId']==x['trackId'] and a['start']<=x['start'] and a['end']>=x['end'] for a in additions)]
    output['candidate']['candidates']=positive+[anchor]+additions+unknown
    output['candidate'].update(algorithm=ALGORITHM,analysisVersion='saved-review-recovery-late-v1',
        componentRuns=[{'label':args.source_label,'role':'recovered_prior_evidence'},
            {'path':str(manifest_path.relative_to(ROOT)).replace('\\','/'),'role':'saved_source_crops_without_full_context'}])
    output['actualHttpAttempts']=len(provider.calls);output['selectedPlayers']=['P9']
    output['candidate']['usage']={'modelRequests':2,'successfulModelRequests':2,'failedModelRequests':0,
        'evidenceImages':6,'actualHttpAttempts':len(provider.calls)}
    atomic_json(folder/'job.json',output)
    summary={'selectedPlayers':['P9'],'actualHttpAttempts':len(provider.calls),'newSourceDecodeCalls':0,
        'elapsedSeconds':round(time.monotonic()-started,3),'newCandidates':[{'trackId':x['trackId'],
            'start':x['start'],'end':x['end'],'method':x['evidenceMethod']} for x in additions],
        'components':[args.source_label,str(manifest_path.relative_to(ROOT)).replace('\\','/')],
        'fullFrameContextAvailable':False,'rawRunsChanged':False,'humanAccuracyVerified':False}
    atomic_json(folder/'summary.json',summary);emit(summary)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-label',default='v4-boundary-repair')
    parser.add_argument('--prior-label',default='v4-proxy-repair')
    parser.add_argument('--output-label',default='v4-p9-recovered')
    parser.add_argument('--proxy',default='http://127.0.0.1:7897')
    parser.add_argument('--late',action='store_true',help='Two bounded calls over saved late comparison crops')
    args=parser.parse_args()
    base=ROOT/'artifacts/player-name-optimization-20261007'
    source=base/args.source_label;folder=base/args.output_label
    if folder.resolve()==source.resolve() or (folder/'job.json').exists():
        raise ValueError('恢复输出必须是未使用的独立目录。')
    folder.mkdir(parents=True,exist_ok=True)
    for name in ('input-session.json','input-clip.json','input-reference-plan.json'):
        shutil.copyfile(source/name,folder/name)
    if args.late:
        run_late(args,source,folder)
        return
    job=load(source/'job.json')
    originals=[deepcopy(x) for x in job['candidate']['candidates'] if x['entityId']=='P9']
    session=load(source/'input-session.json')
    for candidate in originals:
        candidate['_recoveryOwnerIds']=sorted({entity['id'] for entity in session['entities']
            if entity['id']!='P9' and any(binding.get('kind')=='track' and
                binding.get('trackId')==candidate['trackId'] and binding['start']<=candidate['end'] and
                binding['end']>=candidate['start'] and str(binding.get('origin','')).startswith(('ai_','model'))
                for binding in entity.get('bindings',[]))})
    evidence={row['evidenceId']:deepcopy(row) for candidate in originals for row in candidate['evidence']}
    failed=next(call for call in load(source/'calls.json') if len(call.get('labels',[]))==8 and all(x.startswith('P9-') for x in call['labels']))
    labels=failed['labels'];paths={}
    images_folder=folder/'images';images_folder.mkdir(exist_ok=True)
    for label in labels:
        matches=list((source/'request-images').glob('*/[0-9]-'+label+'.jpg'))
        if len(matches)!=1 or label not in evidence:
            raise ValueError('保存请求图或真实证据映射不唯一。')
        destination=images_folder/(label+'.jpg');shutil.copyfile(matches[0],destination);paths[label]=destination
    provider=RecoveryProvider(folder,args.proxy)
    roster=PlayerGameRoster(ROOT/'data/player-rosters','0022500701')
    started=time.monotonic();readings=[];continuities=[]
    initial=provider.review([paths[x] for x in labels],labels)
    def collect(output):
        for row in output['readings']:
            if isinstance(row,dict) and row.get('evidenceId') in evidence:
                readings.append(row)
                evidence[row['evidenceId']].update({k:row[k] for k in ('teamText','jerseyText','targetConfirmed',
                    'visibility','confidence','reason','jerseyNameText') if k in row})
        continuities.extend(row for row in output.get('continuities',[]) if isinstance(row,dict))
    collect(initial)
    recovered,reference_ids,number=analyze(originals,readings,continuities,evidence,roster)
    repairs=[x for x in recovered if any(e.get('source')=='visual_correction_target' for e in x['evidence'])]
    extra_count=0
    if number is not None and any(x['status']!='candidate' for x in repairs):
        targets=sorted([label for label in labels if evidence[label].get('source')=='visual_correction_target'],
            key=lambda label:evidence[label]['quality']['score'],reverse=True)
        refs=sorted(reference_ids,key=lambda label:evidence[label]['frame'])
        comparisons=[];extra_images=[];extra_labels=[]
        # Three existing target poses increase the chance of two independent
        # body matches. Repeated source frames never increase a jersey quorum.
        for index,label in enumerate(targets[:3]):
            ref=refs[index%len(refs)];new_label=label+'-recovery-extra'
            path=images_folder/(new_label+'.jpg');_comparison_frame(paths[ref],paths[label],path)
            evidence[new_label]={**deepcopy(evidence[label]),'evidenceId':new_label,'pass':2,'comparisonReference':ref}
            extra_images.append(path);extra_labels.append(new_label)
            comparisons.append({'targetEvidenceId':new_label,'referenceEvidenceId':ref})
        if extra_images:
            extra_count=len(extra_images)
            collect(provider.review(extra_images,extra_labels,{'comparisons':comparisons}))
            recovered,reference_ids,number=analyze(originals,readings,continuities,evidence,roster)
    prior=load(base/args.prior_label/'job.json')
    if prior['base']!=job['base']:
        raise ValueError('先前成功候选的源视频／跟踪版本不匹配。')
    previous=[deepcopy(x) for x in prior['candidate']['candidates'] if x['entityId']=='P9' and x['status']=='candidate']
    accepted=previous+[x for x in recovered if x['status']=='candidate']
    unknown=[x for x in recovered if x['status']!='candidate' and not any(y['trackId']==x['trackId'] and
        y['start']<=x['start'] and y['end']>=x['end'] for y in accepted)]
    candidate={'status':'ready','algorithm':ALGORITHM,'candidates':accepted+unknown,
        'issues':[],'pendingContext':[],'verified':False,'reviewRequired':True,
        'correctedBindings':[x for x in accepted if x.get('bindingCorrection')],
        'budget':{'initialImages':8,'maxExtraImages':4,'transportRetriesPerLogicalRequest':1},
        'usage':{'modelRequests':1+int(extra_count>0),'successfulModelRequests':1+int(extra_count>0),
            'failedModelRequests':0,'evidenceImages':8+extra_count,'followupRequests':int(extra_count>0),
            'actualHttpAttempts':len(provider.calls)}}
    output={**deepcopy(job),'jobId':'interactive-'+args.output_label,'candidate':candidate,
        'actualHttpAttempts':len(provider.calls),'selectedPlayers':['P9']}
    output=apply_reference_slot_identities(output)
    output['candidate'].update(analysisVersion='saved-review-recovery-v1',rawAlgorithm=job['candidate']['algorithm'],
        analysisStages=['saved-review-recovery-v1','reference-slot-identities-v1'],
        componentRuns=[{'label':args.source_label,'role':'saved_failed_request_images'},
            {'label':args.prior_label,'role':'previous_successful_P9_finite_candidates'}])
    atomic_json(folder/'job.json',output)
    summary={'selectedPlayers':['P9'],'actualHttpAttempts':len(provider.calls),'newSourceDecodeCalls':0,
        'elapsedSeconds':round(time.monotonic()-started,3),'usage':candidate['usage'],
        'segments':dict(Counter(x['status'] for x in output['candidate']['candidates'])),
        'names':sorted({x['nameCandidate']['name'] for x in accepted}),
        'repairCandidates':[{'trackId':x['trackId'],'start':x['start'],'end':x['end'],'method':x['evidenceMethod']}
            for x in accepted if x.get('bindingCorrection')],
        'components':[args.prior_label,args.source_label],'rawRunsChanged':False,'humanAccuracyVerified':False}
    atomic_json(folder/'summary.json',summary);emit(summary)


if __name__=='__main__':
    main()
