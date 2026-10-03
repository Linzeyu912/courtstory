"""Exercise model-pair resolution through the real queue and inference plan."""
import unittest
from pathlib import Path
from process_local_video import inference_plan
from workbench_models import MODEL_CHOICES, resolve_selection


class WorkbenchModelTests(unittest.TestCase):
    def test_supported_pairs_use_the_selected_weights_and_tracker_profile(self):
        expected = {
            ('ebard', 'botsort-reid'): ('team-stable', 'BODD_yolov8n_0001.pt', 'optimized', True),
            ('ebard', 'bytetrack'): ('ebard-byte', 'BODD_yolov8n_0001.pt', 'yolo', False),
            ('yolo', 'botsort-reid'): ('yolo-team', 'yolov8s.pt', 'optimized', True),
            ('yolo', 'bytetrack'): ('yolo', 'yolov8s.pt', 'yolo', False),
        }
        for pair, result in expected.items():
            with self.subTest(pair=pair):
                variant = resolve_selection(*pair)
                plan = inference_plan(variant, Path('models'))
                self.assertEqual((variant, plan['weights'].name, plan['profile'], plan['stable']), result)
                self.assertEqual(plan['detector'], pair[0])
        self.assertEqual(len({resolve_selection(*pair) for pair in expected}), 4)

    def test_partial_unknown_or_conflicting_pair_cannot_run_another_model(self):
        for detector, tracker, variant in [('ebard', None, None), ('unknown', 'bytetrack', None),
                                         ('ebard', 'bytetrack', 'team-stable')]:
            with self.subTest(detector=detector, tracker=tracker):
                with self.assertRaises(ValueError): resolve_selection(detector, tracker, variant)

    def test_default_keeps_existing_optimized_plus_stable_route(self):
        plan = inference_plan(MODEL_CHOICES['defaultVariant'], Path('models'))
        self.assertEqual(plan['id'], 'team-stable')
        self.assertEqual(plan['rawVariant'], 'optimized')
        self.assertEqual(plan['imgsz'], 704)
        self.assertTrue(plan['stable'])
