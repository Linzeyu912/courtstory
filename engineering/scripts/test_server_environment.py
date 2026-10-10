"""Explicit server configuration loading uses fake keys and never contacts providers."""
import codecs
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import serve_player_review


class ServerEnvironmentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root / 'explicit.env'

    def load(self, path):
        loader = getattr(serve_player_review, 'load_server_environment', None)
        self.assertTrue(callable(loader), 'server must offer explicit environment-file loading')
        return loader(path)

    def test_supported_encodings_load_values_without_printing_them_or_inventing_tts_credentials(self):
        source = 'OPEN_ROUTER_KEY="fake-router-value"\nARK_API_KEY=fake-ark-value\nLABEL=测试配置\n'
        for name, content in [('utf8', source.encode('utf-8')), ('utf8-bom', source.encode('utf-8-sig')),
                              ('utf16-le', codecs.BOM_UTF16_LE + source.encode('utf-16-le')),
                              ('utf16-be', codecs.BOM_UTF16_BE + source.encode('utf-16-be'))]:
            with self.subTest(encoding=name), patch.dict(os.environ, {}, clear=True):
                self.path.write_bytes(content)
                output = io.StringIO()
                with redirect_stdout(output), redirect_stderr(output):
                    self.load(self.path)
                self.assertEqual(os.environ['OPEN_ROUTER_KEY'], 'fake-router-value')
                self.assertEqual(os.environ['LABEL'], '测试配置')
                self.assertNotIn('VOLCENGINE_TTS_API_KEY', os.environ)
                self.assertEqual(output.getvalue(), '')
                self.assertEqual(self.path.read_bytes(), content, 'loading never rewrites the source file')

    def test_existing_same_name_environment_wins_and_is_inherited_by_a_child(self):
        self.path.write_text('OPEN_ROUTER_KEY=fake-file-value\nCHILD_ALIAS=${OPEN_ROUTER_KEY}\n', encoding='utf-8')
        with patch.dict(os.environ, {'OPEN_ROUTER_KEY': 'fake-process-value'}, clear=True):
            self.load(self.path)
            self.assertEqual(os.environ['OPEN_ROUTER_KEY'], 'fake-process-value')
            child = subprocess.run([sys.executable, '-c',
                'import json,os; print(json.dumps([os.environ.get("OPEN_ROUTER_KEY")=="fake-process-value",'
                'os.environ.get("CHILD_ALIAS")=="fake-process-value"]))'],
                capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(child.stdout), [True, True])

    def test_omitting_the_option_does_not_search_the_current_or_parent_directory(self):
        (self.root / '.env').write_text('SHOULD_NOT_LOAD=fake-value\n', encoding='utf-8')
        child = self.root / 'child'; child.mkdir()
        with patch.dict(os.environ, {}, clear=True), patch('os.getcwd', return_value=str(child)):
            self.load(None)
            self.assertEqual(dict(os.environ), {})

    def test_missing_and_unsupported_files_fail_without_partial_environment_or_content_in_errors(self):
        cases = [('missing', None), ('utf8-invalid', b'OPEN_ROUTER_KEY=fake-secret\n\xff'),
                 ('utf16-truncated', codecs.BOM_UTF16_LE + b'X'),
                 ('utf32', 'OPEN_ROUTER_KEY=fake-secret\n'.encode('utf-32')),
                 ('utf16-no-bom', 'OPEN_ROUTER_KEY=fake-secret\n'.encode('utf-16-le'))]
        for name, content in cases:
            with self.subTest(case=name), patch.dict(os.environ, {}, clear=True):
                target = self.root / (name + '.env')
                if content is not None:
                    target.write_bytes(content)
                output = io.StringIO()
                with redirect_stdout(output), redirect_stderr(output), self.assertRaises(ValueError) as failure:
                    self.load(target)
                message = str(failure.exception)
                self.assertIn('--env-file', message)
                self.assertNotIn('fake-secret', message + output.getvalue())
                self.assertNotIn('OPEN_ROUTER_KEY', message + output.getvalue())
                self.assertEqual(dict(os.environ), {})

    def test_cli_reports_explicit_missing_env_before_initializing_the_server(self):
        result = subprocess.run([sys.executable, str(Path(serve_player_review.__file__)),
            '--env-file', str(self.root / 'missing.env')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Cannot read --env-file', result.stderr)
        self.assertNotIn('unrecognized arguments', result.stderr)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
