"""Small contract tests: distinguish temporal errors and warning proxies from truth."""
import unittest

from audit_baseline import alignment, audit_tracks, gap_summary, overlap


class AuditContractTests(unittest.TestCase):
    def test_nonzero_pts_origin_is_preserved(self):
        video = [{'pts': 1536, 'time_base': [1, 12800], 'time': .12}]
        correct = [{'frame': 0, 'time': .12, 'source_frame_pts': 1536, 'source_time_base': [1, 12800]}]
        self.assertTrue(alignment(correct, video)['all_pass'])
        reset = [{'frame': 0, 'time': 0, 'source_frame_pts': 1536, 'source_time_base': [1, 12800]}]
        self.assertFalse(alignment(reset, video)['all_pass'])

    def test_integer_pts_and_frame_count_checked_separately(self):
        video = [{'pts': 10, 'time_base': [1, 100], 'time': .1}]
        wrong = [{'frame': 0, 'time': .1, 'source_frame_pts': 9, 'source_time_base': [1, 100]}]
        result = alignment(wrong, video)
        self.assertEqual(result['explicit_pts_mismatches'], 1)
        self.assertFalse(result['all_pass'])
        self.assertFalse(alignment([], video)['all_pass'])

    def test_only_internal_gaps_count(self):
        result = gap_summary({1: [5, 6, 9, 9, 10], 2: [50]})
        self.assertEqual(result['within_id_gap_events'], 1)
        self.assertEqual(result['absent_frames_sum'], 2)
        self.assertEqual(result['largest_gaps'][0]['start'], 7)

    def test_containment_is_different_from_high_iou(self):
        iou, smaller, ratio = overlap([0, 0, 20, 20], [5, 5, 10, 10])
        self.assertLess(iou, .7)
        self.assertEqual(smaller, 1)
        self.assertLess(ratio, .6)

    def test_absent_evidence_and_objects_are_unknown(self):
        records = [{'frame': 0, 'time': 0, 'tracks': [[0, 0, 10, 20, 1, .9, 0]], 'pending_detections': []}]
        result = audit_tracks(records, {}, 100, 100)
        self.assertIsNone(result['evidence']['color_conflict_flags'])
        self.assertIsNone(result['objects']['observation_counts'])
        self.assertIsNone(result['player_observations'])
        self.assertIsNone(result['accuracy']['identity_accuracy'])

    def test_existing_false_flags_count_as_zero_not_unknown(self):
        records = [{'frame': 0, 'time': 0, 'tracks': [[0, 0, 10, 20, 1, .9, 2]],
            'pending_detections': [], 'objects': [], 'track_evidence': {'1': {'color_conflict': False,
                'identity_review_required': False, 'identity_verified': False}}}]
        result = audit_tracks(records, {'player_class_id': 2}, 100, 100)
        self.assertEqual(result['evidence']['color_conflict_flags'], 0)
        self.assertEqual(result['objects']['observation_counts'], {})
        self.assertEqual(result['player_observations'], 1)


if __name__ == '__main__':
    unittest.main()
