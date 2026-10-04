"""Measure camera recovery against known motion, including real missing images."""
import tempfile
import unittest
from pathlib import Path

import av
import cv2
import numpy as np

from court_propagation import LANDMARKS, project, propagate_court


class MotionRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.texture = cv2.GaussianBlur(np.random.default_rng(83).integers(
            0, 256, (240, 1200), dtype=np.uint8), (3, 3), 0)
        cls.h = np.array([[50., 0., 25.], [0., 10., 8.], [0., 0., 1.]])
        cls.seed = {'frame': 0, 'side': 'left', 'source': 'human', 'points': [
            {'id': name, 'image': project(cls.h, [LANDMARKS[name]])[0].tolist(), 'source': 'human'}
            for name in 'ABCDE']}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_pan(self, name, blank=(), cuts=()):
        video = Path(self.temp.name) / (name+'.mp4')
        with av.open(str(video), 'w') as out:
            stream = out.add_stream('libx264', rate=10)
            stream.width = 400; stream.height = 240; stream.pix_fmt = 'yuv420p'
            for i in range(70):
                picture = self.texture[:, i*8:i*8+400].copy()
                if i in blank:
                    picture[:] = 0
                # A static broadcast bar must not anchor the moving floor.
                picture[185:] = self.texture[185:, :400]
                frame = av.VideoFrame.from_ndarray(picture, format='gray')
                for packet in stream.encode(frame): out.mux(packet)
            for packet in stream.encode(): out.mux(packet)
        with av.open(str(video)) as source:
            times = [float(frame.time) for frame in source.decode(video=0)]
        payload = {'width': 400, 'height': 240, 'video_sha256': name, 'sourceCuts': list(cuts),
                   'frames': [{'frame': i, 'time': time, 'tracks': []} for i, time in enumerate(times)]}
        return propagate_court(video, payload, self.seed, max_fallback_frames=2)

    def assert_ground_motion(self, result):
        source = np.array([p['image'] for p in self.seed['points']])
        for key in result['keyframes']:
            if key['points']:
                measured = np.array([p['image'] for p in key['points']])
                np.testing.assert_allclose(measured, source+[-8*key['frame'], 0.], atol=2.)

    def test_long_pan_preserves_geometry_after_seed_leaves_view(self):
        result = self.run_pan('pan')
        self.assertGreaterEqual(result['summary']['validFrames'], 67)
        self.assertTrue(any(k['quality'].get('method') == 'sift_local_anchor' for k in result['keyframes']))
        self.assert_ground_motion(result)

    def test_blank_frames_stay_missing_then_measured_recovery_resumes(self):
        result = self.run_pan('blank', blank=(35, 36))
        self.assertTrue({35, 36}.issubset(result['invalidFrames']))
        self.assertTrue(result['keyframes'][40]['points'])
        self.assert_ground_motion(result)

    def test_local_references_never_cross_registered_cut(self):
        result = self.run_pan('cut', cuts=(40,))
        self.assertEqual(result['keyframes'][-1]['frame'], 39)
        self.assertTrue(all(k['quality'].get('motionAnchorSourceFrame', 0) < 40 for k in result['keyframes']))
        self.assert_ground_motion(result)


if __name__ == '__main__':
    unittest.main()
