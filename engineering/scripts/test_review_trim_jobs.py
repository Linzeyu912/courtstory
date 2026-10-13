"""Offline tests for trim scheduling, failures and retention."""
from copy import deepcopy
import threading
import time
import unittest

from review_trim_jobs import ReviewTrimJobs


class ReviewTrimJobsTests(unittest.TestCase):
    def setUp(self):
        self.services = []
        self.release = threading.Event()

    def tearDown(self):
        self.release.set()
        for service in self.services:
            service.close()
            service._worker.join(timeout=2)
            self.assertFalse(service._worker.is_alive())

    def service(self, operation, **options):
        service = ReviewTrimJobs(operation, **options)
        self.services.append(service)
        return service

    def finished(self, service, ident):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            job = service.get(ident)
            if job and job['status'] in ('ready', 'error'):
                return job
            time.sleep(.005)
        self.fail('Trim job failed to reach a terminal state')

    def test_submit_returns_while_slow_trim_runs_and_progress_is_readable(self):
        started = threading.Event()
        calls = []

        def operation(request, progress):
            calls.append(threading.get_ident())
            progress('正在编码片段。')
            started.set()
            self.release.wait(2)
            return {'sample': 'new-clip', 'frames': 3, 'sourceCuts': request['ranges'], 'audioPolicy': 'keep'}

        service = self.service(operation)
        request = {'ranges': [{'start': 1, 'end': 3}]}
        expected = deepcopy(request)
        job = service.submit(request)
        request['ranges'][0]['start'] = 99
        self.assertEqual(job['status'], 'queued')
        self.assertTrue(started.wait(1))
        self.assertNotEqual(calls, [threading.get_ident()])
        running = service.get(job['id'])
        self.assertEqual(running['status'], 'running')
        self.assertEqual(running['message'], '正在编码片段。')
        running['message'] = 'changed by client'
        self.assertEqual(service.get(job['id'])['message'], '正在编码片段。')
        self.release.set()
        result = self.finished(service, job['id'])
        self.assertEqual(result['result']['sourceCuts'], expected['ranges'])

    def test_waiting_for_external_library_lock_does_not_block_job_status_or_queue(self):
        library_lock = threading.Lock()
        started = threading.Event()

        def operation(request, progress):
            started.set()
            with library_lock:
                return {'sample': request['sample']}

        service = self.service(operation)
        with library_lock:
            first = service.submit({'sample': 'first'})
            self.assertTrue(started.wait(1))
            self.assertEqual(service.get(first['id'])['status'], 'running')
            second = service.submit({'sample': 'second'})
            self.assertEqual(service.get(second['id'])['status'], 'queued')
        self.assertEqual(self.finished(service, first['id'])['status'], 'ready')
        self.assertEqual(self.finished(service, second['id'])['status'], 'ready')

    def test_error_is_returned_and_next_job_still_runs(self):
        def operation(request, progress):
            if request.get('fail'):
                raise ValueError('无法读取源视频。')
            return {'sample': 'good'}

        service = self.service(operation)
        failed = self.finished(service, service.submit({'fail': True})['id'])
        self.assertEqual(failed['status'], 'error')
        self.assertEqual(failed['error'], '无法读取源视频。')
        self.assertEqual(self.finished(service, service.submit({})['id'])['status'], 'ready')

    def test_queue_is_bounded_and_only_one_trim_runs(self):
        started = threading.Event()
        calls = []

        def operation(request, progress):
            calls.append(request['sample'])
            started.set()
            self.release.wait(2)
            return {'sample': request['sample']}

        service = self.service(operation, max_queued=1)
        first = service.submit({'sample': 'first'})
        self.assertTrue(started.wait(1))
        second = service.submit({'sample': 'second'})
        with self.assertRaisesRegex(ValueError, '队列已满'):
            service.submit({'sample': 'third'})
        self.assertEqual(calls, ['first'])
        self.release.set()
        self.finished(service, first['id'])
        self.finished(service, second['id'])
        self.assertEqual(calls, ['first', 'second'])

    def test_completed_results_are_bounded_and_snapshots_are_independent(self):
        service = self.service(lambda request, progress: {'sample': 'clip', 'frames': [1]}, max_completed=2)
        ids = []
        for _ in range(3):
            ids.append(service.submit({})['id'])
            self.finished(service, ids[-1])
        self.assertIsNone(service.get(ids[0]))
        latest = service.get(ids[-1])
        latest['result']['frames'].append(2)
        self.assertEqual(service.get(ids[-1])['result']['frames'], [1])
        self.assertIsNone(service.get('missing'))

    def test_close_cancels_waiting_work_but_allows_running_trim_to_finish(self):
        started = threading.Event()
        calls = []

        def operation(request, progress):
            calls.append(request['sample'])
            started.set()
            self.release.wait(2)
            return {'sample': request['sample']}

        service = self.service(operation)
        first = service.submit({'sample': 'first'})
        self.assertTrue(started.wait(1))
        second = service.submit({'sample': 'second'})
        service.close()
        service.close()
        self.assertEqual(service.get(second['id'])['status'], 'error')
        with self.assertRaisesRegex(ValueError, '已停止'):
            service.submit({'sample': 'third'})
        self.release.set()
        self.assertEqual(self.finished(service, first['id'])['status'], 'ready')
        self.assertEqual(calls, ['first'])


if __name__ == '__main__':
    unittest.main()
