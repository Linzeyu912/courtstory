"""Part 1 identity review using Part 3's source decoder, image tools and provider.

The model proposes local people and bounded detector associations. Only the host
can join a visibly read jersey to an explicit roster; names never come from the model.
"""
from copy import deepcopy
from fractions import Fraction
import base64
import hashlib
import json
import math
from pathlib import Path
import re
import shutil

from commentary_agent import ROOT, provider_environment, redact, run_worker
from commentary_plan import digest, model_config
from commentary_video import CommentaryVideo
from initial_identity_review import source_key, slot_basis, rows_at, _risk, _jump, _text, _confidence
from local_video_library import atomic_json

ALGO_VERSION = 'video-identity-review-v2'
WORKER = ROOT/'engineering/tools/player-review/agents/identity-worker.mjs'
PROFILE_LISTS = ('machineNameIdentities','machineIdentityBindings','machineNameIdentityConflicts')
PROFILE_VALUES = ('nameIdentity','playerProfile','machinePlayerProfile')


def identity_context(value):
    if value is None:
        return {}
    if not isinstance(value,dict) or set(value)-{'season','teamMap','gameId'}:
        raise ValueError('身份上下文只能包含 season、teamMap 和 gameId。')
    result={}
    season=value.get('season')
    if season is not None:
        if not isinstance(season,str) or not re.fullmatch(r'20\d\d-\d\d',season):
            raise ValueError('身份赛季格式无效。')
        result['season']=season
    teams=value.get('teamMap')
    if teams is not None:
        if not isinstance(teams,dict) or set(teams)-{'A','B'} or any(not isinstance(v,str) or not re.fullmatch(r'[A-Z]{3}',v) for v in teams.values()):
            raise ValueError('球队映射需使用 A/B 和三字母 NBA 缩写。')
        if len(set(teams.values()))!=len(teams):
            raise ValueError('两队不能映射为同一球队。')
        result['teamMap']=deepcopy(teams)
    if value.get('gameId') is not None:
        if not isinstance(value['gameId'],str) or not re.fullmatch(r'\d{10}',value['gameId']):
            raise ValueError('比赛编号必须为十位 NBA game ID。')
        result['gameId']=value['gameId']
    return result


def video_source_key(clip,variant,qa,context,config):
    return digest({'source':source_key(clip,variant,qa),'algoVersion':ALGO_VERSION,
                   'identityContext':identity_context(context),'model':config})


def video_slot_basis(session):
    basis=slot_basis(session)
    for entity in session['entities']:
        if entity['id'] in basis:
            basis[entity['id']].update({key:deepcopy(entity.get(key,[])) for key in PROFILE_LISTS})
            basis[entity['id']].update({key:deepcopy(entity.get(key)) for key in PROFILE_VALUES})
    return basis


def _fraction(value):
    return Fraction(*value) if isinstance(value,(list,tuple)) and len(value)==2 else Fraction(value)


def validate_source_mapping(clip,context):
    if clip.get('video_sha256')!=context.get('videoRef') or (clip.get('width'),clip.get('height'))!=(context.get('width'),context.get('height')):
        raise ValueError('身份视频来源哈希或尺寸不符。')
    frames=context.get('frames',[])
    if len(frames)!=len(clip['frames']):
        raise ValueError('视频解码与检测帧数量不一致。')
    mapping=[]
    for index,(record,decoded) in enumerate(zip(clip['frames'],frames)):
        if record.get('frame')!=index or decoded.get('frame')!=index or abs(record['time']-decoded['sourceTime'])>1e-7:
            raise ValueError('检测 assetFrame/time 与实际解码 PTS 不一致。')
        if record.get('source_frame_pts') is not None and (record['source_frame_pts']!=decoded['pts'] or
                _fraction(record.get('source_time_base'))!=_fraction(decoded['timeBase'])):
            raise ValueError('检测 PTS/timeBase 与实际视频不一致。')
        parent_frame=record.get('source_frame',index);parent_time=record.get('source_time',record['time'])
        if type(parent_frame) is not int or parent_frame<0 or type(parent_time) not in (int,float) or not math.isfinite(parent_time):
            raise ValueError('登记的原片映射不完整。')
        mapping.append({'frame':index,'assetFrame':index,'time':decoded['time'],
            'assetTime':decoded['sourceTime'],'sourceFrame':parent_frame,'sourceTime':parent_time,
            'pts':decoded['pts'],'timeBase':decoded['timeBase'],'videoSha256':context['videoRef'],
            'sourceVideoSha256':clip.get('source_video_sha256',context['videoRef'])})
    return mapping


