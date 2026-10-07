"""Local HTTP checks: runtime health must not depend on SDK initialization."""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch


class AgentStartupTests(unittest.TestCase):
    def setUp(self):
        sdk_unavailable = patch.dict(sys.modules, {
            'boto3': None, 'botocore': None, 'botocore.config': None})
        sdk_unavailable.start()
        self.addCleanup(sdk_unavailable.stop)
        with patch.dict(os.environ, {'HKS_BUCKET': 'test-bucket', 'HKS_PREFIX': 'test-release'}):
            spec = importlib.util.spec_from_file_location(
                'agent_main_test', Path(__file__).with_name('agent_main.py'))
            self.agent = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.agent)
        self.server = self.agent.ThreadingHTTPServer(('127.0.0.1', 0), self.agent.Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)

    def request(self, method, path, payload=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=2)
        try:
            body = None if payload is None else json.dumps(payload)
            connection.request(method, path, body=body,
                               headers={'Content-Type': 'application/json'})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_ping_works_without_boto3(self):
        self.assertEqual(self.request('GET', '/ping'), (200, {'status': 'Healthy'}))
        self.assertEqual(self.agent.get_clients.cache_info().misses, 0)

    def test_invalid_input_does_not_initialize_clients(self):
        with patch.object(self.agent, 'get_clients', side_effect=AssertionError('SDK initialized')) as clients:
            status, body = self.request('POST', '/invocations', {'inputKey': 'outside/input.json'})
        self.assertEqual(status, 200)
        self.assertEqual(body, {'error': 'ValueError: Invalid input key'})
        clients.assert_not_called()


if __name__ == '__main__':
    unittest.main()
