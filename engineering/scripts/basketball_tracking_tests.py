"""Regression fixtures for basketball association and conservative suggestions.

Run in the optional local vision environment; no weights or GPU are required.
"""
import json
import unittest
from types import SimpleNamespace

import numpy as np
from ultralytics.engine.results import Boxes

from basketball_tracker import BasketballBOTSORT, BasketballTrack
from basketball_tracking import TorsoEvidence, build_identity_suggestions, torso_evidence, postprocess_assignments
from basketball_run import player_class_id, validate_output_paths


def args(**changes):
    values = dict(track_high_thresh=.25, track_low_thresh=.1, new_track_thresh=.25,
                  track_buffer=30, match_thresh=.8, fuse_score=True,
                  gmc_method="none", proximity_thresh=.5, appearance_thresh=.8,
                  with_reid=False, model="auto", team_gating=True,
                  duplicate_filter=True, team_min_observations=3)
    values.update(changes)
    return SimpleNamespace(**values)


def scene(detections, colors):
    image = np.full((240, 320, 3), (95, 150, 185), np.uint8)
    for detection, color in zip(detections, colors):
        x1, y1, x2, y2 = map(int, detection[:4])
        image[y1:y2, x1:x2] = color
    data = np.array(detections, np.float32).reshape(-1, 6)
    return Boxes(data, image.shape[:2]), image


