"""Initial review contracts. Fake only inference and decode, never model output validation."""
from copy import deepcopy
import json
import threading
import time
import unittest

from initial_identity_review import evidence_plan, validate_candidate, slot_basis, source_key
import test_identity_agent as fixture


class InitialIdentityReviewTests(unittest.TestCase):
    # Reuse only the isolated fixture helpers, not continuation-specific tests.
    make_agent=fixture.IdentityAgentTests.make_agent
    create=fixture.IdentityAgentTests.create
    wait=fixture.IdentityAgentTests.wait

    def setUp(self):
        fixture.IdentityAgentTests.setUp(self)
        self.session['entities'][0].pop('identityReference')
        self.session['entities'][0]['modelBindings']=[dict(kind='track',trackId=2,start=0,end=60)]
        self.session['entities'][1]['modelBindings']=[dict(kind='track',trackId=62,start=0,end=60)]
        self.request=dict(purpose='initial_review',session=self.session,clientRevision=7)
        self.calls=[]

    def initial_answer(self, **kwargs):
        pack=json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
        self.calls.append(pack)
        self.assertEqual(pack['stage'],'initial_review')
        return dict(summary='紫衣球员可以续接；另一人物为裁判，号码仍不清楚。',
                    subjects=[dict(subjectId='subject-1',entityId='P1',role='player',team='紫色',jersey='',confidence=.9,reason='球衣与外观在所示画面一致'),
                              dict(subjectId='subject-2',entityId=None,role='referee',team='',jersey='',confidence=.9,reason='裁判服与手势')],
                    assignments=[dict(windowId=w['id'],subjectId='subject-1' if w['trackId']==2 else 'subject-2',confidence=.9,reason='首尾画面外观一致') for w in pack['windows']],
                    issues=[])

    def initial_agent(self, execute=None, **kwargs):
        return self.make_agent(execute or self.initial_answer,**kwargs)

    def test_initial_no_reference_full_source_and_reason_preserved(self):
        before=deepcopy(self.session);agent=self.initial_agent();done=self.wait(agent,self.create(agent))
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(len(self.calls),1)
        self.assertNotIn('entityId',self.calls[0]);self.assertNotIn('reference',self.calls[0])
        self.assertEqual(self.calls[0]['range'],{'start':0,'end':60})
        self.assertLessEqual(done['candidate']['coverage']['sampledFrames'],8)
        self.assertTrue(all(s['reason'] for s in done['candidate']['subjects']))
        self.assertTrue(done['candidate']['reviewRequired']);self.assertFalse(done['candidate']['identityVerified'])
        self.assertTrue(any(i['kind']=='role_mismatch' for i in done['candidate']['issues']))
        self.assertEqual(done['candidate']['slotBasis'],slot_basis(before))
        adopted=agent.adopt(done['jobId'],self.request,self.clip,'fixture',True)
        self.assertEqual(adopted['sourceKey'],done['sourceKey']);self.assertEqual(self.session,before)
        self.assertEqual(adopted['generationJobId'],done['jobId'])

    def test_source_cache_survives_restart_and_changed_session_does_not_relabel_cached_p_slots(self):
        agent=self.initial_agent();done=self.wait(agent,self.create(agent));agent.close()
        restored=self.initial_agent()
        changed=deepcopy(self.request);changed['clientRevision']=0
        changed['session']['entities'][0]['modelBindings']=[dict(kind='track',trackId=62,start=0,end=60)]
        cached=self.create(restored,changed)
        self.assertEqual(cached['jobId'],done['jobId']);self.assertFalse(cached['matchesCurrentInput'])
        self.assertEqual(len(self.calls),1)
        with self.assertRaises(ValueError):
            restored.adopt(cached['jobId'],changed,self.clip,'fixture',True)
        reused=self.create(restored,{**changed,'reuseCached':True})
        self.assertEqual(reused['status'],'ready');self.assertTrue(reused['matchesCurrentInput'])
        self.assertNotEqual(reused['jobId'],done['jobId'])
        self.assertEqual(reused['generationJobId'],done['jobId'])
        self.assertEqual(reused['candidate']['slotBasis'],done['candidate']['slotBasis'])
        self.assertNotEqual(reused['candidate']['slotBasis'],slot_basis(changed['session']))
        self.assertEqual(len(self.calls),1,'cache rebase must not call the provider')
        self.assertEqual(restored.adopt(reused['jobId'],{**changed,'reuseCached':True},self.clip,'fixture',True)['candidate'],done['candidate'])

    def test_same_source_running_job_deduplicates_even_when_input_session_changes(self):
        gate=threading.Event();entered=threading.Event()
        def blocked(**kwargs):
            entered.set();gate.wait(2);return self.initial_answer(**kwargs)
        agent=self.initial_agent(blocked);first=self.create(agent)
        self.assertTrue(entered.wait(1))
        changed=deepcopy(self.request);changed['session']['entities'][2]['name']='manual edit'
        duplicate=self.create(agent,changed)
        self.assertEqual(first['jobId'],duplicate['jobId']);self.assertFalse(duplicate['matchesCurrentInput'])
        gate.set();self.assertEqual(self.wait(agent,first)['status'],'ready');self.assertEqual(len(self.calls),1)

    def test_transport_failure_cached_without_automatic_repeat_but_explicit_retry_works(self):
        count=[]
        def fail(**kwargs):
            count.append(1);raise TimeoutError('fixture provider timed out')
        agent=self.initial_agent(fail);done=self.wait(agent,self.create(agent))
        self.assertEqual(done['status'],'failed');self.assertEqual(len(count),1)
        self.assertEqual(self.create(agent)['jobId'],done['jobId']);self.assertEqual(len(count),1)
        agent.close();restored=self.initial_agent()
        self.assertEqual(self.create(restored)['status'],'failed');self.assertEqual(len(self.calls),0)
        retry=self.wait(restored,self.create(restored,{**self.request,'forceRetry':True}))
        self.assertNotEqual(retry['jobId'],done['jobId']);self.assertEqual(retry['status'],'ready')
        self.assertEqual(len(self.calls),1)
        self.assertTrue((agent.folder/done['jobId']/'failure-attempt-1.json').is_file())

    def test_cancelled_result_is_never_revived_or_automatically_retried(self):
        gate=threading.Event();entered=threading.Event()
        def blocked(**kwargs):
            entered.set();gate.wait(2);return self.initial_answer(**kwargs)
        agent=self.initial_agent(blocked);job=self.create(agent);self.assertTrue(entered.wait(1))
        agent.cancel(job['jobId'],self.clip,'fixture',True);gate.set();agent.close()
        restored=self.initial_agent();done=self.create(restored)
        self.assertEqual(done['jobId'],job['jobId']);self.assertEqual(done['status'],'cancelled')
        self.assertNotIn('candidate',done)
        with self.assertRaises(ValueError):
            restored.adopt(done['jobId'],self.request,self.clip,'fixture',True)

    def test_interrupted_job_restores_failure_without_starting_provider(self):
        agent=self.initial_agent();done=self.wait(agent,self.create(agent));agent.close()
        state_file=agent.folder/done['jobId']/'state.json'
        state=json.loads(state_file.read_text(encoding='utf-8'));state.update(status='analyzing');state.pop('candidate')
        state_file.write_text(json.dumps(state),encoding='utf-8')
        restored=self.initial_agent();recovered=self.create(restored)
        self.assertEqual(recovered['status'],'failed');self.assertEqual(recovered['failure']['code'],'interrupted')
        self.assertEqual(len(self.calls),1)

    def test_full_clip_sampling_is_bounded_evenly_spaced_and_all_provided_people_are_kept(self):
        clip=deepcopy(self.clip);clip['sourceCuts']=[]
        clip['frames']=[dict(frame=f,time=f/30,tracks=deepcopy(self.clip['frames'][0]['tracks'])) for f in range(721)]
        plan=evidence_plan(clip,self.session)
        self.assertEqual(plan['imageFrames'],[0,120,240,360,480,600,720])
        self.assertLessEqual(plan['maxSampleIntervalSeconds'],4.1)
        self.assertEqual({w['trackId'] for w in plan['windows']},{2,62})
        for track in (2,62):
            covered={f for w in plan['windows'] if w['trackId']==track for f in range(w['start'],w['end']+1)}
            self.assertEqual(covered,set(range(721)))

    def test_cuts_missing_observations_roles_and_jumps_are_not_bridged(self):
        clip=deepcopy(self.clip);clip['sourceCuts']=[30]
        clip['frames'][15]['tracks']=clip['frames'][15]['tracks'][:1]
        clip['frames'][40]['track_evidence']={'2':{'identity_review_required':True,'role_evidence':{'role':'referee'}}}
        clip['frames'][31]['tracks'][1][:4]=[1,1,10,10]
        plan=evidence_plan(clip,self.session)
        self.assertTrue({0,29,30,60}.issubset(set(plan['imageFrames'])))
        self.assertFalse(any(w['start']<30<=w['end'] for w in plan['windows']))
        for window in plan['windows']:
            if window['trackId']==62:self.assertFalse(window['start']<15<window['end'] or window['start']<31<window['end'])
            if window['trackId']==2:self.assertFalse(window['start']<40<window['end'])

    def test_unknown_or_omitted_windows_are_explicit_not_silently_covered(self):
        plan=evidence_plan(self.clip,self.session)
        candidate=validate_candidate(dict(summary='证据不足',subjects=[],assignments=[],issues=[]),plan)
        self.assertEqual(candidate['coverage']['classifiedWindows'],0)
        self.assertEqual(len(candidate['issues']),len(plan['windows']))
        self.assertTrue(all(i['kind']=='unresolved' for i in candidate['issues']))
        for output in [dict(summary='',subjects=[],assignments=[dict(windowId='invented',subjectId='s',confidence=.9,reason='x')],issues=[]),
                       dict(summary='',subjects=[],assignments=[],issues=[dict(kind='identity_uncertain',windowIds=['invented'],reason='x')])]:
            with self.assertRaises(ValueError):validate_candidate(output,plan)

    def test_repair_attempts_share_one_budget_and_do_not_reset_it(self):
        budgets=[]
        def repair(**kwargs):
            budgets.append(kwargs['job']['callTimeout']);time.sleep(.02)
            output=self.initial_answer(**kwargs)
            if len(budgets)==1:output['assignments'][0]['windowId']='invented'
            return output
        agent=self.initial_agent(repair,timeout=2);done=self.wait(agent,self.create(agent))
        self.assertEqual(done['status'],'ready',done);self.assertEqual(len(budgets),2)
        self.assertLess(budgets[1],budgets[0]);self.assertLessEqual(budgets[0],2)

    def test_source_key_excludes_session_but_includes_real_source_mapping(self):
        before=source_key(self.clip,'fixture',True)
        for field in ('source_time','source_frame_pts'):
            changed=deepcopy(self.clip);changed['frames'][0][field]=123
            self.assertNotEqual(source_key(changed,'fixture',True),before)
        self.assertNotEqual(source_key(self.clip,'fixture',False),before)
        self.assertNotEqual(source_key({**self.clip,'tracking_revision':'changed'},'fixture',True),before)

    def test_role_evidence_change_invalidates_source_cache_without_changing_tracking_fingerprint(self):
        agent=self.initial_agent();done=self.wait(agent,self.create(agent))
        self.clip['roleEvidenceSource']={'method':'matched-referee-evidence-v2','trackingFingerprint':'reference-other'}
        self.clip['frames'][0]['track_evidence']={'62':{'identity_review_required':True,'role_evidence':{'role':'referee'}}}
        for reader in (agent,self.initial_agent()):
            with self.assertRaises(ValueError):reader.get(done['jobId'],self.clip,'fixture',True)
            with self.assertRaises(ValueError):reader.adopt(done['jobId'],self.request,self.clip,'fixture',True)
        after=self.wait(agent,self.create(agent))
        self.assertNotEqual(after['sourceKey'],done['sourceKey']);self.assertNotEqual(after['jobId'],done['jobId'])
        self.assertEqual(len(self.calls),2);self.assertEqual(self.clip['tracking_fingerprint'],'b'*64)


if __name__=='__main__':
    unittest.main()
