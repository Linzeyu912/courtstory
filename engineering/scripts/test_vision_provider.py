import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

try:
    from vision_provider import CodexVisionProvider, MultimodalApiProvider, create_provider
except ImportError:
    CodexVisionProvider = MultimodalApiProvider = create_provider = None


class VisionProviderTests(unittest.TestCase):
    def test_future_api_is_explicitly_unavailable_and_never_accepts_a_network_destination(self):
        self.assertIsNotNone(create_provider, 'vision provider contract must exist')
        provider = create_provider('multimodal-api')
        self.assertFalse(provider.status()['available'])
        self.assertEqual(provider.status()['provider'], 'multimodal-api')
        with self.assertRaises(ValueError):
            provider.generate(job={}, directory=Path('.'), schema=Path('schema.json'),
                              result=Path('result.json'), images=[], prompt='Read jersey')
        with self.assertRaises(ValueError):
            create_provider('https://untrusted.example/vision')

    def test_injected_json_boundary_can_be_used_without_credentials(self):
        self.assertIsNotNone(CodexVisionProvider, 'restricted Codex adapter must exist')
        provider = CodexVisionProvider(execute=lambda **_: {'team': 'purple', 'jersey': '10'})
        output = provider.generate(job={}, directory=Path('.'), schema=Path('schema.json'),
                                   result=Path('result.json'), images=[], prompt='Read jersey')
        self.assertEqual(output, {'team': 'purple', 'jersey': '10'})

    def test_real_codex_provider_borrows_runner_without_tactics_only_attributes(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);result=directory/'result.json';commands=[]
            provider=CodexVisionProvider(codex_path=sys.executable,system_proxy_fallback=False)
            self.assertFalse(hasattr(provider,'model_override'));self.assertFalse(hasattr(provider,'no_response_timeout'))
            class SuccessfulProcess:
                def __init__(self, command, **kwargs):
                    commands.append(command)
                    kwargs['stdout'].write('{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"team evidence"}}\n')
                    kwargs['stdout'].flush();result.write_text(json.dumps({'teams':['HOU','DAL']}),encoding='utf-8');self.returncode=0
                def communicate(self, _prompt=None, timeout=None):return '', ''
                def kill(self):pass
            with patch('vision_provider.trusted_model_settings',return_value=('gpt-6-astra','low')), patch('tactics_agent.trusted_model_settings',return_value=('gpt-6-astra','low')), patch('tactics_agent.subprocess.Popen',SuccessfulProcess):
                job={'cancel':threading.Event(),'process':None}
                output=provider.generate(job=job,directory=directory,schema=directory/'schema.json',result=result,images=[],prompt='Read scoreboard')
            self.assertEqual(output,{'teams':['HOU','DAL']});self.assertIsNone(job['process'])
            command=commands[0];self.assertEqual(command[command.index('--model')+1],'gpt-6-astra')
            self.assertIn('--sandbox',command);self.assertIn('read-only',command);self.assertIn('--ignore-rules',command)
            self.assertEqual(json.loads((directory/'runtime.json').read_text(encoding='utf-8'))['model'],'gpt-6-astra')

    def test_real_codex_provider_timeout_uses_provider_budget_without_tactics_attributes(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp);provider=CodexVisionProvider(codex_path=sys.executable,timeout=.01,system_proxy_fallback=False)
            class WaitingProcess:
                def __init__(self, _command, **kwargs):
                    kwargs['stdout'].write('{"type":"thread.started"}\n');kwargs['stdout'].flush();self.killed=False
                def communicate(self, _prompt=None, timeout=None):
                    if self.killed:return '', ''
                    time.sleep(timeout);raise subprocess.TimeoutExpired('fixture',timeout)
                def kill(self):self.killed=True
            with patch('vision_provider.trusted_model_settings',return_value=('gpt-6-astra','low')), patch('tactics_agent.trusted_model_settings',return_value=('gpt-6-astra','low')), patch('tactics_agent.subprocess.Popen',WaitingProcess):
                job={'cancel':threading.Event(),'process':None}
                with self.assertRaises(ValueError) as caught:
                    provider.generate(job=job,directory=directory,schema=directory/'schema.json',result=directory/'result.json',images=[],prompt='Read jersey')
            self.assertEqual(caught.exception.code,'no_response');self.assertIsNone(job['process'])
            runtime=json.loads((directory/'runtime.json').read_text(encoding='utf-8'))
            self.assertEqual(runtime['phase'],'failed');self.assertFalse(runtime['modelOutputSeen'])


if __name__ == '__main__':
    unittest.main()
