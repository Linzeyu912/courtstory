import base64
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from PIL import Image

from tactical_workbench import TacticalWorkbench, ROOT
try:
    from tactics_agent import TacticsAgent, AgentFailure, analysis_stages, video_evidence_selection, build_codex_command, isolated_cli_environment, trusted_model_settings, agent_entity_inputs, agent_prompt, model_image_inputs, model_contact_sheet_inputs
except ImportError:
    TacticsAgent = build_codex_command = None


def fixture_jpeg(width, height):
    buffer=io.BytesIO();Image.new('RGB',(width,height),(80,120,160)).save(buffer,format='JPEG',quality=94)
    return buffer.getvalue()


class AgentPromptTests(unittest.TestCase):
    def test_v4_compact_prompt_preserves_all_evidence_and_input_while_rounding_pixel_view_only(self):
        columns=['frame','time','x','y','box','source','frameIdentityConfirmed','identityReviewRequired']
        pack={'candidateVersion':4,'trajectoryInput':{'columns':columns},'participantRequirements':['P1','P2'],
              'evidenceFrames':[0,12,30], 'sampling':{'unsampledEntityIds':['P2'],'cutFrames':[12]},
              'sourceFrameMapping':[{'frame':0,'time':0.123456789,'sourceFrame':8,'sourceTime':8.123456789}],
              'images':[{'frame':12,'time':0.456789,'sha256':'source-digest'}],
              'entities':[{'id':'P1','missingFrames':[30],'rows':[
                  [0,0.123456789,123.456789123,987.654321987,[111.123456789,900.345678901,145.567890123,988.987654321],'tracked',False,True],
                  [12,0.456789123,None,None,None,'missing',False,True]]},
                  {'id':'P2','rows':[],'missingFrames':[0,12,30]}]}
        before=deepcopy(pack);prompt=agent_prompt(pack);view=json.loads(prompt.split('输入如下：\n',1)[1])
        self.assertEqual(pack,before);self.assertEqual(view['participantRequirements'],pack['participantRequirements'])
        for key in ('evidenceFrames','sampling'):self.assertEqual(view[key],pack[key])
        self.assertEqual(len(view['entities']),len(pack['entities']))
        for compact,original in zip(view['entities'],pack['entities']):
            self.assertEqual(compact['id'],original['id']);self.assertEqual(compact['missingFrames'],original['missingFrames'])
            self.assertEqual(len(compact['rows']),len(original['rows']))
            for row,old in zip(compact['rows'],original['rows']):
                self.assertEqual(row[0],old[0]);self.assertEqual(row[5:],old[5:])
                self.assertLess(abs(row[1]-old[1]),.001)
                for index in (2,3):
                    if old[index] is None:self.assertIsNone(row[index])
                    else:self.assertLess(abs(row[index]-old[index]),.1)
                if old[4] is not None:
                    for coordinate,source in zip(row[4],old[4]):self.assertLess(abs(coordinate-source),.1)
        self.assertEqual(view['sourceFrameMapping'][0]['frame'],0);self.assertEqual(view['sourceFrameMapping'][0]['sourceFrame'],8)
        self.assertEqual(view['images'][0]['sha256'],'source-digest')
        self.assertIn('紧凑单行 JSON',prompt);self.assertIn('issues 最多6条',prompt)
        self.assertIn('不减少任何应覆盖的参与者、图形或依据帧',prompt);self.assertIn('entityId=null',prompt)
        self.assertNotIn('123.456789123',prompt)


