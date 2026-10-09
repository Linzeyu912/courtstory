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

    def complete_plan(self):
        plan = json.loads(json.dumps(self.plan))
        plan["uncertainties"] = []
        plan["events"] = [{"eventId": "e", "kind": "other", "startTime": 0, "endTime": 3, "description": "A pass opens space.",
                           "participants": [], "evidenceFrames": [0], "uncertainties": []}]
        for cue in plan["cues"]:
            cue.update(eventId="e", evidenceFrames=[0], focus="Space", participantRefs=[], nameRecordRefs=[])
        plan.update(participants=[], nodes=[{"nodeId": "n", "eventId": "e", "cueIds": [c["cueId"] for c in plan["cues"]],
                    "anchorAssetFrame": 0, "evidenceWindow": {"startFrame": 0, "endFrame": 0},
                    "participantRefs": [], "focus": "Space", "uncertainties": []}])
        return plan

    def test_shot_render_requires_drawing_document_before_starting_process(self):
        for shot in ({"nodes": [{"kind": "shot_release"}]}, {"events": [{"kind": "shot", "shotStatus": "confirmed"}]}):
            plan = {**json.loads(json.dumps(self.plan)), **shot}
            with self.assertRaisesRegex(ValueError, "document"):
                self.jobs.create({"action": "render", "plan": plan}, self.clip, self.video, "v1", "qa")

    def write_understanding(self, command, plan=None):
        output = Path(command[command.index("--output") + 1]); output.mkdir(parents=True)
        config = json.loads(Path(command[command.index("--producer-config") + 1]).read_text(encoding="utf-8"))
        plan = plan or self.complete_plan()
        (output / "result.json").write_text(json.dumps({"status": "completed", "plan": plan,
            "evidence": {"frames": [0], "detailFrames": [0]}, "producerConfigSnapshot": config}), encoding="utf-8")
        (output / "context.json").write_text(json.dumps({"videoRef": self.clip["video_sha256"], "duration": 12,
            "frames": [{"frame": 0, "time": 0, "sourceTime": 7, "pts": 70, "timeBase": "1/10"}]}), encoding="utf-8")

    def test_plan_validation_and_clip_bounds(self):
        saved = self.jobs.save({"plan": self.plan}, self.clip, "v1", "qa")
        self.assertEqual(self.jobs.get_state(self.clip, "v1", "qa")["plan"], saved)
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
            self.write_understanding(command)

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
        self.assertEqual(state["plan"]["cues"], self.complete_plan()["cues"])
        self.assertEqual(self.jobs.get_state(self.clip, "v1", "qa")["plan"], state["plan"])
        saved = self.root / "jobs" / self.jobs._context(self.clip, "v1", "qa") / "jobs" / job["id"] / "observations.json"
        self.assertEqual(json.loads(saved.read_text(encoding="utf-8")), raw)

    def test_render_success_exposes_only_existing_server_outputs(self):
        def run(command, **kwargs):
            self.assertEqual(Path(command[command.index("--audio-cache") + 1]), self.jobs._dir(self.clip, "v1", "qa") / "audio-cache")
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
        saved = self.jobs.save({'plan': self.plan}, self.clip, 'v1', 'qa')
        candidate = json.loads(json.dumps(saved))
        candidate['cues'][0]['text'] = '这球喂得舒服！'
        def run(command):
            output = Path(command[command.index('--output') + 1])
            output.mkdir(parents=True)
            config = json.loads(Path(command[command.index('--producer-config') + 1]).read_text(encoding='utf-8'))
            (output / 'result.json').write_text(json.dumps({'status': 'completed', 'plan': candidate,
                'originalPlan': saved, 'polish': {'attempts': [], 'configSnapshot': config}}), encoding='utf-8')
        with patch.object(self.jobs, '_run_command', side_effect=run):
            job = self.jobs.create({'action': 'polish', 'plan': saved}, self.clip, self.video, 'v1', 'qa')
            for thread in list(self.jobs._threads):
                thread.join(30)
        state = self.jobs.get(job['id'], self.clip, 'v1', 'qa')
        self.assertEqual(state['status'], 'completed')
        candidate.pop('digest')
        self.assertEqual(state['plan'], candidate)
        self.assertEqual(state['originalPlan'], saved)
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], saved)

    def write_polish(self, command, mutate=None):
        original = json.loads(Path(command[command.index('--plan') + 1]).read_text(encoding='utf-8'))['plan']
        config = json.loads(Path(command[command.index('--producer-config') + 1]).read_text(encoding='utf-8'))
        candidate = json.loads(json.dumps(original)); candidate['cues'][0]['text'] = '空间拉开，顺势一传。'
        if mutate: mutate(candidate)
        output = Path(command[command.index('--output') + 1]); output.mkdir(parents=True)
        (output / 'result.json').write_text(json.dumps({'status': 'completed', 'plan': candidate,
            'originalPlan': original, 'polish': {'attempts': [], 'configSnapshot': config}}), encoding='utf-8')

    def test_polish_locks_saved_baseline_separately_from_unsaved_draft(self):
        from commentary_plan import model_config, plan_ref
        with patch.object(self.jobs, '_run_command', side_effect=self.write_understanding):
            job = self.jobs.create({'action': 'understand'}, self.clip, self.video, 'v1', 'qa')
            for thread in list(self.jobs._threads): thread.join(20)
        saved = self.jobs.get(job['id'], self.clip, 'v1', 'qa')['plan']
        draft = json.loads(json.dumps(saved)); draft['cues'][0]['text'] = '这是用户未保存的改稿。'
        self.jobs.model_config = {**model_config(), 'model': 'another/model', 'capabilitiesRef': 'trusted-test-config'}
        with patch.object(self.jobs, '_run_command', side_effect=self.write_polish):
            job = self.jobs.create({'action': 'polish', 'plan': draft, 'expectedRevision': saved['revision']}, self.clip, self.video, 'v1', 'qa')
            for thread in list(self.jobs._threads): thread.join(20)
        state = self.jobs.get(job['id'], self.clip, 'v1', 'qa')
        self.assertEqual(state['status'], 'completed')
        self.assertEqual(state['originalPlan'], draft)
        self.assertEqual(state['basePlanRef'], plan_ref(saved))
        self.assertEqual(state['polishConfigSnapshot']['model'], 'another/model')
        self.assertEqual(state['plan']['producerConfigSnapshot']['model'], 'openai/gpt-6-astra')
        self.assertNotIn('digest', state['plan'])
        self.assertEqual(state['plan']['nodes'], saved['nodes'])
        self.assertEqual(state['plan']['evidenceRef'], saved['evidenceRef'])
        adopted = self.jobs.save({'plan': state['plan'], 'expectedRevision': saved['revision']}, self.clip, 'v1', 'qa')
        self.assertEqual(adopted['revision'], saved['revision'] + 1)
        with self.assertRaises(ValueError): self.jobs.resolve_plan(plan_ref(saved), self.clip, 'v1', 'qa')

    def test_late_polish_and_geometry_changes_are_rejected_without_overwriting_draft(self):
        saved = self.jobs.save({'plan': self.plan}, self.clip, 'v1', 'qa')
        entered, release = threading.Event(), threading.Event()
        def run(command):
            entered.set(); release.wait(10); self.write_polish(command)
        with patch.object(self.jobs, '_run_command', side_effect=run):
            job = self.jobs.create({'action': 'polish', 'plan': saved}, self.clip, self.video, 'v1', 'qa')
            self.assertTrue(entered.wait(5))
            edited = self.jobs.save_cue('cue-one', {'expectedCue': saved['cues'][0], 'patch': {'text': '人工新稿。'}}, self.clip, 'v1', 'qa')['plan']
            release.set()
            for thread in list(self.jobs._threads): thread.join(20)
        self.assertEqual(self.jobs.get(job['id'], self.clip, 'v1', 'qa')['status'], 'failed')
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], edited)
        with patch.object(self.jobs, '_run_command', side_effect=lambda command: self.write_polish(command, lambda p: p.update(nodes=[{'nodeId': 'invented'}]))):
            job = self.jobs.create({'action': 'polish', 'plan': edited}, self.clip, self.video, 'v1', 'qa')
            for thread in list(self.jobs._threads): thread.join(20)
        state = self.jobs.get(job['id'], self.clip, 'v1', 'qa')
        self.assertEqual(state['status'], 'failed')
        self.assertIn('only change cue text', state['error'])
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], edited)
        with patch.object(self.jobs, '_run_command', side_effect=RuntimeError('network unavailable')):
            failed = self.jobs.create({'action': 'polish', 'plan': edited}, self.clip, self.video, 'v1', 'qa')
            for thread in list(self.jobs._threads):
                thread.join(30)
        self.assertEqual(self.jobs.get(failed['id'], self.clip, 'v1', 'qa')['status'], 'failed')
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], edited)

    def test_individual_manual_edits_preserve_other_cues_and_evidence(self):
        self.plan['cues'][0]['evidenceFrames'] = [4, 8]
        second = {**self.plan['cues'][0], 'cueId': 'cue-two', 'text': '下一句。',
                  'suggestedStartTime': 5, 'suggestedEndTime': 8}
        self.plan['cues'].append(second)
        self.jobs.save({'plan': self.plan}, self.clip, 'v1', 'qa')
        first = self.plan['cues'][0]
        result = self.jobs.save_cue('cue-one', {'patch': {'text': 'Oh my god！球进了！', 'language': 'mul'},
            'expectedCue': first, 'expectedRevision': 1}, self.clip, 'v1', 'qa')
        self.assertEqual(result['plan']['cues'][1], second)
        self.assertEqual(result['cue']['evidenceFrames'], [4, 8])
        self.assertEqual(result['cue']['suggestedStartTime'], first['suggestedStartTime'])
        self.assertEqual(result['cue']['editedBy'], 'human')
        # A stale editor can still save a different, unchanged cue.
        other = self.jobs.save_cue('cue-two', {'patch': {'text': '换个方向，再来！'},
            'expectedCue': second, 'expectedRevision': 1}, self.clip, 'v1', 'qa')
        self.assertEqual(other['plan']['cues'][0], result['cue'])
        with self.assertRaises(CueConflict):
            self.jobs.save_cue('cue-one', {'patch': {'text': '过期的改稿'}, 'expectedCue': first}, self.clip, 'v1', 'qa')
        for invalid in ({'cueId': 'renamed'}, {'text': ''}, {'suggestedEndTime': 99}, {'language': 'invalid'}):
            with self.assertRaises(ValueError):
                self.jobs.save_cue('cue-one', {'patch': invalid, 'expectedCue': result['cue']}, self.clip, 'v1', 'qa')
        self.assertEqual(self.jobs.get_state(self.clip, 'v1', 'qa')['plan'], other['plan'])
        self.assertEqual((result['plan']['revision'], other['plan']['revision']), (2, 3))
        self.assertEqual(len(list(self.jobs._dir(self.clip, 'v1', 'qa').glob('plans/*/*.json'))), 3)

    def test_expected_revision_and_history_cannot_be_overwritten(self):
        first = self.jobs.save({"plan": self.plan, "expectedRevision": 0}, self.clip, "v1", "qa")
        second = self.jobs.save({"plan": first, "expectedRevision": 1}, self.clip, "v1", "qa")
        self.assertEqual(second["revision"], 2)
        with self.assertRaisesRegex(ValueError, "revision"):
            self.jobs.save({"plan": first, "expectedRevision": 1}, self.clip, "v1", "qa")
        history = list(self.jobs._dir(self.clip, "v1", "qa").glob("plans/*/*.json"))
        self.assertEqual(len(history), 2)
        self.assertEqual(json.loads(next(p for p in history if p.name == "1.json").read_text(encoding="utf-8")), first)

    def test_late_generated_result_preserves_user_edit(self):
        entered, release = threading.Event(), threading.Event()
        def run(command):
            entered.set(); release.wait(10)
            self.write_understanding(command)
        with patch.object(self.jobs, "_run_command", side_effect=run):
            job = self.jobs.create({"action": "understand"}, self.clip, self.video, "v1", "qa")
            self.assertTrue(entered.wait(5))
            edited = self.jobs.save({"plan": self.plan, "expectedRevision": 0}, self.clip, "v1", "qa")
            release.set()
            for thread in list(self.jobs._threads): thread.join(20)
        self.assertEqual(self.jobs.get_state(self.clip, "v1", "qa")["plan"], edited)
        self.assertEqual(self.jobs.get(job["id"], self.clip, "v1", "qa")["status"], "failed")

    def test_resolve_requires_current_exact_ref_and_nodes(self):
        saved = self.jobs.save({"plan": self.plan}, self.clip, "v1", "qa")
        with self.assertRaises(ValueError):
            self.jobs.resolve_plan({k: saved[k] for k in ("planId", "revision", "digest")}, self.clip, "v1", "qa")

    def test_cancelled_worker_return_never_publishes_plan(self):
        entered, release = threading.Event(), threading.Event()
        def run(command):
            entered.set(); release.wait(10)
            self.write_understanding(command)
        with patch.object(self.jobs, "_run_command", side_effect=run):
            job = self.jobs.create({"action": "understand"}, self.clip, self.video, "v1", "qa")
            self.assertTrue(entered.wait(5))
            state = self.jobs.cancel(job["id"], self.clip, "v1", "qa")
            self.assertEqual(state["status"], "cancelled")
            release.set()
            for thread in list(self.jobs._threads): thread.join(20)
        self.assertIsNone(self.jobs.get_state(self.clip, "v1", "qa")["plan"])
        self.assertEqual(self.jobs.get(job["id"], self.clip, "v1", "qa")["status"], "cancelled")

    def test_complete_handoff_resolves_and_generation_model_is_preserved_on_edit(self):
        from commentary_plan import model_config, plan_ref
        self.clip["frames"] = [{"frame": 0, "time": 4}, {"frame": 1, "time": 5}]
        plan = self.complete_plan()
        plan["events"][0]["evidenceFrames"] = [1]
        plan["cues"][0]["evidenceFrames"] = [1]
        plan["nodes"][0].update(anchorAssetFrame=1, evidenceWindow={"startFrame": 0, "endFrame": 1})
        locked = model_config()
        def run(command):
            output = Path(command[command.index("--output") + 1]); output.mkdir(parents=True)
            (output / "result.json").write_text(json.dumps({"status": "completed", "plan": plan,
                "evidence": {"frames": [1], "detailFrames": [1]}, "producerConfigSnapshot": locked}), encoding="utf-8")
            (output / "context.json").write_text(json.dumps({"videoRef": self.clip["video_sha256"],
                "frames": [{"frame": 0, "time": 0, "sourceTime": 7, "pts": 70, "timeBase": "1/10"},
                           {"frame": 1, "time": 1, "sourceTime": 8, "pts": 80, "timeBase": "1/10"}]}), encoding="utf-8")
        with patch.object(self.jobs, "_run_command", side_effect=run):
            job = self.jobs.create({"action": "understand", "expectedRevision": 0}, self.clip, self.video, "v1", "qa")
            for thread in list(self.jobs._threads): thread.join(20)
        saved = self.jobs.get(job["id"], self.clip, "v1", "qa")["plan"]
        self.assertEqual(self.jobs.resolve_plan(plan_ref(saved), self.clip, "v1", "qa"), saved)
        self.jobs.model_config = {**locked, "model": "another/model", "capabilitiesRef": "test-catalog"}
        updated = self.jobs.save({"plan": saved, "expectedRevision": 1}, self.clip, "v1", "qa")
        self.assertEqual(updated["producerConfigSnapshot"]["model"], "openai/gpt-6-astra")
        self.assertEqual(updated["nodes"][0]["assetPts"], 80)
        with self.assertRaises(ValueError):
            self.jobs.resolve_plan(plan_ref(saved), self.clip, "v1", "qa")
        with self.assertRaises(ValueError):
            self.jobs.create({"action": "understand", "expectedRevision": 0}, self.clip, self.video, "v1", "qa")
        self.clip["sourceCuts"] = [1]
        with self.assertRaises(ValueError):
            self.jobs.resolve_plan(plan_ref(updated), self.clip, "v1", "qa")

    def test_old_saved_draft_can_be_saved_and_rendered_without_invented_contract(self):
        folder = self.jobs._dir(self.clip, "v1", "qa"); folder.mkdir(parents=True)
        (folder / "plan.json").write_text(json.dumps(self.plan), encoding="utf-8")
        saved = self.jobs.save({"plan": self.plan, "expectedRevision": 0}, self.clip, "v1", "qa")
        self.assertEqual(saved["revision"], 1)
        self.assertFalse(saved.get("nodes"))
        self.assertIsNone(saved["producerConfigSnapshot"])
        with patch.object(self.jobs, "_run_command", side_effect=AssertionError("CLI reached")):
            job = self.jobs.create({"action": "render", "plan": saved,
                "commentaryPlanRef": {k: saved[k] for k in ("planId", "revision", "digest")}}, self.clip, self.video, "v1", "qa")
            for thread in list(self.jobs._threads): thread.join(20)
        self.assertIn("CLI reached", self.jobs.get(job["id"], self.clip, "v1", "qa")["error"])

    def test_new_understanding_cannot_save_legacy_output_as_success(self):
        def run(command):
            output = Path(command[command.index("--output") + 1]); output.mkdir(parents=True)
            config = json.loads(Path(command[command.index("--producer-config") + 1]).read_text(encoding="utf-8"))
            (output / "result.json").write_text(json.dumps({"status": "completed", "plan": self.plan,
                "producerConfigSnapshot": config}), encoding="utf-8")
        with patch.object(self.jobs, "_run_command", side_effect=run):
            job = self.jobs.create({"action": "understand"}, self.clip, self.video, "v1", "qa")
            for thread in list(self.jobs._threads): thread.join(20)
        self.assertEqual(self.jobs.get(job["id"], self.clip, "v1", "qa")["status"], "failed")
        self.assertIsNone(self.jobs.get_state(self.clip, "v1", "qa")["plan"])

    def test_host_rejects_incomplete_or_duplicate_cue_node_coverage(self):
        for case in ("missing_nodes", "omitted_cue", "duplicate_cue"):
            with self.subTest(case=case):
                plan = self.complete_plan()
                if case == "missing_nodes":
                    plan.pop("nodes")
                elif case == "omitted_cue":
                    plan["cues"].append({**plan["cues"][0], "cueId": "cue-two"})
                else:
                    plan["nodes"][0]["cueIds"].append("cue-one")
                with patch.object(self.jobs, "_run_command", side_effect=lambda command: self.write_understanding(command, plan)):
                    job = self.jobs.create({"action": "understand"}, self.clip, self.video, "v1", "qa")
                    for thread in list(self.jobs._threads): thread.join(20)
                self.assertEqual(self.jobs.get(job["id"], self.clip, "v1", "qa")["status"], "failed")
                self.assertIsNone(self.jobs.get_state(self.clip, "v1", "qa")["plan"])


if __name__ == "__main__":
    unittest.main()
