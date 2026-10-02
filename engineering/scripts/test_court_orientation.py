"""Orientation needs independent hoop evidence and an invertible floor layout."""
import copy
import json
import unittest

import numpy as np

from court_orientation import SLOTS, estimate_court
from court_propagation import LANDMARKS, LENGTH, WIDTH


def project(h, points):
    p = np.column_stack((points, np.ones(len(points)))) @ h.T
    return p[:, :2]/p[:, 2:]


def fixture(side='left', slot_side=None, x_shift=0., names='ABCDEIJ'):
    slot_side = slot_side or side
    # The hoop is above the ground footprint. Ground points span both the
    # baseline and free-throw line, so the mapping is independently determined.
    h = np.asarray([[45. if side == 'left' else -45., 8., 140. if side == 'left' else 960.],
                    [2., 18., 190.], [0., .001, 1.]])
    h[0] += x_shift*h[2]
    kps = np.zeros((48, 3))
    for name, slot in SLOTS[slot_side].items():
        if name in names:
            kps[slot] = [*project(h, [LANDMARKS[name]])[0], .8]
    rim = project(h, [[1.6002, WIDTH/2]])[0]
    hoop = {'kind': 'hoop', 'box': [rim[0]-20, rim[1]-175, rim[0]+20, rim[1]-125], 'score': .9}
    return kps, [hoop], h


