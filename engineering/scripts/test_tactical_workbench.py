import copy
import hashlib
import json
from itertools import combinations
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import threading
import unittest
from unittest.mock import patch
import av
import numpy as np
from local_video_library import file_hash
from tactical_workbench import TacticalWorkbench, ROOT
import tactical_workbench as workbench


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

    def test_frame_deadline_and_cancel_stop_before_hash_or_decode(self):
        with patch('tactical_workbench.Path.open') as opened:
            with self.assertRaisesRegex(ValueError,'预算'):
                self.store.frames(self.video,self.clip,[0],execution_deadline=time.monotonic()-1)
            opened.assert_not_called()
        cancel=threading.Event();cancel.set()
        with self.assertRaisesRegex(ValueError,'取消'):
            self.store.frames(self.video,self.clip,[0],cancel=cancel)

    def test_frame_deadline_is_checked_during_decode_before_jpeg(self):
        original_open=av.open;clock=[0.0];decoded=[]
        class Container:
            def __enter__(inner):
                inner.real=original_open(str(self.video));inner.streams=inner.real.streams;return inner
            def __exit__(inner,*args):inner.real.close()
            def decode(inner,**kwargs):
                for index,frame in enumerate(inner.real.decode(**kwargs)):
                    decoded.append(index)
                    if index==2:clock[0]=2.0
                    yield frame
        with patch('av.open',return_value=Container()),patch('tactical_workbench.time.monotonic',side_effect=lambda:clock[0]):
            with self.assertRaisesRegex(ValueError,'预算'):
                self.store.frames(self.video,self.clip,[4],execution_deadline=1.0)
        self.assertEqual(decoded,[0,1,2])

    def test_frame_deadline_is_checked_after_hash_chunk_and_jpeg(self):
        original_open=Path.open;clock=[0.0]
        class Reader:
            def __enter__(inner):inner.stream=original_open(self.video,'rb');return inner
            def __exit__(inner,*args):inner.stream.close()
            def read(inner,size):
                data=inner.stream.read(size);clock[0]=2.0;return data
        with patch('tactical_workbench.Path.open',return_value=Reader()),patch('av.open') as decoder,patch('tactical_workbench.time.monotonic',side_effect=lambda:clock[0]):
            with self.assertRaisesRegex(ValueError,'预算'):self.store.frames(self.video,self.clip,[0],execution_deadline=1.0)
            decoder.assert_not_called()
        from PIL import Image
        save=Image.Image.save;clock[0]=0
        def encode(image,*args,**kwargs):
            result=save(image,*args,**kwargs);clock[0]=2.0;return result
        with patch.object(Image.Image,'save',encode),patch('tactical_workbench.time.monotonic',side_effect=lambda:clock[0]):
            with self.assertRaisesRegex(ValueError,'预算'):self.store.frames(self.video,self.clip,[0],execution_deadline=1.0)

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


