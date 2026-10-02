"""Baseline adaptation keeps raw proposals and actual container timestamps."""
import copy
import importlib
import importlib.util
import unittest


class ReviewAdapterTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('adapt_player_review_tracks'), 'Baseline adapter is missing')
        self.adapter = importlib.import_module('adapt_player_review_tracks')
        self.probe = {'frames': [
            {'frame_index': 0, 'global_source_video_timestamp_seconds': .12,
             'detections': [{'xyxy': [1, 2, 20, 40], 'track_id': 4, 'confidence': .8, 'class_id': 2},
                            {'xyxy': [25, 3, 40, 42], 'track_id': None, 'confidence': .1, 'class_id': 2}],
             'tracker_results': [{'xyxy': [0, 1, 21, 41], 'track_id': 4, 'confidence': .8, 'class_id': 2}]},
            {'frame_index': 1, 'global_source_video_timestamp_seconds': .16, 'detections': [],
             'tracker_results': [{'xyxy': [0, 1, 21, 41], 'track_id': 4, 'confidence': .8, 'class_id': 2}]}
        ]}

    def test_one_raw_box_per_detection_without_duplicating_kalman_tracker_boxes(self):
        records = self.adapter.adapt_probe_records(self.probe, [.12, .16])
        self.assertEqual(records, [
            {'frame': 0, 'time': .12, 'tracks': [[1, 2, 20, 40, 4, .8, 2]],
             'pending_detections': [[25, 3, 40, 42, .1, 2]], 'candidate_count': 2},
            {'frame': 1, 'time': .16, 'tracks': [], 'pending_detections': [], 'candidate_count': 0}
        ])

    def test_missing_or_shifted_container_pts_cannot_be_invented_from_relative_time(self):
        for timestamp in [None, .04]:
            with self.subTest(timestamp=timestamp):
                probe = copy.deepcopy(self.probe)
                probe['frames'][1]['global_source_video_timestamp_seconds'] = timestamp
                probe['frames'][1]['source_time_seconds'] = .04
                with self.assertRaisesRegex(ValueError, 'source timestamp'):
                    self.adapter.adapt_probe_records(probe, [.12, .16])

    def test_duplicate_ids_and_nonsequential_frames_are_rejected(self):
        probe = copy.deepcopy(self.probe)
        probe['frames'][0]['detections'].append(copy.deepcopy(probe['frames'][0]['detections'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate track'):
            self.adapter.adapt_probe_records(probe, [.12, .16])
        probe = copy.deepcopy(self.probe)
        probe['frames'][1]['frame_index'] = 8
        with self.assertRaisesRegex(ValueError, 'frame index'):
            self.adapter.adapt_probe_records(probe, [.12, .16])

    def test_missing_detections_do_not_turn_predictions_into_visible_positions(self):
        probe = copy.deepcopy(self.probe)
        del probe['frames'][1]['detections']
        with self.assertRaisesRegex(ValueError, 'detections'):
            self.adapter.adapt_probe_records(probe, [.12, .16])


if __name__ == '__main__':
    unittest.main()
