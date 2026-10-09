"""Versioned commentary handoff, identity intervals, and clock provenance."""
import copy
import unittest

from commentary_plan import build_name_snapshot, finalize_plan, source_ref, model_config, resolve_catalog_config


class CommentaryPlanTests(unittest.TestCase):
    def setUp(self):
        self.clip = {"video_sha256": "a" * 64, "source_video_sha256": "b" * 64, "tracking_fingerprint": "tracks", "tracking_revision": "v1",
                     "frames": [{"frame": i, "time": 20 + i / 10, "source_frame": 100 + i,
                                 "source_time": 90 + i / 10} for i in range(4)]}
        self.review = {"videoSha256": "a" * 64, "trackingFingerprint": "tracks", "trackingRevision": "v1",
                       "sourceVideoSha256": "b" * 64,
                       "sourceFrameMapping": [{"frame": i, "time": 20 + i / 10,
                                               "sourceFrame": 100 + i, "sourceTime": 90 + i / 10} for i in range(4)],
                       "nameIdentitySource": {"videoSha256": "a" * 64, "trackingFingerprint": "tracks", "trackingRevision": "v1"},
                       "playerNameIdentities": [{"id": "P1", "observations": [
                           {"frame": i, "trackId": 8, "nameIdentity": {"name": "Alice" if i < 2 else "Bob",
                            "nameStatus": "machine_accepted", "positionBindingStatus": "observed",
                            "identityVerified": False, "entityAssociationAmbiguous": False}} for i in range(4)]}]}
        self.context = {"videoRef": "a" * 64, "frames": [{"frame": i, "time": i / 10,
                           "sourceTime": 7 + i / 10, "pts": 70 + i, "timeBase": "1/10"} for i in range(4)]}

    def test_identity_split_and_unaccepted_or_ambiguous_are_not_names(self):
        snapshot = build_name_snapshot(self.review, self.clip)
        self.assertEqual([p["validRange"] for p in snapshot["participants"]],
                         [{"startFrame": 0, "endFrame": 1}, {"startFrame": 2, "endFrame": 3}])
        self.assertFalse(snapshot["participants"][0]["identityVerified"])
        self.review["playerNameIdentities"][0]["observations"][0]["nameIdentity"]["positionBindingStatus"] = "needs_review"
        snapshot = build_name_snapshot(self.review, self.clip)
        self.assertIsNone(snapshot["participants"][0]["displayName"])
        self.review["nameIdentitySource"]["videoSha256"] = "wrong"
        with self.assertRaises(ValueError):
            build_name_snapshot(self.review, self.clip)

    def test_source_display_toggle_not_identity_change_and_mapping_is_checked(self):
        before = source_ref(self.clip, self.review)
        self.review["nameDisplay"] = {"enabled": False}
        self.assertEqual(before, source_ref(self.clip, self.review))
        self.review["sourceFrameMapping"][0]["time"] = 33
        with self.assertRaises(ValueError):
            source_ref(self.clip, self.review)

    def test_anchor_must_be_seen_and_parent_time_never_uses_asset_pts(self):
        snapshot = build_name_snapshot(self.review, self.clip)
        participant = snapshot["participants"][0]
        plan = {"events": [{"eventId": "e1", "startTime": 0, "endTime": .2, "evidenceFrames": [1]}],
                "cues": [{"cueId": "c1", "eventId": "e1", "text": "Alice传球", "participantRefs": [participant["participantId"]], "nameRecordRefs": [participant["nameRecordRef"]], "evidenceFrames": [1]}],
                "participants": [participant], "nodes": [{"nodeId": "n1", "eventId": "e1", "cueIds": ["c1"], "anchorAssetFrame": 1,
                 "evidenceWindow": {"startFrame": 0, "endFrame": 1}, "participantRefs": [participant["participantId"]], "focus": "传球", "uncertainties": []}]}
        saved = finalize_plan(plan, self.clip, self.review, self.context, {"frames": [1]}, model_config(), "job", None)
        node = saved["nodes"][0]
        self.assertEqual((node["assetPtsSeconds"], node["reviewTimeSeconds"], node["parentTimeSeconds"]), (7.1, 20.1, 90.1))
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(saved["producerConfigSnapshot"]["model"], "openai/gpt-6-astra")
        bad = copy.deepcopy(plan); bad["nodes"][0]["anchorAssetFrame"] = 3
        with self.assertRaises(ValueError):
            finalize_plan(bad, self.clip, self.review, self.context, {"frames": [1]}, model_config(), "job", None)

    def test_other_model_cannot_borrow_astra_capabilities(self):
        with self.assertRaises(ValueError):
            model_config({"provider": "openrouter", "model": "other/model"})

    def test_official_catalog_resolves_exact_vision_tools_and_preserves_unknown_prices(self):
        row = {"id": "vendor/vision", "architecture": {"input_modalities": ["text", "image"]},
               "supported_parameters": ["tools"], "context_length": 32000,
               "top_provider": {"max_completion_tokens": 4000}, "pricing": {"prompt": ".000001", "completion": ".000002"}}
        config = resolve_catalog_config("vendor/vision", fetch=lambda url: {"data": [row]})
        self.assertEqual(config["reasoning"], "off")
        self.assertEqual(config["modelCapabilities"]["cost"]["input"], 1)
        self.assertIsNone(config["modelCapabilities"]["cost"]["cacheRead"])
        row["architecture"]["input_modalities"] = ["text"]
        with self.assertRaises(ValueError):
            resolve_catalog_config("vendor/vision", fetch=lambda url: {"data": [row]})

    def test_source_cut_and_entity_binding_changes_invalidate_source(self):
        before = source_ref(self.clip, self.review)
        self.review["entities"] = [{"id": "P1", "bindings": [{"trackId": 8, "start": 0, "end": 1}]}]
        self.assertNotEqual(before, source_ref(self.clip, self.review))
        self.clip["sourceCuts"] = [1]
        snapshot = build_name_snapshot(self.review, self.clip)
        self.assertEqual(snapshot["participants"][0]["validRange"], {"startFrame": 0, "endFrame": 0})

    def test_missing_parent_mapping_keeps_unknown_parent(self):
        plan = {"participants": [], "events": [{"eventId": "e", "startTime": 0, "endTime": .2}],
                "cues": [{"cueId": "c", "eventId": "e", "text": "传球"}],
                "nodes": [{"nodeId": "n", "eventId": "e", "cueIds": ["c"], "anchorAssetFrame": 1,
                           "evidenceWindow": {"startFrame": 0, "endFrame": 1}, "participantRefs": []}]}
        saved = finalize_plan(plan, self.clip, None, self.context, {"frames": [1]}, model_config(), "job", None)
        self.assertIsNone(saved["nodes"][0]["parentTimeSeconds"])
        self.assertEqual(saved["nodes"][0]["assetPtsSeconds"], 7.1)
        self.clip["sourceCuts"] = [1]
        with self.assertRaisesRegex(ValueError, "scene cut"):
            finalize_plan(plan, self.clip, None, self.context, {"frames": [1]}, model_config(), "job", None)

    def test_every_new_cue_belongs_to_exactly_one_node(self):
        plan = {"participants": [], "events": [{"eventId": "e", "startTime": 0, "endTime": .2}],
                "cues": [{"cueId": "c1", "eventId": "e", "text": "传球", "delivery": "during_play"},
                         {"cueId": "c2", "eventId": "e", "text": "空间拉开", "delivery": "pause"}],
                "nodes": [{"nodeId": "n", "eventId": "e", "cueIds": ["c1", "c2"], "anchorAssetFrame": 1,
                           "evidenceWindow": {"startFrame": 0, "endFrame": 1}, "participantRefs": []}]}
        valid = finalize_plan(plan, self.clip, None, self.context, {"frames": [1]}, model_config(), "job", None)
        self.assertEqual(valid["cues"][0]["delivery"], "during_play")
        plan["nodes"][0]["cueIds"] = ["c1"]
        with self.assertRaisesRegex(ValueError, "exactly one node"):
            finalize_plan(plan, self.clip, None, self.context, {"frames": [1]}, model_config(), "job", None)
        plan["nodes"].append({**plan["nodes"][0], "nodeId": "n2", "cueIds": ["c1", "c2"]})
        with self.assertRaisesRegex(ValueError, "exactly one node"):
            finalize_plan(plan, self.clip, None, self.context, {"frames": [1]}, model_config(), "job", None)


if __name__ == "__main__":
    unittest.main()
