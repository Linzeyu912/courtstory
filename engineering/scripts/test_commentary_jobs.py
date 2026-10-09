"""Focused checks for the commentary job service."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from commentary_jobs import CommentaryJobs, CueConflict


class CommentaryJobsTests(unittest.TestCase):
    def setUp(self):
        temporary_root = Path(__file__).resolve().parents[2] / "tmp" / "test-commentary-jobs"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=temporary_root)
        self.root = Path(self.temp.name)
        self.video = self.root / "source.mp4"
        self.video.write_bytes(b"video")
        self.clip = {"id": "clip-a", "video_sha256": "a" * 64, "duration": 12}
        self.plan = {"summary": "summary", "cues": [{
            "cueId": "cue-one", "text": "A pass opens the lane.", "suggestedStartTime": 1,
            "suggestedEndTime": 3, "delivery": "during_play",
        }]}
        self.jobs = CommentaryJobs(self.root / "jobs")
        self.jobs.status = lambda: {"model": "openai/gpt-6-astra", "understandingConfigured": True,
                                    "ttsConfigured": True}

    def tearDown(self):
        self.jobs.close()
        self.temp.cleanup()

    def test_plan_validation_and_clip_bounds(self):
        self.jobs.save({"plan": self.plan}, self.clip, "v1", "qa")
        self.assertEqual(self.jobs.get_state(self.clip, "v1", "qa")["plan"], self.plan)
        self.assertIn("status", self.jobs.get_state(self.clip, "v1", "qa"))
        invalid = json.loads(json.dumps(self.plan))
        invalid["cues"][0]["suggestedEndTime"] = 13
        with self.assertRaises(ValueError):
            self.jobs.save({"plan": invalid}, self.clip, "v1", "qa")
        shifted = {**self.clip, "frames": [{"time": 5}], "mediaEndTime": 12}
        invalid["cues"][0]["suggestedEndTime"] = 8
        with self.assertRaises(ValueError):
            self.jobs.save({"plan": invalid}, shifted, "v1", "qa")

    def test_context_isolation_and_source_owned_video(self):
        self.jobs.save({"plan": self.plan}, self.clip, "v1", "qa")
        self.assertIsNone(self.jobs.get_state({**self.clip, "video_sha256": "b" * 64}, "v1", "qa")["plan"])
        with patch.object(self.jobs, "_run_command", side_effect=AssertionError("should not run")):
            job = self.jobs.create({"action": "render", "plan": self.plan}, self.clip,
                                   self.video, "v1", "qa")
            for thread in list(self.jobs._threads):
                thread.join(30)
        state = self.jobs.get(job["id"], self.clip, "v1", "qa")
        self.assertIn(state["status"], ("running", "failed"))
        self.assertNotIn("source.mp4", json.dumps(job))

    def test_understand_success_persists_plan_and_observations(self):
        entered = threading.Event()

        def run(command, **kwargs):
            entered.set()
            destination = Path(command[command.index("--output") + 1])
            destination.mkdir(parents=True)
            result = {"status": "completed", "plan": self.plan}
            (destination / "result.json").write_text(json.dumps(result), encoding="utf-8")

        raw = {**self.clip, "frames": [{"frame": 0, "time": 0, "tracks": []}]}
        self.clip = raw
        with patch.object(self.jobs, "_run_command", side_effect=run):
            job = self.jobs.create({"action": "understand", "observations": {"ignored": True}}, self.clip,
                                   self.video, "v1", "qa")
            self.assertTrue(entered.wait(30))
            for thread in list(self.jobs._threads):
                thread.join(30)
        state = self.jobs.get(job["id"], self.clip, "v1", "qa")
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["plan"], self.plan)
        self.assertEqual(self.jobs.get_state(self.clip, "v1", "qa")["plan"], self.plan)
        saved = self.root / "jobs" / self.jobs._context(self.clip, "v1", "qa") / "jobs" / job["id"] / "observations.json"
        self.assertEqual(json.loads(saved.read_text(encoding="utf-8")), raw)

    def test_render_success_exposes_only_existing_server_outputs(self):
        def run(command, **kwargs):
            output = Path(command[command.index("--output") + 1])
            output.mkdir(parents=True)
            render = output / "render"
            render.mkdir(parents=True)
            (render / "commentary-final.mp4").write_bytes(b"mp4")
            (render / "commentary.srt").write_text("", encoding="utf-8")
            (render / "timeline.json").write_text(json.dumps({'cues': [
                {'cueId': 'cue-one', 'convertedToHold': True}]}), encoding='utf-8')

        with patch.object(self.jobs, "_run_command", side_effect=run):
            job = self.jobs.create({"action": "render", "plan": self.plan}, self.clip,
                                   self.video, "v1", "qa")
            for thread in list(self.jobs._threads):
                thread.join(30)
        self.assertEqual(self.jobs.get(job["id"], self.clip, "v1", "qa")["status"], "completed")
        self.assertEqual(len(self.jobs.get(job['id'], self.clip, 'v1', 'qa')['timingWarnings']), 1)
        self.assertEqual(self.jobs.video(job["id"], self.clip, "v1", "qa").read_bytes(), b"mp4")
        self.assertTrue(self.jobs.subtitles(job["id"], self.clip, "v1", "qa").is_file())

    def test_polish_candidate_does_not_replace_saved_draft(self):
        self.jobs.save({'plan': self.plan}, self.clip, 'v1', 'qa')
        candidate = json.loads(json.dumps(self.plan))
        candidate['cues'][0]['text'] = '这球喂得舒服！'
        def run(command):
            output = Path(command[command.index('--output') + 1])
            output.mkdir(parents=True)
            (output / 'result.json').write_text(json.dumps({'status': 'completed', 'plan': candidate,
                'originalPlan': self.plan, 'polish': {'attempts': []}}), encoding='utf-8')
        with patch.object(self.jobs, '_run_command', side_effect=run):
            job = self.jobs.create({'action': 'polish', 'plan': self.plan}, self.clip, self.video, 'v1', 'qa')
            for thread in list(self.jobs._threads):
                thread.join(30)
        state = self.jobs.get(job['id'], self.clip, 'v1', 'qa')
        self.assertEqual(state['status'], 'completed')
        self.assertEqual(state['plan'], candidate)
        self.assertEqual(state['originalPlan'], self.plan)
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], self.plan)
        with patch.object(self.jobs, '_run_command', side_effect=RuntimeError('network unavailable')):
            failed = self.jobs.create({'action': 'polish', 'plan': self.plan}, self.clip, self.video, 'v1', 'qa')
            for thread in list(self.jobs._threads):
                thread.join(30)
        self.assertEqual(self.jobs.get(failed['id'], self.clip, 'v1', 'qa')['status'], 'failed')
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], self.plan)

    def test_individual_manual_edits_preserve_other_cues_and_evidence(self):
        self.plan['cues'][0]['evidenceFrames'] = [4, 8]
        second = {**self.plan['cues'][0], 'cueId': 'cue-two', 'text': '下一句。',
                  'suggestedStartTime': 5, 'suggestedEndTime': 8}
        self.plan['cues'].append(second)
        self.jobs.save({'plan': self.plan}, self.clip, 'v1', 'qa')
        first = self.plan['cues'][0]
        result = self.jobs.save_cue('cue-one', {'patch': {'text': 'Oh my god！球进了！', 'language': 'mul'},
            'expectedCue': first}, self.clip, 'v1', 'qa')
        self.assertEqual(result['plan']['cues'][1], second)
        self.assertEqual(result['cue']['evidenceFrames'], [4, 8])
        self.assertEqual(result['cue']['suggestedStartTime'], first['suggestedStartTime'])
        self.assertEqual(result['cue']['editedBy'], 'human')
        # A stale editor can still save a different, unchanged cue.
        other = self.jobs.save_cue('cue-two', {'patch': {'text': '换个方向，再来！'},
            'expectedCue': second}, self.clip, 'v1', 'qa')
        self.assertEqual(other['plan']['cues'][0], result['cue'])
        with self.assertRaises(CueConflict):
            self.jobs.save_cue('cue-one', {'patch': {'text': '过期的改稿'}, 'expectedCue': first}, self.clip, 'v1', 'qa')
        for invalid in ({'cueId': 'renamed'}, {'text': ''}, {'suggestedEndTime': 99}, {'language': 'invalid'}):
            with self.assertRaises(ValueError):
                self.jobs.save_cue('cue-one', {'patch': invalid, 'expectedCue': result['cue']}, self.clip, 'v1', 'qa')
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], other['plan'])


if __name__ == "__main__":
    unittest.main()
