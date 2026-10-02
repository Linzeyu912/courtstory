"""Raw detector partitions remain separate from identity review and accuracy."""

from copy import deepcopy
from fractions import Fraction
from pathlib import Path
import unittest

from detector_evidence import build_detector_evidence, detector_evidence_for_clip, validate_frame_evidence
from review_video_trim import trim_tracking_metadata
from serve_player_review import validate_frame_records


def evidence_records():
    return [{'frame': 0, 'time': 0, 'tracks': [[1, 2, 20, 40, 7, .9, 2]],
             'pending_detections': [[25, 3, 40, 42, .2, 2]],
             'suppressed_detections': [[3, 4, 19, 38, .7, 2]], 'candidate_count': 2,
             'raw_detection_count': 3,
             'detection_indices': {'tracks': [2], 'pending_detections': [0], 'suppressed_detections': [1]},
             'track_evidence': {'7': {'raw_detection_index': 2, 'native_detection_index': 1,
                                    'source': 'full_body_detection_recovery', 'identity_verified': False}}},
            {'frame': 1, 'time': .04, 'tracks': [], 'pending_detections': [], 'suppressed_detections': [],
             'candidate_count': 0, 'raw_detection_count': 0,
             'detection_indices': {'tracks': [], 'pending_detections': [], 'suppressed_detections': []},
             'track_evidence': {}}]


class DetectorEvidenceTests(unittest.TestCase):
    def test_declared_counts_include_suppressed_and_cover_empty_frames(self):
        records = evidence_records()
        before = deepcopy(records)
        declaration = build_detector_evidence(records)
        self.assertEqual(declaration['raw_detection_count'], 3)
        self.assertEqual(declaration['tracked_detection_count'], 1)
        self.assertEqual(declaration['pending_detection_count'], 1)
        self.assertEqual(declaration['suppressed_detection_count'], 1)
        self.assertEqual(declaration['frame_count'], 2)
        metadata = {'detector_evidence': declaration}
        result = detector_evidence_for_clip(records, metadata, 'fixture')
        self.assertTrue(result['partition_complete'])
        self.assertEqual(result['scope'], 'post_nms_person_detections')
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(records, before)
        self.assertNotIn('status', metadata['detector_evidence'])

    def test_legacy_evidence_does_not_prove_complete_detector_output(self):
        records = evidence_records()
        for metadata in ({}, {'model': 'THY', 'statistics': {'suppressed_detections': 1}}):
            result = detector_evidence_for_clip(records, metadata, 'legacy')
            self.assertFalse(result['partition_complete'])
            self.assertIsNone(result['raw_coordinates'])
            self.assertEqual(result['status'], 'unknown')
        partial = build_detector_evidence(records)
        partial['partition_complete'] = False
        self.assertFalse(detector_evidence_for_clip(records, {'detector_evidence': partial}, 'partial')['partition_complete'])

    def test_schema_and_counts_reject_false_completeness_claims(self):
        records = evidence_records()
        declaration = build_detector_evidence(records)
        for change in ({'schema_version': True}, {'raw_coordinates': False}, {'frame_count': 1},
                       {'raw_detection_count': 2}, {'suppressed_detection_count': True},
                       {'scope': 'all_neural_network_outputs'}, {'partitions': ['tracks']}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                detector_evidence_for_clip(records, {'detector_evidence': {**declaration, **change}}, 'fixture')

    def test_invalid_partition_indices_and_track_links_cannot_pass_as_complete(self):
        changes = [lambda row: row.update(raw_detection_count=4),
                   lambda row: row.update(raw_detection_count=10**100),
                   lambda row: row['detection_indices']['pending_detections'].append(1),
                   lambda row: row['detection_indices']['suppressed_detections'].__setitem__(0, 0),
                   lambda row: row['detection_indices']['tracks'].__setitem__(0, 1),
                   lambda row: row['track_evidence']['7'].update(raw_detection_index=3),
                   lambda row: row.pop('suppressed_detections'),
                   lambda row: row.pop('detection_indices'),
                   lambda row: row.update(candidate_count=3)]
        for index, change in enumerate(changes):
            records = evidence_records()
            change(records[0])
            with self.subTest(index=index), self.assertRaises(ValueError):
                build_detector_evidence(records)

    def test_optional_evidence_and_suppressed_boxes_are_validated_for_legacy_records(self):
        changes = [lambda row: row.update(track_evidence=[]),
                   lambda row: row['track_evidence'].update({'999': {'raw_detection_index': 0}}),
                   lambda row: row['track_evidence']['7'].update(raw_detection_index=True),
                   lambda row: row['track_evidence']['7'].update(identity_review_required='true'),
                   lambda row: row['track_evidence']['7'].update(native_detection_confidence=True),
                   lambda row: row['suppressed_detections'][0].__setitem__(4, 1.2),
                   lambda row: row['suppressed_detections'][0].__setitem__(2, -1),
                   lambda row: row.update(suppressed_detections={})]
        for index, change in enumerate(changes):
            records = evidence_records()
            change(records[0])
            with self.subTest(index=index), self.assertRaises(ValueError):
                validate_frame_records(records, [0, .04], 'fixture')

    def test_crop_recounts_complete_evidence_and_retains_raw_indices_and_coordinates(self):
        records = evidence_records()
        source = {'video_sha256': 'parent', 'frames': records,
                  'trackingMetadata': {'detector_evidence': build_detector_evidence(records)}}
        subset = deepcopy(records[:1])
        subset[0].update(source_frame=0, source_time=0)
        result = trim_tracking_metadata(source, Path('child.mp4'), subset, [0], Fraction(1, 25), 25, [0], [], False)
        self.assertEqual(result['detector_evidence']['frame_count'], 1)
        self.assertEqual(result['detector_evidence']['raw_detection_count'], 3)
        self.assertEqual(result['source_tracking_metadata']['detector_evidence']['frame_count'], 2)
        for field in ('tracks', 'pending_detections', 'suppressed_detections', 'detection_indices'):
            self.assertEqual(subset[0][field], records[0][field])
        self.assertTrue(detector_evidence_for_clip(subset, result, 'trim')['partition_complete'])
        self.assertNotIn('frameConfirmations', result)


if __name__ == '__main__':
    unittest.main()
