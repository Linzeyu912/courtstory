"""Per-child transport configuration without network or model requests."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import tomllib
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tactics_agent import TacticsAgent, build_codex_command


class TacticsTransportTests(unittest.TestCase):
    def test_http_sse_changes_only_provider_configuration_and_preserves_restrictions(self):
        args = ('codex.exe', Path('job'), Path('schema.json'), Path('result.json'), [Path('frame.jpg')])
        base = build_codex_command(*args, model='gpt-6.1-sol', effort='low')
        auto = build_codex_command(*args, model='gpt-6.1-sol', effort='low', transport_mode='auto')
        self.assertEqual(base, auto)
        command = build_codex_command(*args, model='gpt-6.1-sol', effort='low', transport_mode='http-sse')
        overrides = [command[i+1] for i, value in enumerate(command[:-1]) if value == '-c']
        config = tomllib.loads('\n'.join(overrides))
        self.assertEqual(config['model_provider'], 'tactics_openai_http')
        self.assertEqual(config['model_providers'], {'tactics_openai_http': {
            'name': 'OpenAI', 'wire_api': 'responses', 'requires_openai_auth': True,
            'supports_websockets': False}})
        removed = []
        index = 0
        while index < len(command):
            if command[index] == '-c' and command[index+1].startswith(('model_provider=', 'model_providers.')):
                index += 2
            else:
                removed.append(command[index]); index += 1
        self.assertEqual(removed, base, 'transport must not change source, model, tools, auth, or timeout policy')
        self.assertIn('--ignore-user-config', command)
        self.assertEqual(command[command.index('--sandbox')+1], 'read-only')
        self.assertFalse(any(word in ' '.join(command).lower() for word in ('base_url', 'env_key', 'bearer', 'insecure', 'dangerously', 'token=')))

    def test_invalid_modes_fail_before_spawn(self):
        for mode in ('websocket', 'https://example.invalid', '', None):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                build_codex_command('codex.exe', '.', 'schema', 'result', [], transport_mode=mode)
            with tempfile.TemporaryDirectory() as temp, self.assertRaises(ValueError):
                TacticsAgent(temp, SimpleNamespace(node='node'), codex_path=sys.executable, transport_mode=mode)

    def test_real_runner_records_selected_transport_and_default_identity_compatibility(self):
        for mode, alias in (('auto', 'openai'), ('http-sse', 'tactics_openai_http')):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp); result = directory/'result.json'; commands = []
                agent = TacticsAgent(directory/'jobs', SimpleNamespace(node='node'), codex_path=sys.executable,
                                     system_proxy_fallback=False, transport_mode=mode)
                self.addCleanup(agent.close)
                class Process:
                    def __init__(self, command, **kwargs):
                        commands.append(command)
                        kwargs['stdout'].write('{"type":"turn.completed"}\n'); kwargs['stdout'].flush()
                        result.write_text('{"summary":"fixture"}', encoding='utf-8')
                        self.returncode = 0
                    def communicate(self, _prompt=None, timeout=None): return '', ''
                    def kill(self): pass
                with patch('tactics_agent.trusted_model_settings', return_value=('gpt-6.1-sol','low')), patch('tactics_agent.subprocess.Popen', Process):
                    status = agent.status()
                    self.assertEqual(status['transportMode'], mode)
                    self.assertEqual(status['providerAlias'], alias)
                    value = agent._execute_cli(job={'cancel':threading.Event(),'process':None}, directory=directory,
                                               schema=directory/'schema.json', result=result, images=[], prompt='fixture')
                self.assertEqual(value, {'summary':'fixture'})
                runtime = json.loads((directory/'runtime.json').read_text(encoding='utf-8'))
                self.assertEqual(runtime['transportMode'], mode)
                self.assertEqual(runtime['providerAlias'], alias)
                self.assertEqual(any('supports_websockets=false' in item for item in commands[0]), mode == 'http-sse')

    def test_server_cli_exposes_only_supported_transport_choices(self):
        script = Path(__file__).with_name('serve_player_review.py')
        help_result = subprocess.run([sys.executable, str(script), '--help'], capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        self.assertIn('--tactics-agent-transport {auto,http-sse}', help_result.stdout)
        rejected = subprocess.run([sys.executable, str(script), '--tactics-agent-transport', 'insecure'], capture_output=True, text=True, encoding='utf-8')
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('invalid choice', rejected.stderr)


if __name__ == '__main__':
    unittest.main()
