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


class TtsCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.plan=self.root/'plan.json';self.env=self.root/'.env'
        self.env.write_text('VOLCENGINE_TTS_API_KEY=local-test-only\n',encoding='utf-8')
        self.data={'cues':[{'cueId':'a','text':'句子甲。'},{'cueId':'b','text':'句子乙。'}]}
        self.calls=[]
        def speech(text,*_):
            self.calls.append(text)
            return b'\x01\x00'*2400,{'sentences':[],'usage':{}}
        self.speech=patch('commentary_tts.synthesize',side_effect=speech)
        self.speech.start();self.addCleanup(self.speech.stop)

    def run_plan(self,name,style=STYLE):
        self.plan.write_text(json.dumps(self.data,ensure_ascii=False),encoding='utf-8')
        manifest=synthesize_plan(self.plan,self.root/name,self.env,style=style,audio_cache=self.root/'shared-cache')
        return json.loads(manifest.read_text(encoding='utf-8'))

    def test_graphic_or_name_display_changes_reuse_verified_wavs_in_new_job(self):
        first=self.run_plan('job-1')
        self.data.update(graphicsRevision=2,nameDisplay={'enabled':False})
        second=self.run_plan('job-2')
        self.assertEqual(self.calls,['句子甲。','句子乙。'])
        self.assertEqual([r['wavSha256'] for r in first['cues']],[r['wavSha256'] for r in second['cues']])
        self.assertTrue(all((self.root/'job-2'/r['path']).is_file() for r in second['cues']))

    def test_editing_one_sentence_synthesizes_only_the_changed_text(self):
        self.run_plan('job-1');self.data['cues'][1]['text']='修改后的句子。'
        result=self.run_plan('job-2')
        self.assertEqual(self.calls,['句子甲。','句子乙。','修改后的句子。'])
        self.assertEqual(result['cues'][1]['text'],'修改后的句子。')

    def test_corrupt_cached_wav_is_resynthesized_without_reusing_bad_bytes(self):
        first=self.run_plan('job-1');key=first['cues'][0]['cacheKey']
        path=self.root/'shared-cache'/f'{key}.wav'
        # Preserve the valid WAV header, format and length. Only the saved hash
        # can reveal this altered PCM, so this proves the integrity check.
        changed=bytearray(path.read_bytes());changed[-1]^=1;path.write_bytes(changed)
        result=self.run_plan('job-2')
        self.assertEqual(self.calls,['句子甲。','句子乙。','句子甲。'])
        self.assertEqual(result['cues'][0]['durationSeconds'],.1)

    def test_natural_voice_has_distinct_shared_cache_then_classic_reuses_classic_wavs(self):
        classic = self.run_plan('classic')
        natural = self.run_plan('natural', NATURAL_STYLE)
        resumed = self.run_plan('classic-again')
        self.assertEqual(self.calls, ['句子甲。', '句子乙。', '句子甲。', '句子乙。'])
        self.assertNotEqual(classic['cues'][0]['cacheKey'], natural['cues'][0]['cacheKey'])
        self.assertEqual(classic['cues'][0]['cacheKey'], resumed['cues'][0]['cacheKey'])


if __name__ == '__main__':
    unittest.main()
