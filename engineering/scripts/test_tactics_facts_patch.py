from copy import deepcopy
import unittest

from test_tactics_visual_facts import fixture
from tactics_visual_facts import compile_visual_facts
from tactics_facts_patch import facts_patch_schema, facts_patch_prompt, apply_facts_patch, FactsPatchFailure


def empty_patch(stage_id='stage-1'):
    return dict(stageId=stage_id, observations=[], actions=[], routes=[], ball=[], peopleAdded=[], routesAdded=[], staticAdded=[], unresolved=[])


class FactsPatchTests(unittest.TestCase):
    def setUp(self):
        self.pack,self.facts=fixture()
        self.needs=[dict(itemType='routes',itemIndex=0,personId='white',evidenceFrames=[0,5,9],code='route_pending',reason='参考帧路线终点错误')]

    def stages(self, needs=None):
        return [dict(stageId='stage-1',pack=self.pack,facts=self.facts,repairNeeds=self.needs if needs is None else needs)]

    def test_small_route_patch_preserves_original_scope_and_every_other_fact(self):
        stages=self.stages();before=deepcopy(stages);patch=empty_patch()
        patch['routes']=[dict(routeIndex=0,points=[[100,200],[210,240],[310,290]],cameraReference='landmark_aligned',note='按原图修正终点')]
        changed=apply_facts_patch(stages,{'stages':[patch]})['stage-1']
        self.assertEqual(stages,before)
        for key in ('personId','anchorFrame','evidenceFrames','meaning'):
            self.assertEqual(changed['routes'][0][key],self.facts['routes'][0][key])
        for key in ('people','ball','static','frameExceptions'):self.assertEqual(changed[key],self.facts[key])
        compile_visual_facts(changed,self.pack)

    def test_forbidden_indices_extra_paths_duplicate_edits_and_scope_changes_fail_closed(self):
        for change in ('index','scope','path','duplicate','wrong_stage','nan'):
            patch=empty_patch();edit=dict(routeIndex=0,points=[[100,200],[200,250]],cameraReference='same_view',note='目标修改')
            patch['routes']=[edit]
            if change=='index':edit['routeIndex']=1
            if change=='scope':edit['evidenceFrames']=[0,5]
            if change=='path':patch['path']='people/0'
            if change=='duplicate':patch['routes']*=2
            if change=='wrong_stage':patch['stageId']='other'
            if change=='nan':edit['points'][1][0]=float('nan')
            with self.subTest(change=change),self.assertRaises(FactsPatchFailure):apply_facts_patch(self.stages(),{'stages':[patch]})

    def test_ball_changes_holder_but_host_owns_frame_and_foot(self):
        needs=[dict(itemType='ball',itemIndex=0,personId='white',evidenceFrames=[0],code='ball_pending')]
        patch=empty_patch();patch['ball']=[dict(ballIndex=0,personId='dark')]
        changed=apply_facts_patch(self.stages(needs),{'stages':[patch]})['stage-1']
        self.assertEqual(changed['ball'][0],{'personId':'dark','frame':0,'point':self.facts['people'][1]['observations'][0]['foot']})
        patch['ball'][0]['frame']=5
        with self.assertRaises(FactsPatchFailure):apply_facts_patch(self.stages(needs),{'stages':[patch]})

    def test_accepted_observations_and_moving_action_cannot_be_downgraded(self):
        for field in ('observations','actions'):
            patch=empty_patch()
            patch[field]=[dict(personId='white',frame=0,foot=[120,220])] if field=='observations' else [dict(personId='white',action='hold',continuity='observed',note='改静止绕过')]
            with self.subTest(field=field),self.assertRaises(FactsPatchFailure):apply_facts_patch(self.stages(),{'stages':[patch]})

    def test_new_person_requires_explicit_clear_missed_player_frame(self):
        patch=empty_patch();patch['peopleAdded']=[dict(id='extra',role='defender',action='hold',observations=[dict(frame=5,foot=[450,350])],continuity='observed',note='清晰漏人')]
        for allowed in (False,True):
            needs=[dict(itemType='frames',itemIndex=1,personId=None,evidenceFrames=[5],code='missed_on_court_player' if allowed else 'unclear_participants',allowNewLocalPerson=allowed)]
            if allowed:
                changed=apply_facts_patch(self.stages(needs),{'stages':[patch]})['stage-1'];self.assertEqual(len(changed['people']),3)
            else:
                with self.assertRaises(FactsPatchFailure):apply_facts_patch(self.stages(needs),{'stages':[patch]})

    def test_prompt_and_schema_request_only_edits_and_leave_unmodified_facts_with_host(self):
        schema=facts_patch_schema(self.stages());prompt=facts_patch_prompt(self.stages())
        self.assertNotIn('"facts"',prompt);self.assertIn('routeIndex',prompt)
        variant=schema['properties']['stages']['items']['anyOf'][0]
        self.assertNotIn('facts',variant['properties'])
        self.assertNotIn('evidenceFrames',variant['properties']['routes']['items']['properties'])

    def test_missed_motion_can_add_evidence_and_route_but_cannot_rewrite_other_person(self):
        needs=[dict(itemType='people',itemIndex=1,personId='dark',evidenceFrames=[0],code='missed_motion')]
        self.facts['people'][1]['continuity']='uncertain'
        patch=empty_patch();patch['actions']=[dict(personId='dark',action='move',continuity='observed',note='清晰后续移动')]
        foot=self.facts['people'][1]['observations'][0]['foot']
        patch['observations']=[dict(personId='dark',frame=5,foot=[foot[0]+40,foot[1]])]
        patch['routesAdded']=[dict(personId='dark',anchorFrame=0,evidenceFrames=[0,5],points=[foot,[foot[0]+40,foot[1]]],
                                  meaning='current_action',cameraReference='same_view',note='实际移动')]
        changed=apply_facts_patch(self.stages(needs),{'stages':[patch]})['stage-1']
        self.assertEqual(changed['people'][0],self.facts['people'][0]);compile_visual_facts(changed,self.pack)
        with self.assertRaises(FactsPatchFailure):apply_facts_patch(self.stages([]),{'stages':[patch]})

    def test_wrong_foot_updates_only_dependent_static_marker_and_passes_native_facts_contract(self):
        self.facts['static']=[dict(personId='dark',frame=0,point=deepcopy(self.facts['people'][1]['observations'][0]['foot']))]
        needs=[dict(itemType='people',itemIndex=1,personId='dark',evidenceFrames=[0],code='wrong_foot')]
        patch=empty_patch();patch['observations']=[dict(personId='dark',frame=0,foot=[600,600])]
        changed=apply_facts_patch(self.stages(needs),{'stages':[patch]})['stage-1']
        self.assertEqual(changed['static'][0]['point'],[600,600])
        self.assertEqual(changed['people'][0],self.facts['people'][0])
        self.assertEqual(changed['routes'],self.facts['routes'])
        compile_visual_facts(changed,self.pack)

    def test_auditor_missed_motion_cannot_be_downgraded_when_original_action_was_unknown(self):
        self.facts['people'][1].update(action='unknown',continuity='uncertain')
        needs=[dict(itemType='people',itemIndex=1,personId='dark',evidenceFrames=[0],code='missed_motion')]
        for action in ('hold','space','screen','unknown'):
            patch=empty_patch();patch['actions']=[dict(personId='dark',action=action,continuity='observed',note='尝试静止通过')]
            with self.subTest(action=action),self.assertRaises(FactsPatchFailure):apply_facts_patch(self.stages(needs),{'stages':[patch]})
        unresolved=empty_patch();unresolved['unresolved']=['漏运动仍无法确认，保留明确例外']
        self.assertEqual(apply_facts_patch(self.stages(needs),{'stages':[unresolved]})['stage-1'],self.facts)


if __name__=='__main__':unittest.main()
