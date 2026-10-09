from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import subprocess
from tactical_workbench import TacticalWorkbench,ROOT

from commentary_drawing_jobs import CommentaryDrawingJobs
from commentary_plan import model_config
from test_commentary_video import make_vfr_video
from commentary_video import CommentaryVideo


class FakeTactics:
    node='node'
    def check_source(self,*args): pass
    def load(self,*args): return {'version':0}
    def run(self,operation,**payload):
        if operation=='agent-digest': return {'digest':'base'}
        if operation=='agent-adopt':
            doc=deepcopy(payload['document']);doc['agentRuns']=[{'jobId':payload['options']['jobId']}]
            candidate=payload['candidate'];doc['annotations']={'schemaVersion':1,'items':[dict(a,id=f"{payload['options']['jobId']}-annotation-{i}",
                origin={'kind':'agent','jobId':payload['options']['jobId'],'sourceFrames':a['evidenceFrames'],'note':''}) for i,a in enumerate(candidate['phases'][0]['annotations'])]}
            doc['tacticKeyframes']={'schemaVersion':1,'items':[dict(id='short-human-cue',frame=2,annotationIds=[doc['annotations']['items'][0]['id']],freeze=True,holdSeconds=.5)]}
            return {'document':doc,'presentation':{'items':[]}}
        return {}


class FakeCommentary:
    def __init__(self,plan): self.plan=plan;self.stale=False;self.reviews=[]
    def resolve_plan(self,ref,*args,**kwargs):
        self.reviews.append(args[-1] if len(args)==4 else kwargs.get('review'))
        if self.stale or ref!={k:self.plan[k] for k in ('planId','revision','digest')}: raise ValueError('stale commentary')
        return deepcopy(self.plan)


class DrawingJobTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.video=self.root/'video.mkv';make_vfr_video(self.video)
        context=CommentaryVideo(self.video,self.root/'probe').context()
        self.clip={'video_sha256':context['videoRef'],'tracking_fingerprint':'track','tracking_revision':'v1','frames':context['frames'],'width':96,'height':64}
        self.document={'review':{'sourceFrameMapping':context['frames']},'playDefinition':{'startFrame':0,'endFrameExclusive':15,'phases':[{'phaseId':'p1'}],'participants':[]}}
        self.plan={'planId':'plan','revision':1,'digest':'a'*64,'producerConfigSnapshot':model_config(),'nodes':[{'nodeId':'n1','anchorAssetFrame':2,'focus':'站位','evidenceWindow':{'startFrame':1,'endFrame':4},'participantRefs':[]}],'participants':[],'events':[],'cues':[]}
        self.commentary=FakeCommentary(self.plan)
        self.request={'expectedVersion':0,'clientRevision':0,'documentDigest':'base','document':self.document,'commentaryPlanRef':{'planId':'plan','revision':1,'digest':'a'*64},'nodeIds':['n1'],'review':{'nameSnapshot':'current'}}
        self.service=CommentaryDrawingJobs(self.root/'jobs',FakeTactics(),self.commentary,execute=self.execute)
        self.audits=[]
    def tearDown(self): self.service.close();self.temp.cleanup()
    def execute(self,start,evidence,output,config,cancel=None,process_callback=None):
        self.audits.append((start['mode'],deepcopy(config)))
        if start['mode']=='audit': return {'status':'completed','audit':{'nodeId':'n1','approved':True,'reason':'checked','annotations':[{'index':0,'approved':True,'reason':'supported'}],'actions':[]}}
        result=evidence.read_frames({'nodeId':'n1','frames':[2]});asset=result['details']['assets'][0]
        phase={'title':'站位','startFrame':1,'endFrameExclusive':5,'freezeFrame':2,'reason':'已保存节点','evidenceFrames':[2],'actions':[],'participants':[{'subjectId':'anon','entityId':None,'label':'接应者','role':'receiver','disposition':'annotated','annotationIndexes':[0],'evidenceFrames':[2],'reason':'可见'}],
            'annotations':[{'assetId':asset['assetId'],'type':'position','entityId':None,'space':'video','anchorFrame':2,'startFrame':2,'endFrameExclusive':5,'points':[{'x':30,'y':30}],
                            'angle':0,'size':1,'color':'#26baff','explanation':'站位','authoredPath':None,'meaning':'position','pattern':'solid','evidenceFrames':[2]}]}
        return {'status':'completed','nodeStatus':'ready','candidate':{'schemaVersion':4,'summary':'站位','issues':[],'phases':[phase],'production':None}}
    def wait(self,id):
        deadline=time.monotonic()+15
        state=None
        while time.monotonic()<deadline:
            state=self.service.get(id,self.clip,'original',False)
            if state['status'] not in ('queued','preparing','analyzing','validating'): return state
            time.sleep(min(.01,max(0,deadline-time.monotonic())))
        self.fail(f'job did not finish within 15 seconds; latest state: {state!r}')
    def test_separate_drawing_audit_and_stale_adoption(self):
        state=self.service.create(self.request,self.clip,self.video,'original',False);state=self.wait(state['jobId'])
        self.assertEqual(state['status'],'ready');self.assertEqual([mode for mode,_ in self.audits],['draw','audit'])
        self.assertEqual(state['modelMode'],'inherited');self.assertTrue(state['visualAudit']['allApproved'])
        self.commentary.stale=True
        with self.assertRaisesRegex(ValueError,'stale'): self.service.adopt(state['jobId'],self.request,self.clip,'original',False)
    def test_retry_locks_model_and_does_not_repeat_successful_generation(self):
        execute=self.service.execute;calls=[]
        def fail_audit(*args,**kwargs):
            calls.append(args[0]['mode'])
            if args[0]['mode']=='audit': raise ValueError('audit transport')
            return execute(*args,**kwargs)
        self.service.execute=fail_audit
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'failed')
        self.plan['producerConfigSnapshot']=model_config({'reasoning':'high'})
        def resumed(*args,**kwargs):
            calls.append(args[0]['mode']);return execute(*args,**kwargs)
        self.service.execute=resumed
        self.service.retry(state['jobId'],self.request,self.clip,'original',False)
        state=self.wait(state['jobId'])
        self.assertEqual(state['status'],'ready');self.assertEqual([mode for mode,_ in self.audits],['draw','audit'])
        self.assertEqual(state['drawingConfigSnapshot']['reasoning'],'medium')
        self.assertEqual(calls,['draw','audit','audit'])

    def test_content_rejection_retry_redraws_with_feedback_then_independently_audits(self):
        execute=self.service.execute;calls=[];reject=True;feedback=[]
        def rejected(start,*args,**kwargs):
            nonlocal reject
            calls.append(start['mode'])
            if start['mode']=='draw': feedback.append(deepcopy(start.get('auditFeedback')))
            result=execute(start,*args,**kwargs)
            if start['mode']=='audit' and reject:
                reject=False
                result['audit'].update(approved=False,reason='位置标记偏离脚下')
                result['audit']['annotations'][0].update(approved=False,reason='坐标需下移')
            if start['mode']=='audit': self.assertIsNone(start.get('auditFeedback'),'review must remain independent')
            return result
        self.service.execute=rejected
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'failed');self.assertNotIn('previewDocument',state)

        self.service.retry(state['jobId'],self.request,self.clip,'original',False)
        state=self.wait(state['jobId'])
        self.assertEqual(state['status'],'ready');self.assertEqual(calls,['draw','audit','draw','audit'])
        self.assertIsNone(feedback[0]);self.assertEqual(feedback[1]['audit']['reason'],'位置标记偏离脚下')
        self.assertTrue(feedback[1]['previousCandidate']['phases'][0]['annotations'])
        self.assertEqual(state['drawingConfigSnapshot'],self.plan['producerConfigSnapshot'])
    def test_cancel_late_result_never_publishes(self):
        entered=threading.Event();release=threading.Event();execute=self.service.execute
        def delayed(*args,**kwargs): entered.set();release.wait(2);return execute(*args,**kwargs)
        self.service.execute=delayed
        state=self.service.create(self.request,self.clip,self.video,'original',False)
        self.assertTrue(entered.wait(1));self.service.cancel(state['jobId'],self.clip,'original',False);release.set()
        state=self.wait(state['jobId']);self.assertEqual(state['status'],'cancelled');self.assertNotIn('previewDocument',state)
    def test_adopt_checks_latest_review_snapshot(self):
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        request={**self.request,'review':{'nameSnapshot':'latest'}}
        self.service.adopt(state['jobId'],request,self.clip,'original',False)
        self.assertEqual(self.commentary.reviews[-1],request['review'])

    def shot_setup(self):
        node=self.plan['nodes'][0];node.update(kind='shot_release',eventId='shot',participantRefs=['shooter'],shotFeedback={'shooterRef':'shooter','defenderRefs':[],
            'opportunity':{'grade':'good','reason':'保存的空位机会评价'},'pressure':{'grade':'low','reason':'保存的防守距离评价'},'evidenceFrames':[2]})
        self.plan['participants']=[{'participantId':'shooter','entityId':None,'displayName':'已确认的名字','nameRecordRef':'name-record','validRange':{'startFrame':0,'endFrame':14}}]
        execute=self.execute
        def shot(start,*args,**kwargs):
            result=execute(start,*args,**kwargs)
            if start['mode']=='draw':
                p=result['candidate']['phases'][0];p['participants'][0]['subjectId']='shooter'
                a=p['annotations'][0];a.update(type='spotlight',meaning='focus',points=[{'x':30,'y':30}],angle=0,size=1)
                result['shotFeedback']={'opportunity':{'grade':'poor','reason':'模型试图改评价'},'pressure':{'grade':'high','reason':'不得采用'}}
            return result
        return shot

    def test_shot_release_requires_designated_shooter_spotlight_and_persists_saved_evaluation(self):
        self.service.execute=self.shot_setup()
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'ready',state.get('message'))
        doc=state['previewDocument'];item=doc['shotFeedback']['items'][0]
        self.assertEqual(item['opportunity'],self.plan['nodes'][0]['shotFeedback']['opportunity'])
        self.assertEqual(item['pressure'],self.plan['nodes'][0]['shotFeedback']['pressure'])
        self.assertEqual(item['spotlightAnnotationId'],doc['annotations']['items'][0]['id'])
        self.assertEqual(item['commentaryPlanRef'],self.request['commentaryPlanRef'])
        self.assertGreaterEqual(max(k['holdSeconds'] for k in doc['tacticKeyframes']['items'] if k['frame']==2),2.5)
        self.assertEqual(doc['agentRuns'][-1]['shotParticipantSnapshot'],self.plan['participants'])

    def test_shot_without_required_spotlight_or_wrong_subject_cannot_be_ready(self):
        shot=self.shot_setup();execute=self.execute
        self.service.execute=execute
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'failed');self.assertNotIn('previewDocument',state)
        def wrong(*args,**kwargs):
            result=shot(*args,**kwargs)
            if args[0]['mode']=='draw': result['candidate']['phases'][0]['participants'][0]['subjectId']='other'
            return result
        self.service.execute=wrong
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'failed');self.assertNotIn('previewDocument',state)

    def test_shot_native_adoption_and_rerun_replace_linked_feedback(self):
        self.service.close()
        self.clip['frames']=[{'frame':i,'time':row['time'],'tracks':[]} for i,row in enumerate(self.clip['frames'])]
        script="import {blankSession,exportReview} from './engineering/tools/player-review/trajectory.mjs';import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';let s='';for await(const c of process.stdin)s+=c;const clip=JSON.parse(s);console.log(JSON.stringify(await createTacticsDocument(exportReview(blankSession(clip.video_sha256),clip,null,{allowEmpty:true}))));"
        self.document=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],input=json.dumps(self.clip).encode(),cwd=ROOT))
        tactics=TacticalWorkbench(self.root/'shot-native');self.request.update(document=self.document,documentDigest=tactics.run('agent-digest',document=self.document)['digest'])
        self.service=CommentaryDrawingJobs(self.root/'shot-native-jobs',tactics,self.commentary,execute=self.shot_setup())
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'ready',state.get('message'));old=state['previewDocument'];item=old['shotFeedback']['items'][0]
        spotlight=next(a for a in old['annotations']['items'] if a['id']==item['spotlightAnnotationId'])
        self.assertEqual(spotlight['type'],'spotlight');self.assertEqual(spotlight['entityId'],None)
        self.assertEqual(item['opportunity'],self.plan['nodes'][0]['shotFeedback']['opportunity'])
        self.request.update(document=old,documentDigest=tactics.run('agent-digest',document=old)['digest'])
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'ready',state.get('message'));doc=state['previewDocument']
        self.assertEqual(len(doc['shotFeedback']['items']),1);self.assertEqual(len(doc['annotations']['items']),1)
        self.assertEqual(doc['agentRuns'][-1]['archivedShotFeedback'],[item])
        self.assertNotEqual(doc['shotFeedback']['items'][0]['spotlightAnnotationId'],item['spotlightAnnotationId'])

    def test_stale_feedback_clears_while_human_modified_spotlight_is_preserved(self):
        self.service.execute=self.shot_setup()
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        doc=deepcopy(state['previewDocument']);item=deepcopy(doc['shotFeedback']['items'][0]);doc['annotations']['items'][0]['origin']['kind']='human_modified'
        job={'document':doc,'request':deepcopy(self.request),'nodes':[{'nodeId':'n1'}]}
        unchanged=self.service._replace_old(job,{'another-failed-node'})[0]
        self.assertEqual(unchanged['shotFeedback']['items'],[item])
        job['request']['commentaryPlanRef']={**self.request['commentaryPlanRef'],'revision':2,'digest':'b'*64}
        replaced,*archives=self.service._replace_old(job,{'n1'})
        self.assertEqual(replaced['shotFeedback']['items'],[])
        self.assertEqual(replaced['annotations']['items'],doc['annotations']['items'])
        self.assertEqual(archives[-1],[item]);self.assertEqual(archives[-2],doc['annotations']['items'])

    def test_window_extension_is_bounded_by_saved_event_and_restarts_local_evidence(self):
        self.plan['nodes'][0]['eventId']='e1'
        self.plan['events']=[{'eventId':'e1','startTime':0,'endTime':.8}]
        execute=self.service.execute;draws=[]
        def extend(start,evidence,*args,**kwargs):
            if start['mode']=='draw':
                draws.append(deepcopy(start['node']['evidenceWindow']))
                if len(draws)==1:
                    evidence.read_frames({'nodeId':'n1','frames':[2]})
                    return {'status':'completed','nodeStatus':'unavailable','reason':'需要更多前后帧','extensionRequest':{'nodeId':'n1','startFrame':0,'endFrame':6,'reason':'当前窗口未包括跑动起点'}}
                self.assertEqual(evidence.seen['n1'],set(),'new Pi context cannot inherit seen images')
                result=execute(start,evidence,*args,**kwargs)
                phase=result['candidate']['phases'][0]
                phase.update(startFrame=0,endFrameExclusive=7)
                return result
            return execute(start,evidence,*args,**kwargs)
        self.service.execute=extend
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'ready',state.get('message'));self.assertEqual(draws,[{'startFrame':1,'endFrame':4},{'startFrame':0,'endFrame':6}])
        run=state['previewDocument']['agentRuns'][-1]
        self.assertEqual(run['nodeWindowExtensions']['n1']['actualWindow'],{'startFrame':0,'endFrame':6})
        self.assertEqual(self.plan['nodes'][0]['evidenceWindow'],{'startFrame':1,'endFrame':4})

    def test_window_extension_rejects_event_escape_and_cuts(self):
        self.plan['nodes'][0]['eventId']='e1';self.plan['events']=[{'eventId':'e1','startTime':0,'endTime':.25}]
        def escape(*args,**kwargs): return {'status':'completed','nodeStatus':'unavailable','reason':'需扩窗','extensionRequest':{'nodeId':'n1','startFrame':0,'endFrame':14,'reason':'要全片'}}
        self.service.execute=escape
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'failed');self.assertIn('事件',state['nodes'][0]['reason'])

    def test_window_extension_cannot_cross_cut_or_repeat(self):
        self.plan['nodes'][0]['eventId']='e1';self.plan['events']=[{'eventId':'e1','startTime':0,'endTime':.8}]
        self.document['review']['settings']={'cuts':[3]}
        calls=[]
        def extension(start,*args,**kwargs):
            calls.append(start['mode'])
            return {'status':'completed','nodeStatus':'unavailable','reason':'需扩窗','extensionRequest':{'nodeId':'n1','startFrame':0,'endFrame':6,'reason':'回看起点'}}
        self.service.execute=extension
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(calls,['draw']);self.assertIn('切镜',state['nodes'][0]['reason'])
        self.document['review']['settings']['cuts']=[];calls.clear()
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(calls,['draw','draw']);self.assertEqual(state['nodes'][0]['status'],'unavailable')
        self.assertIn('一次',state['nodes'][0]['reason'])


    def test_native_candidate_preview_and_replacement_preserve_human_edits(self):
        self.service.close()
        self.clip['frames']=[{'frame':i,'time':row['time'],'tracks':[]} for i,row in enumerate(self.clip['frames'])]
        script="import {blankSession,exportReview} from './engineering/tools/player-review/trajectory.mjs';import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';let s='';for await(const c of process.stdin)s+=c;const clip=JSON.parse(s);console.log(JSON.stringify(await createTacticsDocument(exportReview(blankSession(clip.video_sha256),clip,null,{allowEmpty:true}))));"
        self.document=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],input=json.dumps(self.clip).encode(),cwd=ROOT))
        tactics=TacticalWorkbench(self.root/'native');self.request.update(document=self.document,documentDigest=tactics.run('agent-digest',document=self.document)['digest'])
        self.service=CommentaryDrawingJobs(self.root/'native-jobs',tactics,self.commentary,execute=self.execute)
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'ready',state.get('message'))
        document=state['previewDocument'];annotation=document['annotations']['items'][0]
        self.assertEqual(annotation['points'],[{'x':30,'y':30}]);self.assertEqual(document['agentRuns'][-1]['commentaryPlanRef'],self.request['commentaryPlanRef'])
        self.assertEqual(document['agentRuns'][-1]['annotationNodeRefs'][annotation['id']],'n1')
        # Re-running the same node archives its earlier automatic object and replaces it.
        self.request.update(document=document,documentDigest=tactics.run('agent-digest',document=document)['digest'])
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'ready',state.get('message'))
        replaced=state['previewDocument'];self.assertEqual(len(replaced['annotations']['items']),1)
        self.assertEqual(replaced['agentRuns'][-1]['archivedAnnotations'][0],annotation)
        # Human modifications keep the complete old object on the canvas and show a pending item.
        modified=deepcopy(replaced);modified['annotations']['items'][0]['origin']['kind']='human_modified'
        self.request.update(document=modified,documentDigest=tactics.run('agent-digest',document=modified)['digest'])
        state=self.wait(self.service.create(self.request,self.clip,self.video,'original',False)['jobId'])
        self.assertEqual(state['status'],'ready',state.get('message'))
        self.assertEqual(len(state['previewDocument']['annotations']['items']),2)
        self.assertEqual(state['pendingAnnotations'][0]['annotation'],modified['annotations']['items'][0])


if __name__=='__main__': unittest.main()