class BasketballAssociationTests(unittest.TestCase):
    def test_reliable_team_change_cannot_continue_existing_id(self):
        tracker = BasketballBOTSORT(args())
        detection = [[90, 30, 140, 190, .9, 2]]
        for _ in range(3):
            boxes, image = scene(detection, [(240, 240, 240)])
            first_id = int(tracker.update(boxes, image)[0, 4])
        boxes, image = scene(detection, [(75, 35, 12)])
        result = tracker.update(boxes, image)
        self.assertNotIn(first_id, result[:, 4].astype(int).tolist() if len(result) else [])

    def test_low_score_detection_continues_track_but_cannot_create_one(self):
        tracker = BasketballBOTSORT(args())
        boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(240, 240, 240)])
        first_id = int(tracker.update(boxes, image)[0, 4])
        boxes, image = scene([[92, 30, 142, 190, .18, 2],
                              [200, 30, 250, 190, .18, 2]],
                             [(240, 240, 240), (240, 240, 240)])
        result = tracker.update(boxes, image)
        self.assertEqual(result[:, 4].astype(int).tolist(), [first_id])
        self.assertLess(float(result[0, 5]), .25)

    def test_low_score_opponent_cannot_hijack_track_in_second_stage(self):
        tracker = BasketballBOTSORT(args(team_detection_min_conf=.15))
        detection = [[90, 30, 140, 190, .9, 2]]
        for _ in range(3):
            boxes, image = scene(detection, [(240, 240, 240)])
            first_id = int(tracker.update(boxes, image)[0, 4])
        boxes, image = scene([[90, 30, 140, 190, .18, 2]], [(75, 35, 12)])
        result = tracker.update(boxes, image)
        self.assertNotIn(first_id, result[:, 4].astype(int).tolist() if len(result) else [])

    def test_bright_blue_and_dark_blue_jersey_continue_same_track(self):
        tracker = BasketballBOTSORT(args())
        detection = [[90, 30, 140, 190, .9, 2]]
        for _ in range(3):
            boxes, image = scene(detection, [(75, 35, 12)])
            initial = int(tracker.update(boxes, image)[0, 4])
        boxes, image = scene(detection, [(210, 70, 25)])
        result = tracker.update(boxes, image)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[:, 4].astype(int).tolist(), [initial])

    def test_appearance_mode_keeps_strong_continuity_and_flags_color_for_review(self):
        tracker = BasketballBOTSORT(args(team_gating_mode="appearance", with_reid=True))
        detection = [[90, 30, 140, 190, .9, 2]]
        for _ in range(3):
            boxes, image = scene(detection, [(240, 240, 240)])
            initial = int(tracker.update(boxes, image, np.array([[1., 0.]]))[0, 4])
        boxes, image = scene(detection, [(75, 35, 12)])
        result = tracker.update(boxes, image, np.array([[1., 0.]]))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[:, 4].astype(int).tolist(), [initial])
        self.assertTrue(tracker.tracked_stracks[0].identity_review_required)

    def test_appearance_mode_rejects_clear_opponent_with_disagreeing_feature(self):
        tracker = BasketballBOTSORT(args(team_gating_mode="appearance", with_reid=True))
        detection = [[90, 30, 140, 190, .9, 2]]
        for _ in range(3):
            boxes, image = scene(detection, [(240, 240, 240)])
            initial = int(tracker.update(boxes, image, np.array([[1., 0.]]))[0, 4])
        boxes, image = scene(detection, [(75, 35, 12)])
        result = tracker.update(boxes, image, np.array([[-1., 0.]]))
        self.assertNotIn(initial, result[:, 4].astype(int).tolist() if len(result) else [])

    def test_current_occluded_feature_can_associate_without_initializing_template(self):
        track = BasketballTrack(np.array([115, 110, 50, 160, 0]), .9, 2,
                                np.array([1., 0.]), TorsoEvidence(reason="torso-overlap"))
        self.assertIsNotNone(track.curr_feat)
        self.assertIsNone(track.smooth_feat)

    def test_occluded_update_keeps_existing_smoothed_appearance(self):
        track = BasketballTrack(np.array([115, 110, 50, 160, 0]), .9, 2,
                                np.array([1., 0.]), TorsoEvidence(appearance_safe=True))
        track.activate(BasketballBOTSORT(args()).kalman_filter, 1)
        expected = track.smooth_feat.copy()
        detection = BasketballTrack(np.array([116, 110, 50, 160, 0]), .9, 2,
                                    np.array([0., 1.]), TorsoEvidence(reason="torso-overlap"))
        track.update(detection, 2)
        np.testing.assert_array_equal(track.smooth_feat, expected)

    def test_occluded_reactivation_keeps_existing_smoothed_appearance(self):
        track = BasketballTrack(np.array([115, 110, 50, 160, 0]), .9, 2,
                                np.array([1., 0.]), TorsoEvidence(appearance_safe=True))
        track.activate(BasketballBOTSORT(args()).kalman_filter, 1)
        track.mark_lost()
        expected = track.smooth_feat.copy()
        detection = BasketballTrack(np.array([116, 110, 50, 160, 0]), .9, 2,
                                    np.array([0., 1.]), TorsoEvidence(reason="torso-overlap"))
        track.re_activate(detection, 3)
        np.testing.assert_array_equal(track.smooth_feat, expected)

    def test_new_same_color_neighbor_without_prior_id_is_not_a_duplicate(self):
        tracker = BasketballBOTSORT(args())
        for _ in range(4):
            boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(240, 240, 240)])
            tracker.update(boxes, image)
        boxes, image = scene([[90, 30, 140, 190, .9, 2], [100, 30, 150, 190, .32, 2]],
                             [(240, 240, 240), (240, 240, 240)])
        tracker.update(boxes, image)
        self.assertEqual(tracker.suppressed_indices, [])

    def test_export_full_body_recovery_does_not_change_native_assignment_or_boxes(self):
        raw = np.array([[100, 30, 150, 110, .9, 2], [98, 30, 152, 190, .4, 2]], np.float32)
        original = raw.copy()
        native = {0: 7}
        events = [{"suppressed_index": 0, "kept_index": 1, "reason": "full-body-recovery"}]
        exported, suppressed, sources = postprocess_assignments(native, events)
        self.assertEqual(native, {0: 7})
        np.testing.assert_array_equal(raw, original)
        self.assertEqual(exported, {1: 7})
        self.assertEqual(suppressed, {0})
        self.assertEqual(sources[7], {"native_index": 0, "exported_index": 1, "source": "full_body_detection_recovery"})

    def test_export_composite_duplicate_keeps_both_existing_people(self):
        native = {0: 7, 1: 8, 2: 25}
        exported, suppressed, _ = postprocess_assignments(native,
            [{"suppressed_index": 2, "kept_index": 0, "reason": "supported-nested-same-color"}])
        self.assertEqual(exported, {0: 7, 1: 8})
        self.assertEqual(native, {0: 7, 1: 8, 2: 25})
        self.assertEqual(suppressed, {2})

    def test_upstream_association_core_does_not_feed_export_recovery_back_to_tracker(self):
        tracker = BasketballBOTSORT(args(association_core="upstream", team_gating_mode="audit"))
        for _ in range(4):
            boxes, image = scene([[100, 30, 150, 110, .9, 2]], [(240, 240, 240)])
            initial = int(tracker.update(boxes, image)[0, 4])
        boxes, image = scene([[100, 30, 150, 110, .9, 2], [98, 30, 152, 190, .4, 2]],
                             [(240, 240, 240), (240, 240, 240)])
        result = tracker.update(boxes, image)
        incumbent = next(track for track in tracker.tracked_stracks if track.track_id == initial)
        self.assertEqual(int(incumbent.idx), 0)
        self.assertEqual(float(incumbent.score), float(boxes.conf[0]))
        self.assertLess(float(incumbent.xyxy[3]), 130)
        self.assertIn(initial, result[:, 4].astype(int).tolist())

    def test_repeated_export_full_body_recovery_does_not_reveal_duplicate_native_id(self):
        tracker = BasketballBOTSORT(args(association_core="upstream", team_gating_mode="audit"))
        for _ in range(4):
            boxes, image = scene([[100, 30, 150, 110, .9, 2]], [(240, 240, 240)])
            initial = int(tracker.update(boxes, image)[0, 4])
        for _ in range(5):
            boxes, image = scene([[100, 30, 150, 110, .9, 2], [98, 30, 152, 190, .4, 2]],
                                 [(240, 240, 240), (240, 240, 240)])
            result = tracker.update(boxes, image)
            native = {int(row[-1]): int(row[4]) for row in result}
            exported, suppressed, _ = postprocess_assignments(native, tracker.frame_duplicate_events)
            self.assertEqual(exported, {1: initial})
            self.assertEqual(suppressed, {0})

    def test_duplicate_nested_box_does_not_start_competing_track(self):
        tracker = BasketballBOTSORT(args())
        for _ in range(4):
            boxes, image = scene([[100, 30, 150, 190, .9, 2]], [(240, 240, 240)])
            first_id = int(tracker.update(boxes, image)[0, 4])
        for _ in range(3):
            boxes, image = scene([[100, 30, 150, 190, .9, 2],
                                  [92, 25, 153, 205, .32, 2]],
                                 [(240, 240, 240), (240, 240, 240)])
            result = tracker.update(boxes, image)
        self.assertEqual(result[:, 4].astype(int).tolist(), [first_id])

    def test_overlapping_different_players_keep_their_tracks(self):
        tracker = BasketballBOTSORT(args())
        for _ in range(4):
            boxes, image = scene([[90, 30, 140, 190, .9, 2],
                                  [130, 30, 180, 190, .9, 2]],
                                 [(240, 240, 240), (75, 35, 12)])
            result = tracker.update(boxes, image)
        initial_ids = result[:, 4].astype(int).tolist()
        for _ in range(3):
            boxes, image = scene([[105, 30, 155, 190, .9, 2],
                                  [128, 30, 178, 190, .32, 2]],
                                 [(240, 240, 240), (75, 35, 12)])
            result = tracker.update(boxes, image)
        self.assertEqual(sorted(result[:, 4].astype(int).tolist()), sorted(initial_ids))

    def test_composite_extra_box_is_removed_when_both_players_have_supported_boxes(self):
        tracker = BasketballBOTSORT(args())
        originals = [[90, 30, 140, 190, .9, 2], [125, 30, 175, 190, .9, 2]]
        for _ in range(4):
            boxes, image = scene(originals, [(75, 35, 12), (240, 240, 240)])
            result = tracker.update(boxes, image)
        expected = sorted(result[:, 4].astype(int).tolist())
        boxes, image = scene(originals, [(75, 35, 12), (240, 240, 240)])
        data = np.vstack([boxes.data, [100, 27, 175, 202, .32, 2]])
        tracker.update(Boxes(data, image.shape[:2]), image)
        self.assertEqual(tracker.suppressed_indices, [2])
        self.assertEqual(expected, [1, 2])

    def test_supported_partial_box_recovers_full_body_detection_under_same_id(self):
        tracker = BasketballBOTSORT(args())
        for _ in range(4):
            boxes, image = scene([[100, 30, 150, 110, .9, 2]], [(240, 240, 240)])
            initial = int(tracker.update(boxes, image)[0, 4])
        boxes, image = scene([[100, 30, 150, 110, .9, 2], [98, 30, 152, 190, .4, 2]],
                             [(240, 240, 240), (240, 240, 240)])
        result = tracker.update(boxes, image)
        self.assertEqual(tracker.suppressed_indices, [0])
        self.assertEqual(result[:, 4].astype(int).tolist(), [initial])
        self.assertEqual(int(result[0, -1]), 1)

    def test_low_score_full_body_recovery_keeps_supported_id_in_second_stage(self):
        tracker = BasketballBOTSORT(args())
        for _ in range(4):
            boxes, image = scene([[100, 30, 150, 110, .9, 2]], [(240, 240, 240)])
            initial = int(tracker.update(boxes, image)[0, 4])
        boxes, image = scene([[100, 30, 150, 110, .9, 2], [98, 30, 152, 190, .18, 2]],
                             [(240, 240, 240), (240, 240, 240)])
        result = tracker.update(boxes, image)
        self.assertEqual(result[:, 4].astype(int).tolist(), [initial])
        self.assertEqual(int(result[0, -1]), 1)


