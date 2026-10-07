import errno
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from tactics_agent import TacticsAgent


class TacticsStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.agent = TacticsAgent.__new__(TacticsAgent)
        self.agent.folder = self.folder
        self.agent.lock = threading.RLock()
        self.job = {'jobId':'example', 'status':'ready', 'stages':[], 'progress':{},
                    'previewDocument':{'large':'x'*2_000_000}, 'previewFrames':[{'dataUrl':'y'*1_000_000}]}
        (self.folder/'example').mkdir()

    def test_state_is_small_and_immutable_previews_are_not_rewritten_per_progress_tick(self):
        self.agent._persist(self.job)
        path=self.folder/'example/state.json'
        state=json.loads(path.read_text(encoding='utf-8'))
        self.assertLess(path.stat().st_size,2000)
        self.assertNotIn('previewDocument',state)
        self.assertNotIn('previewFrames',state)
        from tactics_job_storage import read_job_state
        self.assertEqual(read_job_state(path.parent),self.job)
        blobs={p.name:p.stat().st_mtime_ns for p in path.parent.glob('preview*.json')}
        self.job['progress']['elapsedSeconds']=123
        self.agent._persist(self.job)
        self.assertEqual(blobs,{p.name:p.stat().st_mtime_ns for p in path.parent.glob('preview*.json')})
        self.assertEqual(TacticsAgent._public(self.job)['previewDocument'],self.job['previewDocument'])

    def test_legacy_inline_state_load_and_new_reference_integrity(self):
        from tactics_job_storage import read_job_state, StorageFailure
        path=self.folder/'example/state.json'
        path.write_text(json.dumps(self.job))
        self.assertEqual(read_job_state(path.parent),self.job)
        self.agent._persist(self.job)
        state=json.loads(path.read_text(encoding='utf-8'))
        ref=state['previewRefs']['previewDocument']
        for changed in [dict(ref,file='../outside.json'),dict(ref,bytes=ref['bytes']+1),dict(ref,sha256='0'*64)]:
            state['previewRefs']['previewDocument']=changed;path.write_text(json.dumps(state))
            with self.assertRaises(StorageFailure):read_job_state(path.parent)
        state['previewRefs']['previewDocument']=ref;path.write_text(json.dumps(state))
        blob=path.parent/ref['file'];blob.write_bytes(b'X'*ref['bytes'])
        with self.assertRaises(StorageFailure):read_job_state(path.parent)

    def test_atomic_replace_retries_only_bounded_windows_lock_errors(self):
        from tactics_job_storage import atomic_job_json, StorageFailure
        path=self.folder/'state.json';path.write_text('{"old":true}')
        original=Path.replace
        calls=[]
        def replace(source,target):
            calls.append(str(source))
            if len(calls)<3:
                error=PermissionError('locked');error.winerror=32;raise error
            return original(source,target)
        with patch('tactics_job_storage.Path.replace',replace),patch('tactics_job_storage.time.sleep') as wait:
            atomic_job_json(path,{'new':True})
            self.assertEqual(len(calls),3);self.assertEqual(wait.call_count,2)
        for code in (5,32,33):
            error=PermissionError('locked');error.winerror=code
            with patch('tactics_job_storage.Path.replace',side_effect=error) as replace,patch('tactics_job_storage.time.sleep'):
                with self.assertRaises(StorageFailure) as caught:atomic_job_json(path,{'bad':True})
                self.assertEqual(replace.call_count,4);self.assertEqual(caught.exception.code,'storage')
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')),{'new':True})
        with patch('tactics_job_storage.Path.replace',side_effect=OSError(errno.ENOSPC,'disk full')) as replace:
            with self.assertRaises(StorageFailure) as caught:atomic_job_json(path,{'bad':True})
            self.assertEqual(replace.call_count,1);self.assertFalse(caught.exception.retryable)
        self.assertEqual(list(self.folder.glob('.*.tmp')),[])

    def test_progress_storage_error_does_not_kill_model_and_records_process_outcome(self):
        from tactics_job_storage import StorageFailure
        agent=self.agent;agent.timeout=5;agent.no_response_timeout=5;agent.reasoning_effort='low';agent.model_override='gpt-6.1-sol'
        agent.system_proxy_fallback=False;agent.codex='unused';agent.status=lambda:{'available':True}
        agent._persist=lambda job: (_ for _ in ()).throw(StorageFailure('write denied',retryable=False))
        job={'jobId':'example','stages':[{'stageId':'stage-1'}],'progress':{'currentStageId':'stage-1'},'cancel':threading.Event()}
        path=self.folder/'result.json';instances=[]
        class Process:
            pid=123;returncode=None
            def __init__(self,*args,**kwargs):self.out=kwargs['stdout'];self.calls=0;self.killed=False;instances.append(self)
            def communicate(self,input=None,timeout=None):
                self.calls+=1
                if self.calls==1:
                    self.out.write('{"type":"turn.started"}\n');self.out.flush()
                    raise subprocess.TimeoutExpired('probe',1)
                self.out.write('{"type":"turn.completed"}\n');self.out.flush()
                path.write_text('{"answer":"ok"}');self.returncode=0
            def kill(self):self.killed=True;self.returncode=1
        with patch('tactics_agent.subprocess.Popen',Process):
            output=agent._execute_cli(job=job,directory=self.folder,schema=self.folder/'schema.json',result=path,images=[],prompt='test')
        self.assertEqual(output,{'answer':'ok'});self.assertFalse(instances[0].killed)
        runtime=json.loads((self.folder/'runtime.json').read_text(encoding='utf-8'))
        self.assertEqual(runtime['exitCode'],0);self.assertEqual(runtime['terminationReason'],'completed')
        self.assertTrue(runtime['resultExists']);self.assertEqual(job['storageIssue']['code'],'storage')

    @unittest.skipUnless(os.name=='nt','Windows read-handle replacement semantics')
    def test_real_windows_reader_is_bounded_and_preserves_original_until_released(self):
        from tactics_job_storage import atomic_job_json, StorageFailure
        path=self.folder/'locked.json';path.write_text('{"old":true}')
        with path.open('rb'):
            started=time.monotonic()
            with self.assertRaises(StorageFailure):atomic_job_json(path,{'new':True})
            self.assertLess(time.monotonic()-started,1)
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')),{'old':True})
        atomic_job_json(path,{'new':True})
        self.assertEqual(json.loads(path.read_text(encoding='utf-8')),{'new':True})

    def test_preview_exists_and_cached_stat_errors_are_storage_failures(self):
        from tactics_job_storage import JobStateStore, StorageFailure
        directory=self.folder/'example'
        store=JobStateStore();store.save(directory,self.job)
        for current in (store,JobStateStore()):
            with patch('tactics_job_storage.Path.stat',side_effect=PermissionError('blocked metadata')):
                with self.assertRaises(StorageFailure):current.save(directory,self.job)


