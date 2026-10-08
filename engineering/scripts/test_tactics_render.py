"""Job boundaries use real document validation; rendering is exercised separately."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

from tactical_workbench import TacticalWorkbench, ROOT
from tactics_render import TacticsRenderer, draw_name_overlay, name_overlay_index
from basketball_presentation import name_overlay_text, layout_name_labels


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.tactics = TacticalWorkbench(self.folder / 'saved')
        script = "import {makePresentationDemo} from './engineering/tools/tactical-overlay/fixtures/presentation-demo.mjs';import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';console.log(JSON.stringify(await createTacticsDocument((await makePresentationDemo()).review)));"
        self.doc = json.loads(subprocess.check_output([self.tactics.node, '--input-type=module', '-e', script], cwd=ROOT))
        r = self.doc['review']
        self.clip = dict(video_sha256=r['videoSha256'], tracking_fingerprint=r['trackingFingerprint'],
                         tracking_revision=r['trackingRevision'], width=r['width'], height=r['height'],
                         frames=[dict(frame=f['frame'], time=f['time'], source_frame=f['sourceFrame'], source_time=f['sourceTime']) for f in r['sourceFrameMapping']])
        self.request = dict(sample='test', document=self.doc, expectedVersion=0, options={'fps': 30},
                            documentDigest=self.tactics.run('agent-digest', document=self.doc)['digest'])

    def renderer(self, execute=None):
        result = TacticsRenderer(self.folder / 'renders', self.tactics, execute=execute)
        self.addCleanup(result.close)
        return result

    def test_stale_digest_version_and_source_rejected_before_queue(self):
        r = self.renderer()
        for changed in ({'documentDigest': 'bad'}, {'expectedVersion': 1}, {'options': {'fps': 300}}):
            with self.assertRaises(ValueError):
                r.create({**self.request, **changed}, self.clip, self.folder/'source.mp4', 'test', True)
        wrong = deepcopy(self.doc); wrong['review']['width'] += 1
        with self.assertRaises(ValueError):
            r.create({**self.request, 'document': wrong}, self.clip, self.folder/'source.mp4', 'test', True)
        self.assertEqual(r.jobs, {})

    def test_cancelled_snapshot_never_publishes_or_saves(self):
        def execute(job, _directory):
            job['cancel'].wait(5)
            raise ValueError('cancelled')
        r = self.renderer(execute)
        job = r.create(self.request, self.clip, self.folder/'source.mp4', 'test', True)
        self.doc['title'] = 'later unsaved edit'
        self.assertNotEqual(r.jobs[job['id']]['document']['title'], self.doc['title'])
        cancelled = r.cancel(job['id'], self.clip, 'test', True)
        self.assertEqual(cancelled['status'], 'cancelled')
        with self.assertRaises(ValueError):
            r.video(job['id'], self.clip, 'test', True)
        self.assertEqual(self.tactics.load(self.clip, 'test', True, 'workspace')['version'], 0)

    def test_context_and_traversal_do_not_expose_jobs(self):
        r = self.renderer(lambda job, directory: job['cancel'].wait(5))
        job = r.create(self.request, self.clip, self.folder/'source.mp4', 'test', True)
        for ident, qa, kind in ((job['id'], False, 'workspace'), (job['id'], True, 'candidate'), ('../../outside', True, 'workspace')):
            with self.assertRaises(ValueError):
                r.get(ident, self.clip, 'test', qa, kind)
        r.cancel(job['id'], self.clip, 'test', True)

    def test_name_overlay_source_binding_is_required_and_public_job_hides_snapshot_rows(self):
        overlay={'nameDisplay':{'enabled':False,'groups':{'A':True,'B':True},'players':{'P1':True},
                    'showName':True,'showJersey':True,'showAnkleRing':True},
            'nameIdentitySource':{'videoSha256':self.clip['video_sha256'],'trackingFingerprint':self.clip['tracking_fingerprint'],
                'trackingRevision':self.clip['tracking_revision'],'width':self.clip['width'],'height':self.clip['height']},
            'playerNameIdentities':[{'id':'P1','observations':[]}]}
        TacticsRenderer._validate_name_overlay(overlay,self.clip)
        wrong=deepcopy(overlay);wrong['nameIdentitySource']['trackingRevision']='another-version'
        with self.assertRaisesRegex(ValueError,'跟踪版本'):
            TacticsRenderer._validate_name_overlay(wrong,self.clip)
        public=TacticsRenderer._public({'id':'x','status':'queued','options':{'fps':30,'nameOverlay':overlay},'videoUrl':'/hidden'})
        self.assertEqual(public['options']['nameOverlay'],{'enabled':False,'videoSha256':self.clip['video_sha256'],'trackingRevision':self.clip['tracking_revision']})
        self.assertNotIn('playerNameIdentities',json.dumps(public,ensure_ascii=False))

    def test_production_overlay_uses_the_same_saved_filters_and_frame_bound_identity(self):
        import cv2
        import numpy as np
        from unittest.mock import patch
        overlay={'nameDisplay':{'enabled':True,'groups':{'A':True,'B':False},'players':{'P1':True,'P7':True},
                    'showName':True,'showJersey':True,'showAnkleRing':False},
            'playerNameIdentities':[{'id':'P1','observations':[
                {'frame':4,'trackId':9,'x':100,'y':200,'nameIdentity':{'name':'Confirmed','jersey':'23','identityVerified':True}},
                {'frame':5,'trackId':9,'x':None,'y':None,'nameIdentity':None}]},
                {'id':'P7','observations':[{'frame':4,'trackId':3,'x':500,'y':200,'nameIdentity':{'name':'Other','identityVerified':True}}]}]}
        image=np.zeros((720,1280,3),dtype=np.uint8);calls=[]
        with patch.object(cv2,'putText',side_effect=lambda img,text,*args:(calls.append(text),img)[1]):
            draw_name_overlay(image,4,overlay,name_overlay_index(overlay))
            self.assertIn('Confirmed / #23',calls)
            self.assertNotIn('Other',calls)
            calls.clear();draw_name_overlay(image,5,overlay,name_overlay_index(overlay))
            self.assertNotIn('Confirmed / #23',calls,'a missing source position must not reuse the previous frame')

    def test_production_overlay_honors_saved_name_visibility(self):
        import cv2
        import numpy as np
        from unittest.mock import patch
        overlay={'nameDisplay':{'enabled':True,'groups':{'A':True,'B':True},'players':{'P1':True},
                    'showName':False,'showJersey':True,'showAnkleRing':False},
            'playerNameIdentities':[{'id':'P1','observations':[{'frame':4,'trackId':9,'x':100,'y':200,
                'nameIdentity':{'name':'Confirmed','jersey':'23','identityVerified':True}}]}]}
        calls=[]
        with patch.object(cv2,'putText',side_effect=lambda img,text,*args:(calls.append(text),img)[1]):
            draw_name_overlay(np.zeros((720,1280,3),dtype=np.uint8),4,overlay,name_overlay_index(overlay))
        self.assertIn('#23',calls)
        self.assertNotIn('Confirmed',calls)

    def test_production_overlay_honors_saved_jersey_visibility(self):
        import cv2
        import numpy as np
        from unittest.mock import patch
        overlay={'nameDisplay':{'enabled':True,'groups':{'A':True,'B':True},'players':{'P1':True},
                    'showName':True,'showJersey':False,'showAnkleRing':False},
            'playerNameIdentities':[{'id':'P1','observations':[{'frame':4,'trackId':9,'x':100,'y':200,
                'nameIdentity':{'name':'Confirmed','jersey':'23','identityVerified':True}}]}]}
        calls=[]
        with patch.object(cv2,'putText',side_effect=lambda img,text,*args:(calls.append(text),img)[1]):
            draw_name_overlay(np.zeros((720,1280,3),dtype=np.uint8),4,overlay,name_overlay_index(overlay))
        self.assertIn('Confirmed',calls)
        self.assertNotIn('#23',calls)

    def test_video_text_uses_a_separator_supported_by_opencv_hershey_fonts(self):
        self.assertEqual(name_overlay_text({'name':'Cooper Flagg','jersey':'32','identityVerified':False},'P9'),
                         'Cooper Flagg? / #32')

    def test_accepted_name_has_player_id_and_feet_layout_does_not_clip(self):
        self.assertEqual(name_overlay_text({'name':'Daniel Gafford','jersey':'21',
            'nameStatus':'machine_accepted','identityVerified':False},'P7'),'P7 Daniel Gafford / #21')
        items=[{'x':5,'y':180,'width':170,'height':20},{'x':40,'y':180,'width':180,'height':20},
               {'x':635,'y':470,'width':170,'height':20}]
        placed=layout_name_labels(items,640,480,1)
        for item in placed:
            self.assertGreaterEqual(item['rect']['left'],0);self.assertLessEqual(item['rect']['right'],640)
            self.assertGreaterEqual(item['rect']['top'],0);self.assertLessEqual(item['rect']['bottom'],480)
        self.assertGreater(placed[0]['rect']['top'],180)
        self.assertLessEqual(placed[0]['rect']['bottom'],placed[1]['rect']['top'])


if __name__ == '__main__':
    unittest.main()
