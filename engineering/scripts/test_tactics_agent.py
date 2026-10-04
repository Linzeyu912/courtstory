import base64
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from tactical_workbench import TacticalWorkbench, ROOT
try:
    from tactics_agent import TacticsAgent, build_codex_command, isolated_cli_environment, trusted_model_settings, agent_entity_inputs
except ImportError:
    TacticsAgent = build_codex_command = None


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(TacticsAgent, 'A real bound Agent adapter is required')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.tactics = TacticalWorkbench(self.folder / 'saved', node='D:/node.exe')
        script = "import {makePresentationDemo} from './engineering/tools/tactical-overlay/fixtures/presentation-demo.mjs';import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';console.log(JSON.stringify(await createTacticsDocument((await makePresentationDemo()).review)));"
        self.doc = json.loads(subprocess.check_output(['D:/node.exe', '--input-type=module', '-e', script], cwd=ROOT))
        review = self.doc['review']
        self.clip = {'video_sha256': review['videoSha256'], 'tracking_fingerprint': review['trackingFingerprint'],
                     'tracking_revision': review['trackingRevision'], 'width': review['width'], 'height': review['height'],
                     'frames': [dict(frame=f['frame'], time=f['time'], source_frame=f['sourceFrame'], source_time=f['sourceTime']) for f in review['sourceFrameMapping']]}
        self.tactics.frames = lambda _video, _clip, indices: [dict(frame=f, time=self.clip['frames'][f]['time'], dataUrl='data:image/jpeg;base64,' + base64.b64encode(b'fixture decoder boundary').decode()) for f in indices]
        self.output = {'summary': '切入', 'issues': [], 'phases': [{'title': '切入', 'startFrame': 0, 'endFrameExclusive': 61, 'freezeFrame': 12, 'reason': '未来跑位', 'evidenceFrames': [12, 20], 'actions': [], 'annotations': [{'type': 'route', 'entityId': 'P1', 'space': 'video', 'anchorFrame': 12, 'startFrame': 12, 'endFrameExclusive': 30, 'points': [{'x': 600, 'y': 400}, {'x': 720, 'y': 320}], 'angle': 0, 'size': 1, 'color': '#26baff', 'explanation': '切入', 'evidenceFrames': [12, 20]}]}]}
        self.request = dict(document=self.doc, expectedVersion=0, clientRevision=7, documentDigest=self.tactics.run('agent-digest', document=self.doc)['digest'], scope='play', phaseId='phase-1', goal='讲清楚切入')

    def make_agent(self, execute=None):
        agent = TacticsAgent(self.folder / 'agent', self.tactics, codex_path='D:/node.exe', execute=execute or (lambda **_kwargs: self.output))
        self.addCleanup(agent.close)
        return agent

    def wait(self, agent, job):
        for _ in range(100):
            result = agent.get(job['jobId'], self.clip, 'demo', True)
            if result['status'] in ('ready', 'failed', 'cancelled'):
                return result
            time.sleep(.03)
        self.fail('bounded fixture job failed to settle')

    def test_real_validator_accepts_candidate_and_adoption_is_idempotent_without_saving(self):
        agent = self.make_agent()
        job = agent.create(self.request, self.clip, self.folder/'video.mp4', 'demo', True)
        done = self.wait(agent, job)
        self.assertEqual(done['status'], 'ready', done)
        self.assertEqual(len(done['previewDocument']['annotations']['items']), 1)
        adopted = agent.adopt(job['jobId'], self.request, self.clip, 'demo', True)
        self.assertEqual(adopted, agent.adopt(job['jobId'], self.request, self.clip, 'demo', True))
        self.assertEqual(adopted['document']['review'], self.doc['review'])
        self.assertEqual(self.tactics.load(self.clip, 'demo', True, 'workspace')['version'], 0)

    def test_unsaved_revision_digest_saved_version_and_foreign_video_cannot_adopt(self):
        agent = self.make_agent(); job = agent.create(self.request, self.clip, self.folder/'video.mp4', 'demo', True)
        self.assertEqual(self.wait(agent, job)['status'], 'ready')
        for key, value in [('clientRevision', 8), ('documentDigest', '0'*64), ('expectedVersion', 1)]:
            with self.assertRaises(ValueError):
                agent.adopt(job['jobId'], {**self.request, key:value}, self.clip, 'demo', True)
        with self.assertRaises(ValueError):
            agent.get(job['jobId'], {**self.clip, 'video_sha256':'foreign'}, 'demo', True)
        self.tactics.save(self.doc, self.clip, 'demo', True, 'workspace', 0)
        with self.assertRaises(ValueError):
            agent.adopt(job['jobId'], self.request, self.clip, 'demo', True)

    def test_cancelled_and_malformed_results_never_become_ready(self):
        gate = threading.Event()
        def execute(**kwargs):
            gate.wait(2); return self.output
        agent = self.make_agent(execute)
        job = agent.create(self.request, self.clip, self.folder/'video.mp4', 'demo', True)
        agent.cancel(job['jobId'], self.clip, 'demo', True);gate.set()
        self.assertEqual(self.wait(agent, job)['status'], 'cancelled')
        with self.assertRaises(ValueError):agent.adopt(job['jobId'], self.request, self.clip, 'demo', True)
        other=self.make_agent(lambda **_: {'summary':'pretend complete'})
        bad=other.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        self.assertEqual(self.wait(other,bad)['status'],'failed')

    def test_command_never_inherits_write_permissions_or_enables_tools(self):
        command=build_codex_command('codex.exe',self.folder,self.folder/'schema.json',self.folder/'result.json',[self.folder/'frame.jpg'])
        self.assertIn('--ignore-user-config',command);self.assertIn('--ignore-rules',command)
        self.assertEqual(command[command.index('--sandbox')+1],'read-only')
        self.assertIn('--ephemeral',command);self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',command)
        self.assertIn('shell_tool',command);self.assertIn('plugins',command);self.assertIn('web_search="disabled"',command)
        self.assertIn('code_mode_host',command);self.assertIn('shell_snapshot',command)

    def test_child_does_not_inherit_parent_agent_session_overrides(self):
        original={'PATH':'runtime','CODEX_HOME':'auth-directory','CODEX_INTERNAL_ORIGINATOR_OVERRIDE':'desktop','CODEX_THREAD_ID':'parent-session'}
        child=isolated_cli_environment(original)
        self.assertEqual(child,{'PATH':'runtime','CODEX_HOME':'auth-directory'})
        self.assertEqual(original['CODEX_THREAD_ID'],'parent-session')

    def test_vision_input_keeps_motion_and_review_uncertainty_without_duplicate_audit_data(self):
        entities=[{'id':'P1','name':'player','role':'player','teamSide':'red','automaticTeamEvidence':[{'frame':0}]*1000,'courtTrajectory':[{'frame':1}]*1000,
                   'trajectory':[{'frame':1,'time':.1,'x':12,'y':34,'box':[1,2,3,4],'source':'manual_range','trackId':7,'frameIdentityConfirmed':False,'reviewRequired':True,'footMethod':'manual_range','rangeCorrection':{'operationId':'unchanged'}},
                                 {'frame':2,'time':.2,'x':None,'y':None,'source':'missing'}]}]
        before=deepcopy(entities);packed=agent_entity_inputs(entities,{1})
        self.assertEqual(entities,before);self.assertEqual(packed[0]['id'],'P1')
        self.assertNotIn('automaticTeamEvidence',packed[0]);self.assertNotIn('courtTrajectory',packed[0])
        point=packed[0]['trajectory'][0];self.assertEqual(point['frame'],1);self.assertEqual(point['box'],[1,2,3,4])
        self.assertEqual(point['source'],'manual_range');self.assertFalse(point['frameIdentityConfirmed']);self.assertTrue(point['reviewRequired'])
        self.assertEqual(len(packed[0]['trajectory']),1)

    def test_only_trusted_model_fields_and_child_proxy_are_loaded(self):
        config=self.folder/'config.toml';config.write_text('model="gpt-6-astra"\nmodel_reasoning_effort="medium"\napproval_policy="never"\nsandbox_mode="danger-full-access"\n',encoding='utf-8')
        self.assertEqual(trusted_model_settings(config),('gpt-6-astra','medium'))
        command=build_codex_command('codex.exe',self.folder,self.folder/'s.json',self.folder/'r.json',[],model='gpt-6-astra',effort='medium')
        self.assertEqual(command[command.index('--model')+1],'gpt-6-astra')
        self.assertNotIn('danger-full-access',command)
        with self.assertRaises(ValueError):build_codex_command('codex.exe',self.folder,'s','r',[],model='x --sandbox danger-full-access')
        original={'PATH':'abc'}
        child=isolated_cli_environment(original,proxy_server='127.0.0.1:7897')
        self.assertEqual(original,{'PATH':'abc'});self.assertEqual(child['HTTPS_PROXY'],'http://127.0.0.1:7897')
        existing=isolated_cli_environment({'https_proxy':'http://chosen:80'},proxy_server='127.0.0.1:7897')
        self.assertEqual(existing['https_proxy'],'http://chosen:80');self.assertNotIn('HTTPS_PROXY',existing)


if __name__ == '__main__':unittest.main()
