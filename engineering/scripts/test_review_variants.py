"""Verify detector variants retain isolated data through actual video trimming."""
import argparse
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from review_video_trim import trim_review_clip
from serve_player_review import load_clip


class VariantTests(unittest.TestCase):
    def setUp(self):
        import av
        import numpy as np
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.video = self.root / 'source.mp4'
        with av.open(str(self.video), 'w') as container:
            stream = container.add_stream('libx264', rate=10)
            stream.width = 64; stream.height = 48; stream.pix_fmt = 'yuv420p'
            for i in range(6):
                frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), i * 30, np.uint8), format='rgb24')
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)
        with av.open(str(self.video)) as container:
            times = [float(frame.time) for frame in container.decode(video=0)]
        self.digest = hashlib.sha256(self.video.read_bytes()).hexdigest()
        for variant in ['original', 'ebard']:
            data = [{'frame': i, 'time': t, 'tracks': [[1, 2, 20, 40, i + (10 if variant == 'ebard' else 1), .9, 2 if variant == 'ebard' else 0]],
                     'objects': [{'kind': 'hoop', 'box': [3, 4, 8, 9], 'score': .8, 'groundPoint': False}] if variant == 'ebard' else [],
                     'track_roles': {str(i + 10): 'player'} if variant == 'ebard' else {}}
                    for i, t in enumerate(times)]
            path = self.root / f'{variant}.json'
            path.write_text(json.dumps(data), encoding='utf-8')
            path.with_suffix('.meta.json').write_text(json.dumps({'video_sha256': self.digest, 'frames': 6}), encoding='utf-8')
        self.sample = {'id': 'test', 'video': str(self.video), 'tracks': str(self.root / 'original.json'),
                       'videoSha256': self.digest, 'originalLabel': '通用 YOLOv8s', 'defaultVariant': 'ebard',
                       'trackingVariants': [{'id': 'ebard', 'tracks': str(self.root / 'ebard.json'), 'label': 'E-BARD', 'recommended': True}]}

    def load(self, sample=None):
        return load_clip(argparse.ArgumentParser(), sample or self.sample)

    def test_default_and_fingerprints_do_not_mix_models(self):
        clip = self.load()
        self.assertEqual(clip['defaultVariant'], 'ebard')
        a, b = [json.loads(clip['payloads'][k]) for k in ['original', 'ebard']]
        self.assertNotEqual(a['tracking_fingerprint'], b['tracking_fingerprint'])
        self.assertEqual(a['variant'], 'original');self.assertEqual(b['variant'], 'ebard')
        self.assertEqual(b['variants'][1]['recommended'], True)
        self.assertFalse(a['frames'][0]['objects']);self.assertEqual(b['frames'][0]['objects'][0]['kind'], 'hoop')

    def test_cut_preserves_both_models_objects_roles_and_lineage(self):
        clip = self.load()
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        result = trim_review_clip({'video': self.video, 'payload': payloads['ebard'], 'payloads': payloads},
                                  [{'start': 0, 'end': 1}, {'start': 4, 'end': 5}], self.root / 'cut')
        cut = self.load(result)
        self.assertEqual(cut['defaultVariant'], 'ebard')
        self.assertEqual(set(cut['payloads']), {'original', 'ebard'})
        for variant in cut['payloads']:
            payload = json.loads(cut['payloads'][variant])
            self.assertEqual(payload['sourceCuts'], [2])
            self.assertEqual([row['source_frame'] for row in payload['frames']], [0, 1, 4, 5])
            for row, index in zip(payload['frames'], [0, 1, 4, 5]):
                self.assertEqual(row['tracks'], payloads[variant]['frames'][index]['tracks'])
                self.assertEqual(row['objects'], payloads[variant]['frames'][index]['objects'])
                self.assertEqual(row['track_roles'], payloads[variant]['frames'][index]['track_roles'])
            self.assertEqual(payload['source_video_sha256'], self.digest)

    def test_wrong_video_or_unavailable_default_is_rejected(self):
        wrong = {**self.sample, 'defaultVariant': 'missing'}
        with self.assertRaises(SystemExit):self.load(wrong)
        meta = self.root / 'ebard.meta.json'
        meta.write_text(json.dumps({'video_sha256': 'other-video', 'frames': 6}), encoding='utf-8')
        with self.assertRaises(SystemExit):self.load()

    def test_misaligned_version_rejected_before_any_trim_files(self):
        clip = self.load()
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        payloads['original']['frames'][1]['time'] += .1
        output = self.root / 'invalid'
        with self.assertRaises(ValueError):
            trim_review_clip({'video': self.video, 'payload': payloads['ebard'], 'payloads': payloads}, [{'start': 0, 'end': 2}], output)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