class SuggestionBoundaryTests(unittest.TestCase):
    def records(self, frames):
        return [{"frame": frame, "time": .12 + frame / 25,
                 "tracks": [[100, 30, 150, 190, 7, .9, 2]],
                 "pending_detections": [], "candidate_count": 1}
                for frame in frames]

    def test_suggestions_split_at_cut_even_when_internal_id_is_reused(self):
        suggestion = build_identity_suggestions(self.records(range(10)), cuts=[5])
        self.assertEqual(len(suggestion["entities"]), 1)
        bindings = suggestion["entities"][0]["bindings"]
        self.assertEqual(bindings, [{"start": 0, "end": 4, "trackId": 7},
                                    {"start": 5, "end": 9, "trackId": 7}])
        self.assertFalse(suggestion["verified"])

    def test_unknown_gap_is_not_filled_or_bound_as_observation(self):
        suggestion = build_identity_suggestions(self.records([0, 1, 8, 9]))
        self.assertEqual(len(suggestion["entities"]), 1)
        bindings = suggestion["entities"][0]["bindings"]
        self.assertEqual(bindings, [{"start": 0, "end": 1, "trackId": 7},
                                    {"start": 8, "end": 9, "trackId": 7}])
        self.assertFalse(suggestion["verified"])

    def fragment_records(self, opposing=False):
        return [
            {"frame": 0, "tracks": [[90, 30, 140, 190, 1, .9, 2]]},
            {"frame": 1, "tracks": [[92, 30, 142, 190, 1, .9, 2]]},
            {"frame": 4, "tracks": [[96, 30, 146, 190, 11, .9, 2]]},
            {"frame": 5, "tracks": [[98, 30, 148, 190, 11, .9, 2]]},
        ]

    def summaries(self, opposing=False):
        return {1: {"team_label": "white", "last_feature": {"frame": 1, "embedding": [1., 0.]}},
                11: {"team_label": "dark" if opposing else "white",
                     "first_feature": {"frame": 4, "embedding": [1., 0.]}}}

    def test_short_unique_motion_appearance_recovery_preserves_same_alias(self):
        result = build_identity_suggestions(self.fragment_records(), track_summaries=self.summaries())
        self.assertEqual(result["entities"][0]["bindings"],
                         [{"start": 0, "end": 1, "trackId": 1},
                          {"start": 4, "end": 5, "trackId": 11}])
        self.assertFalse(result["verified"])

    def test_opponent_fragment_is_not_linked_even_with_identical_detector_features(self):
        result = build_identity_suggestions(self.fragment_records(), track_summaries=self.summaries(True))
        self.assertEqual(result["entities"][0]["bindings"], [{"start": 0, "end": 1, "trackId": 1}])
        self.assertIn(11, result["unassignedTrackIds"])

    def test_cut_blocks_otherwise_plausible_fragment_recovery(self):
        result = build_identity_suggestions(self.fragment_records(), cuts=[3], track_summaries=self.summaries())
        self.assertEqual(result["entities"][0]["bindings"], [{"start": 0, "end": 1, "trackId": 1}])

    def test_longest_fragment_does_not_replace_a_seed_person_slot(self):
        records = [{"frame": 0, "tracks": [[90, 30, 140, 190, 1, .9, 2],
                                             [200, 30, 250, 190, 2, .9, 2]]}]
        records += [{"frame": frame, "tracks": [[90, 30, 140, 190, 11, .9, 2],
                                                  [200, 30, 250, 190, 2, .9, 2]]}
                    for frame in range(1, 20)]
        result = build_identity_suggestions(records)
        self.assertEqual([entity["bindings"][0]["trackId"] for entity in result["entities"]], [1, 2])

    def test_color_conflict_does_not_become_an_identity_binding(self):
        records = self.records(range(5))
        for frame in (2, 3):
            records[frame]["track_evidence"] = {"7": {"identity_review_required": True}}
        result = build_identity_suggestions(records)
        self.assertEqual(result["entities"][0]["bindings"],
                         [{"start": 0, "end": 1, "trackId": 7}, {"start": 4, "end": 4, "trackId": 7}])


