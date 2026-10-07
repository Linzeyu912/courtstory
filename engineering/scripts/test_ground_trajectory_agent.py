"""Regressions found by running the dedicated Qwen agent on official video."""
import json
import io
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from ground_trajectory_agent import GroundTrajectoryAgent
from ground_trajectory_frame_cache import GroundTrajectoryFrameCache

TEST_TEMP_ROOT = Path(__file__).resolve().parent/'.test-tmp'
TEST_TEMP_ROOT.mkdir(exist_ok=True)


class GroundJobTests(unittest.TestCase):
    @staticmethod
    def fixture(folder):
        tactics = Mock(node=None)
        tactics.run.return_value = {'digest': 'preparation-digest'}
        clip = {'video_sha256': 'a'*64, 'tracking_fingerprint': 'b'*64,
                'tracking_revision': 'test', 'frames': [{'frame': 0, 'time': 0}]}
        players = [f'P{i}' for i in range(1, 11)]
        session = {'version': 1, 'videoHash': clip['video_sha256'], 'maxGapSeconds': 0,
                   'cuts': [], 'entities': [{'id': ident, 'role': 'player', 'anchors': []} for ident in players],
                   'courtPreparation': {'rawByPlayer': {ident: [{'x': 1, 'y': 2}] for ident in players}}}
        request = {'session': session, 'clientRevision': 0, 'entityIds': ['P1'],
                   'range': {'startFrame': 0, 'endFrameExclusive': 1}}
        return tactics, clip, session, request

    def test_first_job_is_persisted_before_worker_starts_and_survives_restart(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, _, request = self.fixture(folder)
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics)
            try:
                tactics.preparations.validate.return_value = None
                with patch.object(agent, 'status', return_value={'available': True}), \
                     patch.object(agent.pool, 'submit') as submit:
                    job = agent.create(request, clip, Path(folder)/'video.mp4', 'test', True)
                    directory = Path(folder)/'jobs'/job['jobId']
                    saved = json.loads((directory/'job.json').read_text(encoding='utf-8'))
                    source = json.loads((directory/'source.json').read_text(encoding='utf-8'))
                    self.assertEqual(saved['status'], 'queued')
                    self.assertIsInstance(saved['createdAt'], str)
                    self.assertEqual(saved['createdAt'], agent.jobs[job['jobId']]['createdAt'])
                    self.assertNotIn('request', saved)
                    self.assertEqual(source['request'], request)
                    submit.assert_called_once()
            finally:
                agent.close()
            restarted = GroundTrajectoryAgent(Path(folder)/'jobs', tactics)
            try:
                restored = restarted.get(job['jobId'], clip, 'test', True)
                self.assertEqual(restored['status'], 'interrupted')
                self.assertEqual(restored['base'], job['base'])
            finally:
                restarted.close()

    def test_old_inline_job_record_remains_recoverable(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, _, request = self.fixture(folder)
            root = Path(folder)/'jobs'; ident = 'legacy-job'
            directory = root/ident; directory.mkdir(parents=True)
            context = [clip['video_sha256'], clip['tracking_fingerprint'], 'test', 'test', True]
            old = {'jobId': ident, 'status': 'partial', 'message': 'old candidate', 'context': context,
                   'request': request, 'clip': clip, 'video': str(Path(folder)/'video.mp4'),
                   'base': {'clientRevision': 0}, 'candidate': {'jobId': ident, 'revision': 1},
                   'feedbackRevisions': [1], 'deliveredFrames': [0]}
            (directory/'job.json').write_text(json.dumps(old), encoding='utf-8')
            agent = GroundTrajectoryAgent(root, tactics)
            try:
                restored = agent.get(ident, clip, 'test', True)
                self.assertEqual(restored['status'], 'partial')
                self.assertEqual(restored['candidate'], old['candidate'])
                self.assertEqual(agent.jobs[ident]['request'], request)
            finally:
                agent.close()

    def test_configured_workers_run_distinct_jobs_at_the_same_time(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, _, request = self.fixture(folder)
            tactics.preparations.validate.return_value = None
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics, max_workers=2)
            gate = threading.Barrier(2)
            lock = threading.Lock(); active = 0; maximum = 0

            def worker(job):
                nonlocal active, maximum
                with lock:
                    active += 1; maximum = max(maximum, active)
                gate.wait(timeout=4)
                with lock: active -= 1

            try:
                with patch.object(agent, 'status', return_value={'available': True}), patch.object(agent, '_run', side_effect=worker):
                    for ident in ('P1', 'P2'):
                        job_request = {**request, 'entityIds': [ident]}
                        agent.create(job_request, clip, Path(folder)/'video.mp4', 'test', True)
                    agent.pool.shutdown(wait=True)
                self.assertEqual(maximum, 2)
            finally:
                agent.close()

    def test_concurrent_jobs_share_one_decode_for_the_same_source_frame(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, _, _ = self.fixture(folder)
            cache = GroundTrajectoryFrameCache()
            calls = []
            def decode(_video, _clip, indices):
                calls.append(list(indices)); time.sleep(.1)
                return [{'frame': i, 'time': float(i), 'dataUrl': 'data:image/jpeg;base64,AA=='} for i in indices]
            tactics.frames.side_effect = decode
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics, frame_cache=cache)
            jobs = [dict(jobId=f'job{i}', clip=clip, video='video', request={'range': {'startFrame': 0, 'endFrameExclusive': 1}}, frames={}) for i in range(2)]
            try:
                outputs = [None, None]
                threads = [threading.Thread(target=lambda n=n: outputs.__setitem__(n, agent._decode(jobs[n], [0]))) for n in range(2)]
                for thread in threads: thread.start()
                for thread in threads: thread.join(timeout=2)
                self.assertTrue(all(not thread.is_alive() for thread in threads))
                self.assertEqual(calls, [[0]])
                self.assertEqual([row[0]['frame'] for row in outputs], [0, 0])
                self.assertIsNot(outputs[0][0], outputs[1][0])
            finally:
                agent.close()

    def test_job_assets_and_mutable_frame_records_are_isolated(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, session, _ = self.fixture(folder)
            tactics.frames.return_value = [{'frame': 0, 'time': 0.0, 'dataUrl': 'data:image/jpeg;base64,AA=='}]
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics, frame_cache=GroundTrajectoryFrameCache())
            observed = []

            def inspect(_frames, _preparation, _ids, _mode, asset_folder):
                observed.append(Path(asset_folder))
                return ([{'type': 'image', 'data': 'AA==', 'mimeType': 'image/jpeg'}], [])

            jobs = []
            for ident in ('one', 'two'):
                jobs.append({'jobId': ident, 'request': {'session': session, 'entityIds': ['P1'],
                    'range': {'startFrame': 0, 'endFrameExclusive': 1}}, 'clip': clip, 'video': 'video',
                    'frames': {}, 'deliveredFrames': [], 'evidenceAssets': [], 'feedbackRevisions': [],
                    'context': [], 'base': {}, '_state_lock': threading.RLock()})
            try:
                with patch('ground_trajectory_images.inspect_images', side_effect=inspect):
                    for job in jobs:
                        agent._rpc(job, 'inspect_frames', {'frames': [0]})
                self.assertEqual(observed, [Path(folder)/'jobs'/'one'/'assets', Path(folder)/'jobs'/'two'/'assets'])
                jobs[0]['frames'][0]['dataUrl'] = 'changed'
                self.assertEqual(jobs[1]['frames'][0]['dataUrl'], 'data:image/jpeg;base64,AA==')
            finally:
                agent.close()

    def test_frozen_inputs_share_read_only_source_and_tools_receive_copied_points(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, session, request = self.fixture(folder)
            clip['frames'] = [{'frame': i, 'time': i/30} for i in range(3)]
            for points in session['courtPreparation']['rawByPlayer'].values():
                points.extend([{'x': i+1, 'y': i+2} for i in range(2)])
            tactics.preparations.validate.return_value = None
            tactics.frames.return_value = [{'frame': 0, 'time': 0.0, 'dataUrl': 'data:image/jpeg;base64,AA=='}]
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics, frozen_inputs=True,
                                          frame_cache=GroundTrajectoryFrameCache())
            try:
                with patch.object(agent, 'status', return_value={'available': True}), patch.object(agent.pool, 'submit'):
                    first_request = {**request, 'entityIds': ['P1'],
                        'range': {'startFrame': 0, 'endFrameExclusive': 1}, 'goal': 'P1 first segment'}
                    second_request = {**request, 'entityIds': ['P2'],
                        'range': {'startFrame': 1, 'endFrameExclusive': 3}, 'goal': 'P2 later segment'}
                    first = agent.create(first_request, clip, 'video', 'test', True)
                    second = agent.create(second_request, clip, 'video', 'test', True)
                first_job, second_job = agent.jobs[first['jobId']], agent.jobs[second['jobId']]
                self.assertIs(first_job['request']['session'], session)
                self.assertIs(second_job['request']['session'], session)
                self.assertIs(first_job['clip'], clip)
                self.assertEqual(first_job['_source_ref'], second_job['_source_ref'])
                first_job['request']['entityIds'].append('P3')
                self.assertEqual(second_job['request']['entityIds'], ['P2'])
                self.assertEqual(session['courtPreparation']['rawByPlayer']['P1'][0]['x'], 1)
                bad_candidate = {'jobId': first['jobId'], 'entityIds': ['P2'],
                    'range': first_job['request']['range'], 'baseDigest': first_job['base']['preparationDigest'],
                    'model': agent.config['model']}
                with self.assertRaisesRegex(ValueError, '候选修改了任务来源或范围'):
                    agent._candidate(first_job, bad_candidate)
                first_job['request']['entityIds'].pop()

                def inspect(_frames, visual, _ids, _mode, _assets):
                    visual['rawByPlayer']['P1'][0]['x'] = 999
                    return ([{'type': 'image', 'data': 'AA==', 'mimeType': 'image/jpeg'}], [])

                with patch('ground_trajectory_images.inspect_images', side_effect=inspect):
                    agent._rpc(first_job, 'inspect_frames', {'frames': [0]})
                self.assertEqual(session['courtPreparation']['rawByPlayer']['P1'][0]['x'], 1)
                source_files = list((Path(folder)/'jobs'/'sources').glob('*.json'))
                self.assertEqual(len(source_files), 1)
                self.assertEqual(json.loads((Path(folder)/'jobs'/first['jobId']/'job.json').read_text(encoding='utf-8'))['sourceRef'],
                                 first_job['_source_ref'])
            finally:
                agent.close()
            restored = GroundTrajectoryAgent(Path(folder)/'jobs', tactics, frozen_inputs=True,
                                             frame_cache=GroundTrajectoryFrameCache())
            try:
                one = restored.jobs[first['jobId']]['request']
                two = restored.jobs[second['jobId']]['request']
                self.assertEqual((one['entityIds'], one['range'], one['goal']),
                    (['P1'], {'startFrame': 0, 'endFrameExclusive': 1}, 'P1 first segment'))
                self.assertEqual((two['entityIds'], two['range'], two['goal']),
                    (['P2'], {'startFrame': 1, 'endFrameExclusive': 3}, 'P2 later segment'))
                self.assertIs(one['session'], two['session'])
                self.assertEqual(restored.jobs[first['jobId']]['clip'], restored.jobs[second['jobId']]['clip'])
            finally:
                restored.close()

    def test_model_request_permits_bound_parallel_lanes(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', Mock(node=None), request_concurrency=3)
            lock = threading.Lock(); observed_max = 0
            def lane(index):
                nonlocal observed_max
                job = {'jobId': f'job-{index}', 'cancel': threading.Event(), '_state_lock': threading.RLock()}
                agent._rpc(job, 'acquire_model_slot', {})
                with lock: observed_max = max(observed_max, agent.request_activity['active'])
                time.sleep(.03)
                agent._rpc(job, 'release_model_slot', {})
            threads = [threading.Thread(target=lane, args=(i,)) for i in range(8)]
            try:
                for thread in threads: thread.start()
                for thread in threads: thread.join(timeout=2)
                self.assertTrue(all(not thread.is_alive() for thread in threads))
                self.assertLessEqual(observed_max, 3)
                self.assertEqual(agent.request_activity['peakActive'], 3)
                self.assertEqual(agent.request_activity['active'], 0)
            finally:
                agent.close()

    def test_model_request_admissions_obey_minimum_interval(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', Mock(node=None), request_concurrency=2,
                                          request_interval_seconds=.05)
            admitted = []; lock = threading.Lock()
            def lane(index):
                job = {'jobId': f'rate-{index}', 'cancel': threading.Event(), '_state_lock': threading.RLock()}
                agent._rpc(job, 'acquire_model_slot', {})
                with lock: admitted.append(time.monotonic())
                agent._rpc(job, 'release_model_slot', {})
            threads = [threading.Thread(target=lane, args=(i,)) for i in range(4)]
            try:
                for thread in threads: thread.start()
                for thread in threads: thread.join(timeout=2)
                self.assertTrue(all(not thread.is_alive() for thread in threads))
                admitted.sort()
                self.assertEqual(len(admitted), 4)
                self.assertTrue(all(later-earlier >= .04 for earlier, later in zip(admitted, admitted[1:])))
            finally:
                agent.close()

    def test_cancelled_waiter_exits_and_releases_are_idempotent(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            agent = GroundTrajectoryAgent(Path(folder)/'jobs', Mock(node=None), request_concurrency=1)
            holder = {'jobId': 'holder', 'cancel': threading.Event(), '_state_lock': threading.RLock()}
            cancel = threading.Event()
            waiter = {'jobId': 'waiter', 'cancel': cancel, '_state_lock': threading.RLock()}
            failures = []
            try:
                agent._rpc(holder, 'acquire_model_slot', {})
                thread = threading.Thread(target=lambda: self._capture_error(
                    lambda: agent._rpc(waiter, 'acquire_model_slot', {}), failures))
                thread.start()
                deadline = time.monotonic()+1
                while agent.request_activity['waiting'] == 0 and time.monotonic() < deadline: time.sleep(.01)
                cancel.set(); agent._model_request_gate.wake(); thread.join(timeout=1)
                self.assertFalse(thread.is_alive())
                self.assertEqual(len(failures), 1)
                self.assertIn('取消', str(failures[0]))
                self.assertTrue(agent._rpc(holder, 'release_model_slot', {})['released'])
                self.assertFalse(agent._rpc(holder, 'release_model_slot', {})['released'])
                self.assertEqual(agent.request_activity['active'], 0)
                self.assertEqual(agent.request_activity['waiting'], 0)
            finally:
                agent.close()

    @staticmethod
    def _capture_error(action, errors):
        try: action()
        except Exception as error: errors.append(error)

    def test_legacy_job_restores_activity_as_interrupted_and_preserves_source(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, _, request = self.fixture(folder)
            root = Path(folder)/'jobs'; ident = 'active-legacy'; directory = root/ident; directory.mkdir(parents=True)
            context = [clip['video_sha256'], clip['tracking_fingerprint'], 'test', 'test', True]
            old = {'jobId': ident, 'status': 'observing', 'message': 'old progress', 'context': context,
                   'request': request, 'clip': clip, 'video': str(Path(folder)/'video.mp4'),
                   'base': {'clientRevision': 0}, 'candidate': {'jobId': ident, 'revision': 2}}
            (directory/'job.json').write_text(json.dumps(old), encoding='utf-8')
            agent = GroundTrajectoryAgent(root, tactics)
            try:
                restored = agent.get(ident, clip, 'test', True)
                self.assertEqual(restored['status'], 'interrupted')
                self.assertEqual(agent.jobs[ident]['request'], request)
                self.assertTrue((directory/'job.json').exists())
            finally:
                agent.close()

    def test_worker_progress_error_is_redacted_and_persisted(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, _, request = self.fixture(folder)
            tactics.preparations.validate.return_value = None

            class WorkerProcess:
                def __init__(self):
                    self.stdin = io.StringIO()
                    self.stdout = io.StringIO(json.dumps({'type': 'progress', 'status': 'observing',
                        'message': 'request failed', 'error': 'ECONNRESET token-secret'})+'\n')
                    self.stderr = io.StringIO('')
                @staticmethod
                def poll(): return 0

            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics)
            try:
                with patch.object(agent, 'status', return_value={'available': True}), \
                     patch.object(agent.pool, 'submit'), patch('ground_trajectory_agent.subprocess.Popen',
                                                               return_value=WorkerProcess()), \
                     patch.dict('os.environ', {'QWEN_KEY': 'token-secret'}):
                    job = agent.create(request, clip, Path(folder)/'video.mp4', 'test', True)
                    agent._run(agent.jobs[job['jobId']])
                restored = agent.jobs[job['jobId']]
                saved = json.loads((Path(folder)/'jobs'/job['jobId']/'job.json').read_text(encoding='utf-8'))
                self.assertEqual(restored['lastError'], 'ECONNRESET [redacted]')
                self.assertEqual(agent.get(job['jobId'], clip, 'test', True)['lastError'], 'ECONNRESET [redacted]')
                self.assertEqual(saved['lastError'], 'ECONNRESET [redacted]')
                self.assertNotIn('token-secret', json.dumps(saved))
            finally:
                agent.close()

    def test_successful_request_clears_last_error_but_keeps_audit(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as folder:
            tactics, clip, _, request = self.fixture(folder)
            tactics.preparations.validate.return_value = None
            response_event = {'tool': 'model_response', 'request': 2, 'stopReason': 'toolUse'}

            class WorkerProcess:
                def __init__(self):
                    self.stdin = io.StringIO()
                    self.stdout = io.StringIO(json.dumps({'type': 'progress', 'status': 'observing',
                        'message': 'response received', 'clearLastError': True, 'event': response_event})+'\n')
                    self.stderr = io.StringIO('')
                @staticmethod
                def poll(): return 0

            agent = GroundTrajectoryAgent(Path(folder)/'jobs', tactics)
            try:
                with patch.object(agent, 'status', return_value={'available': True}), \
                     patch.object(agent.pool, 'submit'), patch('ground_trajectory_agent.subprocess.Popen',
                                                               return_value=WorkerProcess()):
                    job = agent.create(request, clip, Path(folder)/'video.mp4', 'test', True)
                    agent.jobs[job['jobId']]['lastError'] = 'old socket failure'
                    agent._persist(agent.jobs[job['jobId']])
                    agent._run(agent.jobs[job['jobId']])
                restored = agent.jobs[job['jobId']]
                saved = json.loads((Path(folder)/'jobs'/job['jobId']/'job.json').read_text(encoding='utf-8'))
                self.assertNotIn('lastError', restored)
                self.assertNotIn('lastError', agent.get(job['jobId'], clip, 'test', True))
                self.assertNotIn('lastError', saved)
                self.assertEqual(saved['audit'], [response_event])
            finally:
                agent.close()


if __name__ == '__main__':
    unittest.main()
