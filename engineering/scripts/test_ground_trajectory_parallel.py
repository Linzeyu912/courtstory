import json,tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
from ground_trajectory_parallel import ParallelGroundMapping,with_binding_boundaries,provider_requires_stop

class ParallelTests(unittest.TestCase):
    def test_provider_stop_distinguishes_billing_authentication_from_transient_errors(self):
        for error in ['HTTP 401','creditsExhausted','InsufficientQuota','monthly quota exhausted']:
            self.assertTrue(provider_requires_stop(error),error)
        for error in ['HTTP 429 Throttling.RateQuota','Throttling.AllocationQuota','Connection error.','Request timed out.']:
            self.assertFalse(provider_requires_stop(error),error)

    def test_binding_change_marks_a_break_without_changing_frozen_points(self):
        rows=[{'frame':f,'x':float(f),'y':1} for f in range(5)]
        entity={'bindings':[{'kind':'track','trackId':7,'start':0,'end':1},
            {'kind':'track','trackId':12,'start':2,'end':3},{'kind':'track','trackId':12,'start':4,'end':4}]}
        result=with_binding_boundaries(rows,entity)
        self.assertNotIn('breakBefore',rows[2]);self.assertTrue(result[2]['breakBefore'])
        self.assertNotIn('breakBefore',result[4])
        self.assertEqual([(p['x'],p['y']) for p in result],[(p['x'],p['y']) for p in rows])

    def test_ranges_respect_cuts_and_ownership_merges_once_without_source_edits(self):
        self.assertEqual(ParallelGroundMapping.intervals(12,[5],4),[(0,4),(4,5),(5,9),(9,12)])
        class Tactics:
            def frames(self,video,clip,indices):return [{'frame':f,'dataUrl':'x'} for f in indices]
        class FakeAgent:
            def __init__(self,*args,**kwargs):self.jobs={};self.lock=threading.RLock()
            def status(self):return {'available':True}
            def create(self,request,clip,*args):
                pid=request['entityIds'][0];ident=pid;start=request['range']['startFrame'];end=request['range']['endFrameExclusive']
                with self.lock:self.jobs[ident]={'status':'observing','usage':{'requests':1},'request':request}
                return {'jobId':ident}
            def get(self,ident,clip,*args):
                time.sleep(.02)
                with self.lock:
                    r=self.jobs[ident]['request'];pid=r['entityIds'][0]
                    c={'entityIds':[pid],'anchors':[],'unknownRanges':[],
                       'pointsByPlayer':{pid:r['session']['courtPreparation']['rawByPlayer'][pid]}}
                    self.jobs[ident]['status']='ready'
                return {'jobId':ident,'status':'ready','candidate':c}
            def close(self):pass
            @staticmethod
            def _safe_message(v):return str(v)
        rows=[{'frame':f,'time':f*.017,'x':float(f),'y':1.,'source':'projected'} for f in range(4)]
        raw={f'P{i}':[dict(p,x=p['x']+i) for p in rows] for i in range(1,11)}
        session={'entities':[{'id':pid,'role':'player'} for pid in raw],'cuts':[],
            'courtPreparation':{'rawByPlayer':raw,'frameMapping':[{'frame':p['frame'],'time':p['time']} for p in rows]}}
        clip={'frames':rows,'video_sha256':'test-parallel','tracking_revision':'test','sourceCuts':[]}
        before=json.dumps(session,sort_keys=True)
        with tempfile.TemporaryDirectory() as folder,patch('ground_trajectory_parallel.GroundTrajectoryAgent',FakeAgent):
            result=ParallelGroundMapping(folder,Tactics(),chunk_frames=4).run(session,clip,'dummy')
            self.assertEqual(set(result),set(raw));self.assertEqual(json.dumps(session,sort_keys=True),before)
            for pid,r in result.items():self.assertEqual(r['entityId'],pid)
            stored=json.loads((Path(folder)/'result.json').read_text(encoding='utf-8'))
            self.assertEqual(len(stored['players']),10)
            # P2 finished after the last merge, then a restart resumes only P1.
            # The newer P2 snapshot must survive that other owner's merge.
            path=Path(folder)/'players/P2/result.json'
            saved=json.loads(path.read_text(encoding='utf-8'))
            saved['refined'][0]['x']+=.5
            path.write_text(json.dumps(saved),encoding='utf-8')
            resumed=ParallelGroundMapping(folder,Tactics(),max_workers=1,chunk_frames=4).run(
                session,clip,'dummy',selected_ids=['P1'])
            self.assertEqual(resumed['P2']['refined'][0]['x'],saved['refined'][0]['x'])
            self.assertEqual(json.dumps(session,sort_keys=True),before)

if __name__=='__main__':unittest.main()