class ImageLedger:
    """Only actual returned images grant evidence; metadata never grants it alone."""
    def __init__(self,context):
        self.context=context
        self.frames={}
        self.assets=[]
        self.detail_frames=set()
        self.views={}

    def record(self,result):
        images=[c for c in result.get('content',[]) if c.get('type')=='image']
        details=result.get('details',{})
        assets=details.get('assets',[])
        if not images or len(images)!=len(assets):
            raise ValueError('视频证据必须包含实际图像与对应资产。')
        pending={};detail=set()
        returned={f['frame'] if isinstance(f,dict) else f for f in details.get('returnedFrames',details.get('frames',[]))}
        for image,asset in zip(images,assets):
            data=base64.b64decode(image.get('data',''),validate=True)
            if image.get('mimeType') not in ('image/jpeg','image/png','image/webp') or not data or hashlib.sha256(data).hexdigest()!=asset.get('sha256'):
                raise ValueError('证据资产 SHA 与返回图像不同。')
            for meta in asset.get('tiles',[asset]):
                index=meta.get('frame')
                if type(index) is not int or index not in returned or not 0<=index<len(self.context['frames']):
                    raise ValueError('图像帧不属于实际返回范围。')
                actual=self.context['frames'][index]
                if any(meta.get(k)!=actual.get(k) for k in ('pts','timeBase','time','sourceTime')):
                    raise ValueError('图像资产的 PTS/sourceTime 映射不真实。')
                pending[index]={'assetId':asset['assetId'],'sha256':asset['sha256'],
                    'kind':asset['kind'],'path':asset.get('path'),'crop':meta.get('crop'),
                    'trackId':asset.get('trackId')}
                if asset['kind']!='sheet':detail.add(index)
        if returned!=set(pending):
            raise ValueError('返回帧声明超出图像中的真实帧。')
        for index,view in pending.items():self.views.setdefault(index,[]).append(view)
        self.frames.update(pending);self.detail_frames.update(detail);self.assets.extend(deepcopy(assets))
        return result

    def target_view(self,frame,track,row,detail=False):
        for view in reversed(self.views.get(frame,[])):
            if detail and view['kind']=='sheet':continue
            if view['kind']!='region':return view
            box=view.get('crop')
            # inspect_region echoes a requested trackId even with an arbitrary
            # explicit box. Only the actual crop geometry grants target evidence.
            if box and box[0]<=row[0] and box[1]<=row[1] and box[2]>=row[2] and box[3]>=row[3]:
                return view
        raise ValueError('此裁图没有显示目标人物，不能作为身份或号码证据。')


