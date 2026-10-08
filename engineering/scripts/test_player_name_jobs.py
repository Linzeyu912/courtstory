"""Name-task lifecycle and real per-game roster boundaries."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from player_game_roster import PlayerGameRoster
from player_name_jobs import PlayerNameJobs
from test_player_name_identity import fixture

ROOT = Path(__file__).resolve().parents[2]


class Provider:
    def status(self):
        return {'available': True, 'provider': 'test'}


class NameJobsTests(unittest.TestCase):
    def setUp(self):
        temporary_root=ROOT/'tmp/test-player-name-jobs'
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=temporary_root)
        self.session, self.clip = fixture()
        self.calls = []
        self.started, self.release = threading.Event(), threading.Event()
        def recognize(session, clip, video, tactics, roster, **kwargs):
            self.calls.append((session, kwargs))
            self.started.set()
            self.release.wait(2)
            return {'verified': False, 'candidates': [], 'reviewRequired': True}
        self.jobs = PlayerNameJobs(self.temp.name, None, object(), Provider(), recognize=recognize)
        self.request = {'session': self.session, 'clientRevision': 0, 'season': '2024-25', 'teamMap': {'A': 'BOS', 'B': 'NYK'}}

    def tearDown(self):
        self.release.set()
        self.jobs.close()
        self.jobs.pool.shutdown(wait=True)
        self.temp.cleanup()

    def create(self):
        return self.jobs.create(self.request, self.clip, 'video.mp4', 'original', True)

    def test_duplicate_snapshot_reuses_task_and_does_not_mutate_input(self):
        before = json.dumps(self.session, sort_keys=True)
        first = self.create()
        self.assertTrue(self.started.wait(1))
        second = self.create()
        self.assertEqual(first['jobId'], second['jobId'])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(json.dumps(self.session, sort_keys=True), before)
        self.assertIsNot(self.calls[0][0], self.session)
        self.assertIn('cancel_event', self.calls[0][1])
        self.assertTrue(str(self.calls[0][1]['work_dir']).endswith(first['jobId']))

    def test_cancelled_job_never_publishes_late_result(self):
        first = self.create()
        self.assertTrue(self.started.wait(1))
        self.jobs.cancel(first['jobId'], self.clip, 'original', True)
        self.release.set()
        self.jobs.pool.shutdown(wait=True)
        result = self.jobs.get(first['jobId'], self.clip, 'original', True)
        self.assertEqual(result['status'], 'cancelled')
        self.assertIsNone(result['candidate'])

    def test_task_context_cannot_be_read_in_other_video_or_qa_space(self):
        first = self.create()
        with self.assertRaises(ValueError):
            self.jobs.get(first['jobId'], self.clip, 'original', False)
        with self.assertRaises(ValueError):
            self.jobs.get(first['jobId'], {**self.clip, 'tracking_fingerprint': 'other'}, 'original', True)

    def test_ready_result_survives_local_service_restart(self):
        first = self.create()
        self.release.set()
        self.jobs.pool.shutdown(wait=True)
        restored = PlayerNameJobs(self.temp.name, None, object(), Provider())
        try:
            self.assertEqual(restored.get(first['jobId'], self.clip, 'original', True)['status'], 'ready')
        finally:
            restored.close()

    def test_all_provider_requests_failing_is_a_failed_job_not_identity_unknown(self):
        self.jobs.recognize=lambda *args,**kwargs:{'verified':False,'candidates':[],
            'usage':{'modelRequests':2,'successfulModelRequests':0,'failedModelRequests':2}}
        first=self.create();self.jobs.pool.shutdown(wait=True)
        result=self.jobs.get(first['jobId'],self.clip,'original',True)
        self.assertEqual(result['status'],'failed');self.assertIsNone(result['candidate'])
        self.assertIn('模型请求全部失败',result['message'])

    def test_game_roster_keeps_00_and_has_flagg_without_2k_rating(self):
        roster = PlayerGameRoster(ROOT/'data/player-rosters', '0022500701')
        self.assertEqual(roster.lookup('2025-26', 'DAL', '32')['candidates'][0]['name'], 'Cooper Flagg')
        self.assertEqual(roster.lookup('2025-26', 'DAL', '00')['candidates'][0]['name'], 'Max Christie')
        self.assertEqual(roster.lookup('2025-26', 'DAL', '0')['status'], 'no_match')
        self.assertEqual(roster.lookup('2025-26', 'DAL', '1')['status'], 'no_match', 'DNP omitted')
        with self.assertRaises(ValueError):
            roster.options('2024-25')

    def test_explicit_retry_does_not_reuse_a_partly_failed_ready_job(self):
        self.jobs.recognize=lambda *args,**kwargs:{'verified':False,'candidates':[],
            'usage':{'modelRequests':2,'successfulModelRequests':1,'failedModelRequests':1}}
        first=self.create()
        deadline=time.monotonic()+2
        while self.jobs.get(first['jobId'],self.clip,'original',True)['status']!='ready':
            if time.monotonic()>deadline:self.fail('Partial job did not finish')
            time.sleep(.01)
        second=self.create()
        self.assertNotEqual(first['jobId'],second['jobId'])
        self.assertEqual(self.jobs.get(first['jobId'],self.clip,'original',True)['status'],'ready')


if __name__=='__main__':
    unittest.main()
