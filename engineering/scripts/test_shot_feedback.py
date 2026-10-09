"""Shot feedback uses real returned evidence and source-bound host ratings."""
import copy
import unittest
from pathlib import Path

from commentary_plan import build_name_snapshot, finalize_plan, model_config, digest, validate_handoff
from shot_feedback import build_rating_context, prepare_shot_feedback


class ShotFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.context = {"videoRef": "a" * 64, "duration": 1.3, "sourceStartTime": 7,
                        "frames": [{"frame": i, "time": i / 10, "sourceTime": 7 + i / 10,
                                    "pts": 70 + i, "timeBase": "1/10"} for i in range(13)]}
        self.clip = {"video_sha256": "a" * 64, "frames": [{"frame": i, "time": 30 + i / 10} for i in range(13)]}
        self.person = {"participantId": "local-shooter", "entityId": None, "nameRecordRef": None,
                       "validRange": {"startFrame": 0, "endFrame": 12}, "identityStatus": "unknown", "displayName": None}
        self.plan = {"events": [{"eventId": "e", "kind": "shot", "shotStatus": "confirmed", "startTime": 0, "endTime": 1.2}],
                     "participants": [self.person], "cues": [{"cueId": "c", "eventId": "e", "text": "出手前防守追了过来。", "delivery": "pause"}],
                     "nodes": [{"nodeId": "release", "kind": "shot_release", "eventId": "e", "cueIds": ["c"], "anchorAssetFrame": 10,
                                "evidenceWindow": {"startFrame": 0, "endFrame": 12}, "participantRefs": ["local-shooter"],
                                "shotFeedback": {"shooterRef": "local-shooter", "defenderRefs": [], "evidenceFrames": list(range(11)), "ratingsRefs": [],
                                    "opportunity": {"grade": "good", "reason": "可见空位出现。"},
                                    "pressure": {"grade": "high", "reason": "扑防到位。"}}}]}

    def test_confirmed_shot_requires_release_node_shooter_and_pause(self):
        prepare_shot_feedback(self.plan, self.context, None, {"frames": list(range(13))})
        self.assertEqual(self.plan["nodes"][0]["shotFeedback"]["defenseWindow"]["coverage"], "complete")
        for change in (lambda p: p.update(nodes=[]), lambda p: p["nodes"][0]["shotFeedback"].update(shooterRef=None),
                       lambda p: p["cues"][0].update(delivery="during_play")):
            plan = copy.deepcopy(self.plan); change(plan)
            with self.assertRaises(ValueError): prepare_shot_feedback(plan, self.context, None, {"frames": list(range(13))})

    def test_window_length_does_not_prove_coverage_and_future_evidence_is_rejected(self):
        plan = copy.deepcopy(self.plan); plan["nodes"][0]["shotFeedback"]["evidenceFrames"] = [0, 10]
        prepare_shot_feedback(plan, self.context, None, {"frames": [0, 10]})
        shot = plan["nodes"][0]["shotFeedback"]
        self.assertEqual(shot["defenseWindow"]["coverage"], "partial")
        self.assertEqual((shot["opportunity"]["grade"], shot["pressure"]["grade"]), ("unknown", "unknown"))
        self.plan["nodes"][0]["shotFeedback"]["evidenceFrames"].append(11)
        with self.assertRaisesRegex(ValueError, "after release"):
            prepare_shot_feedback(self.plan, self.context, None, {"frames": list(range(13))})

    def test_cut_short_window_and_unreturned_frames_stay_unknown(self):
        self.context["sourceCuts"] = [5]
        self.plan["nodes"][0]["evidenceWindow"]["startFrame"] = 5
        self.plan["nodes"][0]["shotFeedback"]["evidenceFrames"] = list(range(5, 11))
        prepare_shot_feedback(self.plan, self.context, None, {"frames": list(range(13))})
        shot = self.plan["nodes"][0]["shotFeedback"]
        self.assertEqual(shot["defenseWindow"]["startFrame"], 5)
        self.assertEqual(shot["pressure"]["grade"], "unknown")
        with self.assertRaisesRegex(ValueError, "returned"):
            prepare_shot_feedback(self.plan, self.context, None, {"frames": [10]})

    def test_ratings_come_from_host_and_missing_identity_or_season_stays_null(self):
        review = {"gameContext": {"season": "2025-26"}, "playerIdentities": [{"id": "P1", "playerProfile": {
            "status": "confirmed", "season": "2025-26", "player_id_namespace": "normalized_name_key", "player_id": "name:alice",
            "team_abbreviation": "ABC", "jersey_number": "00", "evidence": {"videoSha256": "a" * 64}}}]}
        participant = {**self.person, "participantId": "P1-f0", "entityId": "P1", "displayName": "Alice", "identityVerified": True,
                       "nameRecord": {"name": "Alice", "nameStatus": "human_confirmed", "identityVerified": True}}
        class Data:
            def lookup(self, season, team, jersey):
                assert (season, team, jersey) == ("2025-26", "ABC", "00")
                return {"candidates": [{"player_id": "name:alice", "season": season, "name": "Alice", "rating": {
                    "season": season, "game": "NBA 2K26", "status": "partial", "record_id": "record", "ratings": {"three_point_shot": None, "block": 85},
                    "field_provenance": {"three_point_shot": None, "block": {"url": "https://example.test/record"}}}}]}
        rating = build_rating_context(review, self.clip, {"participants": [participant]}, data=Data())
        self.assertEqual(rating["records"][0]["ratings"]["block"], 85)
        self.assertIsNone(rating["records"][0]["ratings"]["three_point_shot"])
        review["gameContext"]["season"] = "2024-25"
        missing = build_rating_context(review, self.clip, {"participants": [participant]}, data=Data())
        self.assertEqual(missing["records"][0]["status"], "unknown")
        self.assertIsNone(missing["records"][0]["ratings"]["block"])

    def test_finalize_includes_locked_rating_snapshot_and_validates_refs(self):
        self.context["ratingContext"] = {"digest": "host-context", "season": None, "records": []}
        saved = finalize_plan(self.plan, self.clip, None, self.context, {"frames": list(range(13))}, model_config(), "job", None)
        self.assertEqual(saved["ratingSnapshotRef"], {"digest": "host-context"})
        self.assertEqual(saved["nodes"][0]["anchorAssetFrame"], 10)
        self.plan["nodes"][0]["shotFeedback"]["ratingsRefs"] = ["invented"]
        with self.assertRaisesRegex(ValueError, "rating"):
            finalize_plan(self.plan, self.clip, None, self.context, {"frames": list(range(13))}, model_config(), "job", None)

    def test_actual_local_2k_package_accepts_machine_name_without_upgrading_identity(self):
        review = {"gameContext": {"season": "2025-26"}}
        people = []
        for pid, name, team, jersey in (("P1-f0", "Stephen Curry", "GSW", "30"), ("P2-f0", "Mike Conley", "MIN", "10")):
            people.append({**self.person, "participantId": pid, "entityId": pid.split('-')[0], "displayName": name,
                "identityVerified": False, "nameRecord": {"name": name, "nameStatus": "machine_accepted", "identityVerified": False,
                    "positionBindingStatus": "observed", "entityAssociationAmbiguous": False,
                    "playerId": "external-id", "playerIdNamespace": "2k-season-roster", "season": "2025-26", "team": team, "jersey": jersey}})
        context = build_rating_context(review, self.clip, {"participants": people})
        curry, conley = context["records"]
        self.assertEqual(curry["ratings"]["three_point_shot"], 99)
        self.assertEqual((curry["playerId"], conley["playerId"]), ("name:stephencurry", "name:mikeconley"))
        self.assertNotEqual(curry["ratings"]["block"], conley["ratings"]["block"])
        self.assertFalse(curry["identityVerified"])
        self.assertTrue(curry["field_provenance"]["three_point_shot"]["url"])
        inferred = build_rating_context({}, self.clip, {"participants": people})
        self.assertEqual(inferred["season"], "2025-26")
        self.assertEqual(inferred["records"][0]["ratings"]["three_point_shot"], 99)
        people[0]["nameRecord"]["entityAssociationAmbiguous"] = True
        missing = build_rating_context(review, self.clip, {"participants": people})
        self.assertIsNone(missing["records"][0]["ratings"]["three_point_shot"])

    def test_ratings_refs_cannot_cross_people_and_snapshot_is_host_owned(self):
        records = [{"ratingRef": "mine", "participantId": "local-shooter", "ratings": {"block": None}},
                   {"ratingRef": "other", "participantId": "other-person", "ratings": {"block": 99}}]
        self.context["ratingContext"] = {"digest": "host", "season": None, "records": records}
        prepare_shot_feedback(self.plan, self.context, None, {"frames": list(range(13))})
        self.assertEqual(self.plan["nodes"][0]["shotFeedback"]["ratingsRefs"], ["mine"])
        self.plan["nodes"][0]["shotFeedback"]["ratingsRefs"] = ["other"]
        with self.assertRaisesRegex(ValueError, "rating"):
            prepare_shot_feedback(self.plan, self.context, None, {"frames": list(range(13))})
        self.plan["nodes"][0]["shotFeedback"]["ratingsRefs"] = []
        saved = finalize_plan(self.plan, self.clip, None, self.context, {"frames": list(range(13))}, model_config(), "job", None)
        saved["ratingContext"]["records"][0]["ratings"]["block"] = 88
        with self.assertRaisesRegex(ValueError, "rating snapshot"):
            validate_handoff(saved, self.clip, None, self.context)

    def test_vfr_pts_and_missing_release_samples_do_not_use_frame_rate(self):
        for i, row in enumerate(self.context["frames"]):
            row.update(pts=7000 + (i * 100 if i < 10 else 1000 + (i - 10) * 200), timeBase="1/1000")
        prepare_shot_feedback(self.plan, self.context, None, {"frames": list(range(13))})
        self.assertAlmostEqual(self.plan["nodes"][0]["shotFeedback"]["defenseWindow"]["actualDurationSeconds"], 1)
        self.plan["nodes"][0]["shotFeedback"]["evidenceFrames"] = list(range(10))
        prepare_shot_feedback(self.plan, self.context, None, {"frames": list(range(13))})
        self.assertEqual(self.plan["nodes"][0]["shotFeedback"]["pressure"]["grade"], "unknown")

    def test_save_and_cue_edit_preserve_release_and_reject_removing_freeze(self):
        import tempfile
        from commentary_jobs import CommentaryJobs
        from commentary_plan import plan_ref
        with tempfile.TemporaryDirectory() as directory:
            jobs = CommentaryJobs(Path(directory))
            plan = copy.deepcopy(self.plan)
            plan["cues"][0].update(suggestedStartTime=1, suggestedEndTime=1.2)
            saved = finalize_plan(plan, self.clip, None, self.context, {"frames": list(range(13))}, model_config(), "job", None)
            saved["decodeContext"] = copy.deepcopy(self.context)
            saved.pop("digest"); saved["digest"] = digest(saved)
            jobs._persist(jobs._dir(self.clip, "v", "qa"), saved)
            edited = jobs.save_cue("c", {"patch": {"text": "机会好，防守压力也高。"}, "expectedCue": saved["cues"][0]}, self.clip, "v", "qa")["plan"]
            self.assertEqual(edited["nodes"][0]["anchorAssetFrame"], 10)
            self.assertEqual(edited["nodes"][0]["shotFeedback"]["opportunity"]["grade"], "good")
            self.assertEqual(jobs.resolve_plan(plan_ref(edited), self.clip, "v", "qa")["revision"], 2)
            with self.assertRaisesRegex(ValueError, "pause"):
                jobs.save_cue("c", {"patch": {"delivery": "during_play"}, "expectedCue": edited["cues"][0]}, self.clip, "v", "qa")
            jobs.close()

    def test_current_season_is_checked_even_when_legacy_source_digest_stays_compatible(self):
        self.context["ratingContext"] = {"digest": "snapshot", "season": "2025-26", "records": []}
        for season in ("2024-25", "2026-27"):
            with self.assertRaisesRegex(ValueError, "season"):
                prepare_shot_feedback(copy.deepcopy(self.plan), self.context, {"gameContext": {"season": season}}, {"frames": list(range(13))})

    def test_real_missing_2k_record_keeps_null_values_and_provenance(self):
        person = {**self.person, "participantId": "P1-f0", "entityId": "P1", "displayName": "Alex Reese", "identityVerified": False,
                  "nameRecord": {"name": "Alex Reese", "nameStatus": "machine_accepted", "season": "2024-25", "team": "PHI", "jersey": "65",
                                 "positionBindingStatus": "observed", "entityAssociationAmbiguous": False, "playerIdNamespace": "2k-season-roster"}}
        records = build_rating_context({}, self.clip, {"participants": [person]})["records"]
        self.assertEqual(records[0]["playerId"], "name:alexreese")
        self.assertEqual(records[0]["status"], "missing_record")
        self.assertTrue(all(value is None for value in records[0]["ratings"].values()))
        self.assertTrue(all(value is None for value in records[0]["field_provenance"].values()))


if __name__ == "__main__": unittest.main()
