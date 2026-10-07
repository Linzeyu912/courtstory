"""Fail-closed independent visual review, without any provider calls."""
from copy import deepcopy
import json
import unittest
from test_tactics_visual_facts import fixture
from tactics_visual_facts import compile_visual_facts
from tactics_visual_audit import (VisualAuditFailure, visual_audit_schema, visual_audit_prompt,
    apply_visual_audit, visual_audit_batch_schema, visual_audit_batch_prompt, apply_visual_audit_batch)


def accepted():
    return {'routes':[{'routeIndex':0,'personId':'white','verdict':'accept','identity':'same',
        'geometry':'aligned','camera':'landmark_aligned','mergedPeople':False,
        'observations':[{'frame':f,'identityBasis':'jersey','jersey':'4','team':'light','participantKind':'on_court_player','reason':'白衣4号短发，与同帧卷发1号分别可见'} for f in [0,5,9]],
        'reason':'禁区线参照，终点在参考帧右侧，与实际切入一致'}],
        'ball':[{'ballIndex':0,'personId':'white','frame':0,'verdict':'accept','control':'in_hand',
                 'participantKind':'on_court_player','reason':'球清楚在该人右手中'}],
        'peopleReviewed':['white','dark'],'peopleIssues':[], 'frameReviewed':[0,5,9],'frameIssues':[]}


