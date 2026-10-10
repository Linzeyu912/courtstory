"""Saved-commentary drawing jobs: separate Pi contexts, bounded evidence, native adoption."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys
import threading
import time
import uuid

from commentary_drawing import DrawingEvidence, drawing_config, map_candidate, run_pi
from commentary_plan import model_config, resolve_catalog_config
from commentary_video import CommentaryVideo
from commentary_agent import redact
from tactics_job_storage import atomic_job_json


def _digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()


class DrawingAuditRejected(ValueError):
    code='audit_rejected'


class CommentaryDrawingJobs:
    def __init__(self,root,tactics,commentary,python=sys.executable,*,execute=None,timeout=480,model_catalog=None):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.tactics,self.commentary,self.python=tactics,commentary,str(python)
        self.execute=execute or run_pi;self.timeout=timeout;self.model_catalog=model_catalog or {}
        self.lock=threading.RLock();self.pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='commentary-drawing')
        self.jobs={};self.closed=False
        for path in self.root.glob('*/job.json'):
            try: state=json.loads(path.read_text(encoding='utf-8'))
            except (OSError,ValueError): continue
            if state.get('status') in ('queued','preparing','analyzing','validating'):
                state.update(status='failed',message='服务重启，已完成节点保留；可显式重试。',failure={'code':'interrupted','retryable':True})
                atomic_job_json(path,state)

    def status(self):
        config=self.commentary.status() if hasattr(self.commentary,'status') else {}
        configured=config.get('understandingConfigured',config.get('understandingCredential',True))
        return {'available':bool(shutil.which('node') and configured),'provider':'openrouter','modelMode':'inherit_saved_commentary',
                'manualFallback':True,'budgetSeconds':self.timeout,'message':'独立 Pi 按已保存解说节点绘图并单独视觉复核。'}

    @staticmethod
    def _context(clip,variant,qa,kind):
        if type(qa) is not bool or kind not in ('workspace','candidate'): raise ValueError('绘图草稿空间无效。')
        return [clip['video_sha256'],clip['tracking_fingerprint'],clip['tracking_revision'],variant,qa,kind]

    def _document(self,request,clip,variant,qa,kind):
        if not isinstance(request,dict) or any(type(request.get(k)) is not int or request[k]<0 for k in ('expectedVersion','clientRevision')):
            raise ValueError('绘图任务缺少草稿版本。')
        document=request.get('document');self.tactics.check_source(document,clip,kind);self.tactics.run('validate',document=document)
        if self.tactics.run('agent-digest',document=document)['digest']!=request.get('documentDigest'): raise ValueError('草稿内容已变化。')
        if self.tactics.load(clip,variant,qa,kind)['version']!=request['expectedVersion']: raise ValueError('服务器已有更新草稿，请先同步。')
        return document

    def _plan(self,request,clip,variant,qa):
        return self.commentary.resolve_plan(request.get('commentaryPlanRef'),clip,variant,qa,review=request.get('review'))

    def _config(self,plan,override):
        raw,mode=drawing_config(plan,override)
        if mode=='inherited': return model_config(raw),mode
        model=raw['model']
        if model in self.model_catalog:
            trusted={'provider':'openrouter','model':model,'modelCapabilities':deepcopy(self.model_catalog[model])}
            config=model_config(trusted)
        else: config=resolve_catalog_config(model)
        # Reasoning is selected only after the trusted capabilities are known.
        if isinstance(override,dict) and 'reasoning' in override: config=model_config({**config,'reasoning':override['reasoning']})
        return config,mode

    def create(self,request,clip,video,variant,qa,kind='workspace'):
        document=self._document(request,clip,variant,qa,kind);plan=self._plan(request,clip,variant,qa)
        selected=request.get('nodeIds')
        if not isinstance(selected,list) or not selected or len(selected)>12 or any(not isinstance(i,str) for i in selected) or len(set(selected))!=len(selected): raise ValueError('请选择有效解说节点。')
        nodes=[deepcopy(n) for n in plan.get('nodes',[]) if n['nodeId'] in selected]
        if len(nodes)!=len(selected): raise ValueError('绘图节点不属于已保存解说版本。')
        config,mode=self._config(plan,request.get('drawingModelOverride'))
        context=self._context(clip,variant,qa,kind)
        with self.lock:
            if self.closed: raise ValueError('绘图服务已停止。')
            for job in self.jobs.values():
                if job['context']==context and job['request']==request and job['running']: return self._public(job)
            id=str(uuid.uuid4());directory=self.root/id;directory.mkdir()
            job={'jobId':id,'status':'queued','message':'等待根据已保存解说绘图','context':context,'request':deepcopy(request),'document':deepcopy(document),
                 'plan':plan,'clip':deepcopy(clip),'video':str(Path(video).resolve()),'drawingConfigSnapshot':config,'modelMode':mode,'running':True,'runCount':1,
                 'base':{k:request[k] for k in ('expectedVersion','clientRevision','documentDigest')},'nodes':[{'nodeId':n['nodeId'],'node':n,'status':'pending'} for n in nodes],
                 'cancel':threading.Event(),'process':None,'adopted':False,'auditPending':True,'manualFallback':True,'progress':{'completed':0,'total':len(nodes)}}
            self.jobs[id]=job;self._persist(job);self.pool.submit(self._run,job)
            return self._public(job)

    def _persist(self,job):
        atomic_job_json(self.root/job['jobId']/'job.json',{k:deepcopy(v) for k,v in job.items() if k not in ('cancel','process','running','deadline')})

    def _lookup(self,id,clip,variant,qa):
        if not isinstance(id,str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',id): raise ValueError('绘图任务ID无效。')
        job=self.jobs.get(id)
        if job is None:
            path=self.root/id/'job.json'
            if not path.is_file(): raise ValueError('绘图任务不存在。')
            job=json.loads(path.read_text(encoding='utf-8'));job.update(cancel=threading.Event(),process=None,running=False);self.jobs[id]=job
        if job['context'][:5]!=self._context(clip,variant,qa,job['context'][-1])[:5]: raise ValueError('绘图任务来源不匹配。')
        return job

    @staticmethod
    def _public(job):
        keys=('jobId','status','message','base','candidate','presentation','previewDocument','previewFrames','adopted','progress','failure','manualFallback','runCount',
              'auditPending','visualAudit','drawingConfigSnapshot','modelMode','completionKind','pendingHumanReview','pendingAnnotations','pendingActions')
        result=deepcopy({k:job[k] for k in keys if k in job})
        result['commentaryPlanRef']=deepcopy(job['request']['commentaryPlanRef'])
        result['model']=job['drawingConfigSnapshot']['model']
        result['nodes']=[{k:deepcopy(n[k]) for k in ('nodeId','status','reason','failure','extensionRequest') if k in n} for n in job['nodes']]
        result['canRetry']=not job.get('running') and not job.get('adopted') and job['status'] in ('failed','partial','cancelled') and job['runCount']<3
        if job['status']=='partial' and job.get('previewDocument') and all(r['status']=='ready' for r in job['nodes']): result['canRetry']=False
        return result

    def get(self,id,clip,variant,qa):
        with self.lock: return self._public(self._lookup(id,clip,variant,qa))

    def cancel(self,id,clip,variant,qa):
        with self.lock:
            job=self._lookup(id,clip,variant,qa)
            if job.get('adopted'): raise ValueError('已采用任务不能取消。')
            job['cancel'].set();job.update(status='cancelled',message='已取消；已完成局部证据保留。')
            if job['process'] and job['process'].poll() is None: job['process'].terminate()
            for k in ('candidate','previewDocument','previewFrames','presentation'): job.pop(k,None)
            self._persist(job);return self._public(job)

    def retry(self,id,request,clip,variant,qa,kind='workspace'):
        self._document(request,clip,variant,qa,kind);self._plan(request,clip,variant,qa)
        with self.lock:
            if self.closed: raise ValueError('绘图服务已停止。')
            job=self._lookup(id,clip,variant,qa)
            if kind!=job['context'][-1] or job.get('running') or job.get('adopted') or job['status'] not in ('failed','partial','cancelled') or job['runCount']>=3: raise ValueError('当前任务不可重试。')
            if job['status']=='partial' and job.get('previewDocument') and all(r['status']=='ready' for r in job['nodes']): raise ValueError('节点已完成；局部缺口需手动编辑或创建新绘图任务。')
            if request.get('commentaryPlanRef')!=job['request']['commentaryPlanRef'] or any(request.get(k)!=v for k,v in job['base'].items()): raise ValueError('重试不能改变上游或草稿版本。')
            if request.get('nodeIds')!=job['request'].get('nodeIds') or request.get('drawingModelOverride')!=job['request'].get('drawingModelOverride'): raise ValueError('重试沿用原节点及模型快照。')
            job.update(cancel=threading.Event(),running=True,status='queued',message='仅继续失败节点或未完成审核',runCount=job['runCount']+1)
            job.pop('failure',None);self._persist(job);self.pool.submit(self._run,job);return self._public(job)

    def _check_cancel(self,job):
        if job['cancel'].is_set(): raise ValueError('绘图任务已取消。')
        if time.monotonic()>=job['deadline']: raise ValueError('本轮绘图总预算已用尽。')

    def _state(self,job,status,message):
        with self.lock:
            self._check_cancel(job);job.update(status=status,message=message);self._persist(job)

    def _start(self,job,row,mode,evidence=None):
        node=deepcopy(row.get('effectiveNode',row['node']));plan=job['plan'];remaining=job['deadline']-time.monotonic()
        if node.get('kind')!='shot_release': node.pop('shotFeedback',None)
        if remaining<=1: raise ValueError('绘图剩余预算不足。')
        return {'mode':mode,'nodes':[node],'node':node,'planRef':job['request']['commentaryPlanRef'],'modelConfig':job['drawingConfigSnapshot'],
                'participants':[p for p in plan.get('participants',[]) if p['participantId'] in node.get('participantRefs',[])],
                'event':next((e for e in plan.get('events',[]) if e['eventId']==node.get('eventId')),None),
                'cues':[c for c in plan.get('cues',[]) if c['cueId'] in node.get('cueIds',[])],
                'candidate':row.get('candidate'),'evidence':evidence,
                'auditFeedback':deepcopy(row.get('auditFeedback')) if mode=='draw' else None,
                'config':{'maxRequests':8,'maxToolCalls':24,'timeoutSeconds':max(1,min(180,int(remaining)) if mode=='draw' else min(120,int(remaining)))}}

    def _process(self,job,process):
        with self.lock:
            job['process']=process
            if process and job['cancel'].is_set(): process.terminate()

    def _validate_node(self,row,evidence,candidate,participants=()):
        node=row.get('effectiveNode',row['node']);window=node['evidenceWindow'];seen=evidence.seen[node['nodeId']]
        if candidate.get('schemaVersion')!=4 or len(candidate.get('phases',[]))!=1: raise ValueError('绘图需返回原生单节点V4。')
        phase=candidate['phases'][0]
        if (phase['startFrame'],phase['endFrameExclusive'],phase['freezeFrame'])!=(window['startFrame'],window['endFrame']+1,node['anchorAssetFrame']) or node['anchorAssetFrame'] not in seen: raise ValueError('节点帧范围或锚点没有本轮图像证据。')
        for item in [phase,*phase.get('annotations',[]),*phase.get('actions',[]),*phase.get('participants',[])]:
            if not item.get('evidenceFrames') or any(type(f) is not int or f not in seen for f in item['evidenceFrames']): raise ValueError('候选引用本轮未发送的证据帧。')
            if 'startFrame' in item and not window['startFrame']<=item['startFrame']<item['endFrameExclusive']<=window['endFrame']+1: raise ValueError('图形超出节点窗口。')
        if any(a['anchorFrame']!=node['anchorAssetFrame'] for a in phase.get('annotations',[])): raise ValueError('图形锚点不属于当前解说节点。')
        entities={p.get('entityId') for p in phase.get('participants',[]) if p.get('entityId')}
        if any(ref not in entities for action in phase.get('actions',[]) for ref in (action.get('entityId'),action.get('beneficiaryId'),action.get('defenderId')) if ref):
            raise ValueError('原生actions只能引用已绑定entityId；匿名人物动作请用有证据的annotation路线表达。')
        if not phase.get('annotations') and not phase.get('actions'): raise ValueError('此节点尚无可采用的几何候选，不能标为已完成。')
        focus=[(i,a) for i,a in enumerate(phase.get('annotations',[])) if a.get('type')=='spotlight']
        if node.get('kind')=='shot_release':
            shooter_ref=node.get('shotFeedback',{}).get('shooterRef')
            shooter=next((p for p in participants if p.get('participantId')==shooter_ref),None)
            if not shooter: raise ValueError('出手节点缺少保存的出手者引用。')
            if len(focus)!=1: raise ValueError('确定出手节点必须有且仅有出手者spotlight。')
            index,annotation=focus[0];owners=[p for p in phase.get('participants',[]) if index in p.get('annotationIndexes',[])]
            if len(owners)!=1 or owners[0].get('entityId')!=annotation.get('entityId') or (
                owners[0].get('entityId')!=shooter['entityId'] if shooter.get('entityId') is not None else
                owners[0].get('entityId') is not None or owners[0].get('subjectId')!=shooter_ref):
                raise ValueError('出手例外只允许保存的出手者spotlight，匿名人物需匹配subjectId。')
            row['shotSpotlightIndex']=index
        else:
            for index,_ in focus:
                owners=[p for p in phase.get('participants',[]) if index in p.get('annotationIndexes',[])]
                if len(owners)!=1 or owners[0].get('role')!='ball_handler': raise ValueError('普通节点重点圈只允许当前持球人。')
        return map_candidate(candidate,evidence,node['nodeId'])

    def _extend_window(self,job,row,request,video,evidence):
        """One host-approved extension per node, fenced by saved event, shot and budget."""
        self._check_cancel(job)
        if row.get('windowExtension'): raise ValueError('节点扩窗预算已用尽，不能继续扩大。')
        if not isinstance(request,dict) or request.get('nodeId')!=row['nodeId'] or any(type(request.get(k)) is not int for k in ('startFrame','endFrame')) or not isinstance(request.get('reason'),str) or not request['reason'].strip():
            raise ValueError('扩窗请求格式或理由无效。')
        event=next((e for e in job['plan'].get('events',[]) if e.get('eventId')==row['node'].get('eventId')),None)
        if not event or any(isinstance(event.get(k),bool) or not isinstance(event.get(k),(int,float)) or not math.isfinite(event[k]) for k in ('startTime','endTime')):
            raise ValueError('没有可验证的上游事件时间范围，不能扩窗。')
        allowed=[i for i,f in enumerate(video._frames) if event['startTime']<=f['time']<=event['endTime']]
        start,end=request['startFrame'],request['endFrame'];old=row.get('effectiveNode',row['node'])['evidenceWindow']
        if not allowed or not min(allowed)<=start<=old['startFrame']<=old['endFrame']<=end<=max(allowed) or (start,end)==(old['startFrame'],old['endFrame']):
            raise ValueError('扩窗必须包含原窗口且保持在已保存上游事件内。')
        if end-start>240 or video._frames[end]['time']-video._frames[start]['time']>6:
            raise ValueError('扩窗超过局部范围上限，不能退回全片分析。')
        # Check endpoint membership against the same shot fence as regular reads.
        effective=deepcopy(row['node']);effective['evidenceWindow']={'startFrame':start,'endFrame':end}
        original=evidence.nodes[row['nodeId']];evidence.nodes[row['nodeId']]=effective
        previous_seen=evidence.seen[row['nodeId']];evidence.seen[row['nodeId']]=set()
        try: evidence._indices({'nodeId':row['nodeId'],'frames':[start,end]})
        except Exception:
            evidence.nodes[row['nodeId']]=original
            raise
        finally: evidence.seen[row['nodeId']]=previous_seen
        row['effectiveNode']=effective
        row['windowExtension']={'reason':request['reason'][:600],'requestedWindow':{'startFrame':start,'endFrame':end},
                                'actualWindow':deepcopy(effective['evidenceWindow']),'eventId':event['eventId'],'originalWindow':deepcopy(old)}
        row.setdefault('priorEvidence',[]).append({'frames':sorted(evidence.seen[row['nodeId']]),'assets':deepcopy(evidence.node_assets[row['nodeId']])})
        # The expanded attempt creates a fresh Pi Agent. Previous images are retained as
        # history only and must be explicitly read again before becoming its evidence.
        evidence.seen[row['nodeId']]=set();evidence.node_assets[row['nodeId']]=[]
        self._persist(job)

    def _draw_node(self,job,row,evidence,video,directory):
        result=self.execute(self._start(job,row,'draw'),evidence,directory/'draw',job['drawingConfigSnapshot'],cancel=job['cancel'],process_callback=lambda p:self._process(job,p))
        self._check_cancel(job)
        request=result.get('extensionRequest')
        if request and result.get('nodeStatus') in ('partial','unavailable'):
            try:
                self._extend_window(job,row,request,video,evidence)
            except ValueError as exc:
                return {'status':'completed','nodeStatus':'unavailable','reason':str(exc),'extensionRequest':request}
            self._state(job,'analyzing',f"节点 {row['nodeId']} 已在上游事件内补给局部窗口")
            result=self.execute(self._start(job,row,'draw'),evidence,directory/'draw-expanded',job['drawingConfigSnapshot'],cancel=job['cancel'],process_callback=lambda p:self._process(job,p))
            self._check_cancel(job)
            if result.get('extensionRequest') and result.get('nodeStatus') in ('partial','unavailable'):
                result={'status':'completed','nodeStatus':'unavailable','reason':'节点本轮已补给一次窗口，仍缺必要证据。','extensionRequest':result['extensionRequest']}
        return result

    def _audit(self,job,row,video,evidence,directory):
        frames=sorted({f for p in row['candidate']['phases'] for i in [p,*p.get('annotations',[]),*p.get('actions',[]),*p.get('participants',[])] for f in i.get('evidenceFrames',[])})
        # Original frames are sent again to a fresh Agent; generating context is never reused.
        images=evidence.read_frames({'nodeId':row['nodeId'],'frames':frames})
        result=self.execute(self._start(job,row,'audit',images),evidence,directory/'audit',job['drawingConfigSnapshot'],cancel=job['cancel'],process_callback=lambda p:self._process(job,p))
        self._check_cancel(job)
        audit=result.get('audit');phase=row['candidate']['phases'][0]
        if result.get('status')!='completed' or not isinstance(audit,dict) or audit.get('nodeId')!=row['nodeId']: raise ValueError(result.get('error') or '独立视觉审核未完成。')
        for key in ('annotations','actions'):
            items=audit.get(key)
            if not isinstance(items,list) or {r.get('index') for r in items}!=set(range(len(phase.get(key,[])))) or len(items)!=len(phase.get(key,[])) or any(type(r.get('approved')) is not bool for r in items): raise ValueError('独立视觉审核未逐项覆盖候选。')
        approved=all(i['approved'] for key in ('annotations','actions') for i in audit[key])
        if audit.get('approved') is not approved: raise ValueError('独立审核总体与逐项状态不一致。')
        row['visualAudit']=deepcopy(audit);row['auditEvidence']=deepcopy(images['details'])
        if not approved:
            row['auditNeedsRegeneration']=True
            raise DrawingAuditRejected('独立审核发现图形或动作待核对：'+str(audit.get('reason','')))

    def _run(self,job):
        job['deadline']=time.monotonic()+self.timeout
        try:
            self._state(job,'preparing','核对视频与已保存解说来源')
            video=CommentaryVideo(job['video'],self.root/job['jobId']/'images')
            if video.video_ref!=job['clip']['video_sha256'] or len(video._frames)!=len(job['clip']['frames']) or (video.width,video.height)!=(job['clip']['width'],job['clip']['height']): raise ValueError('实际解码资产与当前来源不匹配。')
            evidence=DrawingEvidence(video,[r['node'] for r in job['nodes']],job['document']['review'])
            for row in job['nodes']:
                if row.get('effectiveNode'): evidence.nodes[row['nodeId']]=deepcopy(row['effectiveNode'])
            for row in job['nodes']:
                if row['status']=='ready': continue
                self._check_cancel(job);directory=self.root/job['jobId']/_digest(row['nodeId'])[:16]/f"run-{job['runCount']}"
                try:
                    if row.pop('auditNeedsRegeneration',False):
                        row.setdefault('rejectedCandidates',[]).append({'candidate':row.pop('candidate'),'visualAudit':row.get('visualAudit'),'generationEvidence':row.get('generationEvidence')})
                        row['auditFeedback']={'audit':deepcopy(row.get('visualAudit')),'previousCandidate':deepcopy(row['rejectedCandidates'][-1]['candidate']),
                                              'instruction':'上一几何候选被内容审核驳回。按意见重新读取当前节点原图并修正；旧候选和意见仅作纠错数据，不代表本轮图像证据。'}
                    if not row.get('candidate'):
                        self._state(job,'analyzing',f"根据解说节点 {row['nodeId']} 局部绘图")
                        result=self._draw_node(job,row,evidence,video,directory)
                        self._check_cancel(job)
                        if result.get('status')!='completed': raise ValueError(result.get('error') or '绘图未完成。')
                        row.update(reason=result.get('reason',''),extensionRequest=result.get('extensionRequest'))
                        if result.get('nodeStatus') in ('unavailable','needs_upstream_review'):
                            row.update(status=result['nodeStatus']);self._persist(job);continue
                        row['candidate']=self._validate_node(row,evidence,result.get('candidate') or {},job['plan'].get('participants',[]))
                        row['generationEvidence']={'frames':sorted(evidence.seen[row['nodeId']]),'assets':deepcopy(evidence.node_assets[row['nodeId']])}
                        row['generationStatus']=result.get('nodeStatus','partial');row['status']='awaiting_audit';self._persist(job)
                    self._state(job,'validating',f"独立复核节点 {row['nodeId']} 原图几何")
                    self._audit(job,row,video,evidence,directory)
                    row.update(status='ready');row.pop('failure',None);self._persist(job)
                except Exception as exc:
                    if job['cancel'].is_set(): raise
                    row.update(status='failed',reason=redact(str(exc)),failure={'code':getattr(exc,'code','node_failed'),'retryable':True});self._persist(job)
            self._check_cancel(job)
            ready=[r for r in job['nodes'] if r['status']=='ready']
            if ready:
                self._plan(job['request'],job['clip'],job['context'][3],job['context'][4])
                self._state(job,'validating','校验并转换可采用的原生候选')
                self._publish(job,ready)
            with self.lock:
                self._check_cancel(job)
                count=len(ready);job['progress'].update(completed=count,total=len(job['nodes']))
                job.update(status='ready' if count==len(job['nodes']) and all(r.get('generationStatus')=='ready' for r in ready) else 'partial' if count else 'failed',
                    message='已完成独立绘图、复核和原生候选校验' if count else '暂无通过复核的节点，局部证据与缺口保留',auditPending=not bool(count),completionKind='complete' if count==len(job['nodes']) else 'generation_partial')
                self._persist(job)
        except Exception as exc:
            with self.lock:
                if not job['cancel'].is_set(): job.update(status='failed',message=redact(str(exc)),failure={'code':'drawing_failed','retryable':True})
                self._persist(job)
        finally:
            with self.lock: job['running']=False;job['process']=None

    def _replace_old(self,job,ready_node_ids=None):
        document=deepcopy(job['document']);runs={r['jobId']:r for r in document.get('agentRuns',[]) if r.get('commentaryPlanRef')}
        selected=set(ready_node_ids) if ready_node_ids is not None else {n['nodeId'] for n in job['nodes']};archived=[];removed=set();old_jobs=set();human=[]
        for a in document.get('annotations',{}).get('items',[]):
            old=runs.get(a.get('origin',{}).get('jobId'));node_id=old.get('annotationNodeRefs',{}).get(a['id']) if old else None
            if old and (node_id in selected or old.get('commentaryPlanRef')!=job['request']['commentaryPlanRef']):
                if a.get('origin',{}).get('kind')=='human_modified':
                    human.append(deepcopy(a))
                else:
                    archived.append(deepcopy(a));removed.add(a['id']);old_jobs.add(old['jobId'])
        if removed:
            document['annotations']['items']=[a for a in document['annotations']['items'] if a['id'] not in removed]
            if document.get('tacticKeyframes'):
                for k in document['tacticKeyframes']['items']: k['annotationIds']=[i for i in k['annotationIds'] if i not in removed]
                document['tacticKeyframes']['items']=[k for k in document['tacticKeyframes']['items'] if k['annotationIds']]
        archived_actions=[a for a in document['playDefinition'].get('actions',[]) if any(a.get('actionId','').startswith(j+'-') for j in old_jobs)]
        action_ids={a['actionId'] for a in archived_actions}
        archived_relations=[r for r in document['playDefinition'].get('relations',[]) if r.get('actionId') in action_ids]
        relation_ids={r['id'] for r in archived_relations}
        if action_ids:
            document['playDefinition']['actions']=[a for a in document['playDefinition']['actions'] if a['actionId'] not in action_ids]
            document['playDefinition']['relations']=[r for r in document['playDefinition']['relations'] if r['id'] not in relation_ids]
            for p in document['playDefinition']['phases']:
                p['actionIds']=[i for i in p['actionIds'] if i not in action_ids];p['relationIds']=[i for i in p['relationIds'] if i not in relation_ids]
        old_feedback=document.get('shotFeedback',{}).get('items',[])
        feedback_archive=[deepcopy(item) for item in old_feedback if item.get('nodeId') in selected or item.get('commentaryPlanRef')!=job['request']['commentaryPlanRef'] or item.get('spotlightAnnotationId') in removed]
        if 'shotFeedback' in document: document['shotFeedback']['items']=[item for item in old_feedback if item not in feedback_archive]
        return document,archived,archived_actions,archived_relations,human,feedback_archive

    def _publish(self,job,ready):
        document,archived,old_actions,old_relations,human,feedback_archive=self._replace_old(job,{r['nodeId'] for r in ready});play=document['playDefinition'];ready=sorted(ready,key=lambda r:r['node']['anchorAssetFrame'])
        combined={'schemaVersion':4,'summary':'；'.join(r['candidate']['summary'] for r in ready)[:1800],'issues':[], 'production':None,
                  'phases':[{'title':'已保存解说节点','reason':'按节点局部取证','startFrame':play['startFrame'],'endFrameExclusive':play['endFrameExclusive'],'freezeFrame':ready[0]['node']['anchorAssetFrame'],
                             'evidenceFrames':[],'annotations':[],'actions':[],'participants':[]}]}
        phase=combined['phases'][0];people={};annotation_nodes={};shot_rows=[]
        for row in ready:
            p=row['candidate']['phases'][0];offset=len(phase['annotations']);phase['annotations'].extend(deepcopy(p['annotations']));phase['actions'].extend(deepcopy(p['actions']));phase['evidenceFrames'].extend(p['evidenceFrames']);combined['issues'].extend(row['candidate']['issues'])
            for index in range(len(p['annotations'])): annotation_nodes[f"{job['jobId']}-annotation-{offset+index}"]=row['nodeId']
            if row['node'].get('kind')=='shot_release': shot_rows.append((row,offset+row['shotSpotlightIndex']))
            for person in p['participants']:
                # Anonymous background observations remain in node coverage, not duplicated native subjects.
                if person['entityId'] is None and not person['annotationIndexes']: continue
                key=('entity',person['entityId']) if person['entityId'] is not None else (row['nodeId'],person['subjectId'])
                fresh=deepcopy(person);fresh['subjectId']=f"s{len(people)}";fresh['annotationIndexes']=[i+offset for i in person['annotationIndexes']]
                if key not in people: people[key]=fresh
                else:
                    old=people[key];old['annotationIndexes'].extend(fresh['annotationIndexes']);old['evidenceFrames']=sorted(set(old['evidenceFrames']+fresh['evidenceFrames']))
                    if fresh['disposition']=='annotated': old['disposition']='annotated'
                    if fresh['role']=='ball_handler': old['role']='ball_handler'
        # Native coverage requires observed slots to remain explicit even when not in commentary focus.
        observed=[e for e in document['review'].get('entities',[]) if any(isinstance(p.get('x'),(int,float)) and isinstance(p.get('y'),(int,float)) and not p.get('reviewExcluded') for p in e.get('trajectory',[]))]
        available=set(phase['evidenceFrames'])
        for entity in observed:
            if ('entity',entity['id']) not in people:
                people[('entity',entity['id'])]={'subjectId':f"s{len(people)}",'entityId':entity['id'],'label':entity['id'],'role':'other','disposition':'uncertain','annotationIndexes':[],
                    'evidenceFrames':[next(iter(available))],'reason':'当前解说节点未可靠定位此已保存人物，保留待核对。'}
        phase['participants']=list(people.values());phase['evidenceFrames']=sorted(available);combined['issues']=list(dict.fromkeys(combined['issues']))[:60]
        release_focus=[]
        for row,index in shot_rows:
            owners=[p for p in phase['participants'] if index in p['annotationIndexes']]
            if len(owners)!=1: raise ValueError('原生出手者图形主体不唯一。')
            release_focus.append({'annotationIndex':index,'anchorFrame':row['node']['anchorAssetFrame'],'subjectId':owners[0]['subjectId'],'entityId':owners[0]['entityId']})
        converted=self.tactics.run('agent-adopt',document=document,candidate=combined,options={'scope':'play','phaseId':play['phases'][0]['phaseId'],'jobId':job['jobId'],'shotReleaseFocus':release_focus})
        doc=converted['document'];run=next(r for r in doc['agentRuns'] if r['jobId']==job['jobId'])
        visual={'allApproved':True,'approved':True,'status':'approved','stages':{r['nodeId']:r['visualAudit'] for r in ready}}
        run.update(commentaryPlanRef=deepcopy(job['request']['commentaryPlanRef']),nodeIds=[r['nodeId'] for r in ready],annotationNodeRefs=annotation_nodes,
                   drawingConfigSnapshot=deepcopy(job['drawingConfigSnapshot']),nodeEvidence={r['nodeId']:r['generationEvidence'] for r in ready},
                   nodeParticipantCoverage={r['nodeId']:deepcopy(r['candidate']['phases'][0]['participants']) for r in ready},
                   nodeDigests={r['nodeId']:_digest(r['node']) for r in ready},visualAudit=visual,archivedAnnotations=archived,archivedActions=old_actions,archivedRelations=old_relations)
        run['nodeWindowExtensions']={r['nodeId']:deepcopy(r['windowExtension']) for r in ready if r.get('windowExtension')}
        run['archivedShotFeedback']=feedback_archive
        shot_refs={ref for row,_ in shot_rows for ref in [row['node']['shotFeedback']['shooterRef'],*row['node']['shotFeedback'].get('defenderRefs',[])]}
        run['shotParticipantSnapshot']=[deepcopy(p) for p in job['plan'].get('participants',[]) if p['participantId'] in shot_refs]
        for row,index in shot_rows:
            node=row['node'];feedback=node['shotFeedback'];ident=f"{job['jobId']}-annotation-{index}"
            annotation=next((a for a in doc.get('annotations',{}).get('items',[]) if a['id']==ident),None)
            if not annotation or annotation.get('type')!='spotlight' or annotation.get('anchorFrame')!=node['anchorAssetFrame']: raise ValueError('确定出手节点没有被原生采用的合法spotlight，不能完成。')
            doc.setdefault('shotFeedback',{'schemaVersion':1,'items':[]})['items'].append({'id':f"{job['jobId']}-shot-{index}",'nodeId':node['nodeId'],'eventId':node['eventId'],
                'frame':node['anchorAssetFrame'],'spotlightAnnotationId':ident,'shooterRef':feedback['shooterRef'],'opportunity':deepcopy(feedback['opportunity']),
                'pressure':deepcopy(feedback['pressure']),'commentaryPlanRef':deepcopy(job['request']['commentaryPlanRef'])})
            cues=doc.setdefault('tacticKeyframes',{'schemaVersion':1,'items':[]})['items']
            if not any(k['frame']==node['anchorAssetFrame'] and k.get('freeze') and k['holdSeconds']>=2.5 and ident in k['annotationIds'] for k in cues):
                cues.append({'id':f"{job['jobId']}-shot-cue-{index}",'frame':node['anchorAssetFrame'],'annotationIds':[ident],'freeze':True,'holdSeconds':2.5})
        pending=[{'annotationId':a['id'],'phaseId':a.get('phaseId'),'anchorFrame':a.get('anchorFrame'),
                  'reason':'人工编辑依赖旧解说，已保留在画布；需重核并明确确认当前版本归属或删除重画。','annotation':a} for a in human]
        run['pendingHumanReview']=pending
        run['pendingAnnotations']=[*run.get('pendingAnnotations',[]),*pending]
        self.tactics.run('validate',document=doc)
        previews=self.tactics.frames(job['video'],job['clip'],sorted({r['node']['anchorAssetFrame'] for r in ready}),execution_deadline=job['deadline'],cancel=job['cancel']) if hasattr(self.tactics,'frames') else []
        with self.lock:
            self._check_cancel(job)
            job.update(candidate=combined,previewDocument=doc,presentation=converted['presentation'],previewFrames=previews,visualAudit=visual,pendingHumanReview=pending,
                       pendingAnnotations=run.get('pendingAnnotations',[]),pendingActions=run.get('pendingActions',[]),auditPending=False)
            self._persist(job)

    def adopt(self,id,request,clip,variant,qa,kind='workspace'):
        self._document(request,clip,variant,qa,kind);self._plan(request,clip,variant,qa)
        with self.lock:
            job=self._lookup(id,clip,variant,qa)
            if kind!=job['context'][-1] or job['status'] not in ('ready','partial') or not job.get('previewDocument') or job.get('auditPending'): raise ValueError('暂无通过独立审核可采用的图形。')
            if request.get('commentaryPlanRef')!=job['request']['commentaryPlanRef'] or any(request.get(k)!=v for k,v in job['base'].items()): raise ValueError('生成后解说或草稿版本已变化。')
            job['adopted']=True;self._persist(job)
            return deepcopy({'jobId':id,'base':job['base'],'document':job['previewDocument']})

    def close(self):
        with self.lock:
            self.closed=True
            for job in self.jobs.values():
                job['cancel'].set()
                if job.get('running'):
                    job.update(status='cancelled',message='绘图服务关闭；已完成节点保留。')
                    self._persist(job)
                if job['process'] and job['process'].poll() is None: job['process'].terminate()
        self.pool.shutdown(wait=True,cancel_futures=True)