class ModelImageInputTests(unittest.TestCase):
    def frames(self, count=5):
        buffer=io.BytesIO();Image.effect_noise((2560,1440),4).convert('RGB').save(buffer,format='JPEG',quality=94)
        data=buffer.getvalue();digest=hashlib.sha256(data).hexdigest()
        return [dict(frame=f,time=f/60,sourceFrame=f,sourceTime=f/60,videoSha256='unchanged-video',
                     sha256=digest,dataUrl='data:image/jpeg;base64,'+base64.b64encode(data).decode()) for f in range(count)]

    def test_model_jpegs_preserve_dimensions_frames_and_source_provenance(self):
        frames=self.frames();before=deepcopy(frames)
        images,encoding=model_image_inputs(frames,2560,1440)
        self.assertEqual(frames,before);self.assertLessEqual(encoding['totalImageBytes'],1_572_864)
        self.assertEqual(encoding['coordinateTransform'],'identity');self.assertFalse(encoding['resized'])
        self.assertEqual(len(images),5)
        for (metadata,data),source in zip(images,frames):
            self.assertEqual(Image.open(io.BytesIO(data)).size,(2560,1440))
            self.assertEqual(metadata['sha256'],hashlib.sha256(data).hexdigest())
            self.assertEqual(metadata['modelImageSha256'],metadata['sha256']);self.assertEqual(metadata['modelImageBytes'],len(data))
            self.assertEqual(metadata['sourceImageSha256'],source['sha256']);self.assertEqual(metadata['videoSha256'],'unchanged-video')
            self.assertEqual(metadata['frame'],source['frame']);self.assertEqual(metadata['sourceTime'],source['sourceTime'])
            self.assertIn(metadata['modelImageQuality'],(80,70,60))

    def test_adaptive_quality_and_budget_failure_do_not_drop_evidence_frames(self):
        frames=self.frames(count=1)
        _,first=model_image_inputs(frames,2560,1440,byte_budget=10_000_000)
        images,second=model_image_inputs(frames,2560,1440,byte_budget=first['totalImageBytes']-1)
        self.assertEqual(first['quality'],80);self.assertEqual(second['quality'],70)
        self.assertEqual(len(images),1)
        with self.assertRaises(AgentFailure) as caught:model_image_inputs(frames,2560,1440,byte_budget=1)
        self.assertEqual(caught.exception.code,'image_budget');self.assertFalse(caught.exception.retryable)

    def test_invalid_source_jpeg_dimensions_or_digest_are_rejected(self):
        frame=self.frames(count=1)[0]
        for bad,width in [(dict(frame,sha256='wrong'),2560),(frame,1280),
                          (dict(frame,dataUrl='data:image/jpeg;base64,'+base64.b64encode(b'not jpeg').decode()),2560)]:
            with self.assertRaises(AgentFailure) as caught:model_image_inputs([bad],width,1440)
            self.assertEqual(caught.exception.code,'image_input')

    def test_contact_sheet_preserves_every_selected_frame_source_bytes_and_original_coordinate_contract(self):
        source=fixture_jpeg(1920,1080);digest=hashlib.sha256(source).hexdigest()
        frame_ids=[0,171,342,513,684]
        frames=[dict(frame=f,time=f/60,sha256=digest,dataUrl='data:image/jpeg;base64,'+base64.b64encode(source).decode()) for f in frame_ids]
        before=deepcopy(frames);encoded,encoding=model_image_inputs(frames,1920,1080);encoded_before=deepcopy(encoded)
        sheet,contract=model_contact_sheet_inputs(encoded,1920,1080)
        self.assertEqual(frames,before);self.assertEqual(encoded,encoded_before)
        self.assertEqual([tile['frame'] for tile in contract['tiles']],frame_ids)
        self.assertEqual(contract['sheetSize'],{'width':1536,'height':1392})
        self.assertEqual(contract['sha256'],hashlib.sha256(sheet).hexdigest());self.assertEqual(contract['bytes'],len(sheet))
        self.assertEqual(Image.open(io.BytesIO(sheet)).size,(1536,1392))
        for tile,(metadata,data) in zip(contract['tiles'],encoded):
            self.assertEqual(tile['sourceSize'],{'width':1920,'height':1080});self.assertEqual(tile['scale'],{'x':.4,'y':.4})
            self.assertEqual(tile['sourceImageSha256'],digest);self.assertEqual(tile['modelImageSha256'],hashlib.sha256(data).hexdigest())
            for x,y in [(0,0),(1234.5,678.9),(1920,1080)]:
                sheet_x=tile['rect']['x']+x*tile['scale']['x'];sheet_y=tile['rect']['y']+y*tile['scale']['y']
                self.assertAlmostEqual((sheet_x-tile['rect']['x'])/tile['scale']['x'],x)
                self.assertAlmostEqual((sheet_y-tile['rect']['y'])/tile['scale']['y'],y)
        pack={'candidateVersion':4,'images':[metadata for metadata,_ in encoded], 'imageEncoding':{**encoding,'inputMode':'contact_sheet','contactSheet':contract}}
        prompt=agent_prompt(pack);self.assertIn('禁止把联系表坐标当原图坐标',prompt);self.assertIn('original_x=(sheet_x-rect.x)/scale.x',prompt)
        range_pack={**pack,'candidateVersion':3};self.assertNotIn('唯一附图是 contact sheet',agent_prompt(range_pack))

    def test_contact_sheet_rejects_duplicate_frames_changed_bytes_and_impossible_budget_without_dropping_frames(self):
        frame=self.frames(count=1);encoded,_=model_image_inputs(frame,2560,1440)
        for images,budget in [(encoded+encoded,1_572_864), ([(encoded[0][0],b'wrong bytes')],1_572_864),(encoded,1)]:
            with self.assertRaises(AgentFailure):model_contact_sheet_inputs(images,2560,1440,byte_budget=budget)

    def test_contact_sheet_transport_budget_does_not_reject_larger_retained_original_size_copies(self):
        buffer=io.BytesIO();Image.effect_noise((2560,1440),10).convert('RGB').save(buffer,format='JPEG',quality=94)
        data=buffer.getvalue();digest=hashlib.sha256(data).hexdigest()
        frames=[dict(frame=f,sha256=digest,dataUrl='data:image/jpeg;base64,'+base64.b64encode(data).decode()) for f in range(5)]
        before=deepcopy(frames)
        # V3 still sends these independent copies and retains its actual limit.
        with self.assertRaises(AgentFailure) as caught:model_image_inputs(frames,2560,1440)
        self.assertEqual(caught.exception.code,'image_budget')
        encoded,encoding=model_image_inputs(frames,2560,1440,byte_budget=None)
        self.assertGreater(encoding['totalImageBytes'],1_572_864);self.assertIsNone(encoding['maxTotalImageBytes'])
        sheet,contract=model_contact_sheet_inputs(encoded,2560,1440)
        self.assertLessEqual(len(sheet),1_572_864);self.assertEqual(len(contract['tiles']),5)
        self.assertEqual(frames,before)


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
        jpeg=fixture_jpeg(self.clip['width'],self.clip['height'])
        self.tactics.frames = lambda _video, _clip, indices, **_kwargs: [dict(frame=f, time=self.clip['frames'][f]['time'], dataUrl='data:image/jpeg;base64,' + base64.b64encode(jpeg).decode()) for f in indices]
        self.output = {'summary': '切入', 'issues': [], 'phases': [{'title': '切入', 'startFrame': 0, 'endFrameExclusive': 61, 'freezeFrame': 12, 'reason': '未来跑位', 'evidenceFrames': [12, 20], 'actions': [], 'annotations': [{'type': 'route', 'entityId': 'P1', 'space': 'video', 'anchorFrame': 12, 'startFrame': 12, 'endFrameExclusive': 30, 'points': [{'x': 600, 'y': 400}, {'x': 720, 'y': 320}], 'angle': 0, 'size': 1, 'color': '#26baff', 'explanation': '切入', 'evidenceFrames': [12, 20]}]}]}
        self.request = dict(document=self.doc, expectedVersion=0, clientRevision=7, documentDigest=self.tactics.run('agent-digest', document=self.doc)['digest'], scope='play', phaseId='phase-1', goal='讲清楚切入')

    def make_agent(self, execute=None):
        agent = TacticsAgent(self.folder / 'agent', self.tactics, use_visual_facts=False,codex_path=self.node, execute=execute or (lambda **_kwargs: self.output))
        self.addCleanup(agent.close)
        return agent

    def wait(self, agent, job):
        for _ in range(500):
            result = agent.get(job['jobId'], self.clip, 'demo', True)
            if result['status'] in ('ready', 'partial', 'failed', 'cancelled') and not agent.jobs[job['jobId']].get('running'):
                return result
            time.sleep(.03)
        self.fail('bounded fixture job failed to settle')

    def test_real_validator_accepts_candidate_and_adoption_is_idempotent_without_saving(self):
        agent = self.make_agent()
        self.assertEqual(agent.timeout,300,'legacy/V3 tactics retain their own 300-second budget')
        job = agent.create(self.request, self.clip, self.folder/'video.mp4', 'demo', True)
        done = self.wait(agent, job)
        self.assertEqual(done['status'], 'ready', done)
        self.assertEqual(done['progress']['budgetSeconds'],300)
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

    def test_failed_candidate_gets_one_model_repair_without_patching_draft(self):
        calls=[];models=[]
        invalid=deepcopy(self.output);invalid['phases'][0]['annotations'][0]['points']=[{'x':400,'y':400}]*2
        def execute(**kwargs):
            calls.append(kwargs['prompt'])
            models.append(kwargs['job'].get('callModel'))
            return invalid if len(calls)==1 else self.output
        agent=self.make_agent(execute)
        done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done)
        self.assertEqual(len(calls),2)
        self.assertIn('validationError',calls[1])
        self.assertEqual(models,[None,None], 'Validation repair must keep the configured primary model')
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['version'],0)

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
                              ('failed to refresh available models: 401 Unauthorized; secret-fixture-value', '没有返回分析内容'),
                              ('Reading prompt from stdin... secret-fixture-value', '没有返回分析内容')]:
            class TimedOutProcess:
                def __init__(self, _command, **kwargs):
                    kwargs['stderr'].write(log);kwargs['stderr'].flush();self.calls=0;self.killed=False
                def communicate(self, _prompt=None, timeout=None):
                    self.calls+=1
                    if not self.killed:raise subprocess.TimeoutExpired('codex',timeout)
                    return '', ''
                def kill(self):self.killed=True
            job={'cancel':threading.Event(),'process':None,'callTimeout':.001}
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

    def test_terminal_cli_events_classify_failure_even_when_stderr_is_empty(self):
        agent=self.make_agent()
        for message, code, retryable in [('401 Unauthorized secret-fixture', 'authentication_or_quota', False),
                                         ('stream disconnected secret-fixture', 'transport', True),
                                         ('model not found secret-fixture', 'model_configuration', False),
                                         ('unexpected provider error secret-fixture', 'model_error', True)]:
            class FailedProcess:
                def __init__(self, _command, **kwargs):
                    kwargs['stdout'].write(json.dumps({'type':'turn.failed','error':{'message':message}})+'\n');kwargs['stdout'].flush()
                    self.returncode=0
                def communicate(self, _prompt=None, timeout=None):return '', ''
                def kill(self):pass
            with patch('tactics_agent.subprocess.Popen',FailedProcess):
                with self.assertRaises(AgentFailure) as caught:
                    agent._execute_cli(job={'cancel':threading.Event(),'process':None},directory=self.folder,
                                       schema=self.folder/'schema.json',result=self.folder/'result.json',images=[],prompt='fixture')
            self.assertEqual(caught.exception.code,code);self.assertEqual(caught.exception.retryable,retryable)
            self.assertNotIn('secret-fixture',str(caught.exception))

    def test_cli_item_error_warning_does_not_reject_a_successful_result(self):
        agent=self.make_agent();result=self.folder/'result.json'
        class SuccessfulProcess:
            def __init__(self, _command, **kwargs):
                for event in [{'type':'thread.started'}, {'type':'item.completed','item':{'type':'error','message':'Code Mode unavailable'}},
                              {'type':'item.completed','item':{'type':'agent_message','text':'structured result'}}, {'type':'turn.completed'}]:
                    kwargs['stdout'].write(json.dumps(event)+'\n')
                kwargs['stdout'].flush();result.write_text(json.dumps({'summary':'valid fixture'}),encoding='utf-8');self.returncode=0
            def communicate(self, _prompt=None, timeout=None):return '', ''
            def kill(self):pass
        with patch('tactics_agent.subprocess.Popen',SuccessfulProcess):
            output=agent._execute_cli(job={'cancel':threading.Event(),'process':None},directory=self.folder,
                                      schema=self.folder/'schema.json',result=result,images=[],prompt='fixture')
        self.assertEqual(output,{'summary':'valid fixture'})
        runtime=json.loads((self.folder/'runtime.json').read_text(encoding='utf-8'))
        self.assertTrue(runtime['modelOutputSeen']);self.assertTrue(runtime['sessionStarted']);self.assertEqual(runtime['eventCount'],4)

    def test_startup_events_alone_trigger_no_response_and_preserve_diagnostics(self):
        agent=self.make_agent();agent.no_response_timeout=.005
        class SilentProcess:
            def __init__(self, _command, **kwargs):
                kwargs['stdout'].write('{"type":"thread.started"}\n{"type":"turn.started"}\n');kwargs['stdout'].flush();self.killed=False
            def communicate(self, _prompt=None, timeout=None):
                if self.killed:return '', ''
                time.sleep(timeout);raise subprocess.TimeoutExpired('fixture',timeout)
            def kill(self):self.killed=True
        with patch('tactics_agent.subprocess.Popen',SilentProcess):
            with self.assertRaises(AgentFailure) as caught:
                agent._execute_cli(job={'cancel':threading.Event(),'process':None,'callTimeout':.02},directory=self.folder,
                                   schema=self.folder/'schema.json',result=self.folder/'result.json',images=[],prompt='fixture')
        self.assertEqual(caught.exception.code,'no_response')
        runtime=json.loads((self.folder/'runtime.json').read_text(encoding='utf-8'))
        self.assertFalse(runtime['modelOutputSeen']);self.assertTrue(runtime['sessionStarted']);self.assertEqual(runtime['phase'],'failed')

    def test_complete_malformed_event_line_cannot_hide_a_forbidden_tool(self):
        agent=self.make_agent()
        class ForbiddenProcess:
            def __init__(self, _command, **kwargs):
                kwargs['stdout'].write('not json\n'+json.dumps({'type':'item.started','item':{'type':'command_execution','command':'forbidden'}})+'\n')
                kwargs['stdout'].flush();self.returncode=0
            def communicate(self, _prompt=None, timeout=None):return '', ''
            def kill(self):pass
        with patch('tactics_agent.subprocess.Popen',ForbiddenProcess):
            with self.assertRaises(AgentFailure) as caught:
                agent._execute_cli(job={'cancel':threading.Event(),'process':None},directory=self.folder,
                                   schema=self.folder/'schema.json',result=self.folder/'result.json',images=[],prompt='fixture')
        self.assertEqual(caught.exception.code,'forbidden_tool');self.assertFalse(caught.exception.retryable)

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

    def video_output(self, pack):
        start, end = pack['analysisRange'].values()
        anchor = pack['images'][0]['frame']
        annotation = dict(type='spotlight', entityId=None, space='video', anchorFrame=anchor, startFrame=start, endFrameExclusive=end,
                          points=[{'x':600,'y':400}], angle=0, size=1, color='#26baff', explanation='仅暂停帧可见的局部参与者', evidenceFrames=[anchor], authoredPath=None)
        participants = [dict(subjectId='local-visible-player', entityId=None, label='局部可见参与者', role='off_ball', disposition='annotated',
                             annotationIndexes=[0], evidenceFrames=[anchor], reason='不声明连续身份')]
        participants.extend(dict(subjectId=f'uncertain-{id}', entityId=id, label=id, role='other', disposition='uncertain',
                                 annotationIndexes=[], evidenceFrames=[anchor], reason='身份或参与动作需人工判断') for id in pack['participantRequirements'])
        return dict(schemaVersion=4, summary='原视频多人局部草稿', issues=[], production=None,
                    phases=[dict(title='局部阶段', startFrame=start, endFrameExclusive=end, freezeFrame=anchor, reason='局部画面证据',
                                 evidenceFrames=[anchor], actions=[], annotations=[annotation], participants=participants)])

    def split_agent_job(self, execute, timeout=300):
        agent=TacticsAgent(self.folder/'split-jobs',self.tactics,use_visual_facts=False,codex_path=self.node,execute=execute,timeout=timeout)
        self.addCleanup(agent.close)
        stages=[dict(stageId=f'stage-{i+1}',startFrame=a,endFrameExclusive=b,status='queued',message='等待',attempts=0) for i,(a,b) in enumerate([(0,30),(30,61)])]
        with patch('tactics_agent.analysis_stages',return_value=stages):
            job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        return agent,job

    def test_direct_video_input_excludes_camera_payload_and_preserves_all_observed_slots(self):
        packs=[]
        def execute(**kwargs):
            pack=json.loads(kwargs['prompt'].split('输入如下：\n',1)[1]);packs.append(pack)
            return self.video_output(pack)
        agent=self.make_agent(execute)
        done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done)
        pack=packs[0];self.assertEqual(pack['candidateVersion'],4)
        self.assertNotIn('court',pack);self.assertNotIn('existingProduction',pack);self.assertNotIn('styleReferences',pack)
        self.assertEqual(pack['participantRequirements'],['P1','P2','P3','P4','P5','P6'])
        self.assertLessEqual(len(pack['images']),4);self.assertLessEqual(len(pack['evidenceFrames']),16)
        self.assertTrue({f['frame'] for f in pack['images']}<=set(pack['evidenceFrames']))
        self.assertTrue(all(len(e['rows'])+len(e['missingFrames'])<=16 for e in pack['entities']))
        self.assertEqual(done['stages'][0]['coverage'][0]['annotated'],1)
        self.assertEqual(done['stages'][0]['coverage'][0]['uncertain'],6)
        self.assertTrue(done['manualFallback']);self.assertFalse(done['canRetry'])

    def test_partial_draft_survives_restart_and_retry_runs_only_the_failed_segment(self):
        calls=[];allow_second=False
        def execute(**kwargs):
            pack=json.loads(kwargs['prompt'].split('输入如下：\n',1)[1]);start=pack['analysisRange']['startFrame'];calls.append((start,kwargs['directory']))
            if start and not allow_second:raise AgentFailure('transport','模拟连接中断')
            return self.video_output(pack)
        agent,job=self.split_agent_job(execute);done=self.wait(agent,job)
        self.assertEqual(done['status'],'partial',done);self.assertEqual([s['status'] for s in done['stages']],['ready','failed'])
        self.assertEqual([s for s,_ in calls],[0,30,30]);self.assertEqual(len(set(p for _,p in calls)),3)
        self.assertEqual(len(done['previewDocument']['annotations']['items']),1)
        self.assertIn('待人工补充',done['candidate']['phases'][1]['title'])
        self.assertEqual(done['failure']['code'],'transport');self.assertTrue(done['canRetry'])
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['version'],0)
        before=(agent.folder/job['jobId']/'stage-1/attempt-1/candidate.json').read_bytes()
        agent.close()
        resumed=TacticsAgent(agent.folder,self.tactics,use_visual_facts=False,codex_path=self.node,execute=execute);self.addCleanup(resumed.close)
        restored=resumed.get(job['jobId'],self.clip,'demo',True);self.assertEqual(restored['candidate'],done['candidate'])
        with self.assertRaises(ValueError):resumed.retry(job['jobId'],{**self.request,'goal':'changed'},self.clip,'demo',True)
        allow_second=True
        final=self.wait(resumed,resumed.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(final['status'],'ready',final);self.assertEqual([s for s,_ in calls],[0,30,30,30])
        self.assertEqual(before,(resumed.folder/job['jobId']/'stage-1/attempt-1/candidate.json').read_bytes())
        self.assertEqual(len(final['previewDocument']['annotations']['items']),2)
        adopted=resumed.adopt(job['jobId'],self.request,self.clip,'demo',True)
        self.assertEqual(len(adopted['document']['annotations']['items']),2)
        with self.assertRaises(ValueError):resumed.retry(job['jobId'],self.request,self.clip,'demo',True)

    def test_cancel_during_later_segment_does_not_revive_or_erase_completed_draft(self):
        gate=threading.Event();entered=threading.Event()
        def execute(**kwargs):
            pack=json.loads(kwargs['prompt'].split('输入如下：\n',1)[1])
            if pack['analysisRange']['startFrame']:
                entered.set();gate.wait(5)
            return self.video_output(pack)
        agent,job=self.split_agent_job(execute)
        self.assertTrue(entered.wait(10),'second segment should start after first has been published')
        cancelled=agent.cancel(job['jobId'],self.clip,'demo',True)
        self.assertEqual(cancelled['status'],'cancelled');self.assertEqual(len(cancelled['previewDocument']['annotations']['items']),1)
        gate.set();done=self.wait(agent,job)
        self.assertEqual(done['status'],'cancelled');self.assertEqual(done['progress']['completed'],1)
        with self.assertRaises(ValueError):agent.adopt(job['jobId'],self.request,self.clip,'demo',True)

    def test_budget_is_shared_and_cannot_start_repairs_after_expiry(self):
        calls=[]
        def execute(**kwargs):
            calls.append(kwargs['job']['callTimeout'])
            kwargs['job']['deadline']=time.monotonic()-.1
            raise AgentFailure('transport','模拟连接中断')
        agent,job=self.split_agent_job(execute,timeout=10);done=self.wait(agent,job)
        self.assertEqual(done['status'],'failed',done);self.assertEqual(len(calls),1)
        self.assertLess(calls[0],5);self.assertEqual(done['failure']['code'],'transport')
        self.assertEqual(done['stages'][0]['failure']['code'],'transport');self.assertTrue(done['stages'][0]['retryBudgetExhausted'])
        self.assertIn('模拟连接中断',done['stages'][0]['message']);self.assertEqual(done['stages'][1]['failure']['code'],'budget_exhausted')

    def test_first_pass_reserves_budget_and_both_failed_stages_get_one_retry(self):
        calls=[]
        def execute(**kwargs):
            calls.append((kwargs['directory'].parent.name,kwargs['job']['callTimeout']))
            raise AgentFailure('no_response','没有模型内容')
        agent,job=self.split_agent_job(execute,timeout=300);done=self.wait(agent,job)
        self.assertEqual([stage for stage,_ in calls],['stage-1','stage-2','stage-1','stage-2'])
        self.assertLessEqual(calls[0][1],120);self.assertLessEqual(calls[1][1],240)
        self.assertEqual([s['attempts'] for s in done['stages']],[2,2])
        self.assertFalse(done['stages'][0].get('retryBudgetExhausted',False))
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['version'],0)

    def test_alternate_model_is_used_for_auto_and_manual_execution_retries_only(self):
        models=[];allow_result=False
        def execute(**kwargs):
            models.append(kwargs['job'].get('callModel'))
            if not allow_result:raise AgentFailure('timeout','本地等待超时')
            return self.output
        agent=self.make_agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        failed=self.wait(agent,job)
        self.assertEqual(models,[None,'gpt-6.1-sol']);self.assertEqual(failed['status'],'failed')
        self.assertEqual(failed['stages'][0]['runtime']['retryMode'],'alternate_model')
        self.assertEqual(failed['stages'][0]['runtime']['model'],'gpt-6.1-sol')
        self.assertEqual(agent.status()['retryModel'],'gpt-6.1-sol')
        allow_result=True
        final=self.wait(agent,agent.retry(job['jobId'],self.request,self.clip,'demo',True))
        self.assertEqual(final['status'],'ready',final);self.assertEqual(models,[None,'gpt-6.1-sol','gpt-6.1-sol'])
        self.assertEqual(self.tactics.load(self.clip,'demo',True,'workspace')['version'],0)

    def test_cli_command_records_actual_alternate_model_and_rejects_unsupported_model(self):
        agent=self.make_agent();commands=[]
        class UnsupportedProcess:
            def __init__(self, command, **kwargs):
                commands.append(command)
                kwargs['stdout'].write(json.dumps({'type':'turn.failed','error':{'message':"The requested model 'gpt-6.1-sol' does not exist"}})+'\n')
                kwargs['stdout'].flush();self.returncode=1
            def communicate(self, _prompt=None, timeout=None):return '', ''
            def kill(self):pass
        with patch('tactics_agent.trusted_model_settings',return_value=('gpt-6-astra','low')), patch('tactics_agent.subprocess.Popen',UnsupportedProcess):
            with self.assertRaises(AgentFailure) as caught:
                agent._execute_cli(job={'cancel':threading.Event(),'process':None,'callModel':'gpt-6.1-sol'},directory=self.folder,
                                   schema=self.folder/'schema.json',result=self.folder/'result.json',images=[],prompt='fixture')
        command=commands[0];self.assertEqual(command[command.index('--model')+1],'gpt-6.1-sol')
        self.assertEqual(caught.exception.code,'model_configuration');self.assertFalse(caught.exception.retryable)
        runtime=json.loads((self.folder/'runtime.json').read_text(encoding='utf-8'))
        self.assertEqual(runtime['model'],'gpt-6.1-sol')

    def test_local_model_override_and_identical_retry_model_do_not_fake_a_switch(self):
        calls=[]
        def execute(**kwargs):
            stage=kwargs['job']['stages'][0]
            calls.append((kwargs['job'].get('callModel'),stage['runtime']['model']))
            if len(calls)==1:raise AgentFailure('no_response','没有返回内容')
            return self.output
        agent=TacticsAgent(self.folder/'override-agent',self.tactics,use_visual_facts=False,codex_path=self.node,execute=execute,model_override='gpt-6.1-sol')
        self.addCleanup(agent.close)
        with patch('tactics_agent.trusted_model_settings',return_value=('gpt-6-astra','low')):
            self.assertEqual(agent.status()['model'],'gpt-6.1-sol')
            done=self.wait(agent,agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True))
        self.assertEqual(done['status'],'ready',done);self.assertEqual(calls,[(None,'gpt-6.1-sol'),(None,'gpt-6.1-sol')])
        self.assertEqual(done['stages'][0]['runtime']['retryMode'],'same_model')
        self.assertEqual(done['progress']['firstPassBudgetSeconds'],240);self.assertEqual(done['progress']['retryReserveSeconds'],60)

    def test_lighter_retry_keeps_mandatory_cuts_and_all_motion_evidence(self):
        agent=self.make_agent()
        pack={'analysisRange':{'startFrame':0,'endFrameExclusive':61},
              'images':[{'frame':f} for f in [0,10,20,29,30,40,50,60]],
              'playDefinition':{'phases':[{'freezeFrame':20}]},'sampling':{'cutFrames':[30]},
              'evidenceFrames':list(range(61)),'entities':[{'id':'P1','rows':[[0,1],[60,2]]}],
              'participantRequirements':['P1','P2']}
        images=[Path(f'frame-{item["frame"]}.jpg') for item in pack['images']];before=deepcopy(pack)
        reduced,paths=agent._lighter_retry_input(pack,images)
        self.assertEqual(pack,before);self.assertEqual({item['frame'] for item in reduced['images']},{0,20,29,30,60})
        for key in ('evidenceFrames','entities','participantRequirements'):self.assertEqual(reduced[key],pack[key])
        self.assertEqual(paths,[images[i] for i in [0,2,3,4,7]])
        self.assertEqual(reduced['sampling']['retryMode'],'reduced_images')
        short={**pack,'images':pack['images'][:5]}
        retained,_=agent._lighter_retry_input(short,images[:5]);self.assertEqual(retained['images'],short['images'])

    def test_v4_stage_sheet_keeps_all_metadata_original_preview_bytes_and_retry_frames(self):
        agent=self.make_agent();job_id='sheet-stage-fixture';(agent.folder/job_id).mkdir()
        job=dict(jobId=job_id,document=deepcopy(self.doc),request=deepcopy(self.request),clip=self.clip,
                 video=self.folder/'fixture.mp4',runCount=1)
        stage=dict(stageId='stage-1',startFrame=0,endFrameExclusive=61);job['stages']=[stage]
        _,pack,attachments,_=agent._stage_input(job,stage);before=deepcopy(pack)
        self.assertEqual(len(attachments),1);self.assertEqual(attachments[0].name,'model-contact-sheet.jpg')
        self.assertEqual(pack['imageEncoding']['inputMode'],'contact_sheet')
        self.assertIsNone(pack['imageEncoding']['maxTotalImageBytes'])
        self.assertEqual([tile['frame'] for tile in pack['imageEncoding']['contactSheet']['tiles']],[image['frame'] for image in pack['images']])
        directory=agent.folder/job_id/'stage-1';source=fixture_jpeg(self.clip['width'],self.clip['height'])
        for image in pack['images']:
            self.assertEqual((directory/f"source-frame-{image['frame']:06d}.jpg").read_bytes(),source)
            encoded=(directory/f"frame-{image['frame']:06d}.jpg").read_bytes()
            self.assertEqual(hashlib.sha256(encoded).hexdigest(),image['modelImageSha256'])
        reduced,paths=agent._lighter_retry_input(pack,attachments)
        self.assertEqual(pack,before);self.assertEqual(paths,attachments)
        for key in ('images','imageEncoding','entities','evidenceFrames','participantRequirements'):self.assertEqual(reduced[key],pack[key])
        self.assertEqual(reduced['sampling']['retryMode'],'contact_sheet_all_frames_retained')
        self.assertEqual(json.loads((directory/'input-run-1.json').read_text(encoding='utf-8'))['images'],pack['images'])

    def test_existing_draft_play_pending_is_manual_review_without_repeated_model_retry(self):
        phase=deepcopy(self.doc['playDefinition']['phases'][0])
        self.doc['playDefinition']['phases']=[{**phase,'endFrameExclusive':18},
            {**phase,'phaseId':'manual-second','order':1,'startFrame':18,'freezeFrame':18}]
        self.request['documentDigest']=self.tactics.run('agent-digest',document=self.doc)['digest']
        original=deepcopy(self.doc);calls=[]
        def execute(**kwargs):
            pack=json.loads(kwargs['prompt'].split('输入如下：\n',1)[1]);calls.append(pack)
            output=self.video_output(pack)
            output['phases'][0]['annotations'][0]['evidenceFrames']=[pack['images'][0]['frame'],pack['images'][-1]['frame']]
            return output
        agent=self.make_agent(execute);job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
        done=self.wait(agent,job)
        self.assertEqual(done['status'],'partial',done);self.assertEqual(done['completionKind'],'manual_review')
        self.assertNotIn('failure',done);self.assertFalse(done['canRetry']);self.assertEqual(len(calls),1)
        self.assertEqual(done['progress']['completed'],done['progress']['total'])
        self.assertEqual(len(done['pendingAnnotations']),1);self.assertEqual(done['stages'][0]['coverage'][0]['annotated'],0)
        self.assertEqual(done['stages'][0]['coverage'][0]['pending'],1)
        adopted=agent.adopt(job['jobId'],self.request,self.clip,'demo',True)['document']
        self.assertEqual(adopted['playDefinition']['phases'],original['playDefinition']['phases'])
        self.assertEqual(adopted.get('annotations',{}).get('items',[]),[])
        self.assertEqual(len(adopted['agentRuns'][-1]['pendingAnnotations']),1)
        self.assertEqual(self.doc,original)
        with self.assertRaises(ValueError):agent.retry(job['jobId'],self.request,self.clip,'demo',True)

    def test_restart_republishes_durable_stage_checkpoints_without_model_calls(self):
        for ranges,checkpoint_at in [([(0,61)],1), ([(0,20),(20,40),(40,61)],2)]:
            with self.subTest(ranges=ranges):
                gate=threading.Event();entered=threading.Event();calls=[]
                def execute(**kwargs):
                    pack=json.loads(kwargs['prompt'].split('输入如下：\n',1)[1]);calls.append(pack['analysisRange'])
                    return self.video_output(pack)
                agent=TacticsAgent(self.folder/f'checkpoint-source-{len(ranges)}',self.tactics,use_visual_facts=False,codex_path=self.node,execute=execute)
                self.addCleanup(agent.close)
                publish=agent._publish_completed
                def paused_publish(job,converted=None):
                    if sum(s['status']=='ready' for s in job['stages'])==checkpoint_at and not entered.is_set():
                        entered.set();gate.wait(30)
                    return publish(job,converted)
                agent._publish_completed=paused_publish
                stages=[dict(stageId=f'stage-{i+1}',startFrame=a,endFrameExclusive=b,status='queued',message='等待',attempts=0) for i,(a,b) in enumerate(ranges)]
                with patch('tactics_agent.analysis_stages',return_value=stages):
                    job=agent.create(self.request,self.clip,self.folder/'video.mp4','demo',True)
                try:
                    self.assertTrue(entered.wait(20),'expected durable validated checkpoint')
                    copied=self.folder/f'checkpoint-restored-{len(ranges)}'/job['jobId'];copied.mkdir(parents=True)
                    for name in ('request.json','state.json'):
                        shutil.copyfile(agent.folder/job['jobId']/name,copied/name)
                    checkpoint=json.loads((copied/'state.json').read_text(encoding='utf-8'))
                    for ref in checkpoint.get('previewRefs',{}).values():
                        shutil.copyfile(agent.folder/job['jobId']/ref['file'],copied/ref['file'])
                    from tactics_job_storage import read_job_state
                    checkpoint=read_job_state(copied)
                    before_count=len(checkpoint.get('previewDocument',{}).get('annotations',{}).get('items',[]))
                    self.assertEqual(before_count,checkpoint_at-1)
                finally:
                    gate.set()
                self.wait(agent,job)
                def forbidden_execute(**kwargs):self.fail('checkpoint recovery must not call any model')
                recovered=TacticsAgent(copied.parent,self.tactics,use_visual_facts=False,codex_path=self.node,execute=forbidden_execute);self.addCleanup(recovered.close)
                restored=recovered.get(job['jobId'],self.clip,'demo',True)
                self.assertEqual(restored['status'],'ready' if len(ranges)==1 else 'partial',restored)
                self.assertEqual(len(restored['previewDocument']['annotations']['items']),checkpoint_at)
                self.assertEqual(restored['progress']['completed'],checkpoint_at)
                self.assertEqual(restored['canRetry'],len(ranges)>checkpoint_at)
                adopted=recovered.adopt(job['jobId'],self.request,self.clip,'demo',True)
                self.assertEqual(len(adopted['document']['annotations']['items']),checkpoint_at)