class VisualAuditTests(unittest.TestCase):
    def test_verified_route_is_scoped_without_upgrading_global_motion_flags(self):
        pack,facts=fixture();facts['people'][0].update(action='hold',continuity='uncertain');before=deepcopy(facts)
        safe,report=apply_visual_audit(facts,accepted(),pack)
        self.assertEqual((safe['people'][0]['action'],safe['people'][0]['continuity']),('hold','uncertain'))
        self.assertEqual(report['motionProvenance']['white']['originalAction'],'hold')
        self.assertEqual(report['motionProvenance']['white']['originalContinuity'],'uncertain')
        self.assertTrue(report['allApproved']);self.assertEqual(facts,before)
        from tactics_visual_facts import VisualFactsFailure
        with self.assertRaises(VisualFactsFailure):compile_visual_facts(safe,pack)
        _,compiled=compile_visual_facts(safe,pack,verified_routes=report['verifiedRoutes'])
        self.assertEqual(compiled['motionPeople'],1)

    def test_unverified_claimed_motion_keeps_full_obligation_but_not_a_false_independent_motion_claim(self):
        pack,facts=fixture();facts['routes']=[];audit=accepted();audit['routes']=[];before=deepcopy(facts)
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(safe['people'][0]['action'],'unknown');self.assertFalse(report['allApproved'])
        self.assertEqual(report['originalActions']['white'],'cut');self.assertEqual(facts,before)
        need=next(n for n in report['repairNeeds'] if n['code']=='proposed_motion_unverified')
        self.assertEqual(need['frames'],[0,5,9]);self.assertEqual(need['requestedRange'],{'startFrame':0,'endFrameExclusive':10})
        self.assertFalse(any(n['code']=='missed_motion' for n in report['repairNeeds']))
        compile_visual_facts(safe,pack)
        facts['people'][1]['action']='unknown';safe,_=apply_visual_audit(facts,audit,pack)
        from tactics_visual_facts import VisualFactsFailure
        with self.assertRaises(VisualFactsFailure) as raised:compile_visual_facts(safe,pack)
        self.assertEqual(raised.exception.code,'no_action_content')

    def test_invalid_static_source_references_cannot_reach_an_audit_upgrade(self):
        for change in ['person','frame','wrong_point','route_start','zero_route','fixed_id','source_frame','phase','version','duplicate_foot']:
            pack,facts=fixture();facts['people'][0].update(action='hold',continuity='uncertain')
            facts['static']=[{'personId':'dark','frame':0,'point':[500,500]}]
            if change=='person':facts['static'][0]['personId']='unseen'
            if change=='frame':facts['static'][0]['frame']=5
            if change=='wrong_point':facts['static'][0]['point']=[700,700]
            if change=='route_start':facts['routes'][0]['points'][0]=[700,700]
            if change=='zero_route':facts['routes'][0]['points']=[[100,200],[100,200]]
            if change=='fixed_id':facts['people'][1]['id']='P2'
            if change=='source_frame':pack['evidenceFrames']=[0,5]
            if change=='phase':pack['phaseId']='missing-phase'
            if change=='version':pack['candidateVersion']=3
            if change=='duplicate_foot':facts['people'][1]['observations'][0]['foot']=[100,200]
            with self.subTest(change=change),self.assertRaises(VisualAuditFailure):apply_visual_audit(facts,accepted(),pack)

    def test_partial_proof_cut_and_referee_never_promote_uncertain_identity(self):
        for change in ['cut','referee','unreadable','unresolved_geometry']:
            pack,facts=fixture();facts['people'][0].update(action='unknown',continuity='uncertain');audit=accepted()
            if change=='cut':pack['sampling']['cutFrames']=[5]
            if change=='referee':audit['routes'][0]['observations'][1]['participantKind']='referee'
            if change=='unreadable':audit['routes'][0]['observations'][1]['identityBasis']='insufficient'
            if change=='unresolved_geometry':audit['routes'][0]['geometry']='uncertain'
            safe,report=apply_visual_audit(facts,audit,pack)
            self.assertEqual(safe['routes'],[]);self.assertFalse(report['allApproved'])
            if safe['people']:self.assertNotEqual(safe['people'][0]['continuity'],'observed')

    def test_partial_route_proof_does_not_confirm_other_observations_and_json_cannot_authorize_it(self):
        pack,facts=fixture();facts['people'][0].update(action='unknown',continuity='uncertain')
        facts['routes'][0]['evidenceFrames']=[0,5];audit=accepted();audit['routes'][0]['observations']=audit['routes'][0]['observations'][:2]
        safe,report=apply_visual_audit(facts,audit,pack);proof=report['verifiedRoutes'];before=deepcopy(facts)
        self.assertEqual(safe['people'][0]['continuity'],'uncertain');self.assertEqual(safe['people'][0]['action'],'unknown')
        self.assertEqual(proof[0]['evidenceFrames'],[0,5]);self.assertEqual(proof[0]['originalPerson']['observations'][-1]['frame'],9)
        candidate,_=compile_visual_facts(safe,pack,verified_routes=deepcopy(proof));self.assertEqual(candidate['phases'][0]['annotations'][0]['type'],'route')
        self.assertEqual(facts,before)
        from tactics_visual_facts import VisualFactsFailure
        for invalid in [list(proof),json.loads(json.dumps(proof)),{'verifiedRoutes':list(proof)}]:
            with self.assertRaises(VisualFactsFailure):compile_visual_facts(safe,pack,verified_routes=invalid)
        from tactics_visual_facts import AuditedRoutes
        with self.assertRaises(TypeError):AuditedRoutes(list(proof),facts=safe,pack=pack,raw_facts=facts)
        injected=deepcopy(safe);injected['verifiedRoutes']=json.loads(json.dumps(proof))
        with self.assertRaises(VisualFactsFailure):compile_visual_facts(injected,pack)
        for change in ['image_sha','image_order','range','dims','cuts','route_points','meaning','anchor','person','observation']:
            changed_pack,changed=deepcopy(pack),deepcopy(safe)
            if change=='image_sha':changed_pack['images'][0]['sha256']='wrong-source-image'
            if change=='image_order':changed_pack['images'].reverse()
            if change=='range':changed_pack['analysisRange']['endFrameExclusive']=11
            if change=='dims':changed_pack['width']+=1
            if change=='cuts':changed_pack['sampling']['cutFrames']=[5]
            if change=='route_points':changed['routes'][0]['points'][1][0]+=1
            if change=='meaning':changed['routes'][0]['meaning']='current_action'
            if change=='anchor':changed['routes'][0]['anchorFrame']=5
            if change=='person':changed['routes'][0]['personId']='dark'
            if change=='observation':changed['people'][0]['observations'][-1]['foot'][0]+=1
            with self.subTest(change=change),self.assertRaises(VisualFactsFailure):compile_visual_facts(changed,changed_pack,verified_routes=proof)
        corrupt=deepcopy(proof);corrupt[0]['route']['points'][1][0]+=1
        with self.assertRaises(VisualFactsFailure):compile_visual_facts(safe,pack,verified_routes=corrupt)

    def test_accepted_original_coordinates_and_evidence_unchanged(self):
        pack,facts=fixture();audit=accepted();before=deepcopy((pack,facts,audit))
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(safe,facts);self.assertEqual((pack,facts,audit),before)
        self.assertTrue(report['allApproved']);self.assertTrue(report['complete'])
        self.assertEqual(report['status'],'approved');self.assertEqual(report['exceptionItems'],[])
        candidate,_=compile_visual_facts(safe,pack)
        self.assertEqual(candidate['phases'][0]['annotations'][0]['points'][0],{'x':100,'y':200})

    def test_reject_identity_keeps_positions_not_fake_static(self):
        pack,facts=fixture();audit=accepted();r=audit['routes'][0]
        r.update(verdict='reject',identity='different',reason='白衣4号被接成同帧另外的卷发1号')
        r['observations'][-1]['jersey']='1'
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(safe['routes'],[]);self.assertEqual(safe['people'][0]['action'],'unknown')
        self.assertEqual(safe['people'][0]['observations'],facts['people'][0]['observations'])
        self.assertEqual(safe['static'],facts['static']);self.assertEqual(report['status'],'manual_review')
        self.assertFalse(report['allApproved']);self.assertEqual(report['originalActions']['white'],'cut')
        self.assertEqual(report['repairNeeds'][0]['evidenceFrames'],[0,5,9])
        self.assertEqual(report['repairNeeds'][0]['requestedRange'],{'startFrame':0,'endFrameExclusive':10})
        compile_visual_facts(safe,pack)

    def test_uncertain_does_not_block_other_accepted_route(self):
        pack,facts=fixture();facts['people'][1].update(action='move',observations=[{'frame':0,'foot':[500,500]},{'frame':5,'foot':[550,500]}])
        facts['routes'].append(dict(facts['routes'][0],personId='dark',evidenceFrames=[0,5],points=[[500,500],[550,500]]))
        audit=accepted();audit['routes'][0].update(verdict='uncertain',identity='uncertain')
        audit['routes'].append(dict(audit['routes'][0],routeIndex=1,personId='dark',verdict='accept',identity='same',
            observations=[{'frame':f,'identityBasis':'distinctive_appearance','jersey':None,'team':'dark','participantKind':'on_court_player','reason':'深色队服短发高个，脚点旁无同样外观的人'} for f in [0,5]]))
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual([r['personId'] for r in safe['routes']],['dark'])
        self.assertEqual(safe['people'][0]['action'],'unknown');self.assertEqual(safe['people'][1]['action'],'move')
        self.assertFalse(report['allApproved']);compile_visual_facts(safe,pack)

    def test_accept_without_identity_or_with_merging_or_mismatched_number_is_blocked(self):
        for change in ['missing_basis','merged','number','geometry','camera','cut','unreadable_team','changed_team']:
            with self.subTest(change=change):
                pack,facts=fixture();audit=accepted();r=audit['routes'][0]
                if change=='missing_basis':r['observations'][1]['identityBasis']='insufficient'
                if change=='merged':r['mergedPeople']=True
                if change=='number':r['observations'][1]['jersey']='1'
                if change=='geometry':r['geometry']='misaligned'
                if change=='camera':r['camera']='unresolved'
                if change=='cut':pack['sampling']['cutFrames']=[5]
                if change=='unreadable_team':r['observations'][1]['team']='unreadable'
                if change=='changed_team':r['observations'][1]['team']='dark'
                safe,report=apply_visual_audit(facts,audit,pack)
                self.assertEqual(safe['routes'],[]);self.assertFalse(report['allApproved'])

    def test_ball_requires_visible_control_not_role_and_preserves_positions(self):
        for control in ['other_person','not_visible']:
            pack,facts=fixture();facts['people'][0]['role']='ball_handler';audit=accepted()
            audit['ball'][0]['control']=control
            safe,report=apply_visual_audit(facts,audit,pack)
            self.assertEqual(safe['ball'],[]);self.assertEqual(safe['people'],facts['people'])
            self.assertFalse(report['allApproved']);self.assertEqual(report['acceptedRoutes'],1)

    def test_missing_duplicate_bad_reference_or_extra_keys_fail_closed(self):
        for change in ['route_missing','ball_missing','duplicate','person','frame','index','extra','basis_number','bool']:
            with self.subTest(change=change):
                pack,facts=fixture();audit=accepted()
                if change=='route_missing':audit['routes']=[]
                if change=='ball_missing':audit['ball']=[]
                if change=='duplicate':audit['routes']*=2
                if change=='person':audit['routes'][0]['personId']='dark'
                if change=='frame':audit['routes'][0]['observations'][-1]['frame']=5
                if change=='index':audit['routes'][0]['routeIndex']=1
                if change=='extra':audit['ok']=True
                if change=='basis_number':audit['routes'][0]['observations'][0]['jersey']=4
                if change=='bool':audit['routes'][0]['mergedPeople']='false'
                with self.assertRaises(VisualAuditFailure):apply_visual_audit(facts,audit,pack)

    def test_batch_exact_stage_set_and_no_cross_stage_adoption(self):
        pack,facts=fixture();stages=[{'stageId':'s1','pack':pack,'facts':facts},{'stageId':'s2','pack':pack,'facts':facts}]
        audit={'stages':[{'stageId':s['stageId'],'audit':accepted()} for s in stages]}
        before=deepcopy(stages);result=apply_visual_audit_batch(stages,audit)
        self.assertEqual(set(result),{'s1','s2'});self.assertEqual(stages,before)
        for rows in [audit['stages'][:1],[audit['stages'][0]]*2,[dict(audit['stages'][0],stageId='s3'),audit['stages'][1]]]:
            with self.assertRaises(VisualAuditFailure):apply_visual_audit_batch(stages,{'stages':rows})
        self.assertEqual(visual_audit_batch_schema(stages)['properties']['stages']['minItems'],2)
        self.assertIn('stageId',visual_audit_batch_prompt(stages))
        self.assertIn('"attachmentOrder":[{"stageId":"s1","frames":[0,5,9]},{"stageId":"s2","frames":[0,5,9]}]',visual_audit_batch_prompt(stages))

    def test_prompt_is_blind_to_role_and_contains_original_geometry_all_people(self):
        pack,facts=fixture();prompt=visual_audit_prompt(pack,facts)
        self.assertIn('原始',prompt);self.assertIn('相机',prompt);self.assertIn('球',prompt)
        self.assertIn('"points":[[100,200],[200,250],[300,300]]',prompt)
        self.assertIn('"id":"dark"',prompt);self.assertNotIn('沿禁区线切入',prompt)
        self.assertNotIn('"role":',prompt);self.assertNotIn('contactSheet',prompt)
        schema=visual_audit_schema(pack,facts)
        self.assertEqual(schema['properties']['routes']['minItems'],1)
        json.dumps(schema)

    def test_batch_prompt_audits_reference_frame_illustration_without_requiring_measurement_precision(self):
        pack,facts=fixture();stages=[{'stageId':'s1','pack':pack,'facts':facts}]
        before=deepcopy(stages);schema=visual_audit_batch_schema(stages)
        prompt=visual_audit_batch_prompt(stages)
        for rule in ['reference_frame_visual_approximation','同一真实人','已观察动作','同一地板区域','大致终区',
                     '不要求米制或像素精确','仅缺精确测量不能单独判uncertain','轻微脚步或线宽尺度的示意偏差']:
            self.assertIn(rule,prompt)
        self.assertEqual(stages,before);self.assertEqual(visual_audit_batch_schema(stages),schema)
        self.assertIn('"points":[[100,200],[200,250],[300,300]]',prompt)

    def test_batch_prompt_keeps_contradiction_gates_and_demands_specific_camera_evidence(self):
        pack,facts=fixture();prompt=visual_audit_batch_prompt([{'stageId':'s1','pack':pack,'facts':facts}])
        for rule in ['方向单独正确不够','静态地板参照','为何位移不是镜头平移','错地板区域或方向',
                     '错脚串人','越切镜','no_large_contradiction','unavailable','不构成正面许可',
                     '每个reason最多70字','不得直接复制roughH','不授予可信证明']:
            self.assertIn(rule,prompt)
        self.assertIn('每route的全部evidenceFrames逐帧',prompt)
        self.assertIn('同帧同时可见的另一球员',prompt)
        self.assertIn('原图真实可见落地脚点',prompt)

    def test_person_with_another_accepted_route_keeps_motion(self):
        pack,facts=fixture();facts['routes'].append(dict(deepcopy(facts['routes'][0]),points=[[100,200],[250,350]]));audit=accepted()
        audit['routes'].append(dict(deepcopy(audit['routes'][0]),routeIndex=1,verdict='reject',identity='different'))
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(len(safe['routes']),1);self.assertEqual(safe['people'][0]['action'],'cut')
        self.assertFalse(report['allApproved'])

    def test_invalid_source_coordinates_and_unobserved_frame_are_rejected(self):
        for change in ['point','observation','frame']:
            pack,facts=fixture()
            if change=='point':facts['routes'][0]['points'][1]=[2000,200]
            if change=='observation':facts['people'][0]['observations'][1]['foot']=[200,-1]
            if change=='frame':facts['routes'][0]['evidenceFrames']=[0,5,8]
            with self.assertRaises(VisualAuditFailure):apply_visual_audit(facts,accepted(),pack)

    def test_empty_audit_does_not_claim_automatic_coverage(self):
        pack,facts=fixture();facts['routes']=[];facts['ball']=[]
        safe,report=apply_visual_audit(facts,{'routes':[],'ball':[],'peopleReviewed':['white','dark'],'peopleIssues':[],
                                           'frameReviewed':[0,5,9],'frameIssues':[]},pack)
        self.assertFalse(report['allApproved']);self.assertEqual(safe['people'][0]['action'],'unknown')
        self.assertEqual(safe['people'][0]['observations'],facts['people'][0]['observations'])
        self.assertEqual(report['originalActions']['white'],'cut')

    def test_explicit_decisions_and_repair_references_keep_original_index(self):
        pack,facts=fixture();audit=accepted();audit['ball'][0].update(verdict='reject',control='other_person')
        _,report=apply_visual_audit(facts,audit,pack)
        need=report['repairNeeds'][0]
        self.assertEqual((need['kind'],need['itemIndex'],need['frames']),('ball',0,[0]))
        self.assertEqual(report['decisions'][0]['verdict'],'accept')
        self.assertEqual(report['decisions'][1]['verdict'],'reject')

    def test_referee_or_bench_cannot_get_route_or_possession_approval(self):
        for kind in ['referee','bench','audience','uncertain','other_team']:
            pack,facts=fixture();audit=accepted()
            for row in audit['routes'][0]['observations']:
                if kind=='other_team':row.update(team='other',jersey='83')
                else:row['participantKind']=kind
            audit['ball'][0]['participantKind']='referee'
            safe,report=apply_visual_audit(facts,audit,pack)
            self.assertEqual((safe['routes'],safe['ball']),([],[]));self.assertFalse(report['allApproved'])
            if kind!='other_team':
                if kind!='uncertain':self.assertNotIn('white',[p['id'] for p in safe['people']])

    def test_all_people_must_be_reviewed_and_issues_are_exact_observed_references(self):
        for change in ['missing','duplicate','foreign','unknown_frame','extra']:
            pack,facts=fixture();audit=accepted()
            if change=='missing':audit['peopleReviewed']=['white']
            if change=='duplicate':audit['peopleReviewed']=['white','white']
            if change=='foreign':audit['peopleReviewed']=['white','bench']
            if change=='unknown_frame':audit['peopleIssues']=[{'personId':'dark','frame':5,'code':'bench','reason':'坐在替补席'}]
            if change=='extra':audit['peopleIssues']=[{'personId':'foreign','frame':0,'code':'bench','reason':'坐在替补席'}]
            with self.assertRaises(VisualAuditFailure):apply_visual_audit(facts,audit,pack)

    def test_bench_exclusion_removes_static_and_all_owned_drawings_keeps_raw_evidence(self):
        for code in ['bench','non_player']:
            pack,facts=fixture();facts['static']=[{'personId':'dark','frame':0,'point':[500,500]}];before=deepcopy(facts)
            audit=accepted();audit['peopleIssues']=[{'personId':'dark','frame':0,'code':code,'reason':'场外坐着的替补或工作人员'}]
            safe,report=apply_visual_audit(facts,audit,pack)
            self.assertEqual([p['id'] for p in safe['people']],['white']);self.assertEqual(safe['static'],[])
            self.assertEqual(report['excludedPeople'],[facts['people'][1]]);self.assertEqual(facts,before)
            self.assertEqual(report['repairNeeds'][0]['kind'],'person');self.assertFalse(report['allApproved'])
            compile_visual_facts(safe,pack)

    def test_wrong_foot_removes_only_that_observation_and_dependent_graphics(self):
        pack,facts=fixture();audit=accepted();before=deepcopy(facts)
        audit['peopleIssues']=[{'personId':'white','frame':5,'code':'wrong_foot','reason':'脚点落在旁边另一人的鞋子上'}]
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual([o['frame'] for o in safe['people'][0]['observations']],[0,9])
        self.assertEqual(safe['routes'],[]);self.assertEqual(safe['ball'],facts['ball']);self.assertEqual(facts,before)
        self.assertEqual(safe['people'][0]['action'],'unknown');self.assertFalse(report['allApproved'])
        self.assertEqual(report['excludedObservations'][0]['observation'],facts['people'][0]['observations'][1])

    def test_missed_motion_does_not_succeed_as_static(self):
        pack,facts=fixture();audit=accepted()
        audit['peopleIssues']=[{'personId':'dark','frame':0,'code':'missed_motion','reason':'此人实际开始移动，不能标为保持位置'}]
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(safe['people'][1]['action'],'unknown');self.assertEqual(report['originalActions']['dark'],'hold')
        self.assertFalse(report['allApproved']);self.assertEqual(report['repairNeeds'][0]['code'],'missed_motion')

    def test_legitimate_all_static_can_be_approved_without_routes_or_ball(self):
        pack,facts=fixture();facts['people'][0]['action']='space';facts['routes']=[];facts['ball']=[]
        audit={'routes':[],'ball':[],'peopleReviewed':['white','dark'],'peopleIssues':[],
               'frameReviewed':[0,5,9],'frameIssues':[]}
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertTrue(report['allApproved']);compile_visual_facts(safe,pack)
        for p in facts['people']:p['action']='unknown'
        _,report=apply_visual_audit(facts,audit,pack);self.assertFalse(report['allApproved'])

    def test_bench_and_non_player_are_frame_scoped_not_whole_identity_deletion(self):
        for code in ['bench','non_player']:
            pack,facts=fixture();facts['static']=[{'personId':'white','frame':f,'point':facts['people'][0]['observations'][i]['foot']} for i,f in enumerate([0,5,9])]
            audit=accepted();before=deepcopy(facts)
            audit['peopleIssues']=[{'personId':'white','frame':f,'code':code,'reason':'此帧错接篮后蓝上衣白裤替补，后续同id才是真白17'} for f in [0,5]]
            safe,report=apply_visual_audit(facts,audit,pack)
            white=next(p for p in safe['people'] if p['id']=='white')
            self.assertEqual(white['observations'],[facts['people'][0]['observations'][2]])
            self.assertEqual([s['frame'] for s in safe['static']],[9]);self.assertEqual(safe['routes'],[]);self.assertEqual(safe['ball'],[])
            self.assertEqual(report['excludedPeople'],[]);self.assertEqual(facts,before)
            self.assertEqual([n['frames'] for n in report['repairNeeds'][:2]],[[0],[5]])

    def test_all_input_frames_must_be_reviewed_exactly_once(self):
        for frames in [[0,5],[0,5,5],[0,5,8]]:
            pack,facts=fixture();audit=accepted();audit['frameReviewed']=frames
            with self.assertRaises(VisualAuditFailure):apply_visual_audit(facts,audit,pack)

    def test_visible_missing_player_blocks_approval_without_deleting_valid_figures(self):
        pack,facts=fixture();audit=accepted();before=deepcopy(facts)
        audit['frameIssues']=[{'frame':5,'code':'missed_on_court_player','reason':'禁区右侧有清楚场上防守球员未列入观察','foot':[900,600]}]
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(safe,facts);self.assertEqual(facts,before);self.assertFalse(report['allApproved'])
        need=report['repairNeeds'][0]
        self.assertEqual((need['kind'],need['personId'],need['frames']),('frame',None,[5]))
        self.assertTrue(need['allowNewLocalPerson']);self.assertEqual(need['foot'],[900,600])
        self.assertEqual(report['reviewedFrames'],3)

    def test_unclear_participants_are_an_exception_not_a_ten_person_quota(self):
        pack,facts=fixture();audit=accepted()
        audit['frameIssues']=[{'frame':9,'code':'unclear_participants','reason':'镜头特写遮住部分场上空间，不能判断其余人是否可见','foot':None}]
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(safe,facts);self.assertFalse(report['allApproved'])
        self.assertFalse(report['repairNeeds'][0]['allowNewLocalPerson'])
        self.assertEqual(report['repairNeeds'][0]['code'],'unclear_participants')
        audit['frameIssues']=[]
        _,report=apply_visual_audit(facts,audit,pack);self.assertTrue(report['allApproved'])

    def test_missing_player_hints_are_original_pixel_coordinates_and_not_fake_points(self):
        for foot in [[1921,50],[50,1081],[-1,50],[True,50],[float('nan'),50]]:
            pack,facts=fixture();audit=accepted()
            audit['frameIssues']=[{'frame':0,'code':'missed_on_court_player','reason':'边线漏人','foot':foot}]
            with self.assertRaises(VisualAuditFailure):apply_visual_audit(facts,audit,pack)
        pack,facts=fixture();audit=accepted()
        audit['frameIssues']=[{'frame':0,'code':'missed_on_court_player','reason':'球员上身明确可见但脚部被遮挡','foot':None}]
        safe,report=apply_visual_audit(facts,audit,pack)
        self.assertEqual(safe,facts);self.assertFalse(report['allApproved'])
        self.assertFalse(report['repairNeeds'][0]['allowNewLocalPerson'])
        self.assertEqual(report['repairNeeds'][0]['code'],'unclear_participants')

    def test_frame_issues_cannot_duplicate_or_reference_foreign_frames(self):
        pack,facts=fixture();audit=accepted()
        issue={'frame':0,'code':'missed_on_court_player','reason':'漏掉一位可见球员','foot':[700,700]}
        for issues in [[issue,deepcopy(issue)],[dict(issue,frame=8)]]:
            audit['frameIssues']=issues
            with self.assertRaises(VisualAuditFailure):apply_visual_audit(facts,audit,pack)

    def test_prompt_requires_visible_participant_coverage_without_quota(self):
        pack,facts=fixture();prompt=visual_audit_prompt(pack,facts)
        self.assertIn('frameReviewed',prompt);self.assertIn('missed_on_court_player',prompt)
        self.assertIn('不要求',prompt);self.assertIn('10',prompt)

    def test_no_visible_feet_exception_never_authorizes_new_ground_points(self):
        pack,facts=fixture();audit=accepted()
        facts['frameExceptions']=[{'frame':5,'scope':'no_visible_feet','reason':'特写只有上半身'}]
        audit['frameIssues']=[{'frame':5,'code':'missed_on_court_player','reason':'上半身可见，但要先核对是否有脚部','foot':[900,600]}]
        _,report=apply_visual_audit(facts,audit,pack)
        self.assertFalse(report['repairNeeds'][0]['allowNewLocalPerson'])
        self.assertEqual(report['repairNeeds'][0]['code'],'unclear_participants')
        self.assertFalse(report['allApproved'])

    def test_prompts_define_ground_contact_and_do_not_guess_upper_body_feet(self):
        from tactics_visual_facts import visual_facts_prompt
        pack,facts=fixture()
        facts_prompt=visual_facts_prompt(pack)
        self.assertIn('整个阶段',facts_prompt);self.assertIn('有route',facts_prompt)
        self.assertIn('两脚中点',facts_prompt);self.assertIn('上半身',facts_prompt);self.assertIn('不能猜',facts_prompt)
        audit_prompt=visual_audit_prompt(pack,facts)
        self.assertIn('两脚中点',audit_prompt);self.assertIn('上半身',audit_prompt)
        self.assertIn('不得要求新增',audit_prompt)


if __name__=='__main__':unittest.main()
