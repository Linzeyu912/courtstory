import json
from pathlib import Path
import tempfile
import unittest

try:
    from vision_provider import CodexVisionProvider, MultimodalApiProvider, create_provider
except ImportError:
    CodexVisionProvider = MultimodalApiProvider = create_provider = None


class VisionProviderTests(unittest.TestCase):
    def test_future_api_is_explicitly_unavailable_and_never_accepts_a_network_destination(self):
        self.assertIsNotNone(create_provider, 'vision provider contract must exist')
        provider = create_provider('multimodal-api')
        self.assertFalse(provider.status()['available'])
        self.assertEqual(provider.status()['provider'], 'multimodal-api')
        with self.assertRaises(ValueError):
            provider.generate(job={}, directory=Path('.'), schema=Path('schema.json'),
                              result=Path('result.json'), images=[], prompt='Read jersey')
        with self.assertRaises(ValueError):
            create_provider('https://untrusted.example/vision')

    def test_injected_json_boundary_can_be_used_without_credentials(self):
        self.assertIsNotNone(CodexVisionProvider, 'restricted Codex adapter must exist')
        provider = CodexVisionProvider(execute=lambda **_: {'team': 'purple', 'jersey': '10'})
        output = provider.generate(job={}, directory=Path('.'), schema=Path('schema.json'),
                                   result=Path('result.json'), images=[], prompt='Read jersey')
        self.assertEqual(output, {'team': 'purple', 'jersey': '10'})


if __name__ == '__main__':
    unittest.main()
