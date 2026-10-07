from copy import deepcopy
import base64
import hashlib
import json
import subprocess
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tactics_agent import TacticsAgent
from tactical_workbench import ROOT
import test_tactics_agent as legacy_fixture


def facts_for(pack):
    frames=[item['frame'] for item in pack['images']]
    people=[{'id':f'local-{n}','role':'ball_handler' if n==1 else 'off_ball','action':'move' if n<3 else 'hold',
             'observations':[{'frame':frame,'foot':[100*n,200]} for frame in frames],
             'continuity':'observed','note':'可见实际移动' if n<3 else '可见静止接应'} for n in (1,2,3)]
    return {'summary':'多人实际动作','people':people,'routes':[
        {'personId':f'local-{n}','anchorFrame':frames[0],'evidenceFrames':frames[:2],
         'points':[[100*n,200],[100*n+50,180],[100*n+100,160]],
         'meaning':'current_action','cameraReference':'same_view','note':'真实可见移动路线'} for n in (1,2)],
        'ball':[{'personId':'local-1','frame':frames[0],'point':[100,200]}], 'static':[], 'frameExceptions':[], 'issues':[]}


class FactsIntegrationTests(unittest.TestCase):
    setUp=legacy_fixture.AgentTests.setUp
    wait=legacy_fixture.AgentTests.wait

    def agent(self,execute,**kwargs):
        agent=TacticsAgent(self.folder/'facts',self.tactics,codex_path=self.node,execute=execute,use_visual_audit=False,**kwargs)
        self.addCleanup(agent.close);return agent

    def test_default_facts_compile_through_real_validator_with_raw_audit_and_budget(self):
        calls=[]
        def execute(**kwargs):
            pack=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            schema=json.loads(kwargs['schema'].read_text(encoding='utf-8'))
            self.assertIn('people',schema['properties']);self.assertNotIn('schemaVersion',schema['properties'])
            self.assertNotIn('existingAnnotations',kwargs['prompt']);self.assertNotIn('identityReviewRequired',kwargs['prompt'])
            self.assertGreater(kwargs['job']['callTimeout'],120)
            self.assertLessEqual(kwargs['job']['callTimeout'],180)
            self.assertEqual((kwargs['directory']/'prompt.txt').read_text(encoding='utf-8'),kwargs['prompt'])
            self.assertEqual(pack['imageEncoding']['inputMode'],'original_frames')
            self.assertNotIn('contactSheet',pack['imageEncoding'])
            self.assertEqual(len(kwargs['images']),len(pack['images']))
            for path, metadata in zip(kwargs['images'], pack['images']):
                self.assertEqual(path.name,f"source-frame-{metadata['frame']:06d}.jpg")
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),metadata['sourceImageSha256'])
            self.assertIn('逐张提供原始',kwargs['prompt'])
            calls.append(kwargs);return facts_for(pack)
        agent=self.agent(execute)
        self.assertEqual(agent.timeout,960);self.assertEqual(agent.no_response_timeout,180)
        job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'ready',done);self.assertEqual(len(calls),1)
        self.assertEqual(done['stages'][0]['runtime']['analysisMode'],'visual_facts')
        self.assertEqual(done['stages'][0]['runtime']['modelCallCount'],1)
        self.assertEqual(done['progress']['budgetSeconds'],960)
        self.assertEqual(done['progress']['modelCallLimit'],6)
        self.assertEqual(done['stages'][0]['factsReport']['routePeople'],2)
        directory=calls[0]['directory']
        self.assertEqual(json.loads((directory/'rawfacts.json').read_text(encoding='utf-8'))['people'][0]['id'],'local-1')
        self.assertEqual(json.loads((directory/'candidate.json').read_text(encoding='utf-8'))['schemaVersion'],4)
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['version'],0)

    def test_typed_repair_uses_facts_not_v4_and_cannot_drop_previous_people(self):
        calls=[]
        def execute(**kwargs):
            pack=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            value=facts_for(pack);calls.append(kwargs)
            if len(calls)==1:value['routes']=value['routes'][:1]
            else:
                self.assertIn('repairNeeds',kwargs['prompt']);self.assertIn('previousFacts',kwargs['prompt'])
                self.assertNotIn('schemaVersion',kwargs['prompt']);self.assertGreater(kwargs['job']['callTimeout'],120)
                self.assertLessEqual(kwargs['job']['callTimeout'],180)
                self.assertEqual((kwargs['directory']/'prompt.txt').read_text(encoding='utf-8'),kwargs['prompt'])
            return value
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'ready',done);self.assertEqual(len(calls),2)
        self.assertEqual(done['stages'][0]['factsReport']['observedPeople'],3)

    def test_facts_checkpoint_restart_recompiles_without_calling_model(self):
        from tactics_job_storage import StorageFailure
        blocked=[False];calls=[]
        def execute(**kwargs):
            pack=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            facts=facts_for(pack);kwargs['result'].write_text(json.dumps(facts),encoding='utf-8')
            calls.append(1);blocked[0]=True;return facts
        agent=self.agent(execute);persist=agent._persist
        def fail_checkpoint(job):
            if blocked[0]:raise StorageFailure('fixture disk full')
            return persist(job)
        agent._persist=fail_checkpoint
        job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job);self.assertEqual(done['failure']['code'],'storage')
        recovered=TacticsAgent(agent.folder,self.tactics,codex_path=self.node,use_visual_audit=False,execute=lambda **kwargs:self.fail('duplicate model call'))
        self.addCleanup(recovered.close);recovered.get(job['jobId'],self.clip,'demo',True)
        retry=recovered.retry(job['jobId'],self.request,self.clip,'demo',True);done=self.wait(recovered,retry)
        self.assertEqual(done['status'],'ready',done);self.assertEqual(len(calls),1)
        self.assertEqual(done['stages'][0]['factsReport']['routePeople'],2)

    def test_malformed_list_or_null_can_be_repaired_without_execution_error(self):
        for malformed in ([],None):
            calls=[]
            def execute(**kwargs):
                calls.append(kwargs)
                if len(calls)==1:return malformed
                self.assertIn('validationError',kwargs['prompt'])
                return facts_for(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')))
            agent=TacticsAgent(self.folder/f'malformed-{len(str(malformed))}',self.tactics,codex_path=self.node,use_visual_audit=False,execute=execute)
            self.addCleanup(agent.close)
            job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
            done=self.wait(agent,job)
            self.assertEqual(done['status'],'ready',done);self.assertEqual(len(calls),2)
            self.assertEqual(json.loads((calls[0]['directory']/'rawfacts.json').read_text(encoding='utf-8')),malformed)

    def test_repair_cannot_remove_people_and_original_repair_scope_survives_failure(self):
        calls=[]
        def execute(**kwargs):
            value=facts_for(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')));calls.append(1)
            value['routes']=value['routes'][:1]
            if len(calls)>1:value['people']=[p for p in value['people'] if p['id']!='local-2']
            return value
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['failure']['code'],'facts_retention',done);self.assertEqual(len(calls),2)
        previous=agent.jobs[job['jobId']]['stages'][0]['_factsRepair']['previousFacts']
        self.assertEqual({p['id'] for p in previous['people']},{'local-1','local-2','local-3'})

    def test_late_received_facts_are_not_published_but_retry_reuses_them(self):
        calls=[]
        def execute(**kwargs):
            calls.append(1);kwargs['job']['deadline']=time.monotonic()-1
            return facts_for(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')))
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        failed=self.wait(agent,job)
        self.assertEqual(failed['failure']['code'],'budget_exhausted',failed)
        self.assertNotIn('previewDocument',failed);self.assertEqual(len(calls),1)
        retry=agent.retry(job['jobId'],self.request,self.clip,'demo',True);done=self.wait(agent,retry)
        self.assertEqual(done['status'],'ready',done);self.assertEqual(len(calls),1)
        self.assertEqual(done['progress']['finalizationReserveSeconds'],15)

    def test_native_runner_preserves_default_and_passes_positive_deadline_only(self):
        with patch('tactical_workbench.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='{}')) as run:
            self.tactics.run('probe',test='value')
            self.assertEqual(run.call_args.kwargs['timeout'],90)
            self.tactics.run('probe',execution_timeout=.25,test='value')
            self.assertEqual(run.call_args.kwargs['timeout'],.25)
            self.assertNotIn('execution_timeout',json.loads(run.call_args.kwargs['input']))
            count=run.call_count
            with self.assertRaises(ValueError):self.tactics.run('probe',execution_timeout=0)
            self.assertEqual(run.call_count,count)

    def test_default_facts_two_stages_compile_each_once_through_native_validator(self):
        calls=[];decoded=[];decode=self.tactics.frames
        def frames(video,clip,indices,**kwargs):
            value=decode(video,clip,indices,**kwargs);decoded.extend(deepcopy(value));return value
        self.tactics.frames=frames
        # A real 24-second mapping exercises the default partition, not a forced
        # two-stage mock that could hide integration with source-time splitting.
        mapping=self.doc['review']['sourceFrameMapping']
        for frame,row in enumerate(mapping):
            row['time']=row['sourceTime']=frame*24/len(mapping)
            self.clip['frames'][frame]['time']=self.clip['frames'][frame]['source_time']=row['time']
        self.doc['review']['mediaEndTime']=24
        self.clip['mediaEndTime']=24
        for entity in self.doc['review']['entities']:
            for point in entity.get('trajectory',[]):point['time']=mapping[point['frame']]['time']
        script="import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';let s='';process.stdin.setEncoding('utf8');for await(const c of process.stdin)s+=c;console.log(JSON.stringify(await createTacticsDocument(JSON.parse(s))));"
        self.doc=json.loads(subprocess.check_output([self.node,'--input-type=module','-e',script],
                            input=json.dumps(self.doc['review'],ensure_ascii=False),text=True,encoding='utf-8',cwd=ROOT))
        self.request['document']=self.doc
        self.request['documentDigest']=self.tactics.run('agent-digest',document=self.doc)['digest']
        def execute(**kwargs):
            pack=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            calls.append(kwargs);return facts_for(pack)
        agent=self.agent(execute)
        job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'ready',done);self.assertEqual(len(calls),2)
        self.assertEqual(done['progress']['completed'],2)
        self.assertTrue(all(s['modelCallCount']==1 and s['factsReport']['routePeople']==2 for s in done['stages']))
        for call in calls:self.assertTrue((call['directory']/'rawfacts.json').is_file())
        self.assertEqual(len(decoded),len({frame['frame'] for frame in decoded}),'preview must reuse decoded source evidence')
        original={frame['frame']:frame['dataUrl'] for frame in decoded}
        self.assertTrue(all(frame['dataUrl']==original[frame['frame']] for frame in done['previewFrames']))
        for call in calls:
            pack=json.loads((call['directory']/'input.json').read_text(encoding='utf-8'))
            for frame in pack['images']:
                digest=hashlib.sha256(base64.b64decode(original[frame['frame']].split(',',1)[1])).hexdigest()
                self.assertEqual(frame['sourceImageSha256'],digest)
        state=json.loads((agent.folder/job['jobId']/'state.json').read_text(encoding='utf-8'))
        self.assertNotIn('_sourceFrameCache',state)

    def test_repair_cannot_make_same_people_all_static_to_escape_missing_route(self):
        calls=[]
        def execute(**kwargs):
            value=facts_for(json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8')));calls.append(1)
            value['routes']=value['routes'][:1]
            if len(calls)>1:
                value['routes']=[]
                for person in value['people']:person['action']='hold'
            return value
        agent=self.agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'failed',done);self.assertEqual(done['failure']['code'],'facts_retention')
        self.assertEqual(len(calls),2);self.assertNotIn('previewDocument',done)
        repair=agent.jobs[job['jobId']]['stages'][0]['_factsRepair']
        self.assertEqual({(n['personId'],n['code']) for n in repair['repairNeeds']},{('local-2','moving_without_route')})
        self.assertTrue(repair['retentionErrors'])

    def test_two_stage_diagnostics_keep_over_thirty_and_archive_over_sixty(self):
        for count in (20,35):
            def execute(**kwargs):
                pack=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
                value=legacy_fixture.AgentTests.video_output(self,pack)
                value['issues']=[f"段{pack['analysisRange']['startFrame']}诊断{i}" for i in range(count)]
                return value
            agent=TacticsAgent(self.folder/f'issues-{count}',self.tactics,codex_path=self.node,use_visual_facts=False,execute=execute)
            self.addCleanup(agent.close)
            stages=[dict(stageId=f'stage-{i+1}',startFrame=a,endFrameExclusive=b,status='queued',message='等待',attempts=0)
                    for i,(a,b) in enumerate([(0,30),(30,61)])]
            with patch('tactics_agent.analysis_stages',return_value=stages):
                job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
            done=self.wait(agent,job)
            self.assertEqual(done['status'],'ready',done)
            self.assertEqual(len(done['diagnostics']),count*2)
            self.tactics.run('validate',document=done['previewDocument'])
            adopted=agent.adopt(job['jobId'],self.request,self.clip,'demo',True)['document']
            self.assertTrue(set(done['diagnostics'])<=set(adopted['agentRuns'][-1]['issues']))
            if count==20:self.assertEqual(len(done['candidate']['issues']),40)
            else:
                self.assertIn('70',done['candidate']['issues'][0])
                path=agent.folder/job['jobId']/done['diagnosticsRef']['file']
                self.assertEqual(json.loads(path.read_text(encoding='utf-8')),done['diagnostics'])
