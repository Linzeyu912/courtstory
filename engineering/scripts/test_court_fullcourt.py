"""Known-geometry tests, independent of the real video's predicted points."""
import unittest
import tempfile
from pathlib import Path

import cv2
import numpy as np
import av

from court_fullcourt import (LENGTH, WIDTH, CENTER_RADIUS, project, normalize,
    joint_fit, initialize_graph, align_world, valid_geometry, center_evidence)


class JointCourtTests(unittest.TestCase):
    def fixture(self):
        rng = np.random.default_rng(24)
        truth = {i: np.array([[48., -14., 250.-i*180], [1., 20., 210.], [.001, -.011, 1.]]) for i in range(4)}
        world = rng.uniform([0, 0], [LENGTH, WIDTH], (55, 2))
        edges = []
        for i, j in [(0, 1), (1, 2), (2, 3), (0, 3)]:
            edges.append({'frames': [i, j], 'a': project(truth[i], world), 'b': project(truth[j], world),
                          'h': normalize(truth[j]@np.linalg.inv(truth[i]))})
        absolute = []
        for i, x in [(0, 0), (3, LENGTH-5.7912)]:
            for xy in [[x, 0], [x, 5.1816], [x+5.7912, 5.1816], [x+5.7912, 10.0584], [x, 10.0584]]:
                absolute.append({'frame': i, 'world': xy, 'image': project(truth[i], [xy])[0]})
        return truth, edges, absolute

    def test_both_ends_share_held_out_midcourt(self):
        truth, edges, absolute = self.fixture()
        initial = initialize_graph(list(truth), edges, absolute)
        bad = np.array([[1.03, .01, .4], [.01, .98, -.2], [.001, .001, 1.]])
        initial = {i: normalize(h@bad) for i, h in initial.items()}
        result, _ = joint_fit(initial, edges, absolute, width=1552, max_nfev=30)
        # These center points were not included in the fitting observations.
        check = [[LENGTH/2, y] for y in (0, 3, WIDTH/2, WIDTH)]
        for i in truth:
            self.assertLess(np.max(np.linalg.norm(project(result[i], check)-project(truth[i], check), axis=1)), .02)

    def test_disconnected_cameras_are_not_bridged(self):
        truth, edges, absolute = self.fixture()
        with self.assertRaisesRegex(ValueError, 'Disconnected'):
            initialize_graph(list(truth), edges[:1], absolute)

    def test_metric_gauge_does_not_change_image_motion(self):
        truth, edges, absolute = self.fixture()
        bad = np.array([[1.08, 0, .5], [0, .96, .2], [0, 0, 1.]])
        cameras = {i: normalize(h@bad) for i, h in truth.items()}
        fixed = align_world(cameras, absolute)
        self.assertTrue(np.allclose(normalize(fixed[3]@np.linalg.inv(fixed[0])),
                                    normalize(cameras[3]@np.linalg.inv(cameras[0])), atol=1e-7))

    def test_cut_cannot_be_hidden_by_a_loop_match(self):
        truth, edges, absolute = self.fixture()
        with self.assertRaisesRegex(ValueError, 'camera cut'):
            initialize_graph(list(truth), edges, absolute, cuts=[2])

    def test_fold_and_mirror_are_invalid(self):
        self.assertFalse(valid_geometry(np.diag([-1., 1., 1.])))
        self.assertFalse(valid_geometry(np.array([[1., 0, 0], [0, 1, 0], [-.1, 0, 1.]])))

    def test_blank_image_has_no_center_evidence(self):
        truth, _, _ = self.fixture()
        line, evidence = center_evidence(np.full((872, 1552), 160, np.uint8), truth[0], [], 1.)
        self.assertIsNone(line)

    def test_visible_circle_constraint_preserves_known_geometry(self):
        truth, edges, absolute = self.fixture()
        theta = np.linspace(0, 2*np.pi, 24, endpoint=False)
        circle = np.column_stack([LENGTH/2+CENTER_RADIUS*np.cos(theta), WIDTH/2+CENTER_RADIUS*np.sin(theta)])
        observations = [{'frame': 1, 'pixels': project(truth[1], circle)}]
        result, _ = joint_fit(truth, edges, absolute, circles=observations, max_nfev=10)
        self.assertLess(np.max(np.linalg.norm(project(result[1], circle)-project(truth[1], circle), axis=1)), .01)

    def test_isolated_excursion_uses_real_floor_flow_and_keeps_gaps(self):
        from audit_fullcourt_motion import audit
        rng=np.random.default_rng(51)
        texture=cv2.GaussianBlur(rng.integers(35,225,(360,640),dtype=np.uint8),(3,3),0)
        h=cv2.getPerspectiveTransform(np.float32([[0,0],[LENGTH,0],[LENGTH,WIDTH],[0,WIDTH]]),
                                    np.float32([[30,145],[610,145],[660,350],[-20,350]]))
        rows=[];truth={}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'floor.mp4'
            with av.open(str(path),'w') as out:
                stream=out.add_stream('libx264',rate=30);stream.width=640;stream.height=360;stream.pix_fmt='yuv420p'
                for i in range(6):
                    motion=np.array([[1.,0,i*2],[0,1,0],[0,0,1]])
                    truth[i]=normalize(motion@h)
                    image=cv2.cvtColor(cv2.warpAffine(texture,motion[:2],(640,360)),cv2.COLOR_GRAY2BGR)
                    for packet in stream.encode(av.VideoFrame.from_ndarray(image,format='bgr24')):out.mux(packet)
                    candidate=truth[i].copy()
                    if i==2:candidate=np.array([[1.,0,50],[0,1,0],[0,0,1]])@candidate
                    rows.append({'frame':i,'time':i/30,'courtToImage':candidate.ravel().tolist(),
                                 'quality':{'method':'test_raw'}})
                for packet in stream.encode():out.mux(packet)
            rows[4]['courtToImage']=None
            raw={'frames':rows,'cameras':{str(i):truth[i].ravel().tolist() for i in (0,5)}};tracks=[{'tracks':[]} for _ in rows];scene={'frames':[{'objects':[]} for _ in rows]}
            result=audit(path,raw,tracks,scene,(640,360))
        self.assertIn(2,result['motionAudit']['repairedFrames'])
        self.assertIsNone(result['frames'][4]['courtToImage'])
        check=[[5,5],[10,8],[20,10]]
        repaired=np.asarray(result['frames'][2]['courtToImage']).reshape(3,3)
        self.assertLess(np.max(np.linalg.norm(project(repaired,check)-project(truth[2],check),axis=1)),1.)
        self.assertGreater(np.max(np.linalg.norm(project(np.asarray(raw['frames'][2]['courtToImage']).reshape(3,3),check)-project(truth[2],check),axis=1)),40.)


if __name__ == '__main__':
    unittest.main()