def validate_video_identity(plan,clip,session,mapping,ledger):
    if not isinstance(plan,dict) or set(plan)!={'summary','subjects','segments','issues'} or not _text(plan['summary'],1800,True):
        raise ValueError('身份方案结构或摘要无效。')
    if any(not isinstance(plan[k],list) or len(plan[k])>limit for k,limit in [('subjects',40),('segments',300),('issues',80)]):
        raise ValueError('身份方案数量超出预算。')
    subjects={};segments=[];issues=[];ids=set()
    slots={e['id'] for e in session['entities'] if e['role']=='player'}
    for raw in plan['subjects']:
        if not isinstance(raw,dict) or set(raw)!={'subjectId','entityId','role','team','teamSide','jersey','confidence','reason'}:
            raise ValueError('人物只能包含身份候选字段，不允许模型生成人名。')
        p=deepcopy(raw)
        if (not _text(p['subjectId'],80,True) or p['subjectId'] in subjects or p['role'] not in ('player','referee','other','uncertain') or
            p['entityId'] is not None and p['entityId'] not in slots or p['teamSide'] not in ('A','B','unknown') or
            not _text(p['team'],40) or not isinstance(p['jersey'],str) or not re.fullmatch(r'\d{0,3}',p['jersey']) or
            not _confidence(p['confidence']) or not _text(p['reason'],1000,True)):
            raise ValueError('人物、槽位、球队、号码或理由无效。')
        if p['entityId'] and (not re.fullmatch(r'P(?:[1-9]|10)',p['entityId']) or p['role']!='player' or
                p['teamSide'] not in ('unknown','A' if int(p['entityId'][1:])<=5 else 'B')):
            raise ValueError('球员槽位与球队侧或角色不符。')
        p['evidenceFrames']=[];subjects[p['subjectId']]=p
    cuts=set(clip.get('sourceCuts',[]))|set(session.get('cuts',[]))
    def issue(kind,reason,s=None):
        s=s or {};issues.append({'id':f'issue-{len(issues)+1}','kind':kind,'reason':reason,
            'entityId':s.get('entityId'),'trackId':s.get('trackId'),'start':s.get('start',0),
            'end':s.get('end',len(mapping)-1),'evidenceFrames':deepcopy(s.get('evidenceFrames',[]))})
    for raw in plan['segments']:
        fields={'id','subjectId','trackId','startFrame','endFrame','evidenceFrames','jerseyEvidenceFrames','confidence','reason'}
        if not isinstance(raw,dict) or set(raw)!=fields or not _text(raw['id'],80,True) or raw['id'] in ids or raw['subjectId'] not in subjects:
            raise ValueError('身份区间字段无效或重复。')
        ids.add(raw['id']);p=subjects[raw['subjectId']]
        start,end,track=raw['startFrame'],raw['endFrame'],raw['trackId']
        evidence=raw['evidenceFrames'];jersey=raw['jerseyEvidenceFrames']
        if (any(type(v) is not int for v in (start,end,track)) or not 0<=start<=end<len(mapping) or track<1 or
            not _confidence(raw['confidence']) or not _text(raw['reason'],1000,True) or
            not isinstance(evidence,list) or not 1<=len(evidence)<=128 or any(type(f) is not int for f in evidence) or len(set(evidence))!=len(evidence) or
            start not in evidence or end not in evidence or any(f not in ledger.frames or not start<=f<=end for f in evidence) or
            not isinstance(jersey,list) or any(type(f) is not int or f not in evidence or f not in ledger.detail_frames for f in jersey)):
            raise ValueError('身份边界、号码或依据引用了未实际读取的图像。')
        if any(start<c<=end for c in cuts):raise ValueError('身份区间不能跨切镜。')
        previous=None
        for f in range(start,end+1):
            record=clip['frames'][f];row=rows_at(clip,f).get(track)
            if row is None or record.get('missing') or _risk(clip,f,track):
                raise ValueError('身份区间不能跨缺测、重复框或角色风险。')
            if previous is not None and (not 0<record['time']-clip['frames'][f-1]['time']<=2.5 or _jump(previous,row)):
                raise ValueError('身份区间不能跨时间缺口或检测跳变。')
            previous=row
        # A small set of end images cannot license an unbounded full-track claim.
        ordered=sorted(evidence)
        if any(mapping[b]['time']-mapping[a]['time']>2.5 for a,b in zip(ordered,ordered[1:])):
            raise ValueError('身份区间证据相距过远，请补读中间视频窗口。')
        entries=[]
        for f in evidence:
            asset=ledger.target_view(f,track,rows_at(clip,f)[track],detail=f in jersey)
            entries.append({**mapping[f],'trackId':track,'box':list(rows_at(clip,f)[track][:4]),
                'evidenceId':f'{asset["sha256"]}:{f}:T{track}','imageSha256':asset['sha256'],
                'assetId':asset['assetId'],'targetConfirmed':True})
        s={'id':raw['id'],'subjectId':raw['subjectId'],'entityId':p['entityId'],'role':p['role'],
           'trackId':track,'start':start,'end':end,'confidence':min(raw['confidence'],p['confidence']),
           'reason':raw['reason'],'evidenceFrames':evidence,'jerseyEvidenceFrames':jersey,'evidence':entries}
        segments.append(s);p['evidenceFrames']=sorted(set(p['evidenceFrames'])|set(evidence))
        if p['entityId'] is None or p['role']=='uncertain':issue('identity_uncertain','身份仅为局部候选，需人工核对。',s)
    conflicts=set()
    for i,a in enumerate(segments):
        for b in segments[i+1:]:
            if max(a['start'],b['start'])<=min(a['end'],b['end']) and (
                a['trackId']==b['trackId'] and (a['subjectId'],a['entityId'])!=(b['subjectId'],b['entityId']) or
                a['entityId'] is not None and a['entityId']==b['entityId'] and a['trackId']!=b['trackId']):
                conflicts.update((a['id'],b['id']))
    for s in segments:
        if s['id'] in conflicts:issue('identity_conflict','同一时间人物/槽位/检测框互相冲突，未采用该区间。',s)
    segments=[s for s in segments if s['id'] not in conflicts]
    for raw in plan['issues']:
        if not isinstance(raw,dict) or set(raw)!={'kind','reason'} or raw['kind'] not in ('identity_uncertain','team_uncertain','role_uncertain','missing_player') or not _text(raw['reason'],1000,True):
            raise ValueError('身份问题说明无效。')
        issue(raw['kind'],raw['reason'])
    all_tracks={t for f in range(len(mapping)) for t in rows_at(clip,f)}
    covered={s['trackId'] for s in segments}
    for track in sorted(all_tracks-covered):issue('unsampled','此检测轨迹没有通过图像校验的身份候选。',{'trackId':track})
    image_frames=sorted(ledger.frames)
    return {'schemaVersion':1,'summary':plan['summary'],'subjects':list(subjects.values()),'segments':segments,
        'issues':issues,'slotBasis':video_slot_basis(session),'reviewRequired':True,'identityVerified':False,
        'coverage':{'sampledFrames':len(image_frames),'frameCount':len(mapping),'imageFrames':image_frames,
            'providedWindows':len(plan['segments']),'classifiedWindows':len(segments),'unseenTracks':sorted(all_tracks-covered),
            'maxSampleIntervalSeconds':max((mapping[b]['time']-mapping[a]['time'] for a,b in zip(image_frames,image_frames[1:])),default=0)},
        'evidence':{'videoSha256':clip['video_sha256'],'assets':deepcopy(ledger.assets)}}


