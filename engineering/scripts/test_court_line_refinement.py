"""Known geometry checks for local court-line fits; no model or network needed."""
import unittest

import cv2
import numpy as np

from court_line_refinement import fit_painted_line
from court_propagation import LANDMARKS, project, refine_from_court_lines


class CourtLineTests(unittest.TestCase):
    def test_stripe_and_paint_boundary_are_not_interchangeable(self):
        gray = np.full((160, 640), 210, np.uint8)
        gray[90:] = 35
        mask = np.full_like(gray, 255)
        line, _ = fit_painted_line(gray, np.array([[30., 84.], [600., 84.]]), mask, 18)
        self.assertIsNone(line)
        line, _ = fit_painted_line(gray, np.array([[30., 84.], [600., 84.]]), mask, 18, 'boundary')
        self.assertIsNotNone(line)
        self.assertLess(abs(np.dot(line, [300., 89.5, 1.])), 1)

    def scene(self, paint=True):
        gray = np.full((360, 640), 160 if not paint else 210, np.uint8)
        h = np.array([[30., 2., 60.], [-1., 24., -50.], [0., .004, 1.]])
        corners = project(h, [LANDMARKS[k] for k in 'ABCD'])
        if paint:
            cv2.fillPoly(gray, [np.rint(corners).astype(np.int32)], 35)
        # Inner 12 ft stripes are separate from the 16 ft outer lane boundaries.
        for y in (5.7912, 9.4488):
            pts = project(h, [(0, y), (5.7912, y)])
            cv2.polylines(gray, [np.rint(pts).astype(np.int32)], False, 250, 2, cv2.LINE_AA)
        for x in (0, 5.7912):
            pts = project(h, [(x, 4.5), (x, 10.5)])
            cv2.polylines(gray, [np.rint(pts).astype(np.int32)], False, 250, 2, cv2.LINE_AA)
        return gray, h

    def controls(self, h):
        return [{'id': name, 'image': project(h, [LANDMARKS[name]])[0].tolist(), 'source': 'yolo11n-court48'}
                for name in 'ABCDEI']

    def test_recovers_outer_corners_without_snapping_to_inner_white_stripes(self):
        gray, truth = self.scene()
        initial = np.array([[1., 0., 5.], [0., 1., -4.], [0., 0., 1.]]) @ truth
        fitted, detail = refine_from_court_lines(gray, initial, 'left', control_points=self.controls(initial))
        self.assertTrue(detail['refinementApplied'], detail)
        error = np.linalg.norm(project(fitted, [LANDMARKS[k] for k in 'ABCD'])-
                               project(truth, [LANDMARKS[k] for k in 'ABCD']), axis=1)
        initial_error = np.linalg.norm(project(initial, [LANDMARKS[k] for k in 'ABCD'])-
                                       project(truth, [LANDMARKS[k] for k in 'ABCD']), axis=1)
        # The joint fit deliberately retains the biased detector as a soft
        # prior. Every corner must improve by at least a third in this scene.
        self.assertTrue(np.all(error < initial_error*2/3), (error, initial_error))
        self.assertEqual(detail['laneWidthFeet'], 16)
        self.assertFalse(detail['independentAccuracyValidated'])

    def test_inner_stripes_use_their_own_twelve_foot_template(self):
        gray, truth = self.scene(paint=False)
        fitted, detail = refine_from_court_lines(gray, truth, 'left', control_points=self.controls(truth))
        self.assertTrue(detail['refinementApplied'], detail)
        self.assertEqual(detail['laneWidthFeet'], 12)
        self.assertLess(float(np.linalg.norm(project(fitted, [LANDMARKS['A']])-
                                             project(truth, [LANDMARKS['A']]))), 3.)

    def test_occluded_lines_preserve_the_original_mapping(self):
        gray, initial = self.scene()
        fitted, detail = refine_from_court_lines(gray, initial, 'left', boxes=[[0, 0, 640, 360]],
                                                control_points=self.controls(initial))
        np.testing.assert_array_equal(fitted, initial)
        self.assertFalse(detail['refinementApplied'])

    def test_manual_controls_are_never_snapped(self):
        gray, initial = self.scene()
        controls = self.controls(initial); controls[0]['source'] = 'human'
        fitted, detail = refine_from_court_lines(gray, initial, 'left', control_points=controls)
        np.testing.assert_array_equal(fitted, initial)
        self.assertFalse(detail['refinementApplied'])


if __name__ == '__main__':
    unittest.main()
