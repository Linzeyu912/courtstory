"""Video identity safety contracts, with real VFR decoding and no paid calls."""
from copy import deepcopy
import importlib
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from commentary_video import CommentaryVideo
from test_commentary_video import make_vfr_video

try:
    module = importlib.import_module('identity_video')
except ModuleNotFoundError:
    module = None


class IdentityVideoTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'source-grounded video identity implementation is required')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        path = self.root/'source.mkv'
        make_vfr_video(path, start_pts=2000)
        self.video = CommentaryVideo(path, self.root/'images')
        self.context = self.video.context()
        self.clip = dict(video_sha256=self.video.video_ref, tracking_fingerprint='b'*64,
            tracking_revision='test', width=96, height=64, sourceCuts=[], frames=[
                dict(frame=f['frame'], time=f['sourceTime'], source_frame=f['frame']+100,
                     source_time=f['sourceTime']+30, source_frame_pts=f['pts'],
                     source_time_base=[1, 1000], tracks=[[2,2,30,60,2,.9,2]])
                for f in self.context['frames']])
        self.session = dict(entities=[dict(id='P1',role='player',modelBindings=[])],cuts=[])
        self.mapping = module.validate_source_mapping(self.clip,self.context)
        self.ledger = module.ImageLedger(self.context)
        self.ledger.record(self.video.read_video_window({'frames':[0,2,4],'mode':'full'}))
        self.plan = dict(summary='实际看图候选',subjects=[dict(subjectId='person',entityId='P1',role='player',
            team='红色',teamSide='A',jersey='0',confidence=.9,reason='可见红色球衣号码')],
            segments=[dict(id='s1',subjectId='person',trackId=2,startFrame=0,endFrame=4,
                evidenceFrames=[0,2,4],jerseyEvidenceFrames=[2],confidence=.9,reason='首尾和中间可见同一球员')],issues=[])

    def candidate(self, plan=None, clip=None):
        return module.validate_video_identity(plan or self.plan,clip or self.clip,self.session,self.mapping,self.ledger)

    def test_source_mapping_keeps_asset_and_parent_source_separate(self):
        candidate=self.candidate()
        evidence=candidate['segments'][0]['evidence'][1]
        self.assertEqual((evidence['frame'],evidence['assetFrame'],evidence['sourceFrame']),(2,2,102))
        self.assertEqual(evidence['sourceTime'],self.clip['frames'][2]['source_time'])
        self.assertEqual(evidence['pts'],self.context['frames'][2]['pts'])
        self.assertEqual(evidence['videoSha256'],self.video.video_ref)
        self.assertEqual(candidate['coverage']['imageFrames'],[0,2,4])

    def test_rejects_hash_pts_and_time_mapping_mismatch(self):
        for field,value in [('time',999),('source_frame_pts',999),('source_time_base',[1,30])]:
            bad=deepcopy(self.clip);bad['frames'][2][field]=value
            with self.assertRaises(ValueError):module.validate_source_mapping(bad,self.context)
        with self.assertRaises(ValueError):module.validate_source_mapping({**self.clip,'video_sha256':'c'*64},self.context)

    def test_unread_endpoint_and_jersey_evidence_are_rejected(self):
        for key,value in [('endFrame',3),('jerseyEvidenceFrames',[1]),('evidenceFrames',[0,1,4])]:
            bad=deepcopy(self.plan);bad['segments'][0][key]=value
            with self.assertRaises(ValueError):self.candidate(bad)

    def test_cuts_missing_risks_and_large_time_gaps_cannot_be_bridged(self):
        for variant in ('cut','missing','risk','timegap'):
            bad=deepcopy(self.clip)
            if variant=='cut':bad['sourceCuts']=[2]
            if variant=='missing':bad['frames'][1]['tracks']=[]
            if variant=='risk':bad['frames'][1]['track_evidence']={'2':{'identity_review_required':True}}
            if variant=='timegap':bad['frames'][1]['time']=50
            with self.assertRaises(ValueError,msg=variant):self.candidate(clip=bad)

    def test_duplicates_slot_conflicts_and_wrong_team_slots_never_apply(self):
        bad=deepcopy(self.plan);bad['segments'].append(deepcopy(bad['segments'][0]))
        with self.assertRaises(ValueError):self.candidate(bad)
        bad=deepcopy(self.plan);bad['subjects'][0]['teamSide']='B'
        with self.assertRaises(ValueError):self.candidate(bad)
        bad=deepcopy(self.plan);bad['subjects'].append({**bad['subjects'][0],'subjectId':'other'})
        bad['segments'].append({**bad['segments'][0],'id':'s2','subjectId':'other'})
        result=self.candidate(bad)
        self.assertFalse(result['segments'])
        self.assertTrue(any(i['kind']=='identity_conflict' for i in result['issues']))

    def test_image_metadata_without_actual_images_never_grants_evidence(self):
        ledger=module.ImageLedger(self.context)
        with self.assertRaises(ValueError):ledger.record({'content':[],'details':{'frames':[self.context['frames'][1]]}})
        self.assertFalse(ledger.frames)
        result=self.video.read_video_window({'frames':[1],'mode':'full'})
        result['details']['assets'][0]['pts']+=1
        with self.assertRaises(ValueError):ledger.record(result)
        self.assertFalse(ledger.frames)

    def test_partial_save_preserves_valid_segments_and_identifies_rejected_ranges(self):
        plan=deepcopy(self.plan)
        plan['segments'].append({**plan['segments'][0],'id':'unread','endFrame':3})
        candidate=module.validate_video_identity_partial(plan,self.clip,self.session,self.mapping,self.ledger)
        self.assertEqual([s['id'] for s in candidate['segments']],['s1'])
        self.assertEqual(candidate['completionStatus'],'partial')
        issue=next(i for i in candidate['issues'] if i.get('segmentId')=='unread')
        self.assertEqual((issue['trackId'],issue['start'],issue['end']),(2,0,3))
        self.assertIn('unread',issue['reason'])
        self.assertIn('T2',issue['reason'])
        self.assertEqual(candidate['coverage']['providedWindows'],2)

    def test_partial_save_keeps_subject_validation_global_conflicts_and_all_invalid_strict(self):
        plan=deepcopy(self.plan);plan['subjects'][0]['teamSide']='B'
        with self.assertRaises(ValueError):
            module.validate_video_identity_partial(plan,self.clip,self.session,self.mapping,self.ledger)

        plan=deepcopy(self.plan);plan['segments'][0]['endFrame']=3
        with self.assertRaisesRegex(ValueError,'s1|区间'):
            module.validate_video_identity_partial(plan,self.clip,self.session,self.mapping,self.ledger)
        plan=deepcopy(self.plan);plan['segments'].append(deepcopy(plan['segments'][0]))
        with self.assertRaises(ValueError):
            module.validate_video_identity_partial(plan,self.clip,self.session,self.mapping,self.ledger)
        plan=deepcopy(self.plan)
        plan['subjects'].append({**plan['subjects'][0],'subjectId':'other'})
        plan['segments'].append({**plan['segments'][0],'id':'conflict','subjectId':'other'})
        with self.assertRaises(ValueError):
            module.validate_video_identity_partial(plan,self.clip,self.session,self.mapping,self.ledger)

    def test_partial_save_removes_both_conflicting_ranges_while_retaining_independent_range(self):
        plan=deepcopy(self.plan)
        plan['subjects'].append({**plan['subjects'][0],'subjectId':'other'})
        first={**plan['segments'][0],'endFrame':2,'evidenceFrames':[0,2]}
        plan['segments']=[first,{**first,'id':'conflict','subjectId':'other'},
            {**first,'id':'independent','startFrame':4,'endFrame':4,'evidenceFrames':[4],'jerseyEvidenceFrames':[4]}]
        candidate=module.validate_video_identity_partial(plan,self.clip,self.session,self.mapping,self.ledger)
        self.assertEqual([s['id'] for s in candidate['segments']],['independent'])
        self.assertEqual({s['segmentId'] for s in candidate['rejectedSegments']},{'s1','conflict'})
        self.assertEqual(candidate['completionStatus'],'partial')

    def test_other_person_crop_does_not_grant_target_jersey_evidence(self):
        self.ledger=module.ImageLedger(self.context)
        self.ledger.record(self.video.read_video_window({'frames':[0,2,4],'mode':'sheet'}))
        self.ledger.record(self.video.inspect_region({'frames':[2],'box':[60,2,90,62]}))
        with self.assertRaisesRegex(ValueError,'目标|号码|裁图'):self.candidate()

    def test_arbitrary_region_cannot_claim_ownership_by_echoing_a_track_id(self):
        self.ledger=module.ImageLedger(self.context)
        self.ledger.record(self.video.read_video_window({'frames':[0,2,4],'mode':'sheet'}))
        self.ledger.record(self.video.inspect_region({'frames':[2],'trackId':2,'box':[60,2,90,62]}))
        with self.assertRaisesRegex(ValueError,'目标|号码|裁图'):self.candidate()

    def test_repeated_crops_preserve_prior_valid_target_image(self):
        self.ledger.record(self.video.inspect_region({'frames':[2],'box':[60,2,90,62]}))
        candidate=self.candidate()
        self.assertEqual(candidate['segments'][0]['jerseyEvidenceFrames'],[2])

    def test_context_and_host_model_invalidate_cache(self):
        key=module.video_source_key(self.clip,'v',False,None,{'model':'one'})
        for context,config in [({'season':'2025-26','teamMap':{'A':'HOU'}},{'model':'one'}),
                               (None,{'model':'two'})]:
            self.assertNotEqual(key,module.video_source_key(self.clip,'v',False,context,config))

    def test_names_use_unique_roster_preserve_zero_and_do_not_guess_without_context(self):
        class Roster:
            def lookup(self,season,team,jersey):
                names={'0':['Zero Player'],'00':['Double Zero Player'],'2':['A','B']}[jersey]
                return {'status':'unique_candidate' if len(names)==1 else 'multiple_candidates',
                    'candidates':[{'name':n,'player_id':'name:'+n,'season_roster':[{'url':'https://nba.com/game'}]} for n in names]}
        ctx={'season':'2025-26','teamMap':{'A':'HOU'}}
        for jersey,name in [('0','Zero Player'),('00','Double Zero Player'),('2',None)]:
            plan=deepcopy(self.plan);plan['subjects'][0]['jersey']=jersey
            result=module.build_name_result(self.candidate(plan),ctx,Roster(),job_id='job',source_key='key',base={'videoHash':self.video.video_ref})
            self.assertEqual(result['purpose'],'player_names')
            self.assertEqual(result['candidate']['candidates'][0]['jersey'],jersey)
            self.assertEqual((result['candidate']['candidates'][0].get('nameCandidate') or {}).get('name'),name)
        result=module.build_name_result(self.candidate(),{},Roster(),job_id='job',source_key='key',base={})
        self.assertFalse(any(row.get('nameCandidate') for row in result['candidate']['candidates']))

    def test_cancelled_runner_does_not_decode_or_start_a_model(self):
        event=threading.Event();event.set()
        runner=module.VideoIdentityRunner()
        with self.assertRaisesRegex(ValueError,'取消'):
            runner.run({'cancel':event},self.root,lambda **kw:None)

    def test_identity_jobs_use_video_status_context_cache_and_adopt_cas(self):
        from identity_agent import IdentityAgent
        from test_identity_agent import FrameDecoder
        owner=self
        class Runner:
            config={'model':'fixture'}
            status=lambda self:{'available':True,'provider':'fixture','message':'ready'}
            source_key=lambda self,c,v,q,r:module.video_source_key(c,v,q,r.get('identityContext'),self.config)
            def run(self,job,directory,progress):
                candidate=owner.candidate()
                candidate['completionStatus']='partial'
                candidate['playerNames']=module.build_name_result(candidate,{},None,job_id=job['jobId'],source_key=job['sourceKey'],base=job['base'])
                return candidate,[]
        session={'version':1,'videoHash':self.video.video_ref,'maxGapSeconds':.5,
                 'entities':[dict(id=f'P{i}',role='player',anchors=[],bindings=[],identityKeyframes=[],modelBindings=[]) for i in range(1,11)]}
        agent=IdentityAgent(self.root/'jobs',FrameDecoder(),provider='multimodal-api',initial_video=Runner())
        self.addCleanup(agent.close)
        self.assertFalse(agent.status()['available'])
        self.assertTrue(agent.status()['initialReview']['available'])
        request={'purpose':'initial_review','session':session,'clientRevision':0}
        job=agent.create(request,self.clip,self.video.video_path,'v',False)
        for _ in range(100):
            done=agent.get(job['jobId'],self.clip,'v',False)
            if done['status'] in ('ready','failed'):break
            time.sleep(.01)
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(done['algoVersion'],'video-identity-review-v2')
        changed={**request,'identityContext':{'season':'2025-26','teamMap':{'A':'HOU'}}}
        other=agent.create(changed,self.clip,self.video.video_path,'v',False)
        self.assertNotEqual(other['sourceKey'],done['sourceKey'])
        with self.assertRaises(ValueError):agent.adopt(done['jobId'],changed,self.clip,'v',False)
        same=agent.create(request,self.clip,self.video.video_path,'v',False)
        self.assertEqual(same['jobId'],job['jobId'])
        resumed=agent.create({**request,'forceRetry':True},self.clip,self.video.video_path,'v',False)
        self.assertNotEqual(resumed['jobId'],job['jobId'])
        self.assertEqual(agent.jobs[resumed['jobId']]['resumeFrom'],job['jobId'])

    def test_cancelling_inflight_video_job_never_publishes_a_candidate(self):
        from identity_agent import IdentityAgent
        from test_identity_agent import FrameDecoder
        entered=threading.Event();gate=threading.Event()
        class Runner:
            config={}
            status=lambda self:{'available':True,'provider':'fixture','message':'ready'}
            source_key=lambda self,c,v,q,r:module.video_source_key(c,v,q,r.get('identityContext'),self.config)
            def run(self,job,directory,progress):
                entered.set();gate.wait(2)
                return {'segments':[]},[]
        session={'version':1,'videoHash':self.video.video_ref,'maxGapSeconds':.5,
                 'entities':[dict(id=f'P{i}',role='player',anchors=[],bindings=[],identityKeyframes=[],modelBindings=[]) for i in range(1,11)]}
        agent=IdentityAgent(self.root/'jobs',FrameDecoder(),initial_video=Runner());self.addCleanup(agent.close)
        request={'purpose':'initial_review','session':session,'clientRevision':0}
        job=agent.create(request,self.clip,self.video.video_path,'v',False)
        self.assertTrue(entered.wait(1));agent.cancel(job['jobId'],self.clip,'v',False);gate.set();agent.close()
        done=agent.get(job['jobId'],self.clip,'v',False)
        self.assertEqual(done['status'],'cancelled');self.assertNotIn('candidate',done)

    def test_shared_provider_reads_utf16_env_and_does_not_leak_bad_bytes(self):
        from commentary_agent import provider_environment
        env=self.root/'private.env';env.write_text('OPENROUTER_API_KEY=fixture-private-value\n',encoding='utf-16')
        with patch.dict('os.environ',{},clear=True):
            child,key=provider_environment(env,'openrouter')
            self.assertEqual(key,'fixture-private-value')
            env.write_bytes(b'\xfffixture-secret-bytes')
            try:provider_environment(env,'openrouter')
            except ValueError as error:
                self.assertNotIn('fixture-secret-bytes',str(error))
                self.assertNotIsInstance(error,UnicodeDecodeError)
            else:self.fail('invalid encoding should fail')

    def test_shared_transport_cancellation_terminates_waiting_child(self):
        import os
        from commentary_agent import run_worker
        worker=self.root/'waiting-worker.mjs'
        worker.write_text("process.stdin.on('data',()=>{}); setInterval(()=>{},1000);",encoding='utf-8')
        cancel=threading.Event();captured=[]
        def capture(process):
            captured.append(process)
            threading.Timer(.1,cancel.set).start()
        env={**os.environ,'COMMENTARY_PROVIDER':'openrouter','OPENROUTER_MODEL':'fixture'}
        started=time.monotonic()
        result=run_worker(self.video,self.context,{},self.root,env,'unused',{'timeoutSeconds':30},'fixture',
            worker_path=worker,cancel_event=cancel,set_process=capture)
        self.assertEqual(result['status'],'cancelled');self.assertIsNotNone(captured[0].poll())
        self.assertLess(time.monotonic()-started,7)

    def test_resume_rehydrates_verified_images_and_preserves_original_slot_basis(self):
        candidate=self.candidate();candidate['slotBasis']['P1']['name']='original slot'
        folder=self.root/'previous';folder.mkdir()
        from local_video_library import atomic_json
        atomic_json(folder/'checkpoint.json',candidate)
        resumed=module.load_checkpoint(folder,self.context,self.clip)
        self.assertEqual(resumed['candidate']['slotBasis']['P1']['name'],'original slot')
        self.assertEqual(set(resumed['ledger'].frames),{0,2,4})
        plan=module.merge_checkpoint_plan(resumed['candidate'],{'summary':'补完','subjects':[],'segments':[],'issues':[]})
        self.assertEqual(plan['segments'][0]['endFrame'],4)
        self.assertEqual(plan['subjects'][0]['jersey'],'0')
        correction=deepcopy(self.plan);correction['subjects'][0]['reason']='补看后说明更清楚'
        merged=module.merge_checkpoint_plan(resumed['candidate'],correction)
        self.assertEqual(merged['subjects'][0]['jersey'],'0')
        correction['subjects'][0]['jersey']='00'
        with self.assertRaises(ValueError):module.merge_checkpoint_plan(resumed['candidate'],correction)
        asset=Path(candidate['evidence']['assets'][0]['path']);asset.write_bytes(b'wrong')
        with self.assertRaises(ValueError):module.load_checkpoint(folder,self.context,self.clip)

    def test_real_runner_keeps_checkpoint_and_cumulative_usage_when_resume_transport_fails(self):
        runner=module.VideoIdentityRunner()
        def job(ident,**extra):
            return {'jobId':ident,'sourceKey':'same-key','clip':self.clip,'video':self.video.video_path,
                'request':{'session':self.session},'base':{'videoHash':self.video.video_ref},
                'cancel':threading.Event(),**extra}
        first=self.root/'first';first.mkdir()
        def worker(*args,**kwargs):
            methods=kwargs['rpc_methods']
            methods['read_video_window']({'frames':[0,2,4],'mode':'full'})
            methods['save_identity_review']({'plan':self.plan,'finish':False})
            return {'status':'partial','usage':{'requests':2,'totalTokens':123},'error':'fixture connection'}
        with patch.object(module,'provider_environment',return_value=({},'fixture')),patch.object(module,'run_worker',side_effect=worker):
            candidate,_=runner.run(job('first'),first,lambda **p:None)
        self.assertEqual(candidate['completionStatus'],'partial')
        second=self.root/'second';second.mkdir()
        with patch.object(module,'provider_environment',return_value=({},'fixture')),patch.object(module,'run_worker',return_value={
                'status':'failed','usage':{'requests':3,'totalTokens':456},'error':'fixture second connection'}):
            resumed,_=runner.run(job('second',resumeFrom='first',resumeCount=1),second,lambda **p:None)
        self.assertEqual(resumed['cumulativeUsage']['requests'],5)
        self.assertEqual(resumed['cumulativeUsage']['totalTokens'],579)
        self.assertEqual(resumed['playerNames']['jobId'],'second')
        self.assertEqual(resumed['segments'],candidate['segments'])
        self.assertEqual(resumed['resumeFrom'],'first')

    def test_runner_saves_legal_parts_of_finished_proposal_as_partial_checkpoint(self):
        runner=module.VideoIdentityRunner()
        directory=self.root/'partial';directory.mkdir()
        job={'jobId':'partial','sourceKey':'key','clip':self.clip,'video':self.video.video_path,
             'request':{'session':self.session},'base':{'videoHash':self.video.video_ref},'cancel':threading.Event()}
        def worker(*args,**kwargs):
            methods=kwargs['rpc_methods']
            methods['read_video_window']({'frames':[0,2,4],'mode':'full'})
            plan=deepcopy(self.plan)
            plan['segments'].append({**plan['segments'][0],'id':'cross-cut','startFrame':2,'evidenceFrames':[2,4]})
            self.clip['frames'][3]['missing']=True
            # Keep a separate valid single-frame segment before the missing row.
            plan['segments'][0].update(endFrame=2,evidenceFrames=[0,2])
            saved=methods['save_identity_review']({'plan':plan,'finish':True})
            self.assertTrue(saved['saved'])
            self.assertEqual([s['id'] for s in saved['candidate']['segments']],['s1'])
            return {'status':'completed','usage':{'requests':1}}
        with patch.object(module,'provider_environment',return_value=({},'fixture')),patch.object(module,'run_worker',side_effect=worker):
            candidate,_=runner.run(job,directory,lambda **p:None)
        self.assertTrue((directory/'checkpoint.json').is_file())
        self.assertEqual(candidate['completionStatus'],'partial')
        self.assertEqual(len(candidate['playerNames']['candidate']['candidates']),1)


if __name__=='__main__':unittest.main()
