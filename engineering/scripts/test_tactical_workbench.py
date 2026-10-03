import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import av
import numpy as np
from local_video_library import file_hash
from tactical_workbench import TacticalWorkbench, ROOT


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


class AuthoredAnnotationsPersistenceTests(unittest.TestCase):
    """Use the real Node validator, not the persistence tests' validation mock."""
    def setUp(self):
        self.node = shutil.which('node')
        if not self.node: self.skipTest('Node.js is required by the tactical workbench')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name) / 'annotations'
        script = """
import {makePresentationDemo} from './engineering/tools/tactical-overlay/fixtures/presentation-demo.mjs';
import {createAnnotation} from './engineering/tools/player-review/tactics-annotations.mjs';
let doc={schemaVersion:1,title:'manual canvas',notes:'',...await makePresentationDemo(),presentation:{schemaVersion:1,routes:[]}};
for(const type of ['route','screen','spotlight'])doc=createAnnotation(doc,{id:type,type,phaseId:'setup',entityId:'P1',frame:12,
  space:'court',points:type==='route'?[{x:18,y:10},{x:22,y:9}]:[{x:18,y:10}]});
process.stdout.write(JSON.stringify(doc));
"""
        result = subprocess.run([self.node, '--input-type=module', '-e', script], cwd=ROOT,
            text=True, encoding='utf-8', capture_output=True, check=True,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.document = json.loads(result.stdout)
        review = self.document['review']
        self.clip = {'video_sha256': review['videoSha256'], 'tracking_fingerprint': review['trackingFingerprint'],
            'tracking_revision': review['trackingRevision'], 'width': review['width'], 'height': review['height'],
            'frames': [{'frame': p['frame'], 'time': p['time'], 'source_frame': p['sourceFrame'],
                       'source_time': p['sourceTime']} for p in review['sourceFrameMapping']]}
        self.store = TacticalWorkbench(self.folder, node=self.node)

    def test_annotations_and_legacy_presentation_survive_actual_validation_save_and_restart(self):
        saved = self.store.save(self.document, self.clip, 'test', True, 'workspace', 0)
        self.assertEqual(saved['version'], 1)
        restored = TacticalWorkbench(self.folder, node=self.node).load(self.clip, 'test', True, 'workspace')
        self.assertEqual(restored['document'], self.document)
        self.assertEqual([a['type'] for a in restored['document']['annotations']['items']], ['route', 'screen', 'spotlight'])
        self.assertIsNone(self.store.load(self.clip, 'test', False, 'workspace')['document'])

    def test_invalid_manual_coordinates_cannot_replace_a_previously_saved_document(self):
        self.store.save(self.document, self.clip, 'test', True, 'workspace', 0)
        malformed = copy.deepcopy(self.document); malformed['annotations']['items'][0]['points'][0]['x'] = -1
        with self.assertRaisesRegex(ValueError, '画布标注'):
            self.store.save(malformed, self.clip, 'test', True, 'workspace', 1)
        restored = self.store.load(self.clip, 'test', True, 'workspace')
        self.assertEqual(restored['version'], 1); self.assertEqual(restored['document'], self.document)


if __name__ == '__main__': unittest.main()
