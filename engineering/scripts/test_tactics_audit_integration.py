from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from tactics_agent import TacticsAgent, AgentFailure
import test_tactics_agent as legacy_fixture
from test_tactics_facts_integration import facts_for
from test_tactics_facts_patch import empty_patch


def approved(stages):
    return {'stages':[{'stageId':stage['stageId'], 'audit':{
        'peopleReviewed':[person['id'] for person in stage['facts']['people']], 'peopleIssues':[],
        'frameReviewed':[frame['frame'] for frame in stage['pack']['images']], 'frameIssues':[],
        'routes':[{'routeIndex':index,'personId':route['personId'],'verdict':'accept','identity':'same',
                   'geometry':'aligned','camera':'fixed','mergedPeople':False,
                   'observations':[{'frame':frame,'participantKind':'on_court_player','team':'light','identityBasis':'jersey','jersey':str(index+1),'reason':'白色队服号码一致，与旁边人物区分明确'} for frame in route['evidenceFrames']],
                   'reason':'原图同一球员，同参考系运动'} for index,route in enumerate(stage['facts']['routes'])],
        'ball':[{'ballIndex':index,'personId':ball['personId'],'frame':ball['frame'],'participantKind':'on_court_player','verdict':'accept','control':'in_hand',
                 'reason':'原图看见球由此人控制'} for index,ball in enumerate(stage['facts']['ball'])]}}
        for stage in stages]}


