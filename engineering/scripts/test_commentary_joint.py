"""One media timeline for native tactics, frame-bound names and real WAV lengths."""
from copy import deepcopy
import unittest
from commentary_plan import source_ref

try:
    from commentary_joint import build_joint_composition
except ImportError:
    build_joint_composition = None


class JointCompositionTests(unittest.TestCase):
    def fixture(self):
        # VFR asset starts at PTS 2; parent footage starts at 92, review at 12.
        times = [0., .1, .3, .6, 1.]
        decoded = [dict(frame=i, time=t, sourceTime=2+t, pts=round((2+t)*1000), timeBase='1/1000') for i,t in enumerate(times)]
        mapping = [dict(frame=i,time=12+t,sourceFrame=400+i,sourceTime=92+t) for i,t in enumerate(times)]
        document = dict(review=dict(videoSha256='asset',sourceVideoSha256='parent',width=320,height=180,
                                    trackingFingerprint='tracks',trackingRevision='r1',sourceFrameMapping=mapping),
                        playDefinition=dict(startFrame=0,endFrameExclusive=5,phases=[dict(phaseId='p',startFrame=0,endFrameExclusive=5)]))
        plan = dict(sourceRef=self.complete_source(document),
                    planId='plan',revision=1,digest='plan-digest',nodes=[dict(nodeId='n',anchorAssetFrame=2,cueIds=['a','b'],evidenceWindow=dict(startFrame=1,endFrameExclusive=4))],
                    cues=[dict(cueId=c,delivery='pause',text=c,suggestedStartTime=.1,suggestedEndTime=.6) for c in ['a','b']])
        production = dict(fps=10,width=320,height=180,frames=[dict(sourceFrame=2,sourceTime=12.3,state='draw',reveal=.5,phaseId='p') for _ in range(6)])
        context = dict(frames=decoded,duration=1.2,sourceStartTime=2.,videoRef='asset',width=320,height=180)
        audio = [dict(cueId='a',durationSeconds=.7),dict(cueId='b',durationSeconds=1.1)]
        return document,plan,audio,context,production

    def build(self,*args):
        self.assertTrue(callable(build_joint_composition),'joint composition compiler is missing')
        return build_joint_composition(*args)

    def test_same_asset_anchor_is_one_hold_and_speech_is_complete_and_sequential(self):
        result=self.build(*self.fixture())
        holds=[s for s in result['segments'] if s['kind']=='hold']
        self.assertEqual(len(holds),1)
        self.assertEqual(holds[0]['assetFrame'],2)
        self.assertEqual(holds[0]['cueIds'],['a','b'])
        a,b=result['placements']
        self.assertAlmostEqual(a['previewEnd']-a['previewStart'],.7)
        self.assertAlmostEqual(b['previewEnd']-b['previewStart'],1.1)
        self.assertGreaterEqual(b['previewStart'],a['previewEnd'])
        self.assertGreaterEqual(holds[0]['previewEnd'],b['previewEnd']+.25)
        self.assertEqual(result['totalFrames'],len(result['frames']))

    def test_old_plan_endpoint_rounding_is_clamped_but_real_overrun_is_rejected(self):
        d,p,a,c,n=self.fixture()
        p['cues'][0]['suggestedEndTime']=c['duration']+1/90000
        self.build(d,p,a,c,n)
        self.assertGreater(p['cues'][0]['suggestedEndTime'],c['duration'])
        p['cues'][0]['suggestedEndTime']=c['duration']+.001
        with self.assertRaisesRegex(ValueError,'source window'):self.build(d,p,a,c,n)

    def test_asset_pts_review_time_and_parent_offsets_are_separate_and_vfr_uses_pts(self):
        result=self.build(*self.fixture())
        frame=next(f for f in result['frames'] if f['state']=='hold')
        self.assertEqual(frame['assetFrame'],2)
        self.assertEqual(frame['assetPts'],2300)
        self.assertAlmostEqual(frame['assetPtsSeconds'],2.3)
        self.assertAlmostEqual(frame['clipTimeSeconds'],.3)
        self.assertAlmostEqual(frame['reviewTimeSeconds'],12.3)
        self.assertEqual(frame['parentFrame'],402)
        self.assertAlmostEqual(frame['parentTimeSeconds'],92.3)
        self.assertEqual(frame['parentVideoSha256'],'parent')
        source=[f['assetFrame'] for f in result['frames'] if f['state']=='source']
        self.assertEqual(source[:6],[0,1,1,2,2,2])

    def test_missing_parent_mapping_stays_null_and_long_manual_hold_is_preserved(self):
        d,p,a,c,n=self.fixture()
        d['review'].pop('sourceVideoSha256')
        for row in d['review']['sourceFrameMapping']:
            row.pop('sourceFrame');row.pop('sourceTime')
        # Sparse historical input has no certified handoff digests. All current
        # contract tests use the complete source_ref produced by the host.
        p['sourceRef']={k:p['sourceRef'][k] for k in ('videoSha256','trackingFingerprint','trackingRevision')}
        n['frames']*=10
        result=self.build(d,p,a,c,n)
        hold=next(s for s in result['segments'] if s['kind']=='hold')
        self.assertAlmostEqual(hold['previewEnd']-hold['previewStart'],6.)
        self.assertTrue(all(f['parentFrame'] is None and f['parentTimeSeconds'] is None and f['parentVideoSha256'] is None for f in result['frames']))

    def test_legacy_asset_self_mapping_does_not_certify_parent_footage(self):
        args=list(self.fixture());args[0]['review']['sourceVideoSha256']='asset'
        result=self.build(*args)
        self.assertTrue(all(f['parentVideoSha256'] is None for f in result['frames']))

    def test_anchor_outside_node_window_and_wrong_source_are_rejected(self):
        args=list(self.fixture());args[1]['nodes'][0]['anchorAssetFrame']=4
        with self.assertRaisesRegex(ValueError,'window'):self.build(*args)
        args=list(self.fixture());args[1]['sourceRef']['videoSha256']='other'
        with self.assertRaisesRegex(ValueError,'source'):self.build(*args)

    def test_contract_closed_evidence_window_is_supported(self):
        args=list(self.fixture())
        args[1]['nodes'][0]['evidenceWindow']={'startFrame':1,'endFrame':3}
        result=self.build(*args)
        self.assertEqual(result['placements'][0]['assetFrame'],2)

    def test_active_graphics_from_an_old_commentary_plan_are_rejected(self):
        args=list(self.fixture())
        args[0]['annotations']={'items':[{'id':'drawing','origin':{'kind':'agent','jobId':'j'}}]}
        args[0]['agentRuns']=[{'jobId':'j','commentaryPlanRef':{'planId':'plan','revision':0,'digest':'old'}}]
        with self.assertRaisesRegex(ValueError,'graphics.*plan'):self.build(*args)

    def test_deleted_old_graphics_and_manual_graphics_do_not_block_current_render(self):
        args=list(self.fixture())
        args[0]['annotations']={'items':[{'id':'manual','origin':{'kind':'human_modified','jobId':'legacy'}}]}
        args[0]['agentRuns']=[{'jobId':'deleted','commentaryPlanRef':{'planId':'plan','revision':0,'digest':'old'}}]
        self.build(*args)

    def test_during_play_can_remain_play_and_overlong_audio_uses_node_anchor(self):
        d,p,a,c,n=self.fixture();n['frames']=[];p['cues']=p['cues'][:1];a=a[:1]
        p['cues'][0].update(delivery='during_play',suggestedStartTime=0.,suggestedEndTime=1.)
        a[0]['durationSeconds']=.2
        result=self.build(d,p,a,c,n)
        self.assertEqual([s for s in result['segments'] if s['kind']=='hold'],[])
        a[0]['durationSeconds']=1.4
        result=self.build(d,p,a,c,n)
        self.assertEqual(next(s for s in result['segments'] if s['kind']=='hold')['assetFrame'],2)
        self.assertTrue(result['placements'][0]['fallback'])

    def test_manifest_for_different_spoken_text_is_rejected(self):
        args=list(self.fixture());args[2][0]['text']='old edited text'
        with self.assertRaisesRegex(ValueError,'audio.*text'):self.build(*args)

    def complete_source(self, document, cuts=None):
        review=document['review']
        registered=dict(video_sha256=review['videoSha256'],source_video_sha256=review.get('sourceVideoSha256'),
                        tracking_fingerprint=review['trackingFingerprint'],tracking_revision=review['trackingRevision'],
                        sourceCuts=cuts or [],frames=[dict(frame=r['frame'],time=r['time'],source_frame=r['sourceFrame'],
                                                         source_time=r['sourceTime']) for r in review['sourceFrameMapping']])
        return source_ref(registered,review)

    def test_complete_source_ref_accepts_different_parent_crop_and_keeps_parent_domain(self):
        args=list(self.fixture());args[1]['sourceRef']=self.complete_source(args[0])
        result=self.build(*args)
        self.assertEqual(result['sourceRef'],args[1]['sourceRef'])
        hold=next(f for f in result['frames'] if f['state']=='hold')
        self.assertEqual(hold['parentFrame'],402)
        self.assertAlmostEqual(hold['parentTimeSeconds'],92.3)

    def test_complete_source_ref_preserves_nonempty_registered_splice_cuts(self):
        args=list(self.fixture());args[0]['review']['settings']={'cuts':[3],'sourceCuts':[3]}
        args[1]['sourceRef']=self.complete_source(args[0],[3])
        result=self.build(*args)
        self.assertEqual(result['sourceRef']['reviewDigest'],args[1]['sourceRef']['reviewDigest'])

    def shot_fixture(self):
        d,p,a,c,n=self.fixture();node=p['nodes'][0]
        feedback={'shooterRef':'shooter','opportunity':{'grade':'fair','reason':'contested'},'pressure':{'grade':'low','reason':'late'}}
        node.update(kind='shot_release',eventId='event-shot',shotFeedback=feedback)
        p['participants']=[{'participantId':'shooter','entityId':None}]
        ref={key:p[key] for key in ('planId','revision','digest')}
        d['shotFeedback']={'schemaVersion':1,'items':[{'id':'shot-hud','nodeId':'n','eventId':'event-shot','frame':2,
            'spotlightAnnotationId':'focus','shooterRef':'shooter','opportunity':feedback['opportunity'].copy(),
            'pressure':feedback['pressure'].copy(),'commentaryPlanRef':ref}]}
        d['annotations']={'items':[{'id':'focus','type':'spotlight','anchorFrame':2,'startFrame':2,'endFrameExclusive':3}]}
        d['tacticKeyframes']={'items':[{'frame':2,'freeze':True,'holdSeconds':2.5,'annotationIds':['focus']}]}
        n['frames']=[dict(sourceFrame=2,sourceTime=12.3,state='hold',reveal=1.,phaseId='p') for _ in range(25)]
        return d,p,a,c,n

    def test_release_spotlight_entity_must_match_current_saved_shooter(self):
        args=list(self.shot_fixture());args[1]['participants'][0]['entityId']='P1'
        args[0]['annotations']['items'][0]['entityId']='P1'
        self.build(*args)
        for entity_id in ['P2',None]:
            changed=deepcopy(args);changed[0]['annotations']['items'][0]['entityId']=entity_id
            with self.assertRaisesRegex(ValueError,'shooter.*(identity|participant)'):self.build(*changed)
        args=list(self.shot_fixture());self.build(*args)
        args[0]['annotations']['items'][0]['entityId']='P2'
        with self.assertRaisesRegex(ValueError,'shooter.*identity'):self.build(*args)
        args=list(self.shot_fixture());args[1]['participants']=[]
        with self.assertRaisesRegex(ValueError,'shooter.*participant'):self.build(*args)

    def test_confirmed_release_without_linked_shot_graphics_cannot_render_silently(self):
        args=list(self.shot_fixture());args[0].pop('shotFeedback')
        with self.assertRaisesRegex(ValueError,'shot.*graphics'):self.build(*args)
        args=list(self.shot_fixture());args[0]['annotations']['items']=[]
        with self.assertRaisesRegex(ValueError,'shot.*spotlight'):self.build(*args)

    def test_shot_hud_must_match_current_saved_node_and_plan_evaluation(self):
        for change in [lambda d:d['shotFeedback']['items'][0]['opportunity'].update(grade='good'),
                       lambda d:d['shotFeedback']['items'][0].update(frame=3),
                       lambda d:d['shotFeedback']['items'][0]['commentaryPlanRef'].update(revision=0)]:
            args=list(self.shot_fixture());change(args[0])
            with self.assertRaisesRegex(ValueError,'shot.*(plan|node)'):self.build(*args)

    def test_release_cues_share_one_minimum_pause_and_longer_voice_extends_that_pause(self):
        args=list(self.shot_fixture())
        for cue in args[1]['cues']:cue.update(delivery='during_play',suggestedStartTime=0.,suggestedEndTime=1.2)
        args[2][0]['durationSeconds']=.2
        result=self.build(*args);holds=[s for s in result['segments'] if s['kind']=='hold']
        self.assertEqual(len(holds),1)
        self.assertAlmostEqual(holds[0]['previewEnd']-holds[0]['previewStart'],2.5)
        self.assertTrue(all(p.get('assetFrame')==2 for p in result['placements']))
        args[2][0]['durationSeconds']=3.
        result=self.build(*args);holds=[s for s in result['segments'] if s['kind']=='hold']
        self.assertEqual(len(holds),1)
        self.assertGreaterEqual(holds[0]['previewEnd']-holds[0]['previewStart'],4.6)


if __name__=='__main__':unittest.main()
