"""Exercise the inherited weights-only setting against the deployed detectors."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from yolo_checkpoint import load_detector

ROOT = Path(__file__).resolve().parents[2]


class UnsupportedCheckpointType:
    pass


@unittest.skipUnless(importlib.util.find_spec('torch') and importlib.util.find_spec('ultralytics'),
                     'Optional local vision runtime is not installed')
class DetectorCheckpointTests(unittest.TestCase):
    def test_deployed_detectors_load_after_inheriting_court_environment(self):
        import torch
        models = [('BODD_yolov8n_0001.pt', 'player'), ('yolov8s.pt', 'person')]
        if not all((ROOT / 'tmp/models' / name).is_file() for name, _ in models):
            self.skipTest('Deployed model weights are local-only')
        prior_globals = torch.serialization.get_safe_globals()
        with patch.dict(os.environ, {'TORCH_FORCE_WEIGHTS_ONLY_LOAD': '1',
                                    'YOLO_CONFIG_DIR': str(ROOT / 'tmp/vision-benchmark-settings')}):
            for name, expected_class in models:
                with self.subTest(model=name):
                    model = load_detector(ROOT / 'tmp/models' / name)
                    self.assertIn(expected_class, model.names.values())
                    # PyTorch exposes a set-backed allowlist; iteration order
                    # can change after a scoped registration, membership cannot.
                    self.assertCountEqual(torch.serialization.get_safe_globals(), prior_globals)

    def test_unknown_checkpoint_types_are_rejected_before_yolo_construction(self):
        import torch
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ), patch('ultralytics.YOLO') as yolo:
            path = Path(folder) / 'unknown.pt'
            torch.save({'model': UnsupportedCheckpointType()}, path)
            with self.assertRaisesRegex(ValueError, 'Unexpected checkpoint globals'):
                load_detector(path)
            yolo.assert_not_called()


if __name__ == '__main__':
    unittest.main()
