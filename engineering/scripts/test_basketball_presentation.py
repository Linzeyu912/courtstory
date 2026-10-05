"""Behavioral coverage for team presentation; geometry is never identity truth."""
import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
import tempfile

class TeamPresentationTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('basketball_presentation'), 'Team grouping and stable display implementation is missing')
        import basketball_presentation
        return basketball_presentation

    def test_grouping_does_not_force_unknown_conflicting_or_sixth_members(self):
        module=self.module()
        records=[]
        for frame in range(7):
            evidence={str(i):{'torso':{'label':'dark' if i<=6 else ('white' if i==7 else ('dark' if frame<3 else 'white')), 'reliable':i!=9,'template_safe':i!=9},'identity_review_required':False} for i in range(1,10)}
            records.append({'frame':frame,'time':frame*.04,'tracks':[[i*30,100,i*30+20,300,i,.9,2] for i in range(1,10)],'track_evidence':evidence})
        proposals={'version':1,'verified':False,'method':'old','entities':[{'id':f'P{i}','bindings':[{'trackId':i,'start':0,'end':6}]} for i in range(1,10)]}
        before=json.dumps(records,sort_keys=True);grouped=module.regroup_suggestions(proposals,records,module.load_policy())
        groups={group: [e for e in grouped['entities'] if e.get('teamGroup')==group] for group in ['A','B']}
        self.assertEqual(len(groups['A']),5);self.assertEqual(len(groups['B']),1)
        known={b['trackId'] for e in grouped['entities'] for b in e['bindings']}
        self.assertTrue({6,8,9}.isdisjoint(known));self.assertEqual(json.dumps(records,sort_keys=True),before)
        self.assertEqual([e['id'] for e in groups['A']],['P1','P2','P3','P4','P5']);self.assertEqual(groups['B'][0]['id'],'P6')
        self.assertFalse(grouped['verified']);self.assertTrue(all(not e.get('identityConfirmed',False) for e in grouped['entities']))

    def test_known_team_colors_survive_status_and_unknown_is_gray(self):
        module=self.module();policy=module.load_policy()
        for group in ['A','B']:
            proposed=module.overlay_style({'id':'P1','modelTeamGroup':group},{'source':'tracked','identitySource':'model_suggestion'},policy)
            locked=module.overlay_style({'id':'P1','teamGroup':group,'teamGroupSource':'human'},{'source':'manual','identitySource':'manual_forward'},policy)
            self.assertEqual(proposed['color'],locked['color']);self.assertTrue(proposed['dashed']);self.assertFalse(locked['dashed'])
        self.assertIsNone(module.overlay_style({'id':'P5'},{'source':'tracked'},policy)['group'])

    def test_identity_and_team_confirmations_are_independent_in_video_overlay(self):
        module=self.module();policy=module.load_policy();entity={'id':'P1','modelTeamGroup':'A'}
        point={'source':'tracked','identitySource':'manual_forward'}
        identity_only=module.overlay_style(entity,point,policy)
        self.assertTrue(identity_only['dashed']);self.assertEqual(identity_only['label'],'1?')
        entity.update(teamGroup='A',teamGroupSource='human')
        both=module.overlay_style(entity,point,policy)
        self.assertEqual(both['color'],identity_only['color']);self.assertFalse(both['dashed']);self.assertEqual(both['label'],'1')
        group_only=module.overlay_style(entity,{**point,'identitySource':'model_suggestion'},policy)
        self.assertTrue(group_only['dashed']);self.assertEqual(group_only['label'],'1?')

    def test_weak_third_color_does_not_displace_the_dominant_dark_white_pair(self):
        module=self.module();records=[]
        for frame in range(100):
            ids=[1,2]+([3] if frame<3 else [])
            records.append({'frame':frame,'time':frame*.04,'tracks':[[i*30,100,i*30+20,300,i,.9,2] for i in ids],
                'track_evidence':{str(i):{'torso':{'label':{1:'dark',2:'white',3:'red'}[i],'reliable':True,'template_safe':True}} for i in ids}})
        proposals={'version':1,'verified':False,'method':'old','entities':[
            {'id':f'P{i}','bindings':[{'trackId':i,'start':0,'end':99 if i<3 else 2}]} for i in range(1,4)]}
        grouped=module.regroup_suggestions(proposals,records,module.load_policy())
        self.assertEqual(grouped['teamGrouping']['labels'],{'A':'dark','B':'white'})
        self.assertEqual({b['trackId'] for e in grouped['entities'] for b in e['bindings']},{1,2})
        self.assertEqual(grouped['unassignedTeamCandidates'][0]['trackIds'],[3])
        self.assertEqual(grouped['unassignedTeamCandidates'][0]['reason'],'third_team_color_pending')

    def test_missing_conflict_or_cut_does_not_get_a_new_position(self):
        module=self.module();policy=module.load_policy()
        raw=[{'frame':i,'time':i*.04,'x':150,'y':y,'box':[100,100,200,y],'source':'tracked','trackId':1,'identitySource':'model_suggestion','identityStartFrame':0,'footMethod':'bbox_bottom_center'} for i,y in enumerate([300,301,380,303,304])]
        stable=module.stabilize_points(raw,[],1280,720,policy)
        self.assertLess(stable[2]['y'],330);self.assertEqual(raw[2]['y'],380)
        cut=module.stabilize_points(raw,[2],1280,720,policy);self.assertEqual(cut[2]['box'],raw[2]['box'])
        raw[1]={'frame':1,'time':.04,'x':None,'y':None,'source':'missing'}
        missing=module.stabilize_points(raw,[],1280,720,policy);self.assertIsNone(missing[1]['x']);self.assertEqual(missing[2]['box'],raw[2]['box'])

    def test_shared_fixture_matches_workbench_geometry_and_styles(self):
        module=self.module();policy=module.load_policy();workbench=module.POLICY_PATH.parent
        fixture=json.loads((workbench/'team-overlay-fixture.json').read_text())
        stable=module.stabilize_points(fixture['points'],fixture['cuts'],fixture['width'],fixture['height'],policy)
        self.assertEqual([p['y'] for p in stable],fixture['expectedY'])
        js="""import fs from 'node:fs';import {stabilizePoints,teamOverlayStyle} from './team-overlay.mjs';
const f=JSON.parse(fs.readFileSync('team-overlay-fixture.json','utf8')),p=JSON.parse(fs.readFileSync('team-overlay-policy.json','utf8'));
process.stdout.write(JSON.stringify({points:stabilizePoints(f.points,f.cuts,f.width,f.height,p),styles:f.entities.map(e=>teamOverlayStyle(e,f.points[0],p))}));"""
        observed=json.loads(subprocess.run(['node','--input-type=module','-e',js],cwd=workbench,check=True,capture_output=True,text=True).stdout)
        self.assertEqual(stable,observed['points']);self.assertEqual([module.overlay_style(e,fixture['points'][0],policy) for e in fixture['entities']],observed['styles'])

    def test_renderer_draws_two_team_colors_and_numbered_foot_estimates(self):
        import basketball_render
        import numpy as np
        self.assertTrue(callable(getattr(basketball_render,'draw_team_overlay',None)), 'Renderer needs the same grouped foot overlay as the workbench')
        policy=self.module().load_policy()
        image=np.zeros((240,320,3),dtype=np.uint8)
        record={'frame':0,'time':0,'tracks':[[40,80,80,180,1,.9,2],[160,80,200,180,2,.9,2]],'pending_detections':[]}
        entities=[{'id':'P1','modelTeamGroup':'A'},{'id':'P6','modelTeamGroup':'B'}]
        points=[{'x':60,'y':180,'box':[40,80,80,180],'trackId':1,'source':'tracked','identitySource':'model_suggestion'},
                {'x':180,'y':180,'box':[160,80,200,180],'trackId':2,'source':'tracked','identitySource':'model_suggestion'}]
        overlay=basketball_render.draw_team_overlay(image,record,'team-stable',list(zip(entities,points)),policy)
        # OpenCV stores BGR: fixed first row is red/attack, second row blue/defense.
        self.assertEqual(overlay[180,66].tolist(),[104,85,238]);self.assertEqual(overlay[180,186].tolist(),[237,149,66])

    def test_preparation_preserves_parent_bytes_and_refuses_overwrite(self):
        self.assertIsNotNone(importlib.util.find_spec('prepare_basketball_team_overlay'), 'Immutable presentation variant preparation is missing')
        import prepare_basketball_team_overlay as preparation
        with tempfile.TemporaryDirectory() as temporary:
            parent=Path(temporary)/'parent.json';target=Path(temporary)/'team-stable.json'
            records=[{'frame':i,'time':i*.04,'tracks':[[100,100,200,300,1,.9,2]],'pending_detections':[],
                'track_evidence':{'1':{'torso':{'label':'dark','reliable':True,'template_safe':True}}}} for i in range(5)]
            original=json.dumps(records,indent=2)+'\n';parent.write_text(original,encoding='utf-8')
            metadata={'video_sha256':'a'*64,'frames':5,'width':1280,'height':720,'identitySuggestions':{'version':1,'method':'old','verified':False,
                'entities':[{'id':'P7','bindings':[{'start':0,'end':4,'trackId':1}]}]}}
            parent.with_suffix('.meta.json').write_text(json.dumps(metadata),encoding='utf-8')
            preparation.prepare_variant(parent,target,self.module().load_policy())
            self.assertEqual(target.read_bytes(),parent.read_bytes());self.assertEqual(parent.read_text(encoding='utf-8'),original)
            meta=json.loads(target.with_suffix('.meta.json').read_text())
            self.assertEqual(meta['identitySuggestions']['entities'][0]['id'],'P1');self.assertFalse(meta['identity_verified'])
            self.assertEqual(meta['presentation']['source_records_unchanged'],True);self.assertEqual(meta['parent_tracking']['variant'],'optimized')
            before=target.read_bytes()
            with self.assertRaises(FileExistsError):preparation.prepare_variant(parent,target,self.module().load_policy())
            self.assertEqual(target.read_bytes(),before)
            separate=parent.with_name('optimized.meta.json')
            separate.write_bytes(parent.with_suffix('.meta.json').read_bytes())
            parent.with_suffix('.meta.json').write_text('{}',encoding='utf-8')
            shared_target=target.with_name('shared-team.json')
            preparation.prepare_variant(parent,shared_target,self.module().load_policy(),metadata_path=separate)
            shared_meta=json.loads(shared_target.with_suffix('.meta.json').read_text())
            self.assertEqual(shared_target.read_bytes(),before)
            self.assertEqual(shared_meta['identitySuggestions'],meta['identitySuggestions'])
            self.assertEqual(shared_meta['parent_tracking'],meta['parent_tracking'])

if __name__=='__main__':unittest.main()