class AnalysisStageTests(unittest.TestCase):
    def test_source_time_partition_uses_one_or_two_calls_up_to_24_seconds(self):
        for duration,expected in [(5,1),(12,1),(21.55,2),(24,2)]:
            count=720;mapping=[dict(frame=i,time=duration*i/count) for i in range(count)]
            stages=analysis_stages(mapping,0,count,'play',duration)
            self.assertEqual(len(stages),expected)
            self.assertEqual(stages[0]['startFrame'],0);self.assertEqual(stages[-1]['endFrameExclusive'],count)
            self.assertTrue(all(a['endFrameExclusive']==b['startFrame'] for a,b in zip(stages,stages[1:])))
        self.assertEqual(len(analysis_stages(mapping,0,count,'phase',duration)),1)

    def test_video_sampling_caps_input_by_source_time_preserving_images_cuts_and_brief_people(self):
        mapping=[dict(frame=i,time=i/60) for i in range(646)]
        entities=[dict(id=f'P{i+1}',trajectory=[dict(frame=21+i*37,x=10+i,y=20)]) for i in range(10)]
        before=deepcopy(entities)
        selected=video_evidence_selection(mapping,entities,0,646,0,12,media_end_time=646/60)
        self.assertEqual(len(selected['imageFrames']),5);self.assertEqual(len(selected['evidenceFrames']),16)
        self.assertTrue({0,645}<=set(selected['imageFrames'])<=set(selected['evidenceFrames']))
        self.assertEqual(selected['participantRequirements'],[f'P{i+1}' for i in range(10)])
        self.assertEqual(selected['unsampledEntityIds'],[]);self.assertEqual(entities,before)
        with_cuts=video_evidence_selection(mapping,entities,0,646,300,12,cuts=[200,400],media_end_time=646/60)
        self.assertTrue({0,199,200,300,399,400,645}<=set(with_cuts['imageFrames']))
        self.assertLessEqual(len(with_cuts['imageFrames']),12);self.assertLessEqual(len(with_cuts['evidenceFrames']),16)
        with self.assertRaisesRegex(AgentFailure,'未省略关键切镜'):
            video_evidence_selection(mapping,entities,0,646,300,4,cuts=[200,400],media_end_time=646/60)

    def test_sampling_records_unrepresented_people_without_removing_their_requirements(self):
        mapping=[dict(frame=i,time=i/30) for i in range(301)]
        entities=[dict(id=f'P{i}',trajectory=[dict(frame=5+i*11,x=10,y=20)]) for i in range(20)]
        selected=video_evidence_selection(mapping,entities,0,301,0,12,media_end_time=301/30)
        self.assertEqual(len(selected['participantRequirements']),20);self.assertTrue(selected['unsampledEntityIds'])
        self.assertLessEqual(len(selected['evidenceFrames']),16)
        for id in selected['unsampledEntityIds']:
            self.assertIn(id,selected['participantRequirements'])


