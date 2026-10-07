"""Geometry and coverage contracts for the compact model-facts boundary."""
from copy import deepcopy
import json
import shutil
import subprocess
import tempfile
import unittest
from tactics_visual_facts import compile_visual_facts, visual_facts_prompt, visual_facts_schema, VisualFactsFailure


def fixture():
    pack={'candidateVersion':4,'width':1920,'height':1080,'phaseId':'s1',
          'analysisRange':{'startFrame':0,'endFrameExclusive':10},'evidenceFrames':[0,5,9],
          'images':[{'frame':f} for f in [0,5,9]],'participantRequirements':['P1','P2'],
          'playDefinition':{'phases':[{'phaseId':'s1','freezeFrame':0}], 'participants':[{'id':'P1'},{'id':'P2'}]},
          'sampling':{'cutFrames':[]},'imageEncoding':{'contactSheet':{'tiles':[{'frame':0,'rect':{'x':0,'y':32,'width':768,'height':432},'scale':{'x':.4,'y':.4}}]}}}
    facts={'summary':'切入与补防','people':[
        {'id':'white','role':'off_ball','action':'cut','continuity':'observed','note':'沿禁区线切入',
         'observations':[{'frame':0,'foot':[100,200]},{'frame':5,'foot':[200,250]},{'frame':9,'foot':[300,300]}]},
        {'id':'dark','role':'defender','action':'hold','continuity':'observed','note':'保持弱侧位置',
         'observations':[{'frame':0,'foot':[500,500]}]}],
        'routes':[{'personId':'white','anchorFrame':0,'evidenceFrames':[0,5,9],'points':[[100,200],[200,250],[300,300]],
                   'meaning':'later_observed_action','cameraReference':'landmark_aligned','note':'参照禁区线表达观察到的切入'}],
        'ball':[{'personId':'white','frame':0,'point':[100,200]}], 'static':[], 'frameExceptions':[], 'issues':[]}
    return pack,facts


