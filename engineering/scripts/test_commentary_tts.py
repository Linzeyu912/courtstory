import io
import wave
import json
import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch, Mock

from commentary_tts import synthesize, synthesize_plan, credentials, voice_settings, STYLE, NATURAL_STYLE, SAMPLE_RATE, SPEAKER, MODEL


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

    @patch('commentary_tts.requests.get')
    @patch('commentary_tts.requests.post')
    def test_aliyun_request_and_download_keep_key_off_audio_host(self, post, get):
        pcm = b'\x01\x00' * SAMPLE_RATE
        data = io.BytesIO()
        with wave.open(data, 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(SAMPLE_RATE); audio.writeframes(pcm)
        response = post.return_value.__enter__.return_value
        response.status_code = 200
        response.json.return_value = {'output': {'finish_reason': 'stop', 'audio': {'url': 'http://result.oss-cn-beijing.aliyuncs.com/test.wav?signature=private'}}, 'usage': {'total_tokens': 12}}
        download = get.return_value.__enter__.return_value
        download.status_code = 200; download.content = data.getvalue()
        actual, details = synthesize('传球 < 2 & 得分', {'apiKey':'private-key','endpoint':'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'}, SPEAKER, NATURAL_STYLE, MODEL)
        self.assertEqual(actual, pcm)
        request = post.call_args.kwargs
        self.assertEqual(request['json']['model'], MODEL)
        self.assertEqual(request['json']['input']['voice'], 'anmingyuan_v3.1')
        self.assertEqual(request['json']['input']['text'], '传球 < 2 & 得分')
        self.assertIn('instruction', request['json']['input'])
        self.assertNotIn('headers', get.call_args.kwargs)
        self.assertTrue(get.call_args.args[0].startswith('https://'))
        self.assertEqual(details['usage']['total_tokens'], 12)
        # The real service uses FFmpeg's streaming placeholder for WAV lengths.
        streaming = bytearray(data.getvalue())
        streaming[4:8] = (0x7fffffff).to_bytes(4, 'little')
        streaming[40:44] = (0x7ffffffe).to_bytes(4, 'little')
        download.content = bytes(streaming)
        self.assertEqual(synthesize('投篮', {'apiKey':'private-key','endpoint':'https://dashscope.aliyuncs.com/test'}, SPEAKER, STYLE, MODEL)[0], pcm)
        download.content = data.getvalue()[:-2]
        with self.assertRaisesRegex(ValueError, 'incomplete audio'):
            synthesize('投篮', {'apiKey':'private-key','endpoint':'https://dashscope.aliyuncs.com/test'}, SPEAKER, STYLE, MODEL)
        download.content = b'not a WAV'
        with self.assertRaisesRegex(RuntimeError, 'audio failure'):
            synthesize('投篮', {'apiKey':'private-key','endpoint':'https://dashscope.aliyuncs.com/test'}, SPEAKER, STYLE, MODEL)

    @patch('commentary_tts.requests.post')
    def test_api_failure_does_not_expose_key_or_response_message(self, post):
        response = post.return_value.__enter__.return_value
        response.status_code = 403
        response.json.return_value = {'code':'AccessDenied','message':'private-key'}
        with self.assertRaisesRegex(RuntimeError, 'AccessDenied') as error:
            synthesize('投篮', {'apiKey':'private-key','endpoint':'https://dashscope.aliyuncs.com/test'}, SPEAKER, STYLE, MODEL)
        self.assertNotIn('private-key', str(error.exception))

    @patch('commentary_tts.environment', return_value={'QWEN_API_KEY':'existing-key','SFM_WORKSPACE_ID':'7670306'})
    def test_credentials_support_workspace_and_existing_key(self, env):
        result = credentials('unused')
        self.assertEqual(result['apiKey'], 'existing-key')
        self.assertIn('7670306.cn-beijing.maas.aliyuncs.com', result['endpoint'])
        env.return_value = {'DASHSCOPE_API_KEY':'tts-key'}
        self.assertEqual(credentials('unused')['endpoint'], 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
        env.return_value = {}
        with self.assertRaisesRegex(ValueError, 'DASHSCOPE_API_KEY'): credentials('unused')

    @patch('commentary_tts.environment', return_value={'QWEN_TTS_VOICE':'longsanshu_v3.1','QWEN_TTS_MODEL':MODEL})
    def test_voice_configuration_and_explicit_override(self, env):
        self.assertEqual(voice_settings('unused')['speaker'], 'longsanshu_v3.1')
        self.assertEqual(voice_settings('unused', SPEAKER)['speaker'], SPEAKER)


class TtsCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.plan=self.root/'plan.json';self.env=self.root/'.env'
        self.env.write_text('',encoding='utf-8')
        credential_patch=patch('commentary_tts.credentials',return_value=Mock())
        credential_patch.start();self.addCleanup(credential_patch.stop)
        self.data={'cues':[{'cueId':'a','text':'句子甲。'},{'cueId':'b','text':'句子乙。'}]}
        self.calls=[]
        def speech(text,*_):
            self.calls.append(text)
            return b'\x01\x00'*1600,{'sentences':[],'usage':{}}
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

    def test_manifest_contains_aliyun_and_actual_wav_duration(self):
        result = self.run_plan('polly')
        self.assertEqual(result['config']['provider'], 'aliyun-qwen-audio')
        row = result['cues'][0]
        with wave.open(str(self.root/'polly'/row['path']), 'rb') as audio:
            self.assertEqual(audio.getframerate(), 16000)
            self.assertEqual(row['durationSeconds'], audio.getnframes()/audio.getframerate())

    def test_old_provider_audio_is_not_resumed_as_aliyun(self):
        self.run_plan('old')
        path = self.root/'old/audio-manifest.json'
        saved = json.loads(path.read_text(encoding='utf-8'))
        saved['config']['provider'] = 'amazon-polly'
        path.write_text(json.dumps(saved))
        with self.assertRaisesRegex(ValueError, 'voice settings'):
            self.run_plan('old')

    def test_voice_change_creates_new_cache(self):
        first = self.run_plan('neural')
        with patch.dict('os.environ', {'QWEN_TTS_VOICE': 'longsanshu_v3.1'}):
            second = self.run_plan('standard')
        self.assertNotEqual(first['cues'][0]['cacheKey'], second['cues'][0]['cacheKey'])
        self.assertEqual(len(self.calls), 4)

    def test_natural_voice_has_distinct_shared_cache_then_classic_reuses_classic_wavs(self):
        classic = self.run_plan('classic')
        natural = self.run_plan('natural', NATURAL_STYLE)
        resumed = self.run_plan('classic-again')
        self.assertEqual(self.calls, ['句子甲。', '句子乙。', '句子甲。', '句子乙。'])
        self.assertNotEqual(classic['cues'][0]['cacheKey'], natural['cues'][0]['cacheKey'])
        self.assertEqual(classic['cues'][0]['cacheKey'], resumed['cues'][0]['cacheKey'])


if __name__ == '__main__':
    unittest.main()
