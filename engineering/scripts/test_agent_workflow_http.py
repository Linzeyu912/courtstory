"""Real HTTP authorization tests against the thin adapter, using synthetic tools."""
from copy import deepcopy
import http.client
import json
import threading
import time
import unittest

from agent_workflow_http import make_server
from test_agent_workflow_runner import WorkflowFixture


class HTTPTests(WorkflowFixture):
    def setUp(self):
        super().setUp()
        self.server = make_server(self.runner, ('127.0.0.1', 0), {'test-token-alice': 'alice', 'test-token-bob': 'bob'})
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.shutdown)

    def shutdown(self):
        self.server.shutdown(); self.thread.join(timeout=2); self.server.server_close()

    def request_http(self, method, path, body=None, token='test-token-alice', origin=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=15)
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if origin:
            headers['Origin'] = origin
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None, headers)
            response = connection.getresponse()
            raw = response.read()
            return response.status, json.loads(raw)
        finally:
            connection.close()

    def test_unauthorized_foreign_caller_and_browser_origin(self):
        run_id = self.submit()
        path = '/v1/workflows/' + run_id
        self.assertEqual(self.request_http('GET', path, token=None)[0], 401)
        code, data = self.request_http('GET', path, token='test-token-bob')
        self.assertEqual(code, 400)
        self.assertNotIn(run_id, json.dumps(data))
        self.assertEqual(self.request_http('GET', path, origin='https://foreign.example')[0], 403)
        code, data = self.request_http('GET', path)
        self.assertEqual(code, 200)
        self.assertEqual(data['runId'], run_id)
        self.assertNotIn(str(self.root), json.dumps(data))

    def test_canonical_submit_conflict_and_arbitrary_path_are_rejected(self):
        code, data = self.request_http('POST', '/v1/workflows', self.request)
        self.assertIn(code, (200, 202))
        original = data['runId']
        repeat = deepcopy(self.request); repeat['requestId'] = 'next-http-request'
        self.assertEqual(self.request_http('POST', '/v1/workflows', repeat)[1]['runId'], original)
        repeat['args']['goal'] = 'different'
        code, data = self.request_http('POST', '/v1/workflows', repeat)
        self.assertEqual(code, 409)
        self.assertEqual(data['error']['reasonCode'], 'idempotency_conflict')
        repeat['args']['path'] = 'C:/arbitrary-file'
        code, data = self.request_http('POST', '/v1/workflows', repeat)
        self.assertEqual(code, 400)
        self.assertEqual(data['error']['reasonCode'], 'invalid_input')

    def test_server_start_reconnects_to_durable_queued_run(self):
        run_id = self.submit()  # Local enqueue; no worker has run the task yet.
        restarted = make_server(self.runner, ('127.0.0.1', 0), {'replacement-token': 'alice'})
        try:
            deadline = time.monotonic() + 10
            while self.store.get('alice', run_id)['status'] in {'queued', 'running'} and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertEqual(self.store.get('alice', run_id)['status'], 'succeeded')
            self.assertEqual(self.calls['commit_candidate'], 1)
            self.assertEqual(self.calls['render_projected_video'], 1)
        finally:
            restarted.server_close()


if __name__ == '__main__':
    unittest.main()
