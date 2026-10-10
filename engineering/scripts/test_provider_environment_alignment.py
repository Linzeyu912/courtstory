"""Fake-key-only coverage for shared server, name, speech and drawing setup."""
import codecs
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import commentary_agent
import commentary_drawing
import commentary_jobs
import commentary_tts
import player_name_identity


class ProviderEnvironmentAlignmentTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.env=self.root/'.env'

    def test_name_speech_and_job_status_read_utf16_with_environment_precedence(self):
        self.env.write_text('OPEN_ROUTER_KEY=file-secret\nQWEN_TTS_VOICE=anmingyuan_v3.1\n',encoding='utf-16')
        with patch.dict(os.environ,{'OPEN_ROUTER_KEY':'process-secret'},clear=True), \
                patch.object(player_name_identity,'REPO_ROOT',self.root), \
                patch('commentary_jobs.speech_credentials') as speech:
            self.assertEqual(player_name_identity._load_server_config()['OPEN_ROUTER_KEY'],'process-secret')
            self.assertEqual(commentary_tts.voice_settings(self.env)['speaker'],'anmingyuan_v3.1')
            jobs=commentary_jobs.CommentaryJobs(self.root/'jobs',env_file=self.env)
            self.addCleanup(jobs.close)
            self.assertTrue(jobs.status()['understandingConfigured'])
            speech.assert_called_once_with(self.env)
            names=player_name_identity.create_openrouter_name_provider(env_path=self.env)
            self.assertTrue(names.status()['available'])

    def test_supported_encodings_and_invalid_bytes_do_not_leak_configuration(self):
        source='OPEN_ROUTER_KEY=file-private-secret\nQWEN_TTS_VOICE=anmingyuan_v3.1\n'
        readers=[lambda:commentary_tts.environment(self.env),
                 lambda:player_name_identity._load_server_config(),
                 lambda:commentary_agent.provider_environment(self.env,'openrouter')]
        with patch.dict(os.environ,{},clear=True),patch.object(player_name_identity,'REPO_ROOT',self.root):
            for encoding in ('utf-8','utf-8-sig','utf-16-le','utf-16-be'):
                bom={'utf-16-le':codecs.BOM_UTF16_LE,'utf-16-be':codecs.BOM_UTF16_BE}.get(encoding,b'')
                self.env.write_bytes(bom+source.encode(encoding))
                for read in readers:
                    with self.subTest(encoding=encoding,reader=read):
                        output=io.StringIO()
                        with redirect_stdout(output),redirect_stderr(output):read()
                        self.assertEqual(output.getvalue(),'')
            for raw in (source.encode('utf-32'),source.encode('utf-16-le'),b'file-private-secret\xff'):
                self.env.write_bytes(raw)
                for read in readers:
                    with self.assertRaises(ValueError) as failure:read()
                    self.assertNotIsInstance(failure.exception,UnicodeDecodeError)
                    self.assertNotIn('file-private-secret',str(failure.exception))

    def test_absent_explicit_configuration_never_searches_parent_directory(self):
        self.env.write_text('OPEN_ROUTER_KEY=unexpected-parent-secret\n',encoding='utf-8')
        with patch.dict(os.environ,{},clear=True),patch('os.getcwd',return_value=str(self.root)):
            self.assertEqual(commentary_tts.environment(None),{})
            self.assertEqual(commentary_tts.environment(self.root/'absent.env'),{})

    def test_drawing_spawn_uses_shared_worker_environment_without_a_provider_call(self):
        child={'OPENROUTER_API_KEY':'private-fixture','HTTPS_PROXY':'http://127.0.0.1:1'}
        adapted={**child,'NODE_USE_ENV_PROXY':'1'}
        process=Mock(stdin=io.StringIO(),stdout=io.StringIO(json.dumps({'type':'result','result':{'status':'completed'}})+'\n'),stderr=io.StringIO())
        process.poll.return_value=0
        with patch('commentary_drawing.shutil.which',return_value='node'), \
                patch('commentary_drawing.provider_environment',return_value=(child,'private-fixture')), \
                patch.object(commentary_drawing,'worker_environment',create=True,return_value=adapted) as setup, \
                patch('commentary_drawing.subprocess.Popen',return_value=process) as spawn:
            result=commentary_drawing.run_pi({'config':{}},Mock(),self.root/'drawing',{'provider':'openrouter','model':'fixture'})
        self.assertEqual(result['status'],'completed')
        setup.assert_called_once_with('node',child)
        self.assertEqual(spawn.call_args.kwargs['env'],adapted)

    def test_commentary_command_preserves_explicit_env_and_redacts_file_tokens(self):
        self.env.write_text('OPEN_ROUTER_KEY=router-private-fixture\nAWS_SESSION_TOKEN=session-private-fixture\n',encoding='utf-16')
        video=self.root/'source.mp4';video.write_bytes(b'fixture')
        clip={'id':'fixture','video_sha256':'a'*64,'duration':1}
        with patch.dict(os.environ,{},clear=True):
            jobs=commentary_jobs.CommentaryJobs(self.root/'jobs',env_file=self.env)
            self.addCleanup(jobs.close)
            with patch.object(jobs,'status',return_value={'understandingConfigured':True,'ttsConfigured':True}), \
                    patch.object(jobs,'_run_command',side_effect=RuntimeError('router-private-fixture session-private-fixture')) as run:
                state=jobs.create({'action':'understand'},clip,video,'v',True)
                for thread in list(jobs._threads):thread.join(5)
                command=run.call_args.args[0]
                self.assertEqual(command[command.index('--env-file')+1],str(self.env))
                result=jobs.get(state['id'],clip,'v',True)
        self.assertEqual(result['status'],'failed')
        self.assertNotIn('router-private-fixture',result['error'])
        self.assertNotIn('session-private-fixture',result['error'])


if __name__=='__main__':unittest.main()