class VisualFactsTests(unittest.TestCase):
    def failure(self,pack,facts,code):
        with self.assertRaises(VisualFactsFailure) as caught: compile_visual_facts(facts,pack)
        self.assertEqual(caught.exception.code,code)
        return caught.exception

    def test_real_three_point_route_fixed_coverage_and_no_mutation(self):
        pack,facts=fixture();original=deepcopy((pack,facts))
        candidate,report=compile_visual_facts(facts,pack)
        self.assertEqual((pack,facts),original)
        phase=candidate['phases'][0]
        self.assertEqual((phase['startFrame'],phase['endFrameExclusive']),(0,10))
        route=phase['annotations'][0]
        self.assertEqual(route['points'],[{'x':p[0],'y':p[1]} for p in facts['routes'][0]['points']])
        self.assertEqual(route['pattern'],'dashed')
        self.assertEqual([p['entityId'] for p in phase['participants'][-2:]],['P1','P2'])
        self.assertTrue(all(a['entityId'] is None for a in phase['annotations']))
        self.assertEqual((report['observedPeople'],report['routePeople'],report['motionPeople'],report['actualRoutes']),(2,1,1,1))
        self.assertEqual(report['exceptionItems'],[])
        self.assertEqual(next(a for a in phase['annotations'] if a['type']=='spotlight')['endFrameExclusive'],1)

    def test_missing_motion_is_targeted_not_static_success(self):
        pack,facts=fixture();facts['routes']=[];facts['static']=[{'personId':'white','frame':0,'point':[100,200]}]
        failure=self.failure(pack,facts,'moving_without_route')
        self.assertEqual(failure.repairNeeds[0]['personId'],'white')
        self.assertEqual(failure.repairNeeds[0]['evidenceFrames'],[0,5,9])

    def test_route_action_contradiction(self):
        for action in ['hold','space','unknown','screen']:
            pack,facts=fixture();facts['people'][0]['action']=action
            self.failure(pack,facts,'action_route_contradiction')

    def test_reference_observation_and_evidence_are_required(self):
        pack,facts=fixture();facts['people'][0]['observations']=facts['people'][0]['observations'][1:]
        self.failure(pack,facts,'missing_anchor_observation')
        pack,facts=fixture();facts['routes'][0]['evidenceFrames']=[0,0]
        self.failure(pack,facts,'route_evidence')
        pack,facts=fixture();facts['routes'][0]['anchorFrame']=8
        self.failure(pack,facts,'facts_schema')
        pack,facts=fixture();facts['people'][0]['observations']=[]
        self.assertTrue(self.failure(pack,facts,'missing_person_observation').repairNeeds)

    def test_crosscut_unknown_identity_camera_and_zero_route(self):
        pack,facts=fixture();pack['sampling']['cutFrames']=[5]
        self.failure(pack,facts,'camera_reference')
        pack,facts=fixture();facts['people'][0]['continuity']='uncertain'
        self.failure(pack,facts,'identity_continuity')
        pack,facts=fixture();facts['routes'][0]['cameraReference']='unresolved'
        self.failure(pack,facts,'camera_reference')
        pack,facts=fixture();facts['routes'][0]['points']=[[100,200],[100,200]]
        self.failure(pack,facts,'zero_route')

    def test_marker_points_match_same_person_foot(self):
        pack,facts=fixture();facts['ball'][0]['point']=[500,500]
        self.failure(pack,facts,'holder_position')
        pack,facts=fixture();facts['static']=[{'personId':'dark','frame':0,'point':[100,200]}]
        self.failure(pack,facts,'static_position')
        pack,facts=fixture();facts['ball'].append({'personId':'dark','frame':0,'point':[500,500]})
        self.failure(pack,facts,'multiple_holders')

    def test_duplicate_forged_id_and_geometry(self):
        pack,facts=fixture();facts['people'].append(deepcopy(facts['people'][0]))
        self.failure(pack,facts,'duplicate_person')
        pack,facts=fixture();facts['people'][0]['id']='P1'
        self.failure(pack,facts,'fixed_identity_claim')
        pack,facts=fixture();facts['people'][0]['entityId']='P1'
        self.failure(pack,facts,'facts_schema')
        pack,facts=fixture();facts['routes'][0]['personId']='invented'
        self.failure(pack,facts,'unknown_person')
        pack,facts=fixture();facts['routes'][0]['points'][0][0]=float('nan')
        self.failure(pack,facts,'facts_schema')
        pack,facts=fixture();facts['routes'][0]['points'][0]=[1921,200]
        self.failure(pack,facts,'original_coordinates')
        pack,facts=fixture();facts['routes'].append(deepcopy(facts['routes'][0]))
        self.failure(pack,facts,'duplicate_route')
        pack,facts=fixture();facts['people'][1]['observations'][0]['foot']=[100,200]
        self.failure(pack,facts,'duplicate_local_observation')

    def test_closeup_and_small_view_no_arbitrary_player_quota(self):
        pack,facts=fixture();facts['people']=facts['people'][:1]
        facts['people'][0]['observations']=facts['people'][0]['observations'][:2]
        facts['routes'][0]['evidenceFrames']=[0,5]
        facts['frameExceptions']=[{'frame':9,'scope':'no_visible_feet','reason':'近景中脚点不在画面'}]
        _,report=compile_visual_facts(facts,pack)
        self.assertEqual(report['observedPeople'],1)
        self.assertEqual(len(report['exceptionItems']),1)
        self.assertEqual(report['fixedParticipantCount'],2)

    def test_frame_exceptions_are_explicit_and_honest(self):
        pack,facts=fixture();facts['people'][0]['observations'].pop();facts['routes'][0]['evidenceFrames']=[0,5]
        self.failure(pack,facts,'frame_unaccounted')
        pack,facts=fixture();facts['frameExceptions']=[{'frame':0,'scope':'no_visible_feet','reason':'无人可见'}]
        self.failure(pack,facts,'frame_exception_contradiction')
        pack,facts=fixture();facts['frameExceptions']=[{'frame':0,'scope':'partial_observation','reason':'另一个人被遮挡'}]
        self.assertEqual(len(compile_visual_facts(facts,pack)[1]['exceptionItems']),1)

    def test_static_is_real_but_empty_unknown_does_not_pass(self):
        pack,facts=fixture();facts['routes']=[];facts['ball']=[];facts['people'][0]['action']='hold'
        candidate,report=compile_visual_facts(facts,pack)
        self.assertEqual(report['routePeople'],0)
        self.assertTrue(all(a['type']=='position' for a in candidate['phases'][0]['annotations']))
        for person in facts['people']:person['action']='unknown'
        self.failure(pack,facts,'no_action_content')

    def test_capacity_rejects_without_silent_dropping(self):
        pack,facts=fixture();pack['participantRequirements']=['P'+str(i) for i in range(39)]
        pack['playDefinition']['participants']=[{'id':p} for p in pack['participantRequirements']]
        self.failure(pack,facts,'candidate_capacity')
        pack,facts=fixture();prototype=deepcopy(facts['people'][0]);route=deepcopy(facts['routes'][0])
        facts['people']=[];facts['routes']=[];facts['ball']=[]
        for i in range(24):
            person=deepcopy(prototype);person['id']='v'+str(i)
            for observation in person['observations']:observation['foot'][0]+=i
            facts['people'].append(person)
            item=deepcopy(route);item['personId']=person['id']
            for point in item['points']:point[0]+=i
            facts['routes'].append(item)
            facts['static'].append({'personId':person['id'],'frame':0,'point':[100+i,200]})
        self.failure(pack,facts,'candidate_capacity')

    def test_prompt_does_not_ship_large_rows_or_drop_obligations(self):
        pack,facts=fixture();pack['entities']={'rows':'large-secret-rows'};pack['document']={'dump':'large-secret-document'};pack['goal']='重点讲解切入'
        original=deepcopy(pack);prompt=visual_facts_prompt(pack,{'personId':'white','code':'moving_without_route'})
        self.assertEqual(pack,original)
        self.assertNotIn('large-secret',prompt)
        for term in ['P1','P2','landmark_aligned','no_visible_feet','moving_without_route','rect/scale','120','重点讲解切入','裁判、观众、教练不列入people']:
            self.assertIn(term,prompt)
        self.assertEqual(visual_facts_schema(pack)['properties']['routes']['items']['properties']['anchorFrame']['enum'],[0,5,9])

    def test_unknown_action_does_not_erase_visible_person(self):
        pack,facts=fixture();facts['people'][1]['action']='unknown'
        candidate,report=compile_visual_facts(facts,pack)
        person=candidate['phases'][0]['participants'][1]
        self.assertEqual(person['disposition'],'annotated')
        self.assertEqual(len(person['annotationIndexes']),1)
        self.assertEqual(candidate['phases'][0]['annotations'][person['annotationIndexes'][0]]['type'],'position')
        self.assertEqual(report['exceptionItems'],[{'personId':'dark','code':'action_uncertain','reason':'保持弱侧位置'}])

    @unittest.skipUnless(shutil.which('node'),'Node required for full source-binding validator')
    def test_candidate_passes_real_v4_validator_with_single_three_point_dashed_route(self):
        from tactical_workbench import TacticalWorkbench,ROOT
        script="import {makePresentationDemo} from './engineering/tools/tactical-overlay/fixtures/presentation-demo.mjs';import {createTacticsDocument} from './engineering/tools/player-review/tactics-document.mjs';console.log(JSON.stringify(await createTacticsDocument((await makePresentationDemo()).review)));"
        doc=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=ROOT))
        phase=doc['playDefinition']['phases'][0]
        pack,facts=fixture();pack['playDefinition']=deepcopy(doc['playDefinition']);pack['phaseId']=phase['phaseId']
        pack['participantRequirements']=[p['id'] for p in doc['playDefinition']['participants']]
        pack['analysisRange']={'startFrame':phase['startFrame'],'endFrameExclusive':phase['endFrameExclusive']}
        frames=[phase['freezeFrame'],phase['freezeFrame']+1,phase['freezeFrame']+2]
        pack['evidenceFrames']=frames;pack['images']=[{'frame':f} for f in frames]
        for person in facts['people']:
            for observation in person['observations']:observation['frame']=frames[[0,5,9].index(observation['frame'])]
        facts['routes'][0]['anchorFrame']=frames[0];facts['routes'][0]['evidenceFrames']=frames
        facts['ball'][0]['frame']=frames[0]
        candidate,report=compile_visual_facts(facts,pack)
        with tempfile.TemporaryDirectory() as folder:
            result=TacticalWorkbench(folder).run('agent-adopt',document=doc,candidate=candidate,
                     options={'scope':'phase','phaseId':phase['phaseId'],'jobId':'test-facts'})
        routes=[a for a in result['document']['annotations']['items'] if a['type']=='route']
        self.assertEqual(len(routes),1)
        self.assertEqual(len(routes[0]['points']),3)
        self.assertEqual(routes[0]['style']['pattern'],'dashed')
        self.assertEqual(report['actualRoutes'],1)


if __name__=='__main__':unittest.main()
