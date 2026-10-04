import base64
from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from tactical_workbench import TacticalWorkbench, ROOT
try:
    from tactics_agent import TacticsAgent, build_codex_command, isolated_cli_environment, trusted_model_settings, agent_entity_inputs, agent_prompt
except ImportError:
    TacticsAgent = build_codex_command = None


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(TacticsAgent, 'A real bound Agent adapter is required')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.node = shutil.which('node')
        self.assertIsNotNone(self.node, 'Node.js is required for the real tactical validator')
        self.tactics = TacticalWorkbench(self.folder / 'saved', node=self.node)
        script = "import {makePresentationDemo} from './engineering/tools/tactical-overlay/fixtures/presentation-demo.mjs';import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';console.log(JSON.stringify(await createTacticsDocument((await makePresentationDemo()).review)));"
        self.doc = json.loads(subprocess.check_output([self.node, '--input-type=module', '-e', script], cwd=ROOT))
        review = self.doc['review']
        self.clip = {'video_sha256': review['videoSha256'], 'tracking_fingerprint': review['trackingFingerprint'],
                     'tracking_revision': review['trackingRevision'], 'width': review['width'], 'height': review['height'],
                     'frames': [dict(frame=f['frame'], time=f['time'], source_frame=f['sourceFrame'], source_time=f['sourceTime']) for f in review['sourceFrameMapping']]}
        self.tactics.frames = lambda _video, _clip, indices: [dict(frame=f, time=self.clip['frames'][f]['time'], dataUrl='data:image/jpeg;base64,' + base64.b64encode(b'fixture decoder boundary').decode()) for f in indices]
        self.output = {'summary': '切入', 'issues': [], 'phases': [{'title': '切入', 'startFrame': 0, 'endFrameExclusive': 61, 'freezeFrame': 12, 'reason': '未来跑位', 'evidenceFrames': [12, 20], 'actions': [], 'annotations': [{'type': 'route', 'entityId': 'P1', 'space': 'video', 'anchorFrame': 12, 'startFrame': 12, 'endFrameExclusive': 30, 'points': [{'x': 600, 'y': 400}, {'x': 720, 'y': 320}], 'angle': 0, 'size': 1, 'color': '#26baff', 'explanation': '切入', 'evidenceFrames': [12, 20]}]}]}
        self.request = dict(document=self.doc, expectedVersion=0, clientRevision=7, documentDigest=self.tactics.run('agent-digest', document=self.doc)['digest'], scope='play', phaseId='phase-1', goal='讲清楚切入')

    def make_agent(self, execute=None):
        agent = TacticsAgent(self.folder / 'agent', self.tactics, codex_path=self.node, execute=execute or (lambda **_kwargs: self.output))
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

    def test_preview_uses_new_presentation_anchors_and_phase_freezes_in_batches_of_at_most_40(self):
        annotations=[]
        for frame in range(42):
            annotations.append({**deepcopy(self.output['phases'][0]['annotations'][0]), 'type':'screen', 'entityId':None,
                                'anchorFrame':frame, 'startFrame':frame, 'endFrameExclusive':frame+1,
                                'points':[{'x':300,'y':300}], 'evidenceFrames':[frame]})
        first={**deepcopy(self.output['phases'][0]),'startFrame':0,'endFrameExclusive':30,'freezeFrame':29,
               'evidenceFrames':[0,29],'annotations':annotations[:30]}
        second={**deepcopy(self.output['phases'][0]),'startFrame':30,'endFrameExclusive':61,'freezeFrame':60,
                'evidenceFrames':[30,60],'annotations':annotations[30:]}
        self.output['phases']=[first,second]
        calls=[];frames=self.tactics.frames
        def decode(video, clip, indices):
            self.assertLessEqual(len(indices),40);calls.append(list(indices))
            return frames(video,clip,indices)
        self.tactics.frames=decode
        agent=self.make_agent();job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job);self.assertEqual(done['status'],'ready',done)
        expected=[*range(42),60]
        self.assertEqual([f['frame'] for f in done['previewFrames']],expected)
        self.assertEqual([len(batch) for batch in calls[1:]],[40,3])
        self.assertEqual([p['frame'] for p in done['presentation']['pausePoints']],list(range(42)))
        self.assertTrue(all(item['visible'] for item in done['presentation']['items']))
        self.assertEqual(len(done['presentation']['items']),42)

    def test_cli_presentation_contains_only_this_jobs_drawings(self):
        self.doc['annotations']={'schemaVersion':1,'items':[]}
        prior=self.tactics.run('agent-adopt',document=self.doc,candidate=self.output,
                              options={'jobId':'prior','scope':'play','phaseId':'phase-1'})['document']
        phase_id=prior['playDefinition']['phases'][0]['phaseId']
        candidate=deepcopy(self.output);candidate['phases'][0]['annotations'][0]['anchorFrame']=20
        result=self.tactics.run('agent-adopt',document=prior,candidate=candidate,
                               options={'jobId':'current','scope':'phase','phaseId':phase_id})
        self.assertEqual(len(result['document']['annotations']['items']),2)
        self.assertEqual([i['id'] for i in result['presentation']['items']],['current-annotation-0'])
        self.assertEqual([p['frame'] for p in result['presentation']['pausePoints']],[20])

    def test_invisible_model_output_fails_before_ready_and_never_saves(self):
        self.output['phases'][0]['annotations'][0]['points']=[{'x':400,'y':400}]*2
        agent=self.make_agent();job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job);self.assertEqual(done['status'],'failed')
        self.assertIn('第 1 个图形',done['message']);self.assertIn('completed',done['message'])
        self.assertNotIn('previewDocument',done)
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['version'],0)

    def test_prompt_explains_anchor_pause_and_following_position_contract(self):
        prompt=agent_prompt({})
        self.assertIn('anchorFrame',prompt);self.assertIn('暂停',prompt)
        self.assertIn('跟随圈',prompt);self.assertIn('位置',prompt)
        self.assertIn('不必',prompt);self.assertIn('freezeFrame',prompt)

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

    def test_cli_timeout_distinguishes_network_failure_without_exposing_raw_logs(self):
        agent=self.make_agent()
        for log, expected in [('failed to refresh available models: request timed out; secret-fixture-value', '模型服务网络超时'),
                              ('failed to refresh available models: 401 Unauthorized; secret-fixture-value', 'Agent 超时'),
                              ('Reading prompt from stdin... secret-fixture-value', 'Agent 超时')]:
            class TimedOutProcess:
                def __init__(self, _command, **kwargs):
                    kwargs['stderr'].write(log);kwargs['stderr'].flush();self.calls=0
                def communicate(self, _prompt=None, timeout=None):
                    self.calls+=1
                    if self.calls==1:raise subprocess.TimeoutExpired('codex',timeout)
                    return '', ''
                def kill(self):pass
            job={'cancel':threading.Event(),'process':None}
            with patch('tactics_agent.subprocess.Popen',TimedOutProcess):
                with self.assertRaisesRegex(ValueError,expected) as caught:
                    agent._execute_cli(job=job,directory=self.folder,schema=self.folder/'schema.json',
                                       result=self.folder/'result.json',images=[],prompt='fixture')
            self.assertNotIn('secret-fixture-value',str(caught.exception))
            if 'request timed out' in log:self.assertNotIn('缩小',str(caught.exception))
            self.assertEqual((self.folder/'stderr.txt').read_text(encoding='utf-8'),log)
            self.assertIsNone(job['process'])

    def test_vision_input_keeps_motion_and_review_uncertainty_without_duplicate_audit_data(self):
        entities=[{'id':'P1','name':'player','role':'player','teamSide':'red','automaticTeamEvidence':[{'frame':0}]*1000,'courtTrajectory':[{'frame':1}]*1000,
                   'trajectory':[{'frame':1,'time':.1,'x':12,'y':34,'box':[1,2,3,4],'source':'manual_range','trackId':7,'frameIdentityConfirmed':False,'reviewRequired':True,'footMethod':'manual_range','rangeCorrection':{'operationId':'unchanged'}},
                                 {'frame':2,'time':.2,'x':None,'y':None,'source':'missing'}]}]
        before=deepcopy(entities);packed=agent_entity_inputs(entities,{1})
        self.assertIsInstance(packed,dict,'Sparse evidence must expose a shared row contract')
        self.assertEqual(entities,before);entity=packed['entities'][0];self.assertEqual(entity['id'],'P1')
        self.assertNotIn('automaticTeamEvidence',entity);self.assertNotIn('courtTrajectory',entity)
        point=dict(zip(packed['trajectoryInput']['columns'],entity['rows'][0]));self.assertEqual(point['frame'],1);self.assertEqual(point['box'],[1,2,3,4])
        self.assertEqual(point['source'],'manual_range');self.assertFalse(point['frameIdentityConfirmed']);self.assertTrue(point['reviewRequired'])
        self.assertEqual(len(entity['rows']),1)
        self.assertEqual(entity['missingFrames'],[])

    def test_sparse_input_preserves_confirmed_missing_excluded_and_conflict_semantics(self):
        ordinary={'x':None,'y':None,'source':'missing','frameIdentityConfirmed':False,
                  'identityConfirmed':False,'identityReviewRequired':True}
        points=[dict(frame=0,time=0,**ordinary),
                dict(frame=1,time=.1,**ordinary,reviewExcluded=True),
                {**ordinary,'frame':2,'time':.2,'frameIdentityConfirmed':True,'identityConfirmed':True,'identityReviewRequired':False},
                {'frame':3,'time':.3,'source':'conflict','x':None,'y':None,'identitySource':'human_range_replacement','reviewRequired':True},
                {'frame':4,'time':.4,'source':'tracked','x':10.123456,'y':20.654321,'box':[1,2,3,4],'trackId':7,
                 'identitySource':'human','frameIdentityConfirmed':True,'identityConfirmed':True,'identityReviewRequired':False}]
        before=deepcopy(points);packed=agent_entity_inputs([{'id':'P1','trajectory':points}],set(range(5)))
        self.assertIsInstance(packed,dict,'Sparse evidence must expose a shared row contract')
        self.assertEqual(points,before)
        self.assertEqual(packed['entities'][0]['missingFrames'],[0])
        self.assertEqual(packed['trajectoryInput']['missingFrameValues'],ordinary)
        rows=[dict(zip(packed['trajectoryInput']['columns'],row)) for row in packed['entities'][0]['rows']]
        self.assertEqual([p['frame'] for p in rows],[1,2,3,4])
        self.assertTrue(rows[0]['reviewExcluded'])
        self.assertTrue(rows[1]['frameIdentityConfirmed']);self.assertFalse(rows[1]['identityReviewRequired'])
        self.assertEqual(rows[2]['source'],'conflict');self.assertEqual(rows[2]['identitySource'],'human_range_replacement')
        self.assertEqual(rows[3]['x'],10.123456);self.assertEqual(rows[3]['trackId'],7)
        self.assertTrue(rows[3]['identityConfirmed']);self.assertFalse(rows[3]['identityReviewRequired'])

    def test_sparse_input_reduces_long_missing_sequences_without_dropping_observed_frames(self):
        points=[dict(frame=f,time=f/30,x=None,y=None,source='missing',frameIdentityConfirmed=False,
                     identityConfirmed=False,identityReviewRequired=True) for f in range(1000)]
        for f in range(0,1000,5):
            points[f].update(x=f+.25,y=f+.5,box=[1,2,3,4],trackId=7,source='tracked',
                             identitySource='model_suggestion',reviewRequired=True,footMethod='bbox_bottom_center')
        entities=[{'id':'P1','trajectory':points}]
        packed=agent_entity_inputs(entities,set(range(1000)))
        self.assertIsInstance(packed,dict,'Sparse evidence must expose a shared row contract')
        self.assertEqual(len(packed['entities'][0]['rows']),200)
        self.assertEqual(len(packed['entities'][0]['missingFrames']),800)
        self.assertLess(len(json.dumps(packed)),len(json.dumps(entities))*.4)

    def test_identity_reference_is_source_checked_and_does_not_change_frame_confirmation(self):
        self.clip['frames'][1]['tracks']=[[1,2,3,4,7,.8,2]]
        reference=dict(version=1,videoHash=self.clip['video_sha256'],trackingFingerprint=self.clip['tracking_fingerprint'],
                       frame=1,trackId=7,box=[1,2,3,4],team='purple',jersey='10')
        entity=dict(id='P1',identityReference=reference,trajectory=[dict(frame=2,time=.2,x=5,y=6,trackId=7,
                    source='tracked',frameIdentityConfirmed=False,identityConfirmed=False,identityReviewRequired=True)])
        try:
            packed=agent_entity_inputs([entity],{2},clip=self.clip)
        except TypeError as exc:
            self.fail(f'Source validation must accept the registered clip: {exc}')
        self.assertEqual(packed['entities'][0]['identityReference'],reference)
        point=dict(zip(packed['trajectoryInput']['columns'],packed['entities'][0]['rows'][0]))
        self.assertFalse(point['frameIdentityConfirmed']);self.assertTrue(point['identityReviewRequired'])
        for changed in ({**reference,'videoHash':'foreign'},{**reference,'box':[0,2,3,4]}):
            entity['identityReference']=changed
            self.assertNotIn('identityReference',agent_entity_inputs([entity],{2},clip=self.clip)['entities'][0])

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