class RangeAgentV3Tests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.folder=Path(self.temp.name)
        script="import {makeV2Fixture} from './engineering/tools/player-review/tactics-v2-fixture.mjs';process.stdout.write(JSON.stringify(await makeV2Fixture()));"
        fixture=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=ROOT))
        self.clip,self.doc,self.session=fixture['clip'],fixture['document'],fixture['session'];self.variant=self.clip['tracking_revision']
        self.tactics=TacticalWorkbench(self.folder/'saved');self.tactics.preparations.save(self.session['courtPreparation'],self.session,self.clip,self.variant,True,0)
        jpeg=fixture_jpeg(self.clip['width'],self.clip['height'])
        self.tactics.frames=lambda _video,_clip,indices:[dict(frame=f,time=self.clip['frames'][f]['time'],dataUrl='data:image/jpeg;base64,'+base64.b64encode(jpeg).decode()) for f in indices]
        self.request=dict(document=self.doc,expectedVersion=0,clientRevision=1,documentDigest=self.tactics.run('agent-digest',document=self.doc)['digest'],scope='range',phaseId='phase-1',range={'startFrame':30,'endFrameExclusive':50},goal='synthetic contract test')
        self.calls=[]
        def execute(**kwargs):
            pack=json.loads(kwargs['prompt'].split('输入如下：\n',1)[1]);self.calls.append(pack)
            return dict(schemaVersion=3,summary='synthetic V3',issues=[],range=pack['range'],preparationDigest=pack['preparationDigest'],annotations=[dict(id='pass',phaseId='phase-1',type='route',entityId='P1',startFrame=30,endFrameExclusive=50,cueFrame=30,points=[{'x':10,'y':8},{'x':18,'y':6}],curve='polyline',style={'angle':0,'size':1,'color':'#ffd45c','pattern':'dots'},meaning='pass',progressFrames=[{'frame':30,'t':0},{'frame':50,'t':1}],evidenceFrames=[30,40],explanation='synthetic')],keyframes=[dict(frame=30,annotationIds=['pass'],freeze=True,holdSeconds=2.5)])
        self.agent=TacticsAgent(self.folder/'jobs',self.tactics,use_visual_facts=False,codex_path=shutil.which('node'),execute=execute);self.addCleanup(self.agent.close)

    def test_real_v3_validator_preview_and_selective_adoption_read_the_saved_preparation(self):
        job=self.agent.create(self.request,self.clip,self.folder/'video.mp4',self.variant,True)
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            done=self.agent.get(job['jobId'],self.clip,self.variant,True)
            if done['status'] in ('ready','failed'):break
            time.sleep(.03)
        self.assertEqual(done['status'],'ready',done)
        pack=self.calls[0];self.assertEqual(pack['candidateVersion'],3);self.assertEqual(pack['range'],self.request['range'])
        self.assertTrue(all(30<=image['frame']<50 for image in pack['images']))
        self.assertNotIn('contactSheet',pack['imageEncoding']);self.assertNotIn('inputMode',pack['imageEncoding'])
        self.assertFalse((self.agent.folder/job['jobId']/'stage-1'/'model-contact-sheet.jpg').exists())
        point=pack['entities'][0]['courtTrajectory'][0]
        self.assertEqual(point['x'],self.doc['review']['courtPreparation']['preparedByPlayer']['P1'][point['frame']]['x'])
        adopted=self.agent.adopt(job['jobId'],{**self.request,'selectedIds':['pass']},self.clip,self.variant,True)
        self.assertEqual(adopted['document']['annotations']['items'][0]['style']['pattern'],'dots')
        self.assertEqual(self.tactics.load(self.clip,self.variant,True,'workspace')['version'],0)

    def test_v3_prompt_has_its_own_range_and_metre_contract(self):
        prompt=agent_prompt({'candidateVersion':3,'range':self.request['range']})
        self.assertIn('球场米制',prompt);self.assertIn('preparationDigest',prompt)
        self.assertNotIn('production 为每个阶段',prompt)


if __name__ == '__main__':unittest.main()
