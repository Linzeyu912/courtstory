"""Check model initialisation against real video identity, cuts and metadata."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import av
import cv2
import numpy as np

from court_calibration import CourtKeypointModel, CourtModelUnavailable, calibrate_court, object_source_payload
from court_propagation import LANDMARKS, project
from scene_profiles import validate_court_candidates


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.video = Path(self.temp.name) / 'shot.mp4'
        texture = np.random.default_rng(23).integers(0, 256, (240, 400), dtype=np.uint8)
        texture = cv2.GaussianBlur(texture, (3, 3), 0)
        with av.open(str(self.video), 'w') as out:
            stream = out.add_stream('libx264', rate=10)
            stream.width = 400; stream.height = 240; stream.pix_fmt = 'yuv420p'
            for i in range(5):
                picture = av.VideoFrame.from_ndarray(texture, format='gray')
                for packet in stream.encode(picture): out.mux(packet)
            for packet in stream.encode(): out.mux(packet)
        with av.open(str(self.video)) as inp:
            times = [float(f.time) for f in inp.decode(video=0)]
        self.digest = hashlib.sha256(self.video.read_bytes()).hexdigest()
        self.payload = {'width': 400, 'height': 240, 'video_sha256': self.digest,
                        'sourceCuts': [3], 'variant': 'ebard', 'tracking_fingerprint': 'ebard-fingerprint',
                        'frames': [{'frame': i, 'time': t, 'tracks': [], 'source_frame': 10+i,
                                    'source_time': 4.+t, 'objects': [{'kind': 'hoop', 'box': [10, 20, 30, 35], 'score': .9}]}
                                   for i, t in enumerate(times)]}
        h = np.array([[11., 1., 15.], [.2, 11., 10.], [0., 0., 1.]])
        self.estimate = {'side': 'left', 'status': 'needs_review', 'reason': None,
                         'points': [{'id': key, 'image': project(h, [LANDMARKS[key]])[0].tolist()}
                                    for key in 'ABCDE'],
                         'courtToImage': h.ravel().tolist(), 'imageToCourt': np.linalg.inv(h).ravel().tolist(),
                         'orientation': {'method': 'test_geometry'}}
        self.predictor = lambda image: np.zeros((48, 3))

    def run_calibration(self, **kwargs):
        with patch('court_orientation.estimate_court', return_value=self.estimate):
            return calibrate_court(self.video, self.payload, 1, self.predictor, **kwargs)

    def test_initial_reference_has_floor_inverse_and_is_unconfirmed(self):
        before = copy.deepcopy(self.payload)
        result = self.run_calibration()
        self.assertEqual(result['summary']['validFrames'], 1)
        row = result['keyframes'][0]
        self.assertEqual(row['side'], 'left')
        self.assertEqual(row['status'], 'needs_review')
        np.testing.assert_allclose(np.array(row['imageToCourt']).reshape(3, 3) @
                                   np.array(row['courtToImage']).reshape(3, 3), np.eye(3), atol=1e-9)
        self.assertFalse(result['metricAccuracyValidated'])
        self.assertEqual(result['initialization']['sourceFrame'], 11)
        self.assertEqual(row['orientation']['objectTrackingFingerprint'], 'ebard-fingerprint')
        self.assertEqual(self.payload, before)
        validate_court_candidates(result, self.digest, 5)

    def test_unknown_orientation_is_not_a_fabricated_left_reference(self):
        self.estimate.update(side=None, status='invalid', points=[], courtToImage=None,
                             imageToCourt=None, reason='no_visible_hoop')
        result = self.run_calibration(propagate=True)
        self.assertEqual(result['keyframes'], [])
        self.assertEqual(result['invalidFrames'], [])
        self.assertEqual(result['unresolvedFrames'], [1])
        self.assertIsNone(result['initialization']['side'])
        validate_court_candidates(result, self.digest, 5)

    def test_propagation_locks_side_and_respects_source_and_added_cuts(self):
        result = self.run_calibration(propagate=True, cuts=[1])
        self.assertEqual([r['frame'] for r in result['keyframes']], [1, 2])
        self.assertTrue(all(r['side'] == 'left' for r in result['keyframes']))
        self.assertEqual(result['initialization']['frame'], 1)

    def test_video_change_is_rejected_before_model_inference(self):
        self.payload['video_sha256'] = 'other'
        with self.assertRaisesRegex(ValueError, '视频已变化'):
            self.run_calibration()

    def test_object_source_must_match_video_dimensions_and_times(self):
        for field, value in [('video_sha256', 'other'), ('width', 401)]:
            other = copy.deepcopy(self.payload); other[field] = value
            with self.assertRaises(ValueError): self.run_calibration(object_payload=other)
        other = copy.deepcopy(self.payload); other['frames'][1]['time'] += .1
        with self.assertRaises(ValueError): self.run_calibration(object_payload=other)

    def test_bad_request_and_unsupported_court_are_rejected(self):
        for frame in [True, -1, 5, 1.5]:
            with self.assertRaises(ValueError):
                calibrate_court(self.video, self.payload, frame, self.predictor)
        for options in [{'cuts': [True]}, {'cuts': '1'}, {'propagate': 'yes'}, {'max_fallback_frames': True}]:
            with self.assertRaises(ValueError): self.run_calibration(**options)
        self.payload['supportsCourtCalibration'] = False
        with self.assertRaises(ValueError): self.run_calibration()

    def test_model_missing_or_wrong_hash_never_downloads(self):
        model = CourtKeypointModel(Path(self.temp.name) / 'missing.pt')
        with self.assertRaises(CourtModelUnavailable): model(np.zeros((240, 400, 3), dtype=np.uint8))
        bad = Path(self.temp.name) / 'bad.pt'; bad.write_bytes(b'not a model')
        with self.assertRaises(CourtModelUnavailable): CourtKeypointModel(bad)(np.zeros((240, 400, 3)))

    def test_generic_review_can_use_registered_ebard_objects(self):
        generic = copy.deepcopy(self.payload); generic['variant'] = 'original'
        for row in generic['frames']: row['objects'] = []
        clip = {'payloads': {'original': json.dumps(generic), 'ebard': json.dumps(self.payload)}}
        objects = object_source_payload(clip, 'original')
        self.assertEqual(objects['variant'], 'ebard')
        self.assertEqual(json.loads(clip['payloads']['original']), generic)


if __name__ == '__main__':
    unittest.main()