def validate_video_identity_partial(plan,clip,session,mapping,ledger):
    """Keep independently valid ranges, then apply the original global guards.

    The strict validator is unchanged: no invalid range grants bindings or image
    evidence. A malformed shared subject/issue envelope still rejects the save.
    """
    if not isinstance(plan,dict) or not isinstance(plan.get('segments'),list):
        return validate_video_identity(plan,clip,session,mapping,ledger)
    if len(plan['segments'])>300:
        raise ValueError('身份方案数量超出预算。')
    validate_video_identity({**plan,'segments':[]},clip,session,mapping,ledger)
    raw_segments=plan['segments'];valid=[];rejected=[]
    ids=[s.get('id') for s in raw_segments if isinstance(s,dict) and isinstance(s.get('id'),str)]
    duplicate_ids={ident for ident in ids if ids.count(ident)>1}
    subjects={p['subjectId']:p for p in plan['subjects']}
    def reject(raw,index,reason):
        raw=raw if isinstance(raw,dict) else {}
        ident=raw.get('id') if _text(raw.get('id'),80,True) else f'segment-{index+1}'
        track=raw.get('trackId') if type(raw.get('trackId')) is int else None
        start=raw.get('startFrame');end=raw.get('endFrame')
        subject=subjects.get(raw.get('subjectId')) if isinstance(raw.get('subjectId'),str) else None
        rejected.append({'segmentId':ident,'entityId':(subject or {}).get('entityId'),
            'trackId':track,'start':start if type(start) is int and 0<=start<len(mapping) else 0,
            'end':end if type(end) is int and 0<=end<len(mapping) else len(mapping)-1,
            'evidenceFrames':[], 'reason':f'区间 {ident} / T{track} / {start}–{end} 未采用：{reason}'})
    for index,raw in enumerate(raw_segments):
        try:
            if isinstance(raw,dict) and isinstance(raw.get('id'),str) and raw['id'] in duplicate_ids:
                raise ValueError('区间 id 重复，不能任意选择其中一条。')
            validate_video_identity({**plan,'segments':[raw]},clip,session,mapping,ledger)
            valid.append(raw)
        except ValueError as error:
            reject(raw,index,str(error))
    candidate=validate_video_identity({**plan,'segments':valid},clip,session,mapping,ledger)
    accepted={s['id'] for s in candidate['segments']}
    for index,raw in enumerate(valid):
        if raw['id'] not in accepted:
            reject(raw,index,'与其他区间的人物、槽位或检测框发生重叠冲突。')
    if not candidate['segments']:
        reason='；'.join(item['reason'] for item in rejected[:8])
        raise ValueError('没有通过校验的身份区间，未保存候选。'+reason)
    for item in rejected:
        candidate['issues'].append({'id':f'issue-{len(candidate["issues"])+1}',
                                   'kind':'identity_uncertain',**item})
    candidate['coverage']['providedWindows']=len(raw_segments)
    candidate['rejectedSegments']=rejected
    if rejected:candidate['completionStatus']='partial'
    return candidate