class CandidateBasketballCompatibilityTests(unittest.TestCase):
    """Only complete server-registered historical snapshots retain candidate trust."""
    derived_fields = ('basketballTrajectory', 'basketballTrajectoryMethod', 'basketballTrajectoryReviewed')

    def setUp(self):
        self.node = shutil.which('node')
        if not self.node: self.skipTest('Node.js is required by the tactical workbench')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name) / 'candidate'
        script = """
import {makePresentationDemo} from './engineering/tools/tactical-overlay/fixtures/presentation-demo.mjs';
import {createAnnotation} from './engineering/tools/player-review/tactics-annotations.mjs';
import {exportSceneObjects} from './engineering/tools/player-review/scene-objects.mjs';
import {createSourceBinding} from './engineering/tools/tactical-overlay/binding.mjs';
const fixture=await makePresentationDemo(),frames=fixture.review.sourceFrameMapping.map(({frame,time})=>({frame,time,objects:[]}));
const session={sceneObjectEdits:[{id:'ball-observation',kind:'basketball',frame:12,point:[710,360]}]};
fixture.review.sceneObjects=JSON.parse(JSON.stringify(exportSceneObjects(session,frames,[],{width:1280,height:720})));
const result={};
for(const version of ['current','legacy']){
  let doc={schemaVersion:1,title:'candidate compatibility',notes:'keep manual notes',...structuredClone(fixture),presentation:{schemaVersion:1,routes:[]}};
  if(version==='legacy')for(const key of ['basketballTrajectory','basketballTrajectoryMethod','basketballTrajectoryReviewed'])delete doc.review.sceneObjects[key];
  doc.playDefinition.sourceBinding=await createSourceBinding(doc.review);
  for(const type of ['route','screen','spotlight'])doc=createAnnotation(doc,{id:type,type,phaseId:'setup',entityId:'P1',frame:12,
    space:'court',points:type==='route'?[{x:18,y:10},{x:22,y:9}]:[{x:18,y:10}]});
  result[version]=doc;
}
process.stdout.write(JSON.stringify(result));
"""
        result = subprocess.run([self.node, '--input-type=module', '-e', script], cwd=ROOT,
            text=True, encoding='utf-8', capture_output=True, check=True,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        fixtures = json.loads(result.stdout)
        self.current, self.legacy = fixtures['current'], fixtures['legacy']
        # A self-contained fixture stands in for a fixed, independently verified
        # historical snapshot; production never learns hashes from a request/file.
        digest = hashlib.sha256(json.dumps(self.legacy['review'], sort_keys=True,
            separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()
        trusted = patch.object(workbench, 'LEGACY_CANDIDATE_REVIEW_SHA256', frozenset({digest}), create=True)
        trusted.start(); self.addCleanup(trusted.stop)
        review = self.current['review']
        self.clip = {'video_sha256': review['videoSha256'], 'tracking_fingerprint': review['trackingFingerprint'],
            'source_video_sha256': review['sourceVideoSha256'],
            'tracking_revision': review['trackingRevision'], 'width': review['width'], 'height': review['height'],
            'frames': [{'frame': p['frame'], 'time': p['time'], 'source_frame': p['sourceFrame'],
                       'source_time': p['sourceTime']} for p in review['sourceFrameMapping']]}
        self.store = TacticalWorkbench(self.folder, node=self.node)
        self.store.candidate_cache = copy.deepcopy(self.current)

    def test_legacy_candidate_saves_and_restarts_without_rebinding_or_rewriting_any_document_fields(self):
        before, canonical = copy.deepcopy(self.legacy), copy.deepcopy(self.current)
        saved = self.store.save(self.legacy, self.clip, 'test', True, 'candidate', 0)
        self.assertEqual(saved['version'], 1)
        self.assertEqual(saved['document'], before)
        self.assertEqual(self.legacy, before)
        self.assertEqual(self.store.candidate_cache, canonical)
        restarted = TacticalWorkbench(self.folder, node=self.node)
        restarted.candidate_cache = copy.deepcopy(self.current)
        loaded = restarted.load(self.clip, 'test', True, 'candidate')
        self.assertEqual(loaded['document'], before)
        saved_again = restarted.save(loaded['document'], self.clip, 'test', True, 'candidate', 1)
        self.assertEqual(saved_again['version'], 2)
        self.assertEqual(saved_again['document'], before)
        self.assertNotEqual(before['playDefinition']['sourceBinding'], canonical['playDefinition']['sourceBinding'])
        self.assertEqual(saved_again['document']['annotations'], before['annotations'])
        self.assertEqual(saved_again['document']['presentation'], before['presentation'])

    def test_current_candidate_retains_all_derived_basketball_fields(self):
        saved = self.store.save(self.current, self.clip, 'test', True, 'candidate', 0)
        self.assertEqual(saved['document'], self.current)
        for key in self.derived_fields: self.assertIn(key, saved['document']['review']['sceneObjects'])

    def test_unregistered_old_shape_and_json_scalar_type_changes_are_rejected(self):
        with patch.object(workbench, 'LEGACY_CANDIDATE_REVIEW_SHA256', frozenset(), create=True):
            with self.assertRaisesRegex(ValueError, '来源快照不可改写'):
                self.store.check_source(self.legacy, self.clip, 'candidate')
        changed = copy.deepcopy(self.current)
        changed['review']['sceneObjects']['continuousTracking'] = 0  # Python equality alone treats this as False.
        with self.assertRaisesRegex(ValueError, '来源快照不可改写'):
            self.store.check_source(changed, self.clip, 'candidate')

    def test_historical_full_hash_does_not_bypass_video_dimensions_or_mapping_checks(self):
        for key, value in [('video_sha256', 'foreign'), ('source_video_sha256', 'foreign'), ('width', 1290), ('height', 721)]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, '视频或逐帧时间映射'):
                self.store.check_source(self.legacy, {**self.clip, key: value}, 'candidate')
        clip = copy.deepcopy(self.clip); clip['frames'][12]['time'] += .01
        with self.assertRaisesRegex(ValueError, '视频或逐帧时间映射'):
            self.store.check_source(self.legacy, clip, 'candidate')

    def test_uncropped_candidate_accepts_null_or_missing_source_video_hash_fallback(self):
        document = copy.deepcopy(self.current)
        document['review']['sourceVideoSha256'] = document['review']['videoSha256']
        self.store.candidate_cache = copy.deepcopy(document)
        clip = {**self.clip, 'source_video_sha256': None}
        self.store.check_source(document, clip, 'candidate')
        del clip['source_video_sha256']
        self.store.check_source(document, clip, 'candidate')
        clip['source_video_sha256'] = 'foreign-nonempty-source'
        with self.assertRaisesRegex(ValueError, '视频或逐帧时间映射'):
            self.store.check_source(document, clip, 'candidate')

    def test_partial_derived_fields_and_changed_source_remain_rejected(self):
        mutations = []
        for missing in [subset for count in (1, 2) for subset in combinations(self.derived_fields, count)]:
            changed = copy.deepcopy(self.current)
            for key in missing: del changed['review']['sceneObjects'][key]
            mutations.append(('partial ' + ','.join(missing), changed))
        for key, value in [('basketballTrajectory', []), ('basketballTrajectoryMethod', 'other'), ('basketballTrajectoryReviewed', True)]:
            changed = copy.deepcopy(self.current); changed['review']['sceneObjects'][key] = value
            mutations.append(('derived ' + key, changed))
        for baseline in [self.current, self.legacy]:
            changed = copy.deepcopy(baseline); changed['review']['sceneObjects']['manualEdits'][0]['point'][0] += 1
            mutations.append(('changed manual object', changed))
            changed = copy.deepcopy(baseline); changed['review']['sceneObjects']['frames'][12]['objects'][0]['point'][0] += 1
            mutations.append(('changed exported object', changed))
            changed = copy.deepcopy(baseline); changed['review']['videoSha256'] = 'different-video'
            mutations.append(('changed video', changed))
            changed = copy.deepcopy(baseline); changed['review']['entities'][0]['identityConfirmed'] = False
            mutations.append(('changed source review', changed))
        with patch.object(self.store, 'run') as validate:
            for label, changed in mutations:
                with self.subTest(label=label), self.assertRaisesRegex(ValueError, '来源快照不可改写'):
                    self.store.save(changed, self.clip, 'test', True, 'candidate', 0)
            validate.assert_not_called()
        self.assertIsNone(self.store.load(self.clip, 'test', True, 'candidate')['document'])


if __name__ == '__main__': unittest.main()
