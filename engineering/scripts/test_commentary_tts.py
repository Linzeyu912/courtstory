import base64
import json
import unittest

from commentary_tts import read_audio_stream


class TtsStreamTests(unittest.TestCase):
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
