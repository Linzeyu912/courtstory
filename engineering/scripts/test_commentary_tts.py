import io
import wave
import json
import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch, Mock

from commentary_tts import synthesize, synthesize_plan, credentials, voice_settings, STYLE, NATURAL_STYLE, SAMPLE_RATE
from botocore.response import StreamingBody
from botocore.exceptions import ClientError


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

    def test_polly_request_escapes_text_and_reads_complete_pcm(self):
        pcm = b'\x01\x00' * SAMPLE_RATE
        raw = io.BytesIO(pcm)
        stream = StreamingBody(raw, len(pcm))
        client = Mock()
        client.synthesize_speech.return_value = {'AudioStream': stream, 'RequestCharacters': 8}
        actual, details = synthesize('传球 < 2 & 得分', client, 'Zhiyu', NATURAL_STYLE, 'neural')
        self.assertEqual(actual, pcm)
        request = client.synthesize_speech.call_args.kwargs
        self.assertEqual(request['SampleRate'], '16000')
        self.assertEqual(request['Engine'], 'neural')
        self.assertEqual(request['VoiceId'], 'Zhiyu')
        self.assertIn('&lt; 2 &amp;', request['Text'])
        self.assertIn('105%', request['Text'])
        self.assertTrue(raw.closed)
        self.assertEqual(details['usage']['requestCharacters'], 8)

    def test_incomplete_stream_and_invalid_pcm_are_rejected(self):
        for pcm, declared in ((b'\0\0', 10), (b'', 0), (b'\0', 1)):
            with self.subTest(pcm=pcm):
                client = Mock()
                raw = io.BytesIO(pcm)
                stream = StreamingBody(raw, declared)
                client.synthesize_speech.return_value = {'AudioStream': stream}
                with self.assertRaises((ValueError, RuntimeError)):
                    synthesize('投篮', client, 'Zhiyu', STYLE, 'neural')
                self.assertTrue(raw.closed)

    def test_aws_failure_reports_code_without_secret_message(self):
        client = Mock()
        client.synthesize_speech.side_effect = ClientError(
            {'Error': {'Code': 'AccessDeniedException', 'Message': 'private-token'}}, 'SynthesizeSpeech')
        with self.assertRaisesRegex(RuntimeError, 'AccessDeniedException') as error:
            synthesize('投篮', client, 'Zhiyu', STYLE, 'neural')
        self.assertNotIn('private-token', str(error.exception))

    @patch('commentary_tts.environment', return_value={'AWS_PROFILE': 'team', 'AWS_REGION': 'us-east-1'})
    @patch('boto3.Session')
    def test_credentials_use_profile_and_resolve_sso(self, session, env):
        client = credentials('unused.env')
        self.assertEqual(session.call_args.kwargs['profile_name'], 'team')
        session.return_value.get_credentials.return_value.get_frozen_credentials.assert_called_once()
        self.assertEqual(client, session.return_value.client.return_value)

    @patch('commentary_tts.environment', return_value={})
    @patch('boto3.Session')
    def test_missing_aws_credentials_is_actionable(self, session, env):
        session.return_value.get_credentials.return_value = None
        with self.assertRaisesRegex(ValueError, 'Missing AWS credentials'):
            credentials('unused.env')

    @patch('commentary_tts.environment', return_value={'POLLY_ENGINE': 'standard', 'POLLY_VOICE_ID': 'Joanna'})
    def test_voice_configuration_and_explicit_override(self, env):
        self.assertEqual(voice_settings('unused')['speaker'], 'Joanna')
        settings = voice_settings('unused', 'Zhiyu', 'neural')
        self.assertEqual((settings['speaker'], settings['engine']), ('Zhiyu', 'neural'))


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

    def test_manifest_contains_polly_and_actual_wav_duration(self):
        result = self.run_plan('polly')
        self.assertEqual(result['config']['provider'], 'amazon-polly')
        row = result['cues'][0]
        with wave.open(str(self.root/'polly'/row['path']), 'rb') as audio:
            self.assertEqual(audio.getframerate(), 16000)
            self.assertEqual(row['durationSeconds'], audio.getnframes()/audio.getframerate())

    def test_old_provider_audio_is_not_resumed_as_polly(self):
        self.run_plan('old')
        path = self.root/'old/audio-manifest.json'
        saved = json.loads(path.read_text(encoding='utf-8'))
        saved['config']['provider'] = 'volcengine'
        path.write_text(json.dumps(saved))
        with self.assertRaisesRegex(ValueError, 'voice settings'):
            self.run_plan('old')

    def test_engine_change_creates_new_cache(self):
        first = self.run_plan('neural')
        with patch.dict('os.environ', {'POLLY_ENGINE': 'standard'}):
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