class DetectorContractTests(unittest.TestCase):
    def test_output_or_derived_metadata_cannot_replace_source_or_model(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source, model = root / "source.meta.json", root / "model.pt"
            source.touch()
            model.touch()
            for output in (source, model, root / "source.json"):
                with self.subTest(output=output), self.assertRaises(ValueError):
                    validate_output_paths(source, model, output)
            validate_output_paths(source, model, root / "optimized.json")
    def test_basketball_player_class_is_found_from_model_names(self):
        self.assertEqual(player_class_id({0: "basketball", 1: "hoop", 2: "Player", 3: "referee"}), 2)

    def test_generic_person_class_is_not_mislabeled_as_basketball_player(self):
        with self.assertRaises(ValueError):
            player_class_id({0: "person"})

    def test_numpy_detector_score_produces_json_safe_evidence(self):
        boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(240, 240, 240)])
        payload = torso_evidence(image, boxes.xyxy[0], boxes.conf[0]).as_dict()
        try:
            json.dumps(payload)
        except TypeError as error:
            self.fail(f"Detection evidence cannot be delivered as JSON: {error}")

    def test_high_score_white_jersey_with_dark_number_rejects_dark_match_without_template_update(self):
        boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(70, 120, 160)])
        # Independent hand fixture: central torso has 42% white cloth, 30% dark
        # number/arm and 28% skin. It must not be mistaken for a dark jersey.
        image[66:114, 103:113] = (230, 230, 230)
        image[66:114, 113:120] = (40, 40, 40)
        result = torso_evidence(image, boxes.xyxy[0], .9)
        self.assertEqual(result.label, "white")
        self.assertTrue(result.reliable)
        self.assertFalse(result.template_safe)

    def test_pure_foreground_torso_can_reject_opponent_but_overlap_cannot_update_template(self):
        boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(75, 35, 12)])
        result = torso_evidence(image, boxes.xyxy[0], .9, [[85, 25, 145, 195]])
        self.assertEqual(result.label, "dark")
        self.assertTrue(result.reliable)
        self.assertFalse(result.template_safe)

    def test_large_dark_number_with_visible_white_cloth_remains_ambiguous(self):
        boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(40, 40, 40)])
        image[66:114, 103:109] = (230, 230, 230)
        result = torso_evidence(image, boxes.xyxy[0], .9)
        self.assertFalse(result.reliable)
        self.assertFalse(result.template_safe)

    def test_neutral_dark_number_patch_cannot_establish_an_opponent(self):
        boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(40, 40, 40)])
        result = torso_evidence(image, boxes.xyxy[0], .9)
        self.assertFalse(result.reliable)
        self.assertIsNone(result.label)

    def test_clear_neutral_jersey_can_update_appearance_without_a_team_label(self):
        boxes, image = scene([[90, 30, 140, 190, .9, 2]], [(40, 40, 40)])
        result = torso_evidence(image, boxes.xyxy[0], .9)
        self.assertTrue(getattr(result, "appearance_safe", False))
        self.assertIsNone(result.label)


if __name__ == "__main__":
    unittest.main()
