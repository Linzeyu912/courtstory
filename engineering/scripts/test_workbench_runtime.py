"""Preflight uses the selected interpreter and weights without loading a model."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import local_video_library


class RuntimeTests(unittest.TestCase):
    def test_detector_availability_checks_each_weight_and_pinned_digest(self):
        self.assertTrue(hasattr(local_video_library, 'RuntimeProbe'), 'per-model runtime preflight is missing')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'basket.pt').write_bytes(b'basket')
            weights = {'ebard': ('basket.pt', hashlib.sha256(b'basket').hexdigest()),
                       'yolo': ('generic.pt', '0' * 64)}
            with patch('workbench_runtime.WEIGHTS', weights), patch('workbench_runtime.probe_interpreter', return_value={'available': True, 'reason': '', 'device': 'test GPU'}):
                probe = local_video_library.RuntimeProbe(sys.executable, root)
                result = probe()
                self.assertTrue(result['variants']['team-stable']['available'])
                self.assertFalse(result['variants']['yolo']['available'])
                self.assertIn('generic.pt', result['variants']['yolo']['reason'])
                (root / 'basket.pt').write_bytes(b'wrong')
                result = probe()
                self.assertFalse(result['variants']['team-stable']['available'])
                self.assertIn('SHA-256', result['variants']['team-stable']['reason'])

    def test_worker_log_failure_reports_actual_exception_and_caps_output(self):
        self.assertTrue(hasattr(local_video_library, 'worker_failure'), 'worker error reason is missing')
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'processing.log'
            log.write_text('progress\n' * 10000 + 'Traceback (most recent call last):\n  x\nRuntimeError: CUDA out of memory\n')
            message = local_video_library.worker_failure(log, 1)
            self.assertIn('CUDA out of memory', message)
            self.assertLess(len(message), 1600)

    def test_nested_worker_failure_keeps_the_underlying_reason(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'processing.log'
            log.write_text('Traceback (most recent call last):\nRuntimeError: CUDA out of memory\n'
                           'Traceback (most recent call last):\n'
                           'subprocess.CalledProcessError: Command [python, worker] returned non-zero exit status 1.\n')
            message = local_video_library.worker_failure(log, 1)
            self.assertIn('CUDA out of memory', message)
            self.assertNotIn('CalledProcessError', message)
            log.write_text('_pickle.UnpicklingError: Weights only load failed.\n'
                           'subprocess.CalledProcessError: Command failed\n')
            self.assertIn('模型权重加载不兼容', local_video_library.worker_failure(log, 1))


if __name__ == '__main__': unittest.main()
