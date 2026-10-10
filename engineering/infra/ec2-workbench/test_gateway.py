import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class GatewaySecurityTests(unittest.TestCase):
    def test_health_waits_for_workbench_listener(self):
        handler = object.__new__(gateway.Handler)
        handler.path, handler.command = '/health', 'GET'
        handler.reply = Mock()
        with patch.object(gateway, 'configuration', return_value={}), patch.object(gateway.socket, 'create_connection', side_effect=ConnectionRefusedError):
            handler.handle_request()
        self.assertEqual(handler.reply.call_args.args[0], 503)
        with patch.object(gateway, 'configuration', return_value={}), patch.object(gateway.socket, 'create_connection'):
            handler.handle_request()
        self.assertEqual(handler.reply.call_args.args[0], 200)

    def test_legacy_login_redirects_to_workbench_without_code(self):
        handler = object.__new__(gateway.Handler)
        handler.path, handler.command = '/login', 'GET'
        handler.headers = {'Host': 'demo.cloudfront.net'}
        handler.reply = Mock()
        with patch.object(gateway, 'configuration', return_value={'origin': 'https://demo.cloudfront.net'}):
            handler.handle_request()
        self.assertEqual(handler.reply.call_args.args[0], 303)
        self.assertEqual(handler.reply.call_args.kwargs['headers']['Location'], '/')

    def test_api_without_session_is_forwarded(self):
        handler = object.__new__(gateway.Handler)
        handler.path, handler.command = '/api/library', 'GET'
        handler.headers = {'Host': 'demo.cloudfront.net'}
        handler.reply = Mock()
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.wfile = Mock()
        response = Mock(status=200)
        response.getheaders.return_value = [('Content-Type', 'application/json')]
        response.read.side_effect = [b'{"samples":[]}', b'']
        with patch.object(gateway, 'configuration', return_value={'origin': 'https://demo.cloudfront.net'}), patch.object(gateway.http.client, 'HTTPConnection') as connection:
            connection.return_value.getresponse.return_value = response
            handler.handle_request()
        handler.reply.assert_not_called()
        handler.send_response.assert_called_once_with(200)
        handler.wfile.write.assert_called_once_with(b'{"samples":[]}')

    def test_backup_includes_library_state_and_excludes_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['cloud-library.json', 'artifacts/cloud-state.json',
                         'data/local-videos/example.mov', 'data/local-workbench/auth.json']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('{}')
            names = {p.relative_to(root.resolve()).as_posix() for p in gateway.state_files(root)}
            self.assertEqual(names, {'cloud-library.json', 'artifacts/cloud-state.json',
                                     'data/local-videos/example.mov'})

    def test_rejects_unconfigured_origin(self):
        self.assertFalse(gateway.trusted_origin({'Host': 'demo.cloudfront.net'}, ''))

    def test_rejects_cross_site_post(self):
        self.assertFalse(gateway.trusted_origin({'Host': 'demo.cloudfront.net', 'Origin': 'https://other.example'}, 'https://demo.cloudfront.net'))

    def test_rejects_wrong_host_even_with_valid_origin(self):
        self.assertFalse(gateway.trusted_origin({'Host': 'direct-ec2.example', 'Origin': 'https://demo.cloudfront.net'}, 'https://demo.cloudfront.net'))

    def test_accepts_same_origin(self):
        self.assertTrue(gateway.trusted_origin({'Host': 'demo.cloudfront.net', 'Origin': 'https://demo.cloudfront.net'}, 'https://demo.cloudfront.net'))

    def test_get_without_origin_still_requires_correct_host(self):
        self.assertTrue(gateway.trusted_origin({'Host': 'demo.cloudfront.net'}, 'https://demo.cloudfront.net'))


if __name__ == '__main__':
    unittest.main()
