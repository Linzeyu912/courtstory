"""Exercise scene proposals with metadata-rich and legacy review versions over real media/HTTP."""
import copy
import hashlib
import json
import subprocess
import sys
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import test_scene_profiles as scene_fixture
from review_video_trim import trim_review_clip
from scene_profiles import validate_feet_candidates


class SceneReviewIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.fixture=scene_fixture.SceneProfileTests('test_feet_are_available_only_on_matching_detector')
        self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.root,self.sample=self.fixture.root,self.fixture.sample
        self.sample.setdefault('title','Scene fixture')
        self.tracks=self.root/'ebard.json'
        self.raw=hashlib.sha256(self.tracks.read_bytes()).hexdigest()
        records=json.loads(self.tracks.read_text())
        metadata=json.loads(self.tracks.with_suffix('.meta.json').read_text())
        self.suggestions={'version':1,'method':'team_proposal','verified':False,'entities':[
            {'id':'P6','teamGroup':'B','teamHint':'white','bindings':[
                {'start':row['frame'],'end':row['frame'],'trackId':row['tracks'][0][4]} for row in records]}]}
        metadata.update(tracker='BoT-SORT',identitySuggestions=self.suggestions,
            presentation={'version':1,'default_stable':True,'source_records_unchanged':True},
            parameters={'confidence':.1},presentation_geometry_comparison={'scope':'complete_parent'})
        self.tracks.with_suffix('.meta.json').write_text(json.dumps(metadata),encoding='utf-8')

    def test_metadata_rich_draft_fingerprint_and_raw_feet_binding_are_separate(self):
        loaded=self.fixture.loaded()
        payloads={key:json.loads(value) for key,value in loaded['payloads'].items()}
        data=payloads['ebard']
        self.assertIn('tracking_raw_fingerprint',data.keys(),'Scene proposals need an explicit detector byte fingerprint')
        self.assertEqual(data['tracking_raw_fingerprint'],self.raw)
        self.assertNotEqual(data['tracking_fingerprint'],self.raw)
        self.assertEqual(data['feetCandidates']['trackingFingerprint'],self.raw)
        self.assertIsNone(payloads['original']['feetCandidates'])
        self.assertEqual(data['identitySuggestions'],self.suggestions)
        old_draft=data['tracking_fingerprint']
        metadata=json.loads(self.tracks.with_suffix('.meta.json').read_text())
        metadata['parameters']['confidence']=.2
        self.tracks.with_suffix('.meta.json').write_text(json.dumps(metadata),encoding='utf-8')
        updated=json.loads(self.fixture.loaded()['payloads']['ebard'])
        self.assertNotEqual(updated['tracking_fingerprint'],old_draft)
        self.assertEqual(updated['tracking_raw_fingerprint'],self.raw)
        self.assertEqual(updated['feetCandidates'],data['feetCandidates'])

    def test_legacy_jersey_feet_multiversion_and_nested_trim_keep_exact_detector_lineage(self):
        jersey=self.root/'jersey.json'
        records=json.loads((self.root/'original.json').read_text())
        for record in records:record['tracks'][0][4]=7
        jersey.write_text(json.dumps(records),encoding='utf-8')
        raw=hashlib.sha256(jersey.read_bytes()).hexdigest()
        self.sample.update(alternativeTracks=str(jersey),defaultVariant='jersey',sourceCuts=[3])
        self.fixture.feet['trackingFingerprint']=raw
        for frame in self.fixture.feet['frames']:frame['feet'][0]['trackId']=7
        self.fixture.write_profiles()
        loaded=self.fixture.loaded()
        payloads={key:json.loads(value) for key,value in loaded['payloads'].items()}
        # The validated boundary profile makes the reserved-path failure independent of loader wiring.
        payloads['jersey']['feetCandidates']=validate_feet_candidates(copy.deepcopy(self.fixture.feet),
            self.fixture.fixture.digest,{raw:records},64,48)
        try:
            result=trim_review_clip({'video':loaded['video'],'payload':payloads['original'],'payloads':payloads},
                [{'start':1,'end':2},{'start':4,'end':5}],self.root/'legacy-foot-cut')
        except StopIteration:self.fail('Legacy feet trim must look up alternativeTracks rather than configured jersey')
        child=self.fixture.fixture.load({**result,'id':'legacy-child'})
        child_payloads={key:json.loads(value) for key,value in child['payloads'].items()}
        foot=child_payloads['jersey']['feetCandidates']
        self.assertEqual(foot['trackingFingerprint'],hashlib.sha256(Path(result['alternativeTracks']).read_bytes()).hexdigest())
        self.assertEqual(foot['sourceTrackingFingerprint'],raw)
        self.assertEqual([row['sourceFrame'] for row in foot['frames']],[1,2,4,5])
        self.assertEqual([row['time'] for row in foot['frames']],[row['time'] for row in child_payloads['jersey']['frames']])
        self.assertIsNone(child_payloads['original']['feetCandidates'])
        self.assertIsNone(child_payloads['ebard']['feetCandidates'])
        second=trim_review_clip({'video':result['video'],'payload':child_payloads['jersey'],'payloads':child_payloads},
            [{'start':1,'end':3}],self.root/'legacy-foot-nested')
        nested=json.loads(self.fixture.fixture.load({**second,'id':'legacy-nested'})['payloads']['jersey'])
        self.assertEqual(nested['sourceCuts'],[1])
        self.assertEqual([row['sourceFrame'] for row in nested['feetCandidates']['frames']],[2,4,5])
        self.assertEqual([row['sourceTime'] for row in nested['feetCandidates']['frames']],[.2,.4,.5])
        self.assertEqual(nested['feetCandidates']['trackingFingerprint'],nested['tracking_raw_fingerprint'])

    def test_actual_http_scene_assets_court_guards_cache_paths_and_rich_trim(self):
        library=self.root/'http-library.json'
        library.write_text(json.dumps({'defaultSample':'test','samples':[self.sample]}),encoding='utf-8')
        cache=self.root/'http-cuts';cache.mkdir()
        safe_video,safe_tracks=cache/'source.mp4',cache/'source.json'
        safe_video.write_bytes(self.fixture.fixture.video.read_bytes());safe_tracks.write_bytes(self.tracks.read_bytes())
        cached=[]
        for field,name in [('courtCandidates','court.json'),('feetCandidates','feet.json')]:
            cached.append({'id':'escaped-'+field,'parentSample':'test','parentVideoSha256':self.fixture.fixture.digest,
                'video':str(safe_video),'tracks':str(safe_tracks),field:str(self.root/name)})
        (cache/'library.json').write_text(json.dumps(cached),encoding='utf-8')
        state=self.root/'http-server.json'
        command=[sys.executable,str(Path(__file__).with_name('serve_player_review.py')),'--library',str(library),
                 '--port','0','--state-file',str(state),'--trim-root',str(cache),
                 '--import-cache',str(self.root/'imports'),'--video-folder',str(self.root/'inbox'),
                 '--tactics-folder',str(self.root/'tactics')]
        process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            deadline=time.monotonic()+10
            while not state.is_file() and process.poll() is None and time.monotonic()<deadline:time.sleep(.02)
            self.assertTrue(state.is_file(),'Scene HTTP fixture did not reach readiness')
            url=json.loads(state.read_text())['url']
            with urlopen(url+'api/library',timeout=3) as response:
                self.assertEqual([sample['id'] for sample in json.load(response)['samples']],['test'])
            static=Path(__file__).resolve().parents[1]/'tools/player-review'
            for name in ['scene-objects.mjs','scene-objects-ui.mjs','calibration-guide.mjs','feet-candidates.mjs',
                         'team-overlay.mjs','team-overlay-policy.json']:
                with self.subTest(asset=name):
                    with urlopen(url+name,timeout=3) as response:self.assertEqual(response.read(),(static/name).read_bytes())
            seed={'frame':0,'side':'left','source':'human','points':[
                {'id':name,'image':xy,'source':'human'} for name,xy in
                zip('ABCD',[[3,15],[33,15],[33,42],[3,42]])]}
            body={'sample':'test','seed':seed,'cuts':[3]}
            request=Request(url+'api/court-propagate',data=json.dumps(body).encode(),
                headers={'Content-Type':'application/json','Origin':url.rstrip('/')},method='POST')
            with urlopen(request,timeout=5) as response:court=json.load(response)
            self.assertEqual([key['frame'] for key in court['keyframes']],[0,1,2])
            self.assertTrue(court['reviewRequired']);self.assertFalse(court['metricAccuracyValidated'])
            bad=[(json.dumps(body).encode(),{'Origin':'https://invalid.example'},403),
                 (json.dumps(body).encode(),{'Content-Type':'text/plain'},415),
                 (json.dumps({**body,'note':float('nan')}).encode(),{},400),
                 (json.dumps(body)[:-1].encode()+b',"note":1e999}',{},400),
                 (b'[]',{},400),(json.dumps({**body,'cuts':False}).encode(),{},400)]
            for raw,headers,status in bad:
                with self.subTest(expected=status,body=raw):
                    request=Request(url+'api/court-propagate',data=raw,
                        headers={'Content-Type':'application/json',**headers},method='POST')
                    try:
                        with urlopen(request,timeout=5) as response:actual=response.status
                    except HTTPError as rejected:
                        with rejected:actual=rejected.code
                    self.assertEqual(actual,status)
            request=Request(url+'api/trim',data=json.dumps({'sample':'test','qa':True,
                'ranges':[{'start':1,'end':2},{'start':4,'end':5}]}).encode(),
                headers={'Content-Type':'application/json'},method='POST')
            with urlopen(request,timeout=5) as response:cut=json.load(response)
            with urlopen(url+'api/clip?sample='+cut['sample'],timeout=3) as response:child=json.load(response)
            self.assertEqual(child['variant'],'ebard')
            self.assertNotEqual(child['tracking_fingerprint'],child['tracking_raw_fingerprint'])
            self.assertEqual(child['feetCandidates']['trackingFingerprint'],child['tracking_raw_fingerprint'])
            self.assertEqual(child['trackingMetadata']['source_tracking_revision'],'ebard')
            self.assertFalse(child['trackingMetadata']['presentation']['source_records_unchanged'])
            self.assertEqual(child['identitySuggestions']['entities'][0]['teamGroup'],'B')
            self.assertEqual([row['sourceFrame'] for row in child['feetCandidates']['frames']],[1,2,4,5])
            self.assertEqual(child['frames'][0]['objects'][0]['kind'],'hoop')
            self.assertEqual(child['courtCandidates']['sourceReferenceFrame'],1)
            self.assertEqual(child['sourceCuts'],[2])
        finally:
            if process.poll() is None:process.terminate()
            process.communicate(timeout=5)


if __name__=='__main__':unittest.main()
