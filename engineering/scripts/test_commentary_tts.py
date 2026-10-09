import base64
import json
import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch

from commentary_tts import read_audio_stream, synthesize_plan, STYLE, NATURAL_STYLE


class TtsStreamTests(unittest.TestCase):
    @patch('commentary_tts.credentials', return_value='test')
    @patch('commentary_tts.synthesize', return_value=(b'\x01\x00' * 24, {}))
    def test_voice_change_never_reuses_old_audio(self, synth, credentials):
        temporary_root = Path(__file__).resolve().parents[2] / 'tmp/test-commentary-tts'
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            root = Path(directory)
            plan = root / 'plan.json'
            plan.write_text(json.dumps({'cues': [{'cueId': 'c1', 'text': '球进了！'}]}), encoding='utf-8')
            synthesize_plan(plan, root / 'audio', root / '.env', style=STYLE)
            synthesize_plan(plan, root / 'audio', root / '.env', style=STYLE)
            self.assertEqual(synth.call_count, 1)
            with self.assertRaisesRegex(ValueError, 'voice settings'):
                synthesize_plan(plan, root / 'audio', root / '.env', style=NATURAL_STYLE)

    def test_stream_collects_audio_timestamps_and_completion(self):
        pcm = b'\x01\x00' * 24
        packets = [{'code': 0, 'data': base64.b64encode(pcm).decode(),
                    'sentence': {'text': '投篮。', 'words': []}},
                   {'code': 20000000, 'usage': {'text_words': 3}}]
        actual, sentences, usage = read_audio_stream(json.dumps(p).encode() for p in packets)
        self.assertEqual(actual, pcm)
        self.assertEqual(sentences[0]['text'], '投篮。')
        self.assertEqual(usage['text_words'], 3)

    def test_truncated_and_rejected_streams_are_not_successful_audio(self):
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            read_audio_stream([json.dumps({'code': 0, 'data': 'AAA='})])
        with self.assertRaisesRegex(RuntimeError, '45000010'):
            read_audio_stream([json.dumps({'code': 45000010, 'message': 'Invalid key'})])


if __name__ == '__main__':
    unittest.main()