def build_name_result(candidate,context,roster,*,job_id,source_key,base):
    context=identity_context(context);people={p['subjectId']:p for p in candidate['subjects']};rows=[];issues=[]
    for segment in candidate['segments']:
        p=people[segment['subjectId']]
        if p['role']!='player' or not p['entityId']:continue
        team=context.get('teamMap',{}).get(p['teamSide']);season=context.get('season');jersey=p['jersey']
        item={'entityId':p['entityId'],'trackId':segment['trackId'],'start':segment['start'],'end':segment['end'],
            'status':'unknown','nameCandidate':None,'playerId':None,'season':season,'team':team,'jersey':jersey,
            'evidence':deepcopy(segment['evidence']),'evidenceMethod':'direct_jersey','method':ALGO_VERSION,
            'reason':'尚无足够清晰号码与明确球队/赛季名单。','verified':False,'reviewRequired':True}
        from player_name_identity import _team_code
        visible_team=_team_code(p['team'])
        if team and visible_team and team!=visible_team:
            item['reason']='可见球队文字与指定球队映射冲突。'
        elif season and team and jersey!='' and segment['jerseyEvidenceFrames'] and segment['confidence']>=.75 and roster is not None:
            found=roster.lookup(season,team,jersey)
            if found.get('status')=='unique_candidate' and len(found.get('candidates',[]))==1:
                person=found['candidates'][0]
                item.update(status='candidate',playerId=person['player_id'],nameCandidate={
                    'name':person['name'],'player_id':person['player_id'],'namespace':'normalized_name_key',
                    'season':season,'team':team,'jersey':jersey,'lookupStatus':'unique_candidate',
                    'seasonRoster':deepcopy(person.get('season_roster',[]))},reason='实际号码证据与明确名单唯一匹配；仍为机器候选。')
            else:item['reason']='号码在指定名单没有唯一候选，保留未知。'
        rows.append(item)
    conflicted=set()
    for i,a in enumerate(rows):
        for j,b in enumerate(rows[i+1:],i+1):
            if a['playerId'] and a['playerId']==b['playerId'] and a['entityId']!=b['entityId'] and max(a['start'],b['start'])<=min(a['end'],b['end']):
                conflicted.update((i,j))
    for i in sorted(conflicted):
        row=rows[i];issues.append({**{k:row[k] for k in ('entityId','trackId','start','end','evidence')},
            'kind':'identity_conflict','reason':'同一名单球员在重叠时段对应多个槽位，姓名保持未知。'})
        row.update(status='unknown',playerId=None,nameCandidate=None,reason=issues[-1]['reason'])
    return {'purpose':'player_names','status':'ready','jobId':job_id,'sourceKey':source_key,'base':deepcopy(base),
        'candidate':{'verified':False,'reviewRequired':True,'candidates':rows,'issues':issues,'playerProfiles':[],
                     'method':ALGO_VERSION,'identityContext':context}}


