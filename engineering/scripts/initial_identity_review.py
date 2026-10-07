"""Bounded full-clip identity proposals over supplied detector observations.

No detector output or human review is changed here. The browser applies only
validated machine suggestions after checking its original input snapshot.
"""
from collections import Counter
from copy import deepcopy
import hashlib
import json
import math


ALGO_VERSION = 'initial-identity-review-v1'
ROLES = ('player', 'referee', 'other', 'uncertain')
SLOT_LIST_FIELDS = ('modelBindings','anchors','courtAnchors','bindings','identityKeyframes','frameConfirmations',
                    'visibilityRanges','dismissedModelBindings')


def slot_basis(session):
    return {e['id']:{**{k:deepcopy(e.get(k,[])) for k in SLOT_LIST_FIELDS},
                      **{k:e.get(k,'') for k in ('name','team','jersey')},
                      'identityReference':deepcopy(e.get('identityReference')),
                      'identitySuggestionsDismissed':e.get('identitySuggestionsDismissed',False)}
            for e in session['entities'] if e['role']=='player'}


def _object(properties):
    return {'type':'object', 'additionalProperties':False, 'required':list(properties), 'properties':properties}


TEXT = {'type':'string', 'maxLength':1000}
ID = {'type':'string', 'minLength':1, 'maxLength':80}
CONFIDENCE = {'type':'number', 'minimum':0, 'maximum':1}
SCHEMA = _object({
    'summary':TEXT,
    'subjects':{'type':'array', 'maxItems':40, 'items':_object({
        'subjectId':ID, 'entityId':{'type':['string','null'], 'enum':[None,*[f'P{i}' for i in range(1,11)]]},
        'role':{'type':'string','enum':list(ROLES)}, 'team':{'type':'string','maxLength':40},
        'jersey':{'type':'string','pattern':'^[0-9]{0,3}$'}, 'confidence':CONFIDENCE, 'reason':TEXT})},
    'assignments':{'type':'array', 'maxItems':160, 'items':_object({
        'windowId':ID, 'subjectId':ID, 'confidence':CONFIDENCE, 'reason':TEXT})},
    'issues':{'type':'array', 'maxItems':40, 'items':_object({
        'kind':{'type':'string','enum':['identity_uncertain','team_uncertain','role_uncertain','missing_player']},
        'windowIds':{'type':'array','maxItems':20,'items':ID}, 'reason':TEXT})},
})