class OrientationTests(unittest.TestCase):
    def estimate(self, kps, objects, locked_side=None):
        result = estimate_court(kps, objects, 1280, 720, locked_side)
        json.dumps(result, allow_nan=False)
        return result

    def test_both_directions_use_floor_geometry(self):
        for side in ('left', 'right'):
            with self.subTest(side=side):
                kps, hoops, h = fixture(side)
                result = self.estimate(kps, hoops)
                self.assertEqual(result['side'], side)
                self.assertEqual(result['status'], 'needs_review')
                self.assertFalse(result['orientation']['hoopUsedForGroundFit'])
                self.assertFalse(result['metricAccuracyValidated'])
                to_court = np.asarray(result['imageToCourt']).reshape(3, 3)
                source = np.asarray([LANDMARKS[p['id']] for p in result['points']])
                expected = source.copy()
                if side == 'right':
                    expected[:, 0] = LENGTH-expected[:, 0]
                np.testing.assert_allclose(project(to_court, project(h, source)), expected, atol=1e-5)

    def test_hoop_left_of_image_center_can_be_right_half(self):
        kps, hoops, _ = fixture('right', x_shift=-520.)
        self.assertLess((hoops[0]['box'][0]+hoops[0]['box'][2])/2, 640)
        result = self.estimate(kps, hoops)
        self.assertEqual(result['side'], 'right')

    def test_wrong_slot_side_is_reinterpreted_without_mirroring_pixels(self):
        kps, hoops, _ = fixture('right', slot_side='left')
        result = self.estimate(kps, hoops)
        self.assertEqual(result['side'], 'right')
        self.assertTrue(result['orientation']['reinterpreted'])
        for point in result['points']:
            self.assertEqual(point['slotSide'], 'left')
            self.assertEqual(point['modelSlot'], SLOTS['left'][point['id']])
            np.testing.assert_equal(point['image'], kps[point['modelSlot'], :2])

    def test_higher_scored_mirror_hypothesis_does_not_win(self):
        good, hoops, _ = fixture('right')
        phantom, _, _ = fixture('left')
        phantom[phantom[:, 2] > 0, 2] = .99
        kps = good+phantom
        result = self.estimate(kps, hoops)
        self.assertEqual(result['side'], 'right')
        self.assertEqual(result['orientation']['hypotheses'][0]['reason'], 'hoop_conflicts_with_ground_geometry')

    def test_missing_or_two_hoops_stays_invalid_even_with_lock(self):
        kps, hoops, _ = fixture()
        for objects, reason in (([], 'missing_reliable_hoop'), (hoops*2, 'multiple_hoops_ambiguous')):
            result = self.estimate(kps, objects, 'left')
            self.assertEqual(result['reason'], reason)
            self.assertIsNone(result['courtToImage'])
            self.assertIsNone(result['side'])

    def test_weak_hoop_is_not_independent_evidence(self):
        kps, hoops, _ = fixture()
        hoops[0]['score'] = .2
        self.assertEqual(self.estimate(kps, hoops)['reason'], 'missing_reliable_hoop')

    def test_lock_conflict_rejects_instead_of_flipping(self):
        kps, hoops, _ = fixture('right')
        self.assertEqual(self.estimate(kps, hoops, 'right')['side'], 'right')
        conflict = self.estimate(kps, hoops, 'left')
        self.assertEqual(conflict['reason'], 'locked_side_conflicts_with_current_evidence')
        self.assertIsNone(conflict['side'])
        self.assertIsNone(conflict['imageToCourt'])
        self.assertEqual(conflict['orientation']['inferredSide'], 'right')

    def test_three_collinear_ground_points_plus_one_is_degenerate(self):
        kps, hoops, _ = fixture(names='ABEI')
        # Real model noise can make the three baseline predictions disagree;
        # this must still fail the ground-layout check before fitting.
        kps[SLOTS['left']['I'], 1] += 2
        result = self.estimate(kps, hoops)
        self.assertEqual(result['status'], 'invalid')
        self.assertEqual(result['orientation']['hypotheses'][0]['reason'], 'degenerate_ground_layout')

    def test_insufficient_points_do_not_use_hoop_as_fourth_point(self):
        kps, hoops, _ = fixture(names='ABC')
        result = self.estimate(kps, hoops)
        self.assertEqual(result['status'], 'invalid')
        self.assertEqual(result['orientation']['hypotheses'][0]['pointCount'], 3)

    def test_bad_hoop_geometry_and_below_floor_are_rejected(self):
        for dx, dy, reason in ((450., 0., 'hoop_conflicts_with_ground_geometry'),
                               (0., 220., 'hoop_height_evidence_inconsistent')):
            kps, hoops, _ = fixture()
            hoops[0]['box'] = (np.asarray(hoops[0]['box'])+[dx, dy, dx, dy]).tolist()
            result = self.estimate(kps, hoops)
            self.assertEqual(result['status'], 'invalid')
            self.assertEqual(result['orientation']['hypotheses'][0]['reason'], reason)

    def test_conflicting_nonidentical_ground_hypotheses_remain_ambiguous(self):
        left, hoops, _ = fixture('left')
        same_side_other, _, _ = fixture('left', slot_side='right', x_shift=45.)
        result = self.estimate(left+same_side_other, hoops)
        self.assertEqual(result['reason'], 'multiple_ground_hypotheses_ambiguous')

    def test_hoop_is_not_used_to_change_mapping(self):
        kps, hoops, _ = fixture()
        before = self.estimate(kps, hoops)
        hoops[0]['box'] = (np.asarray(hoops[0]['box'])+[15., -10., 15., -10.]).tolist()
        after = self.estimate(kps, hoops)
        self.assertEqual(before['courtToImage'], after['courtToImage'])
        self.assertEqual(after['status'], 'needs_review')

    def test_input_is_not_mutated(self):
        kps, hoops, _ = fixture()
        old_kps, old_hoops = kps.copy(), copy.deepcopy(hoops)
        self.estimate(kps, hoops)
        np.testing.assert_equal(kps, old_kps)
        self.assertEqual(hoops, old_hoops)

    def test_horizon_and_unsupported_camera_geometry_stay_invalid(self):
        matrices = [
            (np.asarray([[15., 2., 80.], [1., 5., 40.], [-.1, 0., 1.]]),
             'projection_horizon_crosses_half_court'),
            (np.asarray([[1., 18., 200.], [45., 2., 160.], [0., 0., 1.]]),
             'unsupported_endline_or_ambiguous_view'),
            (np.asarray([[45., 8., 140.], [2., -18., 500.], [0., 0., 1.]]),
             'unsupported_near_far_orientation'),
        ]
        for h, reason in matrices:
            with self.subTest(reason=reason):
                kps = np.zeros((48, 3))
                for name, slot in SLOTS['left'].items():
                    kps[slot] = [*project(h, [LANDMARKS[name]])[0], .9]
                result = self.estimate(kps, [{'kind': 'hoop', 'box': [300, 30, 340, 70], 'score': .9}])
                self.assertEqual(result['status'], 'invalid')
                self.assertEqual(result['orientation']['hypotheses'][0]['reason'], reason)

    def test_high_confidence_inconsistent_floor_point_is_not_ignored(self):
        kps, hoops, _ = fixture()
        kps[SLOTS['left']['D'], :2] += [120., 70.]
        result = self.estimate(kps, hoops)
        self.assertEqual(result['status'], 'invalid')
        self.assertEqual(result['orientation']['hypotheses'][0]['reason'], 'inconsistent_ground_points')

    def test_invalid_inputs_are_json_safe(self):
        kps, hoops, _ = fixture()
        cases = [(kps[:47], hoops, None), (np.full((48, 3), np.nan), hoops, None),
                 (kps, None, None), (kps, [{'kind': 'hoop', 'box': None, 'score': .9}], None),
                 (kps, hoops, ['left'])]
        for points, objects, locked in cases:
            self.assertEqual(self.estimate(points, objects, locked)['status'], 'invalid')
        result = estimate_court(kps, hoops, float('inf'), 720)
        self.assertEqual(result['status'], 'invalid')
        json.dumps(result, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