def load_checkpoint(directory,context,clip):
    candidate=json.loads((Path(directory)/'checkpoint.json').read_text(encoding='utf-8'))
    if candidate.get('evidence',{}).get('videoSha256')!=clip['video_sha256']:
        raise ValueError('检查点视频来源不符。')
    ledger=ImageLedger(context)
    for asset in candidate['evidence'].get('assets',[]):
        data=Path(asset['path']).read_bytes()
        frames=asset.get('tiles',[asset])
        ledger.record({'content':[{'type':'image','mimeType':'image/jpeg','data':base64.b64encode(data).decode()}],
            'details':{'assets':[asset],'frames':frames,'returnedFrames':[f['frame'] for f in frames]}})
    return {'candidate':candidate,'ledger':ledger}


def merge_checkpoint_plan(previous,plan):
    if not isinstance(plan,dict):raise ValueError('恢复方案必须为对象。')
    subjects={p['subjectId']:{k:deepcopy(v) for k,v in p.items() if k!='evidenceFrames'} for p in previous['subjects']}
    for p in plan.get('subjects',[]):
        if p.get('subjectId') in subjects:
            old=subjects[p['subjectId']]
            if {k:v for k,v in old.items() if k not in ('reason','confidence')}!={k:v for k,v in p.items() if k not in ('reason','confidence')}:
                raise ValueError('已保存人物不能在续接时改名换槽；新增人物请使用新的 subjectId。')
            continue
        subjects[p['subjectId']]=deepcopy(p)
    segments={s['id']:{'id':s['id'],'subjectId':s['subjectId'],'trackId':s['trackId'],
        'startFrame':s['start'],'endFrame':s['end'],'evidenceFrames':s['evidenceFrames'],
        'jerseyEvidenceFrames':s.get('jerseyEvidenceFrames',[]),'confidence':s['confidence'],'reason':s['reason']}
        for s in previous['segments']}
    for s in plan.get('segments',[]):
        if s.get('id') in segments and segments[s['id']]!=s:
            raise ValueError('续接不能覆盖已保存片段；新增区间请使用新的 id。')
        segments[s['id']]=deepcopy(s)
    return {**plan,'subjects':list(subjects.values()),'segments':list(segments.values())}


