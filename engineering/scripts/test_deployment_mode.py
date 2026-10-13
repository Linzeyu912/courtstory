"""Local launches remain independent of inherited or explicitly loaded AWS settings."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from serve_player_review import configure_deployment, load_server_environment


class DeploymentModeTests(unittest.TestCase):
    def test_local_disables_aws_execution_after_loading_env_file_but_keeps_online_ai(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            env = Path(directory) / 'local.env'
            env.write_text('HKS_GPU_PREFIX=old-gpu\nHKS_AGENT_RUNTIME=old-runtime\n'
                           'OPEN_ROUTER_KEY=test-placeholder\n', encoding='utf-8')
            load_server_environment(env)
            self.assertEqual(configure_deployment('local'), 'local')
            self.assertNotIn('HKS_GPU_PREFIX', os.environ)
            self.assertNotIn('HKS_AGENT_RUNTIME', os.environ)
            self.assertEqual(os.environ['OPEN_ROUTER_KEY'], 'test-placeholder')

    def test_aws_requires_storage_configuration_without_contacting_aws(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'HKS_BUCKET, HKS_PREFIX'):
                configure_deployment('aws')
            os.environ.update(HKS_BUCKET='example-bucket', HKS_PREFIX='example-prefix')
            self.assertEqual(configure_deployment('aws'), 'aws')

    def test_legacy_auto_keeps_explicit_aws_executors(self):
        with patch.dict(os.environ, {'HKS_GPU_PREFIX': 'existing-gpu'}, clear=True):
            self.assertEqual(configure_deployment('auto'), 'aws')
            self.assertEqual(os.environ['HKS_GPU_PREFIX'], 'existing-gpu')
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configure_deployment('auto'), 'local')


if __name__ == '__main__':
    unittest.main()
