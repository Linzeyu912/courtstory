import unittest
import numpy as np

from projection_sensitivity import REFLECTION, project, local_gain, inside_hull, summarize_speed, compare_speed_windows


class ProjectionContractTests(unittest.TestCase):
    def test_reflection_preserves_pair_distance(self):
        h = np.array([[.03, .002, 1], [.001, .04, 2], [0.0001, .0002, 1]])
        image = [[400, 300], [700, 450]]
        a = project(h, image); b = project(REFLECTION@h, image)
        self.assertAlmostEqual(np.linalg.norm(a[0]-a[1]), np.linalg.norm(b[0]-b[1]), places=10)
        self.assertAlmostEqual(b[0, 0], 28.6512-a[0, 0], places=10)

    def test_global_reflection_preserves_speed_and_flips_x_velocity(self):
        a, b = np.array([3., 5.]), np.array([3.2, 5.1])
        mirrored = project(REFLECTION, [a, b])
        v = (b-a)/.04; mv = (mirrored[1]-mirrored[0])/.04
        self.assertAlmostEqual(np.linalg.norm(v), np.linalg.norm(mv), places=10)
        self.assertAlmostEqual(v[0], -mv[0], places=10)

    def test_jacobian_affine_scaling(self):
        h = np.diag([.1, .2, 1.]); xy = np.array([5., 8.])
        self.assertAlmostEqual(local_gain(h, xy, project(h, xy)[0]), .2)

    def test_projection_near_horizon_is_missing(self):
        h = np.array([[1., 0., 0.], [0., 1., 0.], [1., 0., -5.]])
        self.assertTrue(np.isnan(project(h, [5., 7.])).all())

    def test_support_hull_boundary_and_extrapolation(self):
        hull = [[0, 0], [2, 0], [2, 2], [0, 2]]
        self.assertTrue(inside_hull(hull, np.array([0, 1])))
        self.assertFalse(inside_hull(hull, np.array([3, 1])))

    def test_missing_frame_does_not_create_speed_bridge(self):
        points = [{'frame': 0, 'track_id': 1, 'kind': 'left_foot_candidate'},
            {'frame': 2, 'track_id': 1, 'kind': 'left_foot_candidate'}]
        result, examples = summarize_speed(points, [0, .03, .06])
        self.assertEqual(result, {})
        self.assertEqual(examples, [])

    def test_long_window_rejects_missing_internal_id(self):
        points = {f: [{'track_id': 1, 'kind': 'bbox_bottom_center'}] for f in [0, 1, 2, 4, 5]}
        result = compare_speed_windows(points, [], {f: True for f in range(6)}, list(range(6)))
        row = result['all_eligible_windows']['5']
        self.assertEqual(row['candidate_end_observations_after_initial_warmup'], 1)
        self.assertEqual(row['eligible_windows'], 0)
        self.assertEqual(row['exclusive_exclusion_reasons_in_check_order']['temporary_id_not_continuous'], 1)

    def test_window_sensitivity_scales_with_elapsed_time_on_affine_motion(self):
        points = {f: [{'track_id': 1, 'kind': 'bbox_bottom_center'}] for f in range(16)}
        projected = []
        for f in range(16):
            q = np.array([float(f), 0.])
            projected.append({'frame': f, 'track_id': 1, 'kind': 'bbox_bottom_center', 'court': q,
                'sensitivity': {3: {'projections': q+np.array([[0., 0.], [.3, 0.], [-.3, 0.]])}}})
        result = compare_speed_windows(points, projected, {f: True for f in range(16)}, list(range(16)))
        self.assertEqual(result['common_endpoint_cohort_count'], 1)
        for lag in [1, 5, 15]:
            value = result['same_endpoints_all_three_lags'][str(lag)]['sampled_max_abs_speed_change_m_s']['median']
            self.assertAlmostEqual(value, .6/lag, places=10)


if __name__ == '__main__': unittest.main()