class VideoIdentityRunner:
    def __init__(self,config=None,env_file=None,player_data=None,roster_root=None,max_requests=12,max_tools=30,timeout=480):
        self.config=model_config(config);self.env_file=Path(env_file or ROOT/'.env')
        self.player_data=player_data;self.roster_root=Path(roster_root or ROOT/'data/player-rosters')
        self.max_requests=max_requests;self.max_tools=max_tools;self.timeout=timeout

    def status(self):
        value={'provider':self.config['provider'],'model':self.config['model'],'algoVersion':ALGO_VERSION}
        try:
            provider_environment(self.env_file,self.config['provider'],self.config['model'])
            if not shutil.which('node') or not (WORKER.parent/'node_modules/@earendil-works/pi-agent-core').is_dir():
                raise ValueError('需要安装 Node.js 和 agents/package.json 中的 Pi 依赖。')
            return {**value,'available':True,'message':'视频身份 Agent 已配置，实际模型响应需运行核验。'}
        except Exception as error:
            return {**value,'available':False,'message':'视频身份 Agent 配置不可用：'+redact(str(error))}

    def source_key(self,clip,variant,qa,request):
        return video_source_key(clip,variant,qa,request.get('identityContext'),self.config)

    def run(self,job,directory,progress):
        def check():
            if job['cancel'].is_set():raise ValueError('任务已取消。')
        check()
        clip=job['clip'];session=job.get('resumeRequest',job['request'])['session'];ctx=identity_context(job['request'].get('identityContext'))
        roster=self.player_data
        if ctx.get('gameId'):
            from player_game_roster import PlayerGameRoster
            roster=PlayerGameRoster(self.roster_root,ctx['gameId'])
            options=roster.options(ctx.get('season'));ctx.setdefault('season',options['seasons'][0])
        if roster is not None and ctx.get('season'):
            options=roster.options(ctx['season']);allowed={t['abbreviation'] for t in options['teams']}
            if any(t not in allowed for t in ctx.get('teamMap',{}).values()):raise ValueError('球队不属于指定名单。')
        observations=directory/'observations.json';atomic_json(observations,clip)
        video=CommentaryVideo(job['video'],directory/'images',observations)
        context=video.context();mapping=validate_source_mapping(clip,context);check()
        # CommentaryVideo has checked the same asset frames; parent source indices
        # remain a separate host-only provenance field and never drive image reads.
        context['identityContext']=ctx;context['identitySlots']=sorted(video_slot_basis(session))
        context['identitySlotBasis']=video_slot_basis(session)
        context['sourceCuts']=sorted(set(clip.get('sourceCuts',[]))|set(session.get('cuts',[])))
        context['identityMapping']=mapping
        previous=None
        if job.get('resumeFrom'):
            resumed=load_checkpoint(directory.parent/job['resumeFrom'],context,clip)
            previous=resumed['candidate'];ledger=resumed['ledger']
            context['previousCandidate']={k:deepcopy(previous[k]) for k in ('summary','subjects','segments','issues','coverage')}
        else:ledger=ImageLedger(context)
        overview=ledger.record(video.read_video_window({'startTime':0,'endTime':context['duration'],
            'fps':min(2,60/max(context['duration'],1)),'mode':'sheet'}))
        atomic_json(directory/'context.json',context);atomic_json(directory/'overview.json',overview['details'])
        checkpoint=deepcopy(previous)
        def save(params):
            nonlocal checkpoint
            check()
            proposed=merge_checkpoint_plan(checkpoint,params.get('plan')) if checkpoint else params.get('plan')
            candidate=validate_video_identity_partial(proposed,clip,session,mapping,ledger)
            if previous:candidate['slotBasis']=deepcopy(previous['slotBasis'])
            if params.get('finish') is True and not ledger.detail_frames:raise ValueError('完成前需要读取原帧或局部细节。')
            candidate['playerNames']=build_name_result(candidate,ctx,roster,job_id=job['jobId'],source_key=job['sourceKey'],base=job['base'])
            checkpoint=candidate
            atomic_json(directory/'checkpoint.json',candidate)
            return {'saved':True,'candidate':candidate,'finish':params.get('finish') is True}
        def visual(method):
            def call(params):
                check();result=method(params);check();return ledger.record(result)
            return call
        def update(message):
            check();progress(stage=message.get('status','observing'),round=message.get('round'),
                              usage=message.get('usage'),sampledFrames=len(ledger.frames))
        methods={'read_video_window':visual(video.read_video_window),'inspect_region':visual(video.inspect_region),
                 'get_observations':video.get_observations,'save_identity_review':save}
        child,secret=provider_environment(self.env_file,self.config['provider'],self.config['model'])
        child['COMMENTARY_MODEL_CONFIG']=json.dumps(self.config,ensure_ascii=False)
        result=run_worker(video,context,overview,directory,child,secret,
            {'maxRequests':self.max_requests,'maxToolCalls':self.max_tools,'timeoutSeconds':self.timeout},
            '先概览，再按需读取原帧/短窗口/球衣局部，提出 P 与实际检测框的有限身份候选；姓名由宿主匹配名单。',
            worker_path=WORKER,cancel_event=job['cancel'],on_progress=update,rpc_methods=methods,
            set_process=lambda process:job.update(process=process))
        atomic_json(directory/'worker-result.json',result);check()
        if checkpoint is None:raise ValueError(result.get('error') or '视频 Agent 没有保存通过来源校验的身份候选。')
        checkpoint['completionStatus']='completed' if result.get('status')=='completed' and not checkpoint.get('rejectedSegments') else 'partial'
        checkpoint['usage']=result.get('usage',{})
        cumulative=deepcopy((previous or {}).get('cumulativeUsage',(previous or {}).get('usage',{})))
        for key,value in checkpoint['usage'].items():
            if type(value) in (int,float):cumulative[key]=cumulative.get(key,0)+value
        checkpoint['cumulativeUsage']=cumulative
        checkpoint['resumeCount']=job.get('resumeCount',0)
        if job.get('resumeFrom'):checkpoint['resumeFrom']=job['resumeFrom']
        checkpoint['producerConfigSnapshot']=self.config
        if result.get('error'):checkpoint['completionMessage']=redact(result['error'],secret)
        checkpoint['playerNames']=build_name_result(checkpoint,ctx,roster,job_id=job['jobId'],source_key=job['sourceKey'],base=job['base'])
        previews=[]
        for frame in sorted(ledger.frames)[:24]:
            asset=ledger.frames[frame]
            if asset.get('path'):
                previews.append({**mapping[frame],'kind':'initial','sha256':asset['sha256'],
                    'dataUrl':'data:image/jpeg;base64,'+base64.b64encode(Path(asset['path']).read_bytes()).decode()})
        atomic_json(directory/'candidate.json',checkpoint)
        atomic_json(directory/'checkpoint.json',checkpoint)
        return checkpoint,previews


