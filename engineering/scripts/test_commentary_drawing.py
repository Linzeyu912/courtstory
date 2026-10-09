import json
from pathlib import Path
import tempfile
import unittest

from commentary_drawing import DrawingEvidence, drawing_config, map_candidate
from commentary_video import CommentaryVideo
from test_commentary_video import make_vfr_video


class DrawingEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        make_vfr_video(self.root / 'video.mkv')
        self.video = CommentaryVideo(self.root / 'video.mkv', self.root / 'images')
        self.node = dict(nodeId='n1', anchorAssetFrame=2, evidenceWindow=dict(startFrame=1,endFrame=4))
        self.evidence = DrawingEvidence(self.video, [self.node])

    def tearDown(self):
        self.temp.cleanup()

    def test_raw_frame_preserves_size_and_identity_transform(self):
        result = self.evidence.read_frames(dict(nodeId='n1',frames=[2]))
        asset = result['details']['assets'][0]
        self.assertEqual([asset['width'],asset['height']], [96,64])
        self.assertEqual(asset['transform'],dict(scaleX=1,scaleY=1,offsetX=0,offsetY=0))
        self.assertEqual(self.evidence.seen['n1'], {2})

    def test_window_and_unseen_coordinates_rejected(self):
        with self.assertRaises(ValueError): self.evidence.read_frames(dict(nodeId='n1',frames=[0,2]))
        with self.assertRaises(ValueError): self.evidence.read_frames(dict(nodeId='n1',frames=[True]))
        with self.assertRaises(ValueError): map_candidate({'phases':[{'annotations':[{'assetId':'unseen'}]}]},self.evidence,'n1')

    def test_missing_entity_crop_does_not_register_requested_frames(self):
        self.video._observations={'rawByPlayer':{'P1':[None,{'box':[10,12,30,40]},None]}}
        result=self.evidence.inspect_region(dict(nodeId='n1',frames=[1,2],entityId='P1'))
        self.assertEqual([r['frame'] for r in result['details']['returnedFrames']], [1])
        self.assertEqual(result['details']['unavailableFrames'],[2])
        self.assertEqual(self.evidence.seen['n1'], {1})

    def test_crop_coordinates_map_back_and_border_is_rejected(self):
        result=self.evidence.inspect_region(dict(nodeId='n1',frames=[2],box=[10,12,30,40]))
        asset=result['details']['assets'][0]
        candidate={'phases':[{'annotations':[{'assetId':asset['assetId'],'anchorFrame':2,'points':[dict(x=3,y=4)]}]}]}
        mapped=map_candidate(candidate,self.evidence,'n1')
        self.assertEqual(mapped['phases'][0]['annotations'][0]['points'],[dict(x=13,y=16)])
        candidate['phases'][0]['annotations'][0]['points'][0]['x']=500
        with self.assertRaises(ValueError): map_candidate(candidate,self.evidence,'n1')

    def test_model_snapshot_and_explicit_override(self):
        plan={'producerConfigSnapshot':dict(provider='openrouter',model='openai/a',reasoning='medium')}
        config,mode=drawing_config(plan,None)
        self.assertEqual((config['model'],mode),('openai/a','inherited'))
        config,mode=drawing_config(plan,'openai/b')
        self.assertEqual((config['model'],mode),('openai/b','override'))
        self.assertIsNone(config.get('modelCapabilities'))
        with self.assertRaises(ValueError): drawing_config({},None)
        with self.assertRaises(ValueError): drawing_config(plan,{'model':'x','apiKey':'secret'})


if __name__=='__main__': unittest.main()
