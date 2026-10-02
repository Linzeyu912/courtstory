"""Camera motion propagation must respect real cuts and reject invalid seeds."""
import tempfile
import unittest
from pathlib import Path

import av
import cv2
import numpy as np

from court_propagation import LANDMARKS, fit_seed, project, propagate_court


class CameraTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.video=Path(self.temp.name)/'motion.mp4'
        rng=np.random.default_rng(14)
        texture=rng.integers(0,256,(240,400),dtype=np.uint8)
        texture=cv2.GaussianBlur(texture,(3,3),0)
        for x in range(20,380,25):cv2.circle(texture,(x,80+(x%3)*30),6,255,2)
        with av.open(str(self.video),'w') as out:
            stream=out.add_stream('libx264',rate=10);stream.width=400;stream.height=240;stream.pix_fmt='yuv420p'
            for i in range(5):
                shifted=cv2.warpAffine(texture,np.float32([[1,0,i*2],[0,1,i]]),(400,240))
                # A broadcast graphic remains fixed while the visible court moves.
                shifted[185:232,30:370]=texture[185:232,30:370]
                cv2.putText(shifted,'ESPN 45 - 46',(40,216),cv2.FONT_HERSHEY_SIMPLEX,.7,255,2)
                frame=av.VideoFrame.from_ndarray(shifted,format='gray')
                for packet in stream.encode(frame):out.mux(packet)
            for packet in stream.encode():out.mux(packet)
        with av.open(str(self.video)) as inp:times=[float(f.time) for f in inp.decode(video=0)]
        self.payload={'width':400,'height':240,'video_sha256':'test','sourceCuts':[3],
                      'frames':[{'frame':i,'time':t,'tracks':[]} for i,t in enumerate(times)]}
        h=np.asarray([[11.,1.,15.],[.2,11.,10.],[0.,0.,1.]])
        self.seed={'frame':0,'side':'left','source':'human','points':[
            {'id':ident,'image':project(h,[LANDMARKS[ident]])[0].tolist(),'source':'human'} for ident in 'ABCDE']}

    def test_known_motion_stops_at_source_cut(self):
        result=propagate_court(self.video,self.payload,self.seed)
        self.assertEqual([k['frame'] for k in result['keyframes']],[0,1,2])
        self.assertEqual(result['summary']['validFrames'],3)
        before=np.array([p['image'] for p in self.seed['points']])
        after=np.array([p['image'] for p in result['keyframes'][-1]['points']])
        np.testing.assert_allclose(after,before+[4.,2.],atol=1.)
        self.assertTrue(result['reviewRequired']);self.assertFalse(result['metricAccuracyValidated'])

    def test_check_points_do_not_make_insufficient_seed_valid(self):
        self.seed['points'][2]['role']='check';self.seed['points'][3]['role']='check'
        with self.assertRaises(ValueError):fit_seed(self.seed,5,400,240)

    def test_invalid_and_duplicate_controls_rejected(self):
        self.seed['points'][0]['id']='hoop'
        with self.assertRaises(ValueError):fit_seed(self.seed,5,400,240)
        self.seed['points'][0]['id']='B'
        with self.assertRaises(ValueError):fit_seed(self.seed,5,400,240)

    def test_malformed_control_is_a_validation_error(self):
        self.seed['points']=['A']
        with self.assertRaises(ValueError):fit_seed(self.seed,5,400,240)

    def test_blank_frame_is_invalid_not_reused_pose(self):
        from court_propagation import flow_transform
        blank=np.zeros((240,400),np.uint8)
        h,quality=flow_transform(blank,blank,np.full_like(blank,255),1.)
        self.assertIsNone(h);self.assertIn('reason',quality)

    def test_propagated_seed_cannot_silently_cross_a_new_cut(self):
        self.seed.update(frame=2,source='camera_propagation',quality={'referenceFrame':0})
        with self.assertRaises(ValueError):propagate_court(self.video,self.payload,self.seed,cuts=[1])
        # Explicit review of the current frame can create a new local support.
        self.seed['quality']['cameraSupportFrame']=2
        result=propagate_court(self.video,self.payload,self.seed,cuts=[1])
        self.assertEqual(result['referenceFrame'],2)
        row=next(k for k in result['keyframes'] if k['frame']==2)
        self.assertEqual(row['quality']['referenceFrame'],2)


if __name__=='__main__':unittest.main()