def main():
    """Explicit one-job local entry point; no browser credentials or deployment."""
    import argparse
    import threading
    import uuid
    from identity_agent import IdentityAgent, _digest
    from player_identity_data import PlayerIdentityData
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',type=Path,required=True,help='Existing initial_review request with session snapshot')
    parser.add_argument('--clip',type=Path,required=True)
    parser.add_argument('--video',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True,help='New isolated artifact directory')
    parser.add_argument('--env-file',type=Path,default=ROOT/'.env')
    parser.add_argument('--model-config',type=Path,help='Host-owned shared commentary configuration')
    parser.add_argument('--player-data-root',type=Path,default=ROOT/'2K Player Data')
    parser.add_argument('--max-requests',type=int,default=8)
    parser.add_argument('--max-tools',type=int,default=24)
    parser.add_argument('--timeout',type=int,default=300)
    parser.add_argument('--variant',default='original')
    parser.add_argument('--qa',action='store_true')
    args=parser.parse_args()
    if args.output.exists():parser.error('Output already exists; select a new directory to preserve evidence')
    if not 1<=args.max_requests<=24 or not 1<=args.max_tools<=60 or not 10<=args.timeout<=600:
        parser.error('Budgets outside supported bounds')
    request=json.loads(args.request.read_text(encoding='utf-8'));clip=json.loads(args.clip.read_text(encoding='utf-8'))
    IdentityAgent._request(request,clip)
    if request['purpose']!='initial_review':parser.error('This entry point only accepts initial_review')
    config=json.loads(args.model_config.read_text(encoding='utf-8')) if args.model_config else None
    runner=VideoIdentityRunner(config,args.env_file,PlayerIdentityData(args.player_data_root),
        max_requests=args.max_requests,max_tools=args.max_tools,timeout=args.timeout)
    status=runner.status()
    if not status['available']:parser.error(status['message'])
    args.output.mkdir(parents=True)
    base={'clientRevision':request['clientRevision'],'sessionDigest':_digest(request['session']),
        'videoHash':clip['video_sha256'],'trackingFingerprint':clip['tracking_fingerprint'],
        'trackingRevision':clip['tracking_revision'],'variant':args.variant,'qa':args.qa}
    job={'jobId':str(uuid.uuid4()),'purpose':'initial_review','algoVersion':ALGO_VERSION,'request':request,
        'clip':clip,'video':args.video,'base':base,'sourceKey':runner.source_key(clip,args.variant,args.qa,request),
        'cancel':threading.Event(),'process':None}
    atomic_json(args.output/'request.json',{'request':request,'video':str(args.video),'base':base,'sourceKey':job['sourceKey']})
    try:
        candidate,previews=runner.run(job,args.output,lambda **p:atomic_json(args.output/'progress.json',p))
        result={k:job[k] for k in ('jobId','purpose','algoVersion','base','sourceKey')}
        result.update(status='ready',candidate=candidate,previewFrames=previews)
        atomic_json(args.output/'result.json',result)
        print(json.dumps({'status':'ready','completionStatus':candidate['completionStatus'],
            'segments':len(candidate['segments']),'nameCandidates':sum(c['status']=='candidate' for c in candidate['playerNames']['candidate']['candidates']),
            'output':str(args.output/'result.json')},ensure_ascii=False))
        return 0 if candidate['completionStatus']=='completed' else 2
    except Exception as error:
        atomic_json(args.output/'failure.json',{'message':redact(str(error))})
        print('Identity review failed; inspect redacted failure.json')
        return 1


if __name__=='__main__':raise SystemExit(main())
