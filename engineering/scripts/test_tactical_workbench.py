import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import av
import numpy as np
from local_video_library import file_hash
from tactical_workbench import TacticalWorkbench


class TacticalWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.video = self.root / 'video.mp4'
        with av.open(str(self.video), 'w') as container:
            stream = container.add_stream('libx264', rate=10)
            stream.width, stream.height, stream.pix_fmt = 64, 48, 'yuv420p'
            for index in range(5):
                frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), index * 40, np.uint8), format='rgb24')
                for packet in stream.encode(frame): container.mux(packet)
            for packet in stream.encode(): container.mux(packet)
        with av.open(str(self.video)) as container:
            frames = [{'frame': i, 'time': float(f.time)} for i, f in enumerate(container.decode(video=0))]
        self.clip = {'video_sha256': file_hash(self.video), 'tracking_fingerprint': 'track-v1', 'tracking_revision': 'test', 'width': 64, 'height': 48, 'frames': frames}
        self.store = TacticalWorkbench(self.root / 'data')
        self.document = {'review': {'videoSha256': self.clip['video_sha256'], 'trackingFingerprint': 'track-v1', 'trackingRevision': 'test', 'width': 64, 'height': 48,
            'sourceFrameMapping': [{**f, 'sourceFrame': f['frame'], 'sourceTime': f['time']} for f in frames]}}

    def test_exact_decode_returns_requested_pts_and_real_jpeg(self):
        result = self.store.frames(self.video, self.clip, [0, 3])
        self.assertEqual([f['time'] for f in result], [0, 0.3]); self.assertTrue(result[0]['dataUrl'].startswith('data:image/jpeg;base64,/9j/'))

    def test_mismatched_pts_hash_and_frame_bounds_are_rejected(self):
        bad = copy.deepcopy(self.clip); bad['frames'][2]['time'] = 0.25
        with self.assertRaises(ValueError): self.store.frames(self.video, bad, [2])
        with self.assertRaises(ValueError): self.store.frames(self.video, self.clip, [-1])
        with self.assertRaises(ValueError): self.store.frames(self.video, {**self.clip, 'video_sha256': 'wrong'}, [0])

    def test_saved_documents_survive_restart_and_qa_is_isolated(self):
        with patch.object(self.store, 'run', return_value={'valid': True}):
            result = self.store.save(self.document, self.clip, 'test', True, 'workspace', 0)
        self.assertEqual(result['version'], 1)
        restarted = TacticalWorkbench(self.root / 'data')
        self.assertEqual(restarted.load(self.clip, 'test', True, 'workspace')['document'], self.document)
        self.assertIsNone(restarted.load(self.clip, 'test', False, 'workspace')['document'])

    def test_concurrent_save_cannot_overwrite_newer_version(self):
        with patch.object(self.store, 'run', return_value={'valid': True}):
            self.store.save(self.document, self.clip, 'test', False, 'workspace', 0)
            with self.assertRaises(ValueError): self.store.save(self.document, self.clip, 'test', False, 'workspace', 0)
        self.assertEqual(self.store.load(self.clip, 'test', False, 'workspace')['version'], 1)

    def test_foreign_model_and_modified_candidate_cannot_be_saved(self):
        with self.assertRaises(ValueError): self.store.check_source(self.document, {**self.clip, 'tracking_fingerprint': 'other'}, 'workspace')
        self.store.candidate_cache = copy.deepcopy(self.document)
        changed = copy.deepcopy(self.document); changed['review']['width'] = 128
        with self.assertRaises(ValueError): self.store.check_source(changed, self.clip, 'candidate')

    def test_untrusted_storage_key_cannot_escape_configured_directory(self):
        path = self.store.path(self.clip, '../../elsewhere', True, 'workspace')
        self.assertTrue(path.is_relative_to(self.root / 'data'))
        with self.assertRaises(ValueError): self.store.path(self.clip, 'test', True, '../../x')


if __name__ == '__main__': unittest.main()