class AuditIntegrationTests(unittest.TestCase):
    setUp=legacy_fixture.AgentTests.setUp
    wait=legacy_fixture.AgentTests.wait

    def agent(self, execute):
        agent=TacticsAgent(self.folder/'audit',self.tactics,codex_path=self.node,execute=execute)
        self.addCleanup(agent.close)
        return agent

    def test_camera_conflict_demotes_only_target_and_reuses_existing_patch_and_audit_calls(self):
        calls=[];guard_calls=[]
        def camera(stages,clip,folder,deadline,cancel):
            guard_calls.append(1)
            self.assertGreater(deadline,__import__('time').monotonic())
            route=stages[0]['facts']['routes'][0]
            conflict=route['points'][-1]!=[210,160]
            return {s['stageId']:{'metricAccuracyValidated':False,'routes':[
                {'routeIndex':0,'personId':'local-1','status':'camera_contradiction' if conflict else 'no_large_contradiction',
                 'differencePixels':373 if conflict else 12,'approximateEndpoint':[210,160],
                 'anchorFrame':route['anchorFrame'],'lastFrame':max(route['evidenceFrames'])}]} for s in stages}
        def execute(**kwargs):
            calls.append(kwargs['job']['callAnalysisMode'])
            if kwargs['job']['callAnalysisMode']=='visual_facts':
                return facts_for(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')))
            if kwargs['job']['callAnalysisMode']=='visual_audit_repair':
                self.assertIn('approximateEndpoint',kwargs['prompt'])
                context=json.loads((kwargs['directory']/'context.json').read_text(encoding='utf-8'))
                value={'stages':[empty_patch(s['stageId']) for s in context['repairStages']]}
                value['stages'][0]['routes']=[{'routeIndex':0,'points':[[100,200],[150,180],[210,160]],'cameraReference':'landmark_aligned','note':'独立原图复查后修正参考帧终点'}]
                return value
            stages=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            self.assertIn('独立本地相机检查',kwargs['prompt'])
            return approved(stages)
        with patch('tactics_camera_guard.CameraGuard.review',side_effect=camera):
            agent=self.agent(execute)
            done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done)
        self.assertTrue(done['visualAudit']['allApproved'])
        self.assertEqual(calls,['visual_facts','visual_audit','visual_audit_repair','visual_audit'])
        self.assertEqual(len(guard_calls),2)
        directory=agent.folder/done['jobId']/'audit-run-1-call-2'
        self.assertEqual(json.loads((directory/'rawaudit.json').read_text(encoding='utf-8'))['stages'][0]['audit']['routes'][0]['verdict'],'accept')
        self.assertEqual(json.loads((directory/'effective-audit.json').read_text(encoding='utf-8'))['stages'][0]['audit']['routes'][0]['verdict'],'uncertain')
        self.assertEqual(done['stages'][0]['factsReport']['routePeople'],2)

    def test_empty_safe_audit_still_runs_bounded_patch_then_reaudit_before_final_failure(self):
        for corrected in (True,False):
            calls=[];audit_count=[0]
            def execute(**kwargs):
                mode=kwargs['job']['callAnalysisMode'];calls.append(mode)
                if mode=='visual_facts':
                    value=facts_for(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')))
                    value['people'][2]['action']='unknown'
                    return value
                if mode=='visual_audit_repair':
                    live=kwargs['job']
                    self.assertEqual(live['stages'][0]['status'],'awaiting_audit')
                    self.assertNotIn('_output',live['stages'][0]);self.assertNotIn('candidate',live)
                    self.assertEqual(live['progress']['completed'],0)
                    self.assertTrue(live['visualAudit']['stages']['stage-1']['repairNeeds'])
                    context=json.loads((kwargs['directory']/'context.json').read_text(encoding='utf-8'))
                    value={'stages':[empty_patch(s['stageId']) for s in context['repairStages']]}
                    value['stages'][0]['routes']=[{'routeIndex':0,'points':[[100,200],[150,180],[210,160]],'cameraReference':'landmark_aligned','note':'按原图修正终点'}]
                    return value
                stages=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
                result=approved(stages);audit_count[0]+=1
                if audit_count[0]==1 or not corrected:
                    for stage in result['stages']:
                        for route in stage['audit']['routes']:
                            route.update(verdict='uncertain',geometry='uncertain',reason='参考帧中的运动终点尚需独立依据')
                if not corrected and audit_count[0]==2:
                    kwargs['job'].update(candidate={'old':'preview'},previewDocument={'old':'document'},previewFrames=[])
                return result
            agent=TacticsAgent(self.folder/f'empty-safe-{corrected}',self.tactics,codex_path=self.node,execute=execute)
            self.addCleanup(agent.close)
            done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
            self.assertEqual(calls,['visual_facts','visual_audit','visual_audit_repair','visual_audit'])
            if corrected:
                self.assertEqual(done['status'],'ready',done.get('failure'))
                self.assertEqual(done['progress']['completed'],1)
                self.assertEqual(done['stages'][0]['factsReport']['routePeople'],2)
            else:
                self.assertEqual(done['status'],'failed');self.assertNotIn('candidate',done)
                self.assertEqual(done['failure']['code'],'no_action_content')
                self.assertEqual(done['progress']['auditStatus'],'needs_repair')
                self.assertTrue(done['visualAudit']['stages']['stage-1']['repairNeeds'])
                self.assertEqual(done['stages'][0]['status'],'awaiting_audit')
                with self.assertRaises(ValueError):agent.adopt(done['jobId'],self.request,self.clip,'demo',True)

    def test_known_camera_conflict_cannot_disappear_after_note_only_patch_and_unavailable_check(self):
        guard_count=[0];calls=[]
        def camera(stages,*args):
            guard_count[0]+=1
            return {s['stageId']:({'metricAccuracyValidated':False,'routes':[{'routeIndex':0,'personId':'local-1',
                'status':'camera_contradiction','differencePixels':373,'approximateEndpoint':[210,160],
                'anchorFrame':s['facts']['routes'][0]['anchorFrame'],'lastFrame':max(s['facts']['routes'][0]['evidenceFrames'])}]}
                if guard_count[0]==1 else {'status':'geometry_unavailable','reason':'local_model_unavailable','routes':[]}) for s in stages}
        def execute(**kwargs):
            mode=kwargs['job']['callAnalysisMode'];calls.append(mode)
            if mode=='visual_facts':return facts_for(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')))
            if mode=='visual_audit_repair':
                stages=json.loads((kwargs['directory']/'context.json').read_text(encoding='utf-8'))['repairStages']
                row=empty_patch(stages[0]['stageId']);r=stages[0]['facts']['routes'][0]
                row['routes']=[{'routeIndex':0,'points':r['points'],'cameraReference':r['cameraReference'],'note':'仅改描述没有修复几何'}]
                return {'stages':[row]}
            return approved(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')))
        with patch('tactics_camera_guard.CameraGuard.review',side_effect=camera):
            agent=self.agent(execute);done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(calls,['visual_facts','visual_audit','visual_audit_repair','visual_audit'])
        self.assertEqual(done['status'],'partial');self.assertFalse(done['visualAudit']['allApproved'])
        report=done['visualAudit']['stages']['stage-1']
        self.assertEqual(report['acceptedRoutes'],1)
        known=next(r for r in report['cameraGeometry']['routes'] if r['routeIndex']==0)
        self.assertEqual(known['status'],'camera_contradiction')
        self.assertEqual(known['currentComparison'],'geometry_unavailable')

    def test_real_run7_audit_report_is_preserved_when_safe_facts_have_no_action(self):
        import threading,time
        fixture=json.loads((Path(__file__).parent/'test_fixtures/tactics-run7-all-routes-unverified.json').read_text(encoding='utf-8'))
        stages=deepcopy(fixture['stages']);raw_before=[deepcopy(s['facts']) for s in stages]
        agent=self.agent(lambda **kwargs:deepcopy(fixture['audit']))
        job={'jobId':'real-run7-fixture','clip':self.clip,'stages':[], 'runCount':1,'_modelCallsThisRun':3,
             'progress':{'completed':0},'cancel':threading.Event(),'deadline':time.monotonic()+390,
             'document':self.request['document'],'request':self.request}
        root=agent.folder/job['jobId'];root.mkdir()
        for s in stages:
            (root/s['stageId']).mkdir()
            for image in s['pack']['images']:
                data=b'fixture transport only; original facts and audit preserved'
                (root/s['stageId']/f"source-frame-{image['frame']:06d}.jpg").write_bytes(data)
                image['sourceImageSha256']=hashlib.sha256(data).hexdigest()
            job['stages'].append({'stageId':s['stageId'],'status':'awaiting_audit','_facts':s['facts'],'_factsPack':s['pack']})
        unavailable={s['stageId']:{'status':'geometry_unavailable','routes':[]} for s in stages}
        with patch('tactics_camera_guard.CameraGuard.review',return_value=unavailable),patch.object(agent,'_persist'),patch.object(agent,'_state'),patch.object(agent,'_tactics_run') as native:
            agent._audit_completed(job)
        self.assertEqual([s['_facts'] for s in job['stages']],raw_before)
        self.assertEqual(job['_modelCallsThisRun'],4,'the real failure still has exactly two calls available for patch and re-audit')
        self.assertTrue(job['auditNeedsRepair']);self.assertNotIn('candidate',job)
        self.assertEqual(job['progress']['completed'],1)
        self.assertEqual(job['stages'][0]['status'],'awaiting_audit');self.assertNotIn('_output',job['stages'][0])
        self.assertEqual(job['stages'][0]['failure']['code'],'no_action_content')
        self.assertEqual(job['stages'][1]['status'],'ready')
        native.assert_called_once()
        self.assertFalse(any(a['type']=='route' for p in native.call_args.kwargs['candidate']['phases'] for a in p['annotations']))
        for stage in job['stages']:self.assertTrue(stage['visualAudit']['repairNeeds'])
        self.assertEqual(sum(r['acceptedBall'] for r in job['visualAudit']['stages'].values()),7)

    def test_default_generation_requires_original_image_audit_before_publish(self):
        calls=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            self.assertEqual((kwargs['directory']/'prompt.txt').read_text(encoding='utf-8'),kwargs['prompt'])
            calls.append(value)
            if isinstance(value,dict):return facts_for(value)
            self.assertNotIn('candidate',kwargs['job'])
            self.assertLessEqual(kwargs['job']['callTimeout'],210)
            metadata=[frame for item in value for frame in item['pack']['images']]
            for image,frame in zip(kwargs['images'],metadata):
                self.assertTrue(image.name.startswith('source-frame-'))
                self.assertEqual(hashlib.sha256(image.read_bytes()).hexdigest(),frame['sourceImageSha256'])
            return approved(value)
        agent=self.agent(execute);done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(len(calls),2)
        self.assertTrue(done['visualAudit']['allApproved'])
        self.assertEqual(done['progress']['modelCallCount'],2)
        self.assertEqual(done['progress']['modelCallLimit'],6)
        self.assertEqual(done['progress']['budgetSeconds'],960)

    def test_audit_transport_retries_identical_original_evidence_without_regenerating_facts(self):
        calls=[];audit_inputs=[];directories=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            calls.append(kwargs['job']['callAnalysisMode'])
            if isinstance(value,dict):return facts_for(value)
            self.assertNotIn('candidate',kwargs['job']);self.assertTrue(kwargs['job']['auditPending'])
            audit_inputs.append((value,kwargs['prompt'],kwargs['schema'].read_text(encoding='utf-8'),
                                 [hashlib.sha256(p.read_bytes()).hexdigest() for p in kwargs['images']]))
            directories.append(kwargs['directory'])
            if len(audit_inputs)==1:raise AgentFailure('transport','stream disconnected: server overloaded')
            return approved(value)
        agent=self.agent(execute);done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done.get('failure'))
        self.assertEqual(calls,['visual_facts','visual_audit','visual_audit'])
        self.assertEqual(audit_inputs[0],audit_inputs[1])
        self.assertNotEqual(directories[0],directories[1])
        failure=json.loads((directories[0]/'failure.json').read_text(encoding='utf-8'))
        self.assertEqual(failure['code'],'transport')
        self.assertEqual(done['progress']['auditTransportRetries'],1)
        self.assertEqual(done['progress']['modelCallCount'],3)
        self.assertTrue(done['visualAudit']['allApproved'])

    def test_audit_transport_retry_is_bounded_cancelable_and_never_publishes_unaudited(self):
        import time
        for boundary in ('persistent_transport','call_limit','deadline','cancel','nonretryable','image_changed'):
            with self.subTest(boundary=boundary):
                calls=[];audit_calls=[]
                def execute(**kwargs):
                    value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
                    if isinstance(value,dict):return facts_for(value)
                    audit_calls.append(1);job=kwargs['job']
                    if boundary=='call_limit':job['_modelCallsThisRun']=6
                    if boundary=='deadline':job['deadline']=time.monotonic()-1
                    if boundary=='cancel':job['cancel'].set();job['status']='cancelled'
                    if boundary=='image_changed':kwargs['images'][0].write_bytes(b'changed between audit attempts')
                    raise AgentFailure('authentication_or_quota' if boundary=='nonretryable' else 'transport',
                                       'fixture unavailable',boundary!='nonretryable')
                agent=TacticsAgent(self.folder/boundary,self.tactics,codex_path=self.node,execute=execute)
                self.addCleanup(agent.close)
                done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
                self.assertEqual(len(audit_calls),2 if boundary=='persistent_transport' else 1)
                self.assertEqual(sum(isinstance(v,dict) for v in calls),1)
                self.assertNotIn('candidate',done);self.assertTrue(done['auditPending'])
                self.assertLessEqual(done['progress']['modelCallCount'],6)
                if boundary=='deadline':self.assertEqual(done['failure']['code'],'budget_exhausted')
                if boundary=='cancel':self.assertEqual(done['status'],'cancelled')
                if boundary=='image_changed':self.assertEqual(done['failure']['code'],'audit_evidence')
                with self.assertRaises(ValueError):agent.adopt(done['jobId'],self.request,self.clip,'demo',True)

    def test_missing_audit_retains_generated_facts_and_retry_only_calls_audit(self):
        calls=[];fail=[True]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            if isinstance(value,dict):return facts_for(value)
            if fail[0]:raise AgentFailure('no_response','audit fixture no output')
            return approved(value)
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True);done=self.wait(agent,job)
        self.assertNotEqual(done['status'],'ready');self.assertNotIn('candidate',done)
        self.assertTrue(done['auditPending']);self.assertTrue(done['canRetry'])
        self.assertEqual(done['stages'][0]['status'],'ready')
        fail[0]=False
        restored=TacticsAgent(agent.folder,self.tactics,codex_path=self.node,execute=execute);self.addCleanup(restored.close)
        self.assertTrue(restored.get(job['jobId'],self.clip,'demo',True)['auditPending'])
        done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(sum(isinstance(call,dict) for call in calls),1)
        self.assertEqual(len(calls),3)

    def test_semantic_raw_facts_wait_for_audit_without_candidate_or_rewrite_after_restart(self):
        calls=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            if isinstance(value,dict):
                facts=facts_for(value);facts['people'][0]['continuity']='uncertain'
                return facts
            stage=kwargs['job']['stages'][0]
            self.assertEqual(stage['status'],'awaiting_audit');self.assertNotIn('_output',stage)
            self.assertNotIn('candidate',kwargs['job'])
            raise AgentFailure('no_response','independent audit unavailable')
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(len(calls),2)
        self.assertEqual(done['stages'][0]['status'],'awaiting_audit')
        self.assertTrue(done['auditPending']);self.assertNotIn('candidate',done)
        self.assertNotIn('_output',agent.jobs[job['jobId']]['stages'][0])
        with self.assertRaises(ValueError):agent.adopt(job['jobId'],self.request,self.clip,'demo',True)
        restored=TacticsAgent(agent.folder,self.tactics,codex_path=self.node,execute=execute);self.addCleanup(restored.close)
        restored.get(job['jobId'],self.clip,'demo',True)
        done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(len(calls),3)
        self.assertEqual(sum(isinstance(value,dict) for value in calls),1)
        self.assertEqual(done['stages'][0]['attempts'],1)
        self.assertNotIn('candidate',done)

    def test_invalid_source_facts_cannot_bypass_generation_validation_into_audit(self):
        calls=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            self.assertIsInstance(value,dict,'invalid coordinates cannot be independently approved')
            facts=facts_for(value);facts['people'][0]['continuity']='uncertain'
            facts['people'][0]['observations'][0]['foot'][0]=value['width']+1
            return facts
        agent=self.agent(execute);done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(len(calls),2)
        self.assertEqual(done['status'],'failed');self.assertNotIn('candidate',done)
        self.assertNotEqual(done['stages'][0]['status'],'awaiting_audit')

    def test_real_run5_raw_semantics_can_preserve_two_independently_approved_routes(self):
        from tactics_visual_facts import compile_visual_facts,VisualFactsFailure
        from tactics_visual_audit import apply_visual_audit_batch
        stages=json.loads((Path(__file__).parent/'test_fixtures/tactics-run5-semantic-raw.json').read_text(encoding='utf-8'))['stages']
        before=deepcopy(stages);audit=approved(stages)
        for item,review in zip(stages,audit['stages']):
            with self.assertRaises(VisualFactsFailure) as caught:compile_visual_facts(item['facts'],item['pack'])
            self.assertTrue(TacticsAgent._semantic_audit_eligible(item['facts'],item['pack'],caught.exception))
            selected=next((i for i,r in enumerate(item['facts']['routes']) if r['personId']=='dal_inside'),0)
            for i,row in enumerate(review['audit']['routes']):
                if i!=selected:row.update(verdict='reject',identity='different',reason='该路线身份连续性未获原图支持')
        verified=apply_visual_audit_batch(stages,audit);routes=0
        for item in stages:
            safe=verified[item['stageId']]
            candidate,_=compile_visual_facts(safe['facts'],item['pack'],verified_routes=safe['report']['verifiedRoutes'])
            routes+=sum(a['type']=='route' for p in candidate['phases'] for a in p['annotations'])
            self.assertFalse(safe['report']['allApproved']);self.assertTrue(safe['report']['repairNeeds'])
            self.assertTrue(safe['report']['exceptionItems'])
        self.assertEqual(routes,2)
        headband=next(p for p in verified['stage-2']['facts']['people'] if p['id']=='dark_headband')
        self.assertEqual(headband['action'],'unknown')
        self.assertTrue(any(n['personId']=='dark_headband' and n['code']=='proposed_motion_unverified'
                            for n in verified['stage-2']['report']['repairNeeds']))
        self.assertEqual(stages,before,'raw model facts remain original evidence')

    def test_semantic_pending_runs_independent_audit_then_native_partial_publication(self):
        calls=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            if isinstance(value,dict):
                facts=facts_for(value);facts['people'][0]['continuity']='uncertain'
                facts['people'][2]['action']='move'
                return facts
            self.assertEqual(kwargs['job']['stages'][0]['status'],'awaiting_audit')
            self.assertNotIn('candidate',kwargs['job']);kwargs['job']['_modelCallsThisRun']=6
            return approved(value)
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'partial',{k:done.get(k) for k in ('status','failure','message')})
        self.assertEqual(len(calls),2);self.assertEqual(done['stages'][0]['attempts'],1)
        self.assertEqual(sum(a['type']=='route' for p in done['candidate']['phases'] for a in p['annotations']),2)
        self.assertFalse(done['visualAudit']['allApproved'])
        raw=agent.jobs[job['jobId']]['stages'][0]['_facts']
        self.assertEqual(raw['people'][0]['continuity'],'uncertain');self.assertEqual(raw['people'][2]['action'],'move')
        document=agent.adopt(job['jobId'],self.request,self.clip,'demo',True)['document']
        self.tactics.save(document,self.clip,'demo',True,'workspace',0)
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['document']['agentRuns'][-1]['visualAudit'],done['visualAudit'])

    def test_two_generated_stages_share_one_batch_audit_with_exact_source_order(self):
        calls=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            if isinstance(value,dict):
                facts=facts_for(value);facts['people'][0]['continuity']='uncertain'
                return facts
            self.assertEqual(kwargs['job']['progress']['completed'],0)
            self.assertEqual([row['stageId'] for row in value],['stage-1','stage-2'])
            self.assertEqual([image.parent.name for image in kwargs['images']],
                             [row['stageId'] for row in value for _ in row['pack']['images']])
            return approved(value)
        stages=[dict(stageId=f'stage-{i+1}',startFrame=a,endFrameExclusive=b,status='queued',message='waiting',attempts=0)
                for i,(a,b) in enumerate([(0,30),(30,61)])]
        agent=self.agent(execute)
        completed_at_publication=[];publish=agent._publish_completed
        def recorded_publish(job,*args,**kwargs):
            if job.get('visualAudit'):completed_at_publication.append(job['progress']['completed'])
            return publish(job,*args,**kwargs)
        agent._publish_completed=recorded_publish
        with patch('tactics_agent.analysis_stages',return_value=stages):
            job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(len(calls),3)
        self.assertEqual([s['attempts'] for s in done['stages']],[1,1])
        self.assertEqual(done['progress']['modelCallCount'],3)
        self.assertTrue(completed_at_publication)
        self.assertEqual(set(completed_at_publication),{2})

    def test_two_stage_structured_audit_survives_adopt_save_reload_with_source_binding(self):
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            audit=approved(value)
            audit['stages'][1]['audit']['ball'][0].update(verdict='reject',control='other_person',reason='第二阶段球在另一人手中')
            kwargs['job']['_modelCallsThisRun']=6
            return audit
        stages=[dict(stageId=f'stage-{i+1}',startFrame=a,endFrameExclusive=b,status='queued',message='waiting',attempts=0)
                for i,(a,b) in enumerate([(0,30),(30,61)])]
        agent=self.agent(execute)
        with patch('tactics_agent.analysis_stages',return_value=stages):
            job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'partial')
        document=agent.adopt(job['jobId'],self.request,self.clip,'demo',True)['document']
        run=next(r for r in document['agentRuns'] if r['jobId']==job['jobId'])
        self.assertEqual(run['visualAudit'],done['visualAudit'])
        self.assertFalse(run['visualAudit']['allApproved'])
        self.assertEqual(set(run['visualAudit']['stages']),{'stage-1','stage-2'})
        proof=run['visualAuditSource'];review=self.request['document']['review']
        self.assertEqual(proof['frameMappingDigest'],self.request['document']['playDefinition']['sourceBinding']['frameMappingDigest'])
        self.assertEqual(proof['width'],review['width']);self.assertEqual(proof['height'],review['height'])
        self.assertEqual(proof['videoSha256'],review['videoSha256'])
        self.assertEqual(proof['context'],{'variant':'demo','qa':True,'kind':'workspace'})
        self.assertEqual(proof['jobId'],job['jobId'])
        self.assertNotIn('reviewDigest',proof)
        self.tactics.save(document,self.clip,'demo',True,'workspace',0)
        saved=self.tactics.load(self.clip,'demo',True,'workspace')['document']['agentRuns'][-1]
        self.assertEqual(saved['visualAudit'],run['visualAudit']);self.assertEqual(saved['visualAuditSource'],proof)
        run['visualAudit']['stages'].clear()
        self.assertEqual(set(agent.get(job['jobId'],self.clip,'demo',True)['visualAudit']['stages']),{'stage-1','stage-2'})

    def test_adopt_rejects_transplanted_or_changed_audit_source_and_report(self):
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            return facts_for(value) if isinstance(value,dict) else approved(value)
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        self.assertEqual(self.wait(agent,job)['status'],'ready')
        run=agent.jobs[job['jobId']]['previewDocument']['agentRuns'][-1];original=deepcopy(run)
        for key,value in [('jobId','another-job'),('videoSha256','another-video'),('width',7),('frameMappingDigest','different-pts')]:
            with self.subTest(key=key):
                run['visualAuditSource'][key]=value
                with self.assertRaises(ValueError):agent.adopt(job['jobId'],self.request,self.clip,'demo',True)
                run.clear();run.update(deepcopy(original))
        run['visualAudit']['allApproved']=False
        with self.assertRaises(ValueError):agent.adopt(job['jobId'],self.request,self.clip,'demo',True)
        run.clear();run.update(deepcopy(original))
        changed=deepcopy(self.clip);changed['width']+=1
        with self.assertRaises(ValueError):agent.adopt(job['jobId'],self.request,changed,'demo',True)
        self.assertEqual(agent.adopt(job['jobId'],self.request,self.clip,'demo',True)['document']['agentRuns'][-1],original)
        # Only an older job with neither field is upgraded from its genuine
        # audit; incomplete/mismatched proofs above are never silently repaired.
        run.pop('visualAudit');run.pop('visualAuditSource')
        self.assertEqual(agent.adopt(job['jobId'],self.request,self.clip,'demo',True)['document']['agentRuns'][-1],original)
        agent.jobs[job['jobId']]['auditPending']=True
        with self.assertRaises(ValueError):agent.adopt(job['jobId'],self.request,self.clip,'demo',True)

    def test_audit_checkpoint_failure_recovers_same_signed_source_without_any_model_call(self):
        from tactics_job_storage import StorageFailure
        fail=[False];calls=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            if isinstance(value,dict):
                kwargs['job']['_modelCallsThisRun']=5
                return facts_for(value)
            fail[0]=True;return approved(value)
        agent=self.agent(execute);persist=agent._persist
        def failed_checkpoint(job):
            if fail[0]:raise StorageFailure('audit checkpoint disk failure')
            return persist(job)
        agent._persist=failed_checkpoint
        job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True);done=self.wait(agent,job)
        self.assertEqual(done['failure']['code'],'storage');self.assertEqual(len(calls),2)
        self.assertTrue(agent.jobs[job['jobId']]['_auditAttempt']['directory'].endswith('-call-6'))
        restored=TacticsAgent(agent.folder,self.tactics,codex_path=self.node,execute=lambda **_:self.fail('durable audit must not call a model'))
        self.addCleanup(restored.close)
        restored.get(job['jobId'],self.clip,'demo',True)
        done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(done['status'],'ready',done)
        self.assertTrue(done['visualAudit']['allApproved'])
        self.assertTrue(done['progress']['auditRecoveredFromCheckpoint'])
        self.assertEqual(done['progress']['modelCallCount'],0)

    def test_received_patch_restart_reuses_same_result_after_storage_or_native_failure(self):
        from tactics_job_storage import StorageFailure
        for failure_kind in ('storage','native'):
            with self.subTest(failure_kind=failure_kind):
                received=[False];counts={'generation':0,'audit':0,'patch':0}
                def execute(**kwargs):
                    value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
                    if isinstance(value,dict) and 'repairStages' in value:
                        counts['patch']+=1;row=value['repairStages'][0];route=row['facts']['routes'][0]
                        points=deepcopy(route['points']);points[-1][0]+=5;change=empty_patch(row['stageId'])
                        change['routes']=[dict(routeIndex=0,points=points,cameraReference='same_view',note='更正终点')]
                        received[0]=True;return {'stages':[change]}
                    if isinstance(value,dict):counts['generation']+=1;return facts_for(value)
                    counts['audit']+=1;audit=approved(value)
                    if counts['audit']==1:
                        audit['stages'][0]['audit']['routes'][0].update(verdict='reject',geometry='misaligned',reason='终点错位')
                    return audit
                agent=self.agent(execute);persist=agent._persist;native=agent._tactics_run
                def failed_persist(job):
                    if received[0] and failure_kind=='storage':raise StorageFailure('patch checkpoint failed')
                    return persist(job)
                def failed_native(job,operation,**payload):
                    if received[0] and failure_kind=='native':raise AgentFailure('validation_timeout','native fixture timeout')
                    return native(job,operation,**payload)
                agent._persist=failed_persist;agent._tactics_run=failed_native
                job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True);done=self.wait(agent,job)
                self.assertNotEqual(done['status'],'ready');self.assertEqual(counts,{'generation':1,'audit':1 if failure_kind=='storage' else 2,'patch':1})
                recovered_calls=[]
                def only_reaudit(**kwargs):
                    value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
                    self.assertIsInstance(value,list,'received patch and generation must not call the model twice')
                    recovered_calls.append(value);return approved(value)
                restored=TacticsAgent(agent.folder,self.tactics,codex_path=self.node,execute=only_reaudit);self.addCleanup(restored.close)
                restored.get(job['jobId'],self.clip,'demo',True)
                done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
                self.assertEqual(done['status'],'ready',{key:done.get(key) for key in ('status','failure','auditRepairFailure','progress')})
                if failure_kind=='storage':
                    self.assertTrue(done['progress']['patchRecoveredFromCheckpoint'])
                    self.assertEqual(len(recovered_calls),1)
                else:
                    self.assertEqual(len(recovered_calls),0)
                    self.assertEqual(restored.jobs[job['jobId']]['_receivedAudit']['signature'],done['visualAudit']['signature'])

    def test_patch_recovery_rejects_invalid_path_context_and_schema_and_honors_cancel(self):
        import threading
        from tactics_facts_patch import facts_patch_schema
        from tactics_job_storage import StorageFailure, atomic_job_json
        from test_tactics_visual_facts import fixture
        pack,facts=fixture();report={'repairNeeds':[{'itemType':'routes','itemIndex':0,'personId':'white','evidenceFrames':[0,5,9],'code':'route_pending'}]}
        def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()
        agent=self.agent(lambda **_:self.fail('invalid recovery must not call a model'));agent._remaining=lambda _:720
        for change in ('path','context','schema','schema_reference','cancel'):
            with self.subTest(change=change):
                job={'jobId':'recovery-'+change,'base':{'documentDigest':'bound-draft'},'auditNeedsRepair':True,'runCount':2,
                     '_modelCallsThisRun':0,'progress':{},'cancel':threading.Event(),
                     'stages':[{'stageId':'stage-1','status':'ready','_facts':facts,'_factsPack':pack,'visualAudit':report}]}
                rows=[dict(stageId='stage-1',pack=pack,facts=facts,repairNeeds=report['repairNeeds'])]
                schema=facts_patch_schema(rows);schema_hash=digest(schema)
                context={'jobId':job['jobId'],'base':job['base'],'repairStages':rows,'oldAudit':{'stage-1':report},'schemaSha256':schema_hash}
                folder=agent.folder/job['jobId']/'audit-repair-run-1';folder.mkdir(parents=True)
                atomic_job_json(folder/'schema.json',schema);atomic_job_json(folder/'context.json',context)
                atomic_job_json(folder/'rawpatch.json',{'stages':[empty_patch()]})
                job['_patchAttempt']={'directory':folder.name,'signature':digest(context),'schemaSha256':schema_hash}
                if change=='path':job['_patchAttempt']['directory']='../other-job'
                if change=='context':atomic_job_json(folder/'context.json',{**context,'base':{'documentDigest':'other-draft'}})
                if change=='schema':atomic_job_json(folder/'schema.json',{'type':'object'})
                if change=='schema_reference':job['_patchAttempt']['schemaSha256']='0'*64
                if change=='cancel':
                    job['cancel'].set();agent._repair_audited(job)
                    self.assertNotIn('patchRecoveredFromCheckpoint',job['progress'])
                else:
                    with self.assertRaises(StorageFailure):agent._repair_audited(job)

    def test_two_stage_compact_patches_and_reaudit_fit_exact_five_call_contract(self):
        audits=[0];calls=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            if isinstance(value,dict) and 'repairStages' in value:
                rows=[]
                for row in value['repairStages']:
                    route=row['facts']['routes'][0];points=deepcopy(route['points']);points[-1][0]+=5
                    patch=empty_patch(row['stageId']);patch['routes']=[dict(routeIndex=0,points=points,cameraReference='same_view',note='修复偏移')]
                    rows.append(patch)
                result={'stages':rows}
                self.assertLess(len(json.dumps(result)),1500)
                return result
            if isinstance(value,dict):return facts_for(value)
            audits[0]+=1;audit=approved(value)
            if audits[0]==1:
                for row in audit['stages']:row['audit']['routes'][0].update(verdict='reject',geometry='misaligned',reason='终点偏移')
            return audit
        stages=[dict(stageId=f'stage-{i+1}',startFrame=a,endFrameExclusive=b,status='queued',message='waiting',attempts=0)
                for i,(a,b) in enumerate([(0,30),(30,61)])]
        agent=self.agent(execute)
        with patch('tactics_agent.analysis_stages',return_value=stages):
            job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'ready',done);self.assertEqual(done['progress']['modelCallCount'],5)
        self.assertEqual([stage['attempts'] for stage in done['stages']],[1,1])
        self.assertEqual(len(calls),5);self.assertEqual(audits[0],2)

    def test_rejected_identity_keeps_accepted_route_and_raw_facts_without_false_complete(self):
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            audit=approved(value);audit['stages'][0]['audit']['routes'][0].update(verdict='reject',identity='different',reason='号码4变为1，球转移不是同人运动')
            # No remaining correction budget; keep the explicitly audited subset.
            kwargs['job']['_modelCallsThisRun']=5
            return audit
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True);done=self.wait(agent,job)
        self.assertEqual(done['status'],'partial',done)
        self.assertFalse(done['visualAudit']['allApproved']);self.assertTrue(done['auditNeedsRepair'])
        self.assertEqual(done['completionKind'],'manual_review')
        self.assertEqual(done['stages'][0]['visualAudit']['acceptedRoutes'],1)
        self.assertEqual(len(agent.jobs[job['jobId']]['stages'][0]['_facts']['routes']),2)
        self.assertTrue(done['canRetry'])

    def test_targeted_correction_is_independently_reaudited_without_regenerating_stage(self):
        calls=[];audits=[0]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));calls.append(value)
            if isinstance(value,dict) and 'repairStages' in value:
                self.assertLessEqual(kwargs['job']['callTimeout'],90)
                self.assertEqual((kwargs['directory']/'prompt.txt').read_text(encoding='utf-8'),kwargs['prompt'])
                rows=[]
                for row in value['repairStages']:
                    self.assertNotIn('"facts"',kwargs['prompt'])
                    patch=empty_patch(row['stageId']);route=row['facts']['routes'][0];points=deepcopy(route['points']);points[-1][0]+=5
                    patch['routes']=[{'routeIndex':0,'points':points,'cameraReference':route['cameraReference'],'note':'按原图更正终点'}]
                    rows.append(patch)
                return {'stages':rows}
            if isinstance(value,dict):return facts_for(value)
            audits[0]+=1;audit=approved(value)
            if audits[0]==1:
                audit['stages'][0]['audit']['routes'][0].update(verdict='reject',geometry='misaligned',reason='参考帧终点错位')
                # Two earlier generation/structure attempts have already spent
                # slots; the final two slots must cover patch AND re-audit.
                kwargs['job']['_modelCallsThisRun']=4
            return audit
        agent=self.agent(execute);done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(done['progress']['modelCallCount'],6)
        self.assertEqual(done['progress']['auditRepairStatus'],'verified')
        self.assertEqual(sum(isinstance(value,dict) and 'images' in value for value in calls),1)
        self.assertEqual(audits[0],2)

    def test_ball_exception_keeps_exact_frame_reason_and_original_action_after_adopt_save_reload(self):
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            audit=approved(value)
            audit['stages'][0]['audit']['ball'][0].update(verdict='reject',control='other_person',reason='球在另一位白衣4号手中')
            kwargs['job']['_modelCallsThisRun']=5
            return audit
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True);done=self.wait(agent,job)
        self.assertEqual(done['status'],'partial',done)
        document=agent.adopt(job['jobId'],self.request,self.clip,'demo',True)['document']
        self.tactics.save(document,self.clip,'demo',True,'workspace',0)
        restored=self.tactics.load(self.clip,'demo',True,'workspace')
        text='\n'.join(restored['document']['agentRuns'][-1]['issues'])
        for expected in ('stage-1 ball #0 local-1','frames=[0]','originalAction=move','球在另一位白衣4号手中'):
            self.assertIn(expected,text)

    def test_audit_repair_can_only_correct_target_observations_not_accepted_evidence(self):
        from tactics_facts_repair import check_audited_facts_repair
        from tactics_visual_facts import VisualFactsFailure
        from test_tactics_visual_facts import fixture
        from test_tactics_visual_audit import accepted
        from tactics_visual_audit import apply_visual_audit
        pack,facts=fixture();audit=accepted();audit['routes'][0].update(verdict='reject',identity='different')
        _,report=apply_visual_audit(facts,audit,pack)
        corrected=deepcopy(facts);corrected['people'][0]['observations'][-1]['foot'][0]+=10
        corrected['routes'][0]['points'][-1][0]+=10
        check_audited_facts_repair(facts,corrected,report,pack)
        for field in ('accepted_ball_foot','delete_route','downgrade_action','change_other_person','shorten_scope'):
            bad=deepcopy(corrected)
            if field=='accepted_ball_foot':bad['people'][0]['observations'][0]['foot'][0]+=10
            if field=='delete_route':bad['routes']=[]
            if field=='downgrade_action':bad['people'][0]['action']='unknown'
            if field=='change_other_person':bad['people'][1]['observations'][0]['foot'][0]+=10
            if field=='shorten_scope':bad['routes'][0]['evidenceFrames']=bad['routes'][0]['evidenceFrames'][:2]
            with self.subTest(field=field),self.assertRaises(VisualFactsFailure):check_audited_facts_repair(facts,bad,report,pack)

    def test_person_negative_only_releases_exact_bad_frame_not_other_real_observations(self):
        from tactics_facts_repair import check_audited_facts_repair
        from tactics_visual_facts import VisualFactsFailure
        from test_tactics_visual_facts import fixture
        pack,facts=fixture()
        person=facts['people'][1]
        person['observations']=[{'frame':frame,'foot':[500,500]} for frame in [0,5,9]]
        report={'repairNeeds':[{'personId':person['id'],'itemType':'people','itemIndex':1,'code':'bench','evidenceFrames':[0]}]}
        corrected=deepcopy(facts);corrected['people'][1]['observations']=corrected['people'][1]['observations'][1:]
        corrected['static']=[item for item in corrected['static'] if item['personId']!=person['id'] or item['frame']!=0]
        check_audited_facts_repair(facts,corrected,report,pack)
        bad=deepcopy(corrected);bad['people']=bad['people'][:1]
        with self.assertRaises(VisualFactsFailure):check_audited_facts_repair(facts,bad,report,pack)

    def test_clear_missed_person_addition_is_automatic_and_reaudited_with_old_people_frozen(self):
        audits=[0]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict) and 'repairStages' in value:
                row=value['repairStages'][0];frame=row['pack']['images'][0]['frame'];patch=empty_patch(row['stageId'])
                patch['peopleAdded']=[{'id':'new-visible','role':'defender','action':'hold','continuity':'observed',
                                      'note':'审核指出的场上漏人','observations':[{'frame':frame,'foot':[450,350]}]}]
                return {'stages':[patch]}
            if isinstance(value,dict):return facts_for(value)
            audits[0]+=1;audit=approved(value)
            if audits[0]==1:
                audit['stages'][0]['audit']['frameIssues']=[{'frame':value[0]['pack']['images'][0]['frame'],
                    'code':'missed_on_court_player','reason':'右侧另有一名清晰防守者','foot':[450,350]}]
            return audit
        agent=self.agent(execute);done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(done['stages'][0]['factsReport']['observedPeople'],4)
        self.assertEqual(done['progress']['modelCallCount'],4)
        self.assertEqual(audits[0],2)

    def test_unclear_frame_does_not_authorize_inventing_a_new_person(self):
        from tactics_facts_repair import check_audited_facts_repair
        from tactics_visual_facts import VisualFactsFailure
        from test_tactics_visual_facts import fixture
        pack,facts=fixture();changed=deepcopy(facts)
        added=deepcopy(changed['people'][1]);added['id']='unsupported';changed['people'].append(added)
        report={'repairNeeds':[{'personId':None,'itemType':'frames','itemIndex':0,'code':'unclear_participants',
                               'evidenceFrames':[0],'allowNewLocalPerson':False}]}
        with self.assertRaises(VisualFactsFailure):check_audited_facts_repair(facts,changed,report,pack)


if __name__=='__main__':unittest.main()
