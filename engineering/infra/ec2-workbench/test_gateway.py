import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class GatewaySecurityTests(unittest.TestCase):
    def test_backup_includes_library_state_and_excludes_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['cloud-library.json', 'artifacts/cloud-state.json',
                         'data/local-videos/example.mov', 'data/local-workbench/auth.json']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('{}')
            names = {p.relative_to(root.resolve()).as_posix() for p in gateway.state_files(root)}
            self.assertEqual(names, {'cloud-library.json', 'artifacts/cloud-state.json',
                                     'data/local-videos/example.mov'})

    def test_rejects_unconfigured_origin(self):
        self.assertFalse(gateway.trusted_origin({'Host': 'demo.cloudfront.net'}, ''))

    def test_rejects_cross_site_post(self):
        self.assertFalse(gateway.trusted_origin({'Host': 'demo.cloudfront.net', 'Origin': 'https://other.example'}, 'https://demo.cloudfront.net'))

    def test_rejects_wrong_host_even_with_valid_origin(self):
        self.assertFalse(gateway.trusted_origin({'Host': 'direct-ec2.example', 'Origin': 'https://demo.cloudfront.net'}, 'https://demo.cloudfront.net'))

    def test_accepts_same_origin(self):
        self.assertTrue(gateway.trusted_origin({'Host': 'demo.cloudfront.net', 'Origin': 'https://demo.cloudfront.net'}, 'https://demo.cloudfront.net'))

    def test_get_without_origin_still_requires_correct_host(self):
        self.assertTrue(gateway.trusted_origin({'Host': 'demo.cloudfront.net'}, 'https://demo.cloudfront.net'))

    def test_requires_correct_session(self):
        self.assertFalse(gateway.authenticated({}))
        self.assertFalse(gateway.authenticated({'Cookie': 'hks_session=wrong'}))
        self.assertTrue(gateway.authenticated({'Cookie': 'hks_session=' + gateway.SESSION}))


if __name__ == '__main__':
    unittest.main()