def source_key(clip, variant, qa):
    source = {'algoVersion':ALGO_VERSION, 'videoHash':clip['video_sha256'],
              'trackingFingerprint':clip['tracking_fingerprint'], 'trackingRevision':clip['tracking_revision'],
              'variant':variant, 'qa':qa, 'width':clip['width'], 'height':clip['height'],
              'roleEvidenceSource':clip.get('roleEvidenceSource'),
              'roleRisks':[[f['frame'],f.get('role_conflicts',[]),
                            [[str(t),{k:e.get(k) for k in ('color_conflict','identity_review_required','role_evidence')}]
                             for t,e in sorted(f.get('track_evidence',{}).items(),key=lambda item:str(item[0]))
                             if any(k in e for k in ('color_conflict','identity_review_required','role_evidence'))]]
                           for f in clip['frames'] if f.get('role_conflicts') or f.get('track_evidence')],
              'sourceCuts':clip.get('sourceCuts', []),
              'mapping':[[f.get(k) for k in ('frame','time','source_frame','source_time','source_frame_pts','source_time_base')]
                         for f in clip['frames']]}
    return hashlib.sha256(json.dumps(source, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def rows_at(clip, frame):
    rows = clip['frames'][frame].get('tracks', [])
    counts = Counter(r[4] for r in rows if isinstance(r, (list,tuple)) and len(r)>=5 and type(r[4]) is int)
    return {r[4]:r for r in rows if isinstance(r,(list,tuple)) and len(r)>=5 and type(r[4]) is int and r[4]>0
            and counts[r[4]]==1 and all(type(v) in (int,float) and math.isfinite(v) for v in r[:4])
            and 0<=r[0]<r[2]<=clip['width'] and 0<=r[1]<r[3]<=clip['height']}


def _risk(clip, frame, track):
    record = clip['frames'][frame]
    value = record.get('track_evidence', {}).get(str(track), record.get('track_evidence', {}).get(track, {}))
    return value.get('color_conflict') is True or value.get('identity_review_required') is True


def _jump(a,b):
    scale = max(a[2]-a[0],a[3]-a[1],b[2]-b[0],b[3]-b[1],1)
    return math.hypot((a[0]+a[2]-b[0]-b[2])/2,(a[1]+a[3]-b[1]-b[3])/2)>scale


def evidence_plan(clip, session, max_frames=8):
    frames=clip['frames'];last=len(frames)-1
    cuts=sorted(set(clip.get('sourceCuts', [])+session.get('cuts',[])))
    required={0,last,*[v for c in cuts for v in (c-1,c) if 0<=v<=last]}
    if len(required)>max_frames:
        raise ValueError('整片切镜超过本轮证据预算；已保留原稿，可按片段手工核对。')
    duration=frames[last]['time']-frames[0]['time']
    count=min(max_frames,last+1,max(len(required),3,math.ceil(duration/4)+1))
    # Allocate equal-time subdivisions, rather than repeatedly bisecting a gap:
    # six extra points over 24 seconds must not leave an accidental 6-second tail.
    borders=sorted(required)
    allocations=[0 for _ in range(max(0,len(borders)-1))]
    for _ in range(count-len(required)):
        candidates=[i for i,(a,b) in enumerate(zip(borders,borders[1:])) if b-a-1>allocations[i]]
        if not candidates:
            break
        chosen=max(candidates,key=lambda i:(frames[borders[i+1]]['time']-frames[borders[i]]['time'])/(allocations[i]+1))
        allocations[chosen]+=1
    selected=set(required)
    for i,(a,b) in enumerate(zip(borders,borders[1:])):
        for n in range(1,allocations[i]+1):
            target=frames[a]['time']+(frames[b]['time']-frames[a]['time'])*n/(allocations[i]+1)
            selected.add(min((f for f in range(a+1,b) if f not in selected),key=lambda f:abs(frames[f]['time']-target)))
    indices=sorted(selected);observed=[rows_at(clip,i) for i in range(last+1)]
    if any(len(observed[f])>25 for f in indices):
        raise ValueError('抽样画面超过 25 个可见人物，不能遗漏人员后声称完成初检；请手工缩小比赛片段。')
    windows=[];covered=set()
    def add(track,start,end,evidence):
        if len(windows)>=160:
            raise ValueError('本片候选片段超过初检预算，保留原稿供手工核对。')
        hints=[e['id'] for e in session['entities'] if e['role']=='player' and any(
            b.get('trackId')==track and b['start']<=start<=b['end'] and b['start']<=end<=b['end']
            for b in e.get('modelBindings',[]))]
        windows.append({'id':f'window-{len(windows)+1}', 'trackId':track,'start':start,'end':end,
                        'evidenceFrames':evidence,'existingEntityId':hints[0] if len(hints)==1 else None})
        covered.update((f,track) for f in evidence)
    for left,right in zip(indices,indices[1:]):
        if frames[right]['time']-frames[left]['time']>4.1 or any(left<c<=right for c in cuts):
            continue
        for track in sorted(observed[left].keys() & observed[right].keys()):
            if all(track in observed[f] and not _risk(clip,f,track) and
                   (f==left or not _jump(observed[f-1][track],observed[f][track])) for f in range(left,right+1)):
                add(track,left,right,[left,right])
    for frame in indices:
        for track in sorted(observed[frame]):
            if (frame,track) not in covered:
                add(track,frame,frame,[frame])
    all_tracks={t for values in observed for t in values}
    shown_tracks={t for f in indices for t in observed[f]}
    role_evidence=[{'frame':f,'trackId':track,'classId':row[6] if len(row)>6 else None,
                    'evidence':frames[f].get('track_evidence',{}).get(str(track),frames[f].get('track_evidence',{}).get(track,{}))}
                   for f in indices for track,row in observed[f].items()]
    return {'imageFrames':indices,'windows':windows,'unseenTracks':sorted(all_tracks-shown_tracks),
            'observedRoleEvidence':role_evidence,
            'sampledFrames':len(indices),'frameCount':last+1,'range':{'start':0,'end':last},
            'maxSampleIntervalSeconds':max((frames[b]['time']-frames[a]['time'] for a,b in zip(indices,indices[1:])),default=0)}


def _text(value, max_length=1000, nonempty=False):
    return isinstance(value,str) and len(value)<=max_length and (not nonempty or bool(value.strip())) and not any(ord(c)<32 for c in value)


def _confidence(value):
    return type(value) in (int,float) and math.isfinite(value) and 0<=value<=1


def validate_candidate(output, plan):
    import re
    if not isinstance(output,dict) or set(output)!={'summary','subjects','assignments','issues'} or not _text(output['summary']):
        raise ValueError('整片初检输出结构无效。')
    subjects=output['subjects'];assignments=output['assignments'];model_issues=output['issues']
    if not isinstance(subjects,list) or len(subjects)>40 or not isinstance(assignments,list) or len(assignments)>160 or not isinstance(model_issues,list) or len(model_issues)>40:
        raise ValueError('整片初检输出数量超出范围。')
    people={};windows={w['id']:w for w in plan['windows']};used=set();segments=[];issues=[]
    def issue(kind,reason,window=None,entity=None,track=None):
        window=window or {'start':0,'end':plan['range']['end'],'evidenceFrames':[]}
        issues.append({'id':f'issue-{len(issues)+1}','kind':kind,'entityId':entity,
                       'trackId':track if track is not None else window.get('trackId'),
                       'start':window['start'],'end':window['end'],'reason':reason,'evidenceFrames':window['evidenceFrames']})
    for p in subjects:
        if not isinstance(p,dict) or set(p)!={'subjectId','entityId','role','team','jersey','confidence','reason'} or not _text(p['subjectId'],80,True) or p['subjectId'] in people or p['entityId'] not in [None,*[f'P{i}' for i in range(1,11)]] or p['role'] not in ROLES or not _text(p['team'],40) or not isinstance(p['jersey'],str) or not re.fullmatch(r'[0-9]{0,3}',p['jersey']) or not _confidence(p['confidence']) or not _text(p['reason'],1000,True):
            raise ValueError('初检人物、角色、号码或说明无效。')
        people[p['subjectId']]={**p,'evidenceFrames':[]}
    for a in assignments:
        if not isinstance(a,dict) or set(a)!={'windowId','subjectId','confidence','reason'} or a['windowId'] not in windows or a['windowId'] in used or a['subjectId'] not in people or not _confidence(a['confidence']) or not _text(a['reason'],1000,True):
            raise ValueError('初检引用了未提供、重复或无说明的观察片段。')
        used.add(a['windowId']);w=windows[a['windowId']];p=people[a['subjectId']]
        p['evidenceFrames']=sorted(set(p['evidenceFrames'])|set(w['evidenceFrames']))
        value={'id':a['windowId'],'subjectId':p['subjectId'],'entityId':p['entityId'],'trackId':w['trackId'],
               'start':w['start'],'end':w['end'],'role':p['role'],'confidence':min(a['confidence'],p['confidence']),
               'reason':a['reason'],'evidenceFrames':w['evidenceFrames']}
        segments.append(value)
        if p['role'] in ('referee','other'):
            issue('role_mismatch',a['reason'],w,w['existingEntityId'])
        elif p['role']=='uncertain' or p['entityId'] is None:
            issue('identity_uncertain',a['reason'],w,p['entityId'])
        elif not p['team']:
            issue('team_uncertain','球员位置候选保留；球衣分队证据不足，未改人工球队。',w,p['entityId'])
    for ident,w in windows.items():
        if ident not in used:
            issue('unresolved','模型未明确核对这段观察，保留原机器关联并等待人工查看。',w,w['existingEntityId'])
    for track in plan['unseenTracks']:
        issue('unsampled','此临时人物只在未抽样画面出现，未推断其角色或身份。',track=track)
    for i in model_issues:
        if not isinstance(i,dict) or set(i)!={'kind','windowIds','reason'} or i['kind'] not in ('identity_uncertain','team_uncertain','role_uncertain','missing_player') or not _text(i['reason'],1000,True) or not isinstance(i['windowIds'],list) or len(i['windowIds'])>20 or any(w not in windows for w in i['windowIds']):
            raise ValueError('初检异常引用不正确。')
        for ident in i['windowIds'] or [None]:
            issue(i['kind'],i['reason'],windows.get(ident))
    return {'schemaVersion':1,'summary':output['summary'],'subjects':list(people.values()),'segments':segments,'issues':issues,
            'coverage':{'sampledFrames':plan['sampledFrames'],'frameCount':plan['frameCount'],
                        'providedWindows':len(windows),'classifiedWindows':len(used),'unseenTracks':plan['unseenTracks'],
                        'imageFrames':plan['imageFrames'],'maxSampleIntervalSeconds':plan['maxSampleIntervalSeconds']},
            'reviewRequired':True,'identityVerified':False}
