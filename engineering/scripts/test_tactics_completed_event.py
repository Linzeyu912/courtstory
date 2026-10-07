import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from vision_provider import CodexVisionProvider


class CompletedEventTests(unittest.TestCase):
    def run_events(self, events, *, expired=False, exit_without_file=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        processes = []
        class TailProcess:
            def __init__(self, _command, **kwargs):
                self.returncode = None
                self.killed = False
                processes.append(self)
                for event in events:
                    kwargs['stdout'].write(json.dumps(event) + '\n')
                kwargs['stdout'].flush()
            def communicate(self, _prompt=None, timeout=None):
                if self.killed:
                    return '', ''
                if exit_without_file:
                    self.returncode = 0
                    return '', ''
                time.sleep(timeout)
                raise subprocess.TimeoutExpired('tail', timeout)
            def kill(self):
                self.killed = True
                self.returncode = -9
        provider = CodexVisionProvider(codex_path=sys.executable, timeout=.02, system_proxy_fallback=False)
        job = {'cancel': threading.Event(), 'process': None}
        if expired:
            job['deadline'] = time.monotonic() - 1
        with patch('tactics_agent.subprocess.Popen', TailProcess), patch('tactics_agent.trusted_model_settings', return_value=('gpt-6-astra', 'low')):
            output = provider.generate(job=job, directory=directory, schema=directory/'schema.json',
                                       result=directory/'result.json', images=[], prompt='fixture')
        self.assertEqual(processes[0].killed, not exit_without_file)
        self.assertIsNone(job['process'])
        return output, json.loads((directory/'runtime.json').read_text(encoding='utf-8')), directory

    @staticmethod
    def message(text='{"teams":["HOU","DAL"]}'):
        return {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': text}}

    def test_completed_json_is_recovered_when_cli_tail_never_writes_result(self):
        output, runtime, directory = self.run_events([self.message(), {'type': 'turn.completed'}])
        self.assertEqual(output, {'teams': ['HOU', 'DAL']})
        self.assertEqual(json.loads((directory/'result.json').read_text(encoding='utf-8')), output)
        self.assertTrue(runtime['recoveredFromCompletedEvent'])
        self.assertEqual(runtime['terminationReason'], 'completed_event_recovered')
        self.assertEqual(runtime['exitCode'], -9)

    def test_normal_exit_missing_last_message_file_recovers_same_completed_json(self):
        output, runtime, _ = self.run_events([self.message(), {'type':'turn.completed'}], exit_without_file=True)
        self.assertEqual(output, {'teams':['HOU','DAL']})
        self.assertTrue(runtime['recoveredFromCompletedEvent'])
        self.assertEqual(runtime['exitCode'], 0)

    def test_partial_ambiguous_or_non_strict_completed_text_is_not_recovered(self):
        for events in ([self.message()], [self.message(), self.message(), {'type':'turn.completed'}],
                       [self.message('{"x":NaN}'), {'type':'turn.completed'}],
                       [self.message('{"x":1,"x":2}'), {'type':'turn.completed'}],
                       [self.message('x'*1_000_001), {'type':'turn.completed'}]):
            with self.subTest(events=len(events)), self.assertRaises(ValueError):
                self.run_events(events)

    def test_forbidden_tools_and_expired_job_cannot_be_recovered(self):
        for events, expired in (([self.message(), {'type':'turn.completed'}, {'type':'item.completed','item':{'type':'tool_call'}}],False),
                                ([self.message(), {'type':'turn.completed'}],True)):
            with self.subTest(expired=expired), self.assertRaises(ValueError):
                self.run_events(events, expired=expired)


if __name__ == '__main__':
    unittest.main()
