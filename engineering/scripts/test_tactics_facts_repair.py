from copy import deepcopy
import unittest

from test_tactics_facts_integration import facts_for
from tactics_visual_facts import VisualFactsFailure


class FactsRepairTests(unittest.TestCase):
    def setUp(self):
        self.pack={'width':1920,'height':1080,'images':[{'frame':f} for f in (0,10,20)],'sampling':{},
                   'analysisRange':{'startFrame':0,'endFrameExclusive':21},'evidenceFrames':[0,10,20]}
        self.old=facts_for(self.pack);self.old['routes']=self.old['routes'][:1]
        self.needs=[{'personId':'local-2','code':'moving_without_route','evidenceFrames':[0,10,20]}]

    def check(self,new,old=None,needs=None):
        from tactics_facts_repair import check_facts_repair
        return check_facts_repair(self.old if old is None else old,new,self.needs if needs is None else needs,self.pack)

    def test_target_movement_and_untargeted_people_cannot_be_downgraded_or_relocated(self):
        for change in ('all_hold','target_hold','other_note','remove_observation','relocate','route','ball'):
            value=facts_for(self.pack)
            if change=='all_hold':
                for p in value['people']:p['action']='hold'
                value['routes']=[]
            if change=='target_hold':value['people'][1]['action']='hold';value['routes']=value['routes'][:1]
            if change=='other_note':value['people'][0]['note']='changed'
            if change=='remove_observation':value['people'][0]['observations'].pop()
            if change=='relocate':value['people'][0]['observations'][0]['foot']=[900,900]
            if change=='route':value['routes'][0]['points'][1]=[900,900]
            if change=='ball':value['ball']=[]
            with self.subTest(change=change),self.assertRaises(VisualFactsFailure):self.check(value)

    def test_legitimate_target_route_addition_and_order_changes_are_accepted(self):
        value=facts_for(self.pack);value['people'].reverse();value['routes'].reverse()
        for person in value['people']:person['observations'].reverse()
        self.check(value)

    def test_bad_camera_route_can_be_repaired_without_touching_valid_other_route(self):
        old=facts_for(self.pack);old['routes'][1]['cameraReference']='unresolved'
        self.check(facts_for(self.pack),old,[{'personId':'local-2','code':'camera_reference','evidenceFrames':[0,10]}])

    def test_global_schema_error_can_be_fixed_but_valid_route_and_movement_survive(self):
        old=facts_for(self.pack);old['unexpected']='bad field'
        self.check(facts_for(self.pack),old,[])
        changed=facts_for(self.pack);changed['routes']=[]
        for p in changed['people']:p['action']='hold'
        with self.assertRaises(VisualFactsFailure):self.check(changed,old,[])

    def test_global_invalid_coordinate_does_not_freeze_invalid_point(self):
        old=facts_for(self.pack);old['people'][1]['observations'][0]['foot']=[99999,200]
        self.check(facts_for(self.pack),old,[])

    def test_new_people_and_new_observations_can_only_add_evidence(self):
        old=deepcopy(self.old)
        for person in old['people']:person['observations']=person['observations'][:2]
        value=facts_for(self.pack)
        value['people'].append({'id':'new-visible','role':'other','action':'unknown','continuity':'uncertain','note':'新可见人',
                                'observations':[{'frame':20,'foot':[400,400]}]})
        self.check(value,old)

    def test_repairing_typed_duplicate_foot_allows_only_its_dependent_route(self):
        old=facts_for(self.pack)
        old['people'][1]['observations'][0]['foot']=[100,200]
        old['routes'][1]['points'][0]=[100,200]
        needs=[{'personId':'local-2','code':'duplicate_local_observation','evidenceFrames':[0]}]
        self.check(facts_for(self.pack),old,needs)
        changed=facts_for(self.pack);changed['routes'][0]['points'][1]=[900,900]
        with self.assertRaises(VisualFactsFailure):self.check(changed,old,needs)

    def test_global_conflicting_duplicate_id_can_be_corrected_without_freezing_arbitrary_last_record(self):
        old=facts_for(self.pack);duplicate=deepcopy(old['people'][1]);duplicate['observations'][0]['foot']=[999,200]
        old['people'].append(duplicate)
        self.check(facts_for(self.pack),old,[])
