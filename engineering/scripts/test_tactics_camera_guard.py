"""Independent camera contradictions are negative evidence, never coordinate authority."""
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from tactics_camera_guard import CameraGuard, compare_stage, constrain_audit, retain_camera_contradictions


class CameraGuardTests(unittest.TestCase):
    def setUp(self):
        self.fixture=json.loads((Path(__file__).parent/'test_fixtures/tactics-run6-camera-geometry.json').read_text(encoding='utf-8'))

    def test_real_run6_large_white7_contradiction_only_and_no_metric_permission(self):
        original=deepcopy(self.fixture)
        reports=[compare_stage(s['pack'],s['facts'],self.fixture['seeds']) for s in self.fixture['stages']]
        conflicts=[r for report in reports for r in report['routes'] if r['status']=='camera_contradiction']
        self.assertEqual([r['personId'] for r in conflicts],['white7'])
        self.assertAlmostEqual(conflicts[0]['differencePixels'],372.9383,places=2)
        self.assertAlmostEqual(conflicts[0]['approximateEndpoint'][0],850.8944,places=2)
        self.assertFalse(reports[0]['metricAccuracyValidated'])
        good=next(r for r in reports[0]['routes'] if r['personId']=='black00')
        self.assertEqual(good['status'],'no_large_contradiction');self.assertLess(good['differencePixels'],30)
        weak=next(r for r in reports[1]['routes'] if r['personId']=='hou7')
        self.assertEqual(weak['status'],'geometry_unavailable')
        self.assertEqual(self.fixture,original)

    def test_cut_opposite_side_and_seed_hash_mismatch_never_issue_a_conflict(self):
        stage=self.fixture['stages'][0]
        for kind in ('cut','side','hash'):
            pack=deepcopy(stage['pack']);seeds=deepcopy(self.fixture['seeds'])
            if kind=='cut':pack['sampling']['cutFrames']=[342]
            if kind=='side':seeds['513']['proposal']['side']='left'
            if kind=='hash':seeds['513']['sourceImageSha256']='0'*64
            row=next(r for r in compare_stage(pack,stage['facts'],seeds)['routes'] if r['personId']=='white7')
            self.assertEqual(row['status'],'geometry_unavailable',kind)

    def test_known_negative_needs_fresh_geometry_after_changed_points_never_transfers_to_new_source(self):
        stages=deepcopy(self.fixture['stages'][:1]);stage=stages[0]
        first={stage['stageId']:compare_stage(stage['pack'],stage['facts'],self.fixture['seeds'])}
        bound=retain_camera_contradictions(stages,first,{})
        previous={stage['stageId']:{'cameraGeometry':bound[stage['stageId']]}}
        original=deepcopy(previous)
        stage['facts']['routes'][1]['points'][-1]=[850,510]
        unavailable={stage['stageId']:{'status':'geometry_unavailable','reason':'local_model_unavailable','routes':[]}}
        retained=retain_camera_contradictions(stages,unavailable,previous)
        row=next(r for r in retained[stage['stageId']]['routes'] if r['personId']=='white7')
        self.assertEqual(row['status'],'camera_contradiction');self.assertTrue(row['geometryInputChanged'])
        again=retain_camera_contradictions(stages,unavailable,{stage['stageId']:{'cameraGeometry':retained[stage['stageId']]}})
        self.assertEqual(again,retained,'durable retry must have a stable negative-evidence signature')
        fresh={stage['stageId']:compare_stage(stage['pack'],stage['facts'],self.fixture['seeds'])}
        resolved=retain_camera_contradictions(stages,fresh,previous)
        self.assertEqual(resolved[stage['stageId']]['routes'][1]['status'],'no_large_contradiction')
        self.assertFalse(resolved[stage['stageId']]['metricAccuracyValidated'])
        stage['pack']['binding']['videoSha256']='f'*64
        different=retain_camera_contradictions(stages,unavailable,previous)
        self.assertEqual(different[stage['stageId']]['routes'],[])
        self.assertEqual(previous,original)

    def test_constraint_cannot_mint_permission_or_change_raw_facts_or_model_audit(self):
        from test_tactics_audit_integration import approved
        from tactics_visual_audit import apply_visual_audit_batch
        stages=deepcopy(self.fixture['stages']);before=deepcopy(stages)
        for stage in stages:stage['cameraGeometry']=compare_stage(stage['pack'],stage['facts'],self.fixture['seeds'])
        audit=approved(stages);raw=deepcopy(audit)
        effective=constrain_audit(stages,audit)
        row=effective['stages'][0]['audit']['routes'][1]
        self.assertEqual(row['verdict'],'uncertain');self.assertEqual(row['geometry'],'misaligned')
        self.assertEqual(audit,raw)
        self.assertEqual([s['facts'] for s in stages],[s['facts'] for s in before])
        verified=apply_visual_audit_batch(stages,effective)
        self.assertNotIn('white7',[r['personId'] for r in verified['stage-1']['facts']['routes']])
        self.assertIn('black00',[r['personId'] for r in verified['stage-1']['facts']['routes']])
        self.assertFalse(verified['stage-1']['report']['allApproved'])
        rejected=deepcopy(audit)
        rejected['stages'][0]['audit']['routes'][1].update(verdict='reject',identity='different',reason='原图显示不是同一名球员')
        self.assertEqual(constrain_audit(stages,rejected),rejected,'camera warning must not erase the original identity rejection')

    def test_unavailable_model_source_mismatch_cancel_never_start_worker(self):
        with tempfile.TemporaryDirectory() as folder:
            guard=CameraGuard(model_path=Path(folder)/'absent.pt')
            clip={'video_sha256':self.fixture['provenance']['videoSha256'],'width':1920,'height':1080,
                  'supportsCourtCalibration':True,'frames':[]}
            with patch.object(guard,'_infer',side_effect=AssertionError('must not spawn')):
                stages=deepcopy(self.fixture['stages'])
                rows=guard.review(stages,clip,Path(folder),time.monotonic()+10,threading.Event())
                self.assertTrue(all(r['status']=='geometry_unavailable' for r in rows.values()))
                stages[0]['pack']['binding']['videoSha256']='0'*64
                rows=guard.review(stages,clip,Path(folder),time.monotonic()+10,threading.Event())
                self.assertEqual(rows['stage-1']['reason'],'source_mismatch')
                cancel=threading.Event();cancel.set()
                rows=guard.review(self.fixture['stages'],clip,Path(folder),time.monotonic()+10,cancel)
                self.assertEqual(rows['stage-1']['reason'],'cancelled')

    def test_cache_rechecks_image_sha_dimensions_cuts_and_does_not_repeat_local_inference(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);model=folder/'model.pt';model.write_bytes(b'test-only-local-weight')
            stages=deepcopy(self.fixture['stages'][:1]);stage=stages[0]
            (folder/stage['stageId']).mkdir()
            stream=io.BytesIO();Image.new('RGB',(1920,1080)).save(stream,'JPEG');raw=stream.getvalue();sha=hashlib.sha256(raw).hexdigest()
            for meta in stage['pack']['images']:
                meta['sourceImageSha256']=sha
                (folder/stage['stageId']/f"source-frame-{meta['frame']:06d}.jpg").write_bytes(raw)
            clip={'video_sha256':stage['pack']['binding']['videoSha256'],'width':1920,'height':1080,
                  'supportsCourtCalibration':True,'frames':[{} for _ in range(685)]}
            guard=CameraGuard(model_path=model,python_path=Path(__file__))
            def infer(requests,*args):
                seeds={}
                for key,item in requests.items():
                    seed=deepcopy(self.fixture['seeds'][str(item['frame'])]);seed['sourceImageSha256']=sha;seeds[key]=seed
                return seeds
            with patch('tactics_camera_guard.COURT_MODEL_SHA256',hashlib.sha256(model.read_bytes()).hexdigest()),patch.object(guard,'_infer',side_effect=infer) as worker:
                before=deepcopy(stages)
                first=guard.review(stages,clip,folder,time.monotonic()+10,threading.Event())
                second=guard.review(stages,clip,folder,time.monotonic()+10,threading.Event())
                self.assertEqual(first,second);self.assertEqual(worker.call_count,1);self.assertEqual(stages,before)
                model.unlink()
                cached=guard.review(stages,clip,folder,time.monotonic()+10,threading.Event())
                self.assertEqual(cached,first,'source-bound seeds remain usable when the local model is unavailable')
                model.write_bytes(b'test-only-local-weight')
                stage['pack']['sampling']['cutFrames']=[342]
                guarded=guard.review(stages,clip,folder,time.monotonic()+10,threading.Event())
                self.assertEqual(worker.call_count,2)
                white=next(r for r in guarded['stage-1']['routes'] if r['personId']=='white7')
                self.assertEqual(white['reason'],'source_cut')
                (folder/'stage-1/source-frame-000171.jpg').write_bytes(b'changed')
                invalid=guard.review(stages,clip,folder,time.monotonic()+10,threading.Event())
                self.assertEqual(invalid['stage-1']['reason'],'source_image_hash_mismatch');self.assertEqual(worker.call_count,2)
                wrong=io.BytesIO();Image.new('RGB',(20,20)).save(wrong,'JPEG');raw=wrong.getvalue()
                (folder/'stage-1/source-frame-000171.jpg').write_bytes(raw)
                next(m for m in stage['pack']['images'] if m['frame']==171)['sourceImageSha256']=hashlib.sha256(raw).hexdigest()
                invalid=guard.review(stages,clip,folder,time.monotonic()+10,threading.Event())
                self.assertEqual(invalid['stage-1']['reason'],'source_image_dimensions');self.assertEqual(worker.call_count,2)

    def test_worker_is_local_offline_bounded_and_reaped_without_permission_prompt(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);process=MagicMock();process.poll.return_value=None
            with patch('tactics_camera_guard.subprocess.Popen',return_value=process) as launch:
                with self.assertRaises(TimeoutError):
                    CameraGuard()._infer({},folder,time.monotonic()+.03,threading.Event())
                process.kill.assert_called_once();process.wait.assert_called_once()
                arguments,options=launch.call_args
                self.assertIsInstance(arguments[0],list)
                self.assertNotIn('shell',options)
                self.assertEqual(options['env']['YOLO_AUTOINSTALL'],'false')
                self.assertEqual(options['env']['YOLO_OFFLINE'],'true')


if __name__=='__main__':unittest.main()