class StorageCheckpointTests(unittest.TestCase):
    # Reuse the real validator setup without inheriting its unrelated tests.
    from test_tactics_agent import AgentTests as _Fixture
    setUp = _Fixture.setUp
    make_agent = _Fixture.make_agent
    wait = _Fixture.wait

    def test_create_and_retry_storage_failure_never_leave_unsubmitted_running_job(self):
        from tactics_job_storage import StorageFailure
        agent=self.make_agent()
        agent._persist=lambda job: (_ for _ in ()).throw(StorageFailure('fixture full disk'))
        with patch.object(agent.pool,'submit') as submit:
            failed=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
            self.assertEqual(failed['failure']['code'],'storage');self.assertEqual(failed['status'],'failed')
            self.assertFalse(agent.jobs[failed['jobId']]['running']);submit.assert_not_called()
            retried=agent.retry(failed['jobId'],self.request,self.clip,'demo',True)
            self.assertEqual(retried['failure']['code'],'storage');self.assertFalse(agent.jobs[failed['jobId']]['running'])
            submit.assert_not_called()
            agent.jobs[failed['jobId']]['status']='queued'
            cancelled=agent.cancel(failed['jobId'],self.clip,'demo',True)
            self.assertEqual(cancelled['status'],'cancelled');self.assertEqual(cancelled['storageIssue']['code'],'storage')

    def test_required_checkpoint_failure_retains_received_or_validated_result_without_model_rerun(self):
        from tactics_job_storage import StorageFailure
        for checkpoint in ('validating','ready'):
            with self.subTest(checkpoint=checkpoint):
                calls=[];blocked=[True]
                def execute(**kwargs):calls.append(1);return self.output
                agent=TacticsAgent(self.folder/checkpoint,self.tactics,use_visual_facts=False,codex_path=self.node,execute=execute)
                self.addCleanup(agent.close)
                original=agent._persist
                def persist(job):
                    if blocked[0] and any(s['status']==checkpoint for s in job['stages']):
                        raise StorageFailure('fixture disk full',retryable=False)
                    return original(job)
                agent._persist=persist
                job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
                failed=self.wait(agent,job)
                self.assertEqual(failed['failure']['code'],'storage',failed)
                self.assertEqual(len(calls),1)
                self.assertTrue(failed['canRetry'])
                self.assertEqual(failed['stages'][0]['status'],'ready' if checkpoint=='ready' else 'failed')
                blocked[0]=False
                retry=agent.retry(job['jobId'],self.request,self.clip,'demo',True)
                done=self.wait(agent,retry)
                self.assertEqual(done['status'],'ready',done)
                self.assertEqual(len(calls),1)
                self.assertEqual(len(done['previewDocument']['annotations']['items']),1)

    def test_restart_recovers_cli_result_when_post_response_checkpoint_cannot_be_saved(self):
        from tactics_job_storage import StorageFailure
        blocked=[False];calls=[]
        def execute(**kwargs):
            calls.append(1);kwargs['result'].write_text(json.dumps(self.output),encoding='utf-8');blocked[0]=True
            return self.output
        agent=self.make_agent(execute);original=agent._persist
        def persist(job):
            if blocked[0]:raise StorageFailure('fixture disk full')
            return original(job)
        agent._persist=persist
        job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        failed=self.wait(agent,job);self.assertEqual(failed['failure']['code'],'storage')
        recovered=TacticsAgent(agent.folder,self.tactics,use_visual_facts=False,codex_path=self.node,
                              execute=lambda **kwargs:self.fail('must reuse received result after restart'))
        self.addCleanup(recovered.close)
        restored=recovered.get(job['jobId'],self.clip,'demo',True)
        retry=recovered.retry(job['jobId'],self.request,self.clip,'demo',True)
        done=self.wait(recovered,retry)
        self.assertEqual(done['status'],'ready',done);self.assertEqual(len(calls),1)


if __name__=='__main__':unittest.main()
