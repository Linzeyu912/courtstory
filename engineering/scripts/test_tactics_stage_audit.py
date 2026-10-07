"""Bounded stage audits retain original evidence and never publish half an audit."""
from copy import deepcopy
import hashlib
import json
import time
import unittest
from unittest.mock import patch

from tactics_agent import TacticsAgent, AgentFailure
from tactics_job_storage import read_job_state, StorageFailure
import test_tactics_agent as legacy_fixture
from test_tactics_facts_integration import facts_for
from test_tactics_audit_integration import approved
from test_tactics_facts_patch import empty_patch


class StageAuditTests(unittest.TestCase):
    setUp=legacy_fixture.AgentTests.setUp
    wait=legacy_fixture.AgentTests.wait

    def agent(self, execute, folder=None):
        value=TacticsAgent(folder or self.folder/'stage-audit',self.tactics,codex_path=self.node,execute=execute)
        self.addCleanup(value.close)
        return value

    def create(self,agent):
        stages=[dict(stageId=f'stage-{n}',startFrame=start,endFrameExclusive=end,status='queued',message='等待分析',attempts=0)
                for n,start,end in [(1,0,30),(2,30,61)]]
        with patch('tactics_agent.analysis_stages',return_value=stages):
            return agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)

    def test_first_stage_is_checkpointed_and_restart_only_audits_second_without_new_facts(self):
        calls=[];fail=[True]
        def execute(**kwargs):
            mode=kwargs['job']['callAnalysisMode'];value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if mode=='visual_facts':
                calls.append(('facts',value['analysisRange']['startFrame']));return facts_for(value)
            ids=[s['stageId'] for s in value];calls.append(('audit',ids))
            if fail[0] and 'stage-2' in ids:raise AgentFailure('no_response','second stage fixture unavailable')
            self.assertEqual(len(value),1)
            self.assertEqual(len(kwargs['images']),len(value[0]['pack']['images']))
            for image,meta in zip(kwargs['images'],value[0]['pack']['images']):
                self.assertEqual(hashlib.sha256(image.read_bytes()).hexdigest(),meta['sourceImageSha256'])
            return approved(value)
        agent=self.agent(execute);job=self.create(agent);done=self.wait(agent,job)
        self.assertEqual(calls,[('facts',0),('facts',30),('audit',['stage-1']),('audit',['stage-2'])])
        self.assertNotIn('candidate',done);self.assertTrue(done['auditPending'])
        checkpoint=read_job_state(agent.folder/job['jobId'])['stages'][0]['_auditCheckpoint']
        self.assertTrue(checkpoint['complete']);self.assertIn('schemaSha256',checkpoint)
        fail[0]=False
        restored=self.agent(execute,agent.folder);restored.get(job['jobId'],self.clip,'demo',True)
        done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(done['status'],'ready',done.get('failure'))
        self.assertEqual(calls[-1],('audit',['stage-2']));self.assertEqual(len(calls),5)
        self.assertEqual(done['stages'][0]['attempts'],1);self.assertEqual(done['stages'][1]['attempts'],1)

    def test_changed_pack_schema_or_checkpoint_result_never_reuses_cached_authority(self):
        for change in ('pack','schema','rawaudit'):
            with self.subTest(change=change):
                audits=[];fail=[True]
                def execute(**kwargs):
                    value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
                    if isinstance(value,dict):return facts_for(value)
                    ids=[s['stageId'] for s in value];audits.append(ids)
                    if fail[0] and 'stage-2' in ids:raise AgentFailure('no_response','fixture stopped')
                    return approved(value)
                agent=self.agent(execute,self.folder/change);job=self.create(agent);self.wait(agent,job)
                live=agent.jobs[job['jobId']];checkpoint=live['stages'][0].get('_auditCheckpoint')
                self.assertIsNotNone(checkpoint)
                if change=='pack':live['stages'][0]['_factsPack']['goal']='source input changed'
                else:
                    path=agent.folder/job['jobId']/checkpoint['directory']/('schema.json' if change=='schema' else 'rawaudit.json')
                    path.write_text('{}',encoding='utf-8')
                agent._persist(live);fail[0]=False
                restored=self.agent(execute,agent.folder);restored.get(job['jobId'],self.clip,'demo',True)
                done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
                if change=='pack':
                    self.assertEqual(audits[-2:],[['stage-1'],['stage-2']]);self.assertEqual(done['status'],'ready')
                else:
                    self.assertNotEqual(done['status'],'ready');self.assertNotIn('candidate',done)
                    self.assertEqual(done['failure']['code'],'storage');self.assertEqual(len(audits),2)

    def test_changed_source_image_is_rejected_before_cached_audit_can_publish(self):
        fail=[True];audits=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            ids=[s['stageId'] for s in value];audits.append(ids)
            if fail[0] and 'stage-2' in ids:raise AgentFailure('no_response','fixture stopped')
            return approved(value)
        agent=self.agent(execute);job=self.create(agent);self.wait(agent,job)
        stage=agent.jobs[job['jobId']]['stages'][0];metadata=stage['_factsPack']['images'][0]
        (agent.folder/job['jobId']/'stage-1'/f"source-frame-{metadata['frame']:06d}.jpg").write_bytes(b'changed source image')
        fail[0]=False
        done=self.wait(agent,agent.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(done['failure']['code'],'audit_evidence');self.assertNotIn('candidate',done);self.assertEqual(len(audits),2)

    def test_received_whole_result_cannot_bypass_each_stage_checkpoint_after_native_failure(self):
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            return facts_for(value) if isinstance(value,dict) else approved(value)
        agent=self.agent(execute);native=agent._tactics_run;failed=[False]
        def fail_native(job,operation,**kwargs):
            if job.get('callAnalysisMode')=='visual_audit' and not failed[0]:
                failed[0]=True;raise AgentFailure('validation_timeout','whole native validation interrupted')
            return native(job,operation,**kwargs)
        agent._tactics_run=fail_native;job=self.create(agent);self.wait(agent,job);live=agent.jobs[job['jobId']]
        self.assertIn('_receivedAudit',live);self.assertTrue(live['auditPending'])
        checkpoint=live['stages'][0]['_auditCheckpoint'];directory=agent.folder/job['jobId']/checkpoint['directory']
        (directory/'schema.json').write_text('{}',encoding='utf-8')
        restored=self.agent(lambda **kwargs:self.fail('no new model is needed to reject corrupt evidence'),agent.folder)
        restored.get(job['jobId'],self.clip,'demo',True)
        done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(done.get('failure',{}).get('code'),'storage',done.get('message'))
        self.assertNotIn('candidate',done)

    def test_changed_source_binding_or_mapping_cannot_authorize_a_cached_or_new_audit(self):
        for change in ('video','pts','dimensions'):
            with self.subTest(change=change):
                fail=[True];audits=[]
                def execute(**kwargs):
                    value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
                    if isinstance(value,dict):return facts_for(value)
                    ids=[s['stageId'] for s in value];audits.append(ids)
                    if fail[0] and 'stage-2' in ids:raise AgentFailure('no_response','fixture stopped')
                    return approved(value)
                agent=self.agent(execute,self.folder/change);job=self.create(agent);self.wait(agent,job)
                pack=agent.jobs[job['jobId']]['stages'][0]['_factsPack']
                if change=='video':pack['binding']['videoSha256']='different-video'
                if change=='pts':pack['sourceFrameMapping'][0]['time']+=.01
                if change=='dimensions':pack['width']+=1
                agent._persist(agent.jobs[job['jobId']]);fail[0]=False
                done=self.wait(agent,agent.retry(job['jobId'],self.request,self.clip,'demo',True))
                self.assertEqual(done.get('failure',{}).get('code'),'audit_evidence',done.get('message'))
                self.assertNotIn('candidate',done);self.assertEqual(len(audits),2)

    def test_exact_probe_checkpoint_helper_preserves_raw_and_rejects_a_changed_prompt(self):
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            if any(s['stageId']=='stage-2' for s in value):raise AgentFailure('no_response','fixture stopped')
            return approved(value)
        agent=self.agent(execute);job=self.create(agent);self.wait(agent,job);live=agent.jobs[job['jobId']]
        stage=live['stages'][0];directory=agent.folder/job['jobId']/stage['_auditCheckpoint']['directory']
        item=json.loads((directory/'input.json').read_text(encoding='utf-8'))[0]
        raw=(directory/'rawaudit.json').read_bytes();audit=json.loads(raw)
        stage.pop('_auditCheckpoint')
        agent._checkpoint_stage_audit(live,item,directory,audit,{'kind':'readonly_probe','originalCall':'probe-1'})
        self.assertEqual((directory/'rawaudit.json').read_bytes(),raw)
        self.assertEqual(stage['_auditCheckpoint']['provenance']['originalCall'],'probe-1')
        self.assertNotIn('candidate',live);self.assertTrue(live['auditPending'])
        saved=deepcopy(stage['_auditCheckpoint']);(directory/'prompt.txt').write_text('changed prompt',encoding='utf-8')
        with self.assertRaises(StorageFailure):agent._checkpoint_stage_audit(live,item,directory,audit)
        self.assertEqual(stage['_auditCheckpoint'],saved)

    def test_legacy_completed_whole_audit_is_restored_before_overwriting_input_without_new_calls(self):
        from tactics_visual_audit import visual_audit_batch_schema
        from tactics_camera_guard import CameraGuard
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            raise AgentFailure('no_response','old whole completed fixture preparation')
        agent=self.agent(execute);job=self.create(agent);self.wait(agent,job);live=agent.jobs[job['jobId']]
        rows=[{'stageId':s['stageId'],'pack':s['_factsPack'],'facts':s['_facts']} for s in live['stages']]
        geometry=CameraGuard().review(rows,self.clip,agent.folder/job['jobId'],time.monotonic()+60,live['cancel'])
        for row in rows:row['cameraGeometry']=geometry[row['stageId']]
        directory=agent.folder/job['jobId']/'audit-run-1-call-3';directory.mkdir(exist_ok=True)
        for filename,value in [('input.json',rows),('schema.json',visual_audit_batch_schema(rows)),('rawaudit.json',approved(rows))]:
            (directory/filename).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
        original=(directory/'input.json').read_bytes()
        live['_auditAttempt']={'directory':directory.name,'signature':agent._audit_digest(rows)}
        live.pop('_receivedAudit',None);agent._persist(live)
        restored=self.agent(lambda **kwargs:self.fail('the completed whole audit must not call any model'),agent.folder)
        restored.get(job['jobId'],self.clip,'demo',True)
        done=self.wait(restored,restored.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(done['status'],'ready',done.get('message'));self.assertEqual(done['progress']['modelCallCount'],0)
        self.assertEqual(json.loads((directory/'input.json').read_text(encoding='utf-8')),json.loads(original))
        self.assertTrue(done['visualAudit']['allApproved'])

    def test_patch_reaudits_only_changed_stage_and_reuses_other_raw_checkpoint(self):
        calls=[];audits=[]
        def execute(**kwargs):
            mode=kwargs['job']['callAnalysisMode'];calls.append(mode)
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if mode=='visual_facts':return facts_for(value)
            if mode=='visual_audit_repair':
                context=json.loads((kwargs['directory']/'context.json').read_text(encoding='utf-8'))
                self.assertEqual([s['stageId'] for s in context['repairStages']],['stage-2'])
                row=empty_patch('stage-2');row['routes']=[{'routeIndex':0,'points':[[100,200],[150,185],[210,165]],'cameraReference':'same_view','note':'原图重新补证终点'}]
                return {'stages':[row]}
            ids=[s['stageId'] for s in value];audits.append(ids);result=approved(value)
            if ids==['stage-2'] and audits.count(ids)==1:
                result['stages'][0]['audit']['routes'][0].update(verdict='uncertain',geometry='uncertain',reason='需要核对终点')
            return result
        agent=self.agent(execute);done=self.wait(agent,self.create(agent))
        self.assertEqual(audits,[['stage-1'],['stage-2'],['stage-2']]);self.assertEqual(done['status'],'ready',done.get('failure'))
        self.assertEqual(len(calls),6);self.assertEqual(done['progress']['modelCallCount'],6)

    def test_two_changed_stages_cannot_spend_patch_call_without_all_reaudit_calls_reserved(self):
        calls=[]
        def execute(**kwargs):
            mode=kwargs['job']['callAnalysisMode'];calls.append(mode)
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if mode=='visual_facts':return facts_for(value)
            self.assertEqual(mode,'visual_audit','a patch plus two mandatory reaudits would exceed six calls')
            result=approved(value)
            for stage in result['stages']:stage['audit']['routes'][0].update(verdict='uncertain',geometry='uncertain',reason='终点补证')
            return result
        agent=self.agent(execute);done=self.wait(agent,self.create(agent))
        self.assertEqual(calls,['visual_facts','visual_facts','visual_audit','visual_audit'])
        self.assertEqual(done['progress']['auditRepairStatus'],'insufficient_verification_budget')
        self.assertEqual(done['status'],'partial');self.assertFalse(done['visualAudit']['allApproved'])

    def test_two_stage_repair_time_reserves_both_complete_audits_and_finalization(self):
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            result=approved(value)
            for stage in result['stages']:stage['audit']['routes'][0].update(verdict='uncertain',geometry='uncertain',reason='终点需补证')
            return result
        agent=self.agent(execute);job=self.create(agent);self.wait(agent,job);live=agent.jobs[job['jobId']]
        # A legacy whole audit can leave three consumed calls. Isolate its
        # time reservation from the new stage loop's separate six-call gate.
        live['_modelCallsThisRun']=3;calls=[]
        def patch_execute(**kwargs):
            calls.append(kwargs['job']['callTimeout'])
            rows=json.loads((kwargs['directory']/'context.json').read_text(encoding='utf-8'))['repairStages']
            return {'stages':[empty_patch(row['stageId']) for row in rows]}
        agent.execute=patch_execute
        with patch.object(agent,'_remaining',return_value=494):agent._repair_audited(live)
        self.assertEqual(calls,[]);self.assertEqual(live['progress']['auditRepairStatus'],'insufficient_verification_budget')
        with patch.object(agent,'_remaining',return_value=500):agent._repair_audited(live)
        self.assertEqual(calls,[65],'420s independent audits + 15s finalization must remain after the patch cap')

    def test_transport_retry_is_same_stage_once_per_run_and_does_not_skip_next_stage(self):
        calls=[];fail=[True]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):return facts_for(value)
            ids=[s['stageId'] for s in value];calls.append((kwargs['job']['runCount'],ids))
            if fail[0] and (ids==['stage-2'] or calls.count((1,['stage-1']))==1):raise AgentFailure('transport','same evidence fixture disconnected')
            return approved(value)
        agent=self.agent(execute);job=self.create(agent);done=self.wait(agent,job)
        self.assertEqual(calls,[(1,['stage-1']),(1,['stage-1']),(1,['stage-2'])])
        self.assertEqual(done['progress']['auditTransportRetries'],1);self.assertNotIn('candidate',done)
        fail[0]=False
        def retry_execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'));ids=[s['stageId'] for s in value]
            calls.append((2,ids))
            if calls.count((2,['stage-2']))==1:raise AgentFailure('transport','second run transport fixture')
            return approved(value)
        agent.execute=retry_execute;done=self.wait(agent,agent.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(done['status'],'ready',done.get('failure'));self.assertEqual(calls[-2:],[(2,['stage-2']),(2,['stage-2'])])
        self.assertEqual(done['progress']['auditTransportRetries'],2)

    def test_cancel_deadline_and_call_limit_never_publish_first_stage_only(self):
        for boundary in ('cancel','deadline','call_limit'):
            with self.subTest(boundary=boundary):
                audits=[]
                def execute(**kwargs):
                    value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
                    if isinstance(value,dict):return facts_for(value)
                    audits.append([s['stageId'] for s in value]);job=kwargs['job']
                    if boundary=='cancel':job['cancel'].set();job['status']='cancelled'
                    if boundary=='deadline':job['deadline']=time.monotonic()-1
                    if boundary=='call_limit':job['_modelCallsThisRun']=6
                    return approved(value)
                agent=self.agent(execute,self.folder/boundary);done=self.wait(agent,self.create(agent))
                self.assertEqual(audits,[['stage-1']]);self.assertNotIn('candidate',done);self.assertTrue(done['auditPending'])

    def test_generation_failed_stage_is_an_explicit_empty_range_and_never_borrowed_from_audited_stage(self):
        audits=[];facts=[]
        def execute(**kwargs):
            value=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if isinstance(value,dict):
                start=value['analysisRange']['startFrame'];facts.append(start)
                if start==30:raise AgentFailure('no_response','second generation unavailable')
                return facts_for(value)
            audits.append([s['stageId'] for s in value]);return approved(value)
        agent=self.agent(execute);done=self.wait(agent,self.create(agent))
        self.assertEqual(done['status'],'partial',done.get('message'));self.assertEqual(audits,[['stage-1']])
        self.assertEqual(facts,[0,30,30]);self.assertEqual(done['stages'][1]['status'],'failed')
        first,second=done['candidate']['phases'];self.assertTrue(first['annotations']);self.assertEqual(second['annotations'],[])
        self.assertEqual((second['startFrame'],second['endFrameExclusive']),(30,61));self.assertEqual(second['participants'],[])
        self.assertEqual(set(done['visualAudit']['stages']),{'stage-1'})
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['version'],0)


if __name__=='__main__':unittest.main()
