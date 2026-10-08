import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from commentary_agent import TOKEN_PLAN_URL, commentary_markdown, provider_environment, redact, run_worker


class CommentaryDriverTests(unittest.TestCase):
    def test_exited_worker_keeps_failure_result_instead_of_broken_pipe_traceback(self):
        scratch = Path(__file__).resolve().parents[2] / "tmp"
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as folder:
            output = Path(folder)
            worker = output / "exit-worker.mjs"
            worker.write_text("process.stdin.once('data',()=>process.stdout.write(JSON.stringify({type:'rpc',id:'1',method:'read_video_window',params:{}})+'\\n',()=>process.exit(7)));", encoding="utf-8")
            class Video:
                def read_video_window(self, params):
                    time.sleep(0.1)
                    return {"content": [], "details": {}}
                inspect_region = read_video_window
                get_observations = read_video_window
            env = {**os.environ, "COMMENTARY_PROVIDER": "openrouter", "OPENROUTER_MODEL": "openai/gpt-6-astra"}
            with patch('commentary_agent.WORKER', worker):
                result = run_worker(Video(), {}, {"content": []}, output, env, "unused-secret", {"timeoutSeconds": 2}, "test")
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["workerExitCode"], 7)

    def test_openrouter_uses_its_own_key_and_model(self):
        with patch('commentary_agent.dotenv_values', return_value={"OPEN_ROUTER_KEY": "test-router-token", "QWEN_TOKEN_PLAN_KEY": "other-token"}), patch.dict(os.environ, {}, clear=True):
            child, secret = provider_environment(Path("unused"), "openrouter")
            self.assertEqual(secret, "test-router-token")
            self.assertEqual(child["COMMENTARY_PROVIDER"], "openrouter")
            self.assertEqual(child["OPENROUTER_MODEL"], "openai/gpt-6-astra")
            self.assertNotIn("QWEN_KEY", child)
        with patch('commentary_agent.dotenv_values', return_value={"QWEN_TOKEN_PLAN_KEY": "other-token"}), patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "OPENROUTER"):
                provider_environment(Path("unused"), "openrouter")

    def test_token_plan_key_cannot_silently_fall_back(self):
        scratch = Path(__file__).resolve().parents[2] / "tmp"
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as folder:
            env_file = Path(folder) / ".env"
            env_file.write_text("QWEN_KEY=other-key\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(ValueError, "QWEN_TOKEN_PLAN_KEY"):
                    provider_environment(env_file, "token-plan")
                env_file.write_text("QWEN_TOKEN_PLAN_KEY=test-token\nQWEN_KEY=other-key\nQWEN_BASE_URL=https://wrong.example\n", encoding="utf-8")
                child, secret = provider_environment(env_file, "token-plan")
                self.assertEqual(child["QWEN_BASE_URL"], TOKEN_PLAN_URL)
                self.assertEqual(child["QWEN_KEY"], "test-token")
                self.assertNotIn("QWEN_TOKEN_PLAN_KEY", child)
                self.assertNotIn(secret, redact(f"Failure {secret}", secret))

    def test_markdown_does_not_mutate_plan(self):
        result = {"status": "partial", "plan": {"summary": "测试", "uncertainties": ["甲"], "events": [{"uncertainties": ["乙"]}], "cues": []}}
        self.assertIn("乙", commentary_markdown(result))
        self.assertEqual(result["plan"]["uncertainties"], ["甲"])


if __name__ == "__main__":
    unittest.main()
