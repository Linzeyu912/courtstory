import base64
from copy import deepcopy
import io
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from PIL import Image

try:
    from identity_agent import IdentityAgent
except ImportError:
    IdentityAgent = None


class FrameDecoder:
    """Only replace the expensive video decode; real image/validation logic runs."""
    def frames(self, _video, clip, indices):
        buffer = io.BytesIO()
        Image.new('RGB', (200, 100), '#563891').save(buffer, 'JPEG')
        url = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()
        return [dict(frame=i, time=clip['frames'][i]['time'], sourceFrame=i,
                     sourceTime=clip['frames'][i]['time'], videoSha256=clip['video_sha256'],
                     dataUrl=url) for i in indices]


class IdentityAgentTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(IdentityAgent, 'identity jobs must exist')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.clip = {'video_sha256': 'a'*64, 'tracking_fingerprint': 'b'*64,
                     'tracking_revision': 'fixture', 'width': 200, 'height': 100,
                     'sourceCuts': [30], 'frames': [
                         {'frame': i, 'time': i / 30, 'tracks': [[10, 10, 40, 80, 2, .9, 2],
                                                                [100, 10, 140, 85, 62, .8, 2]]}
                         for i in range(61)]}
        self.reference = dict(version=1, videoHash='a'*64, trackingFingerprint='b'*64,
                              frame=10, trackId=2, box=[10, 10, 40, 80], team='紫色', jersey='10')
        self.session = {'version': 1, 'videoHash': 'a'*64, 'maxGapSeconds': .5,
                        'entities': [dict(id=f'P{i}', role='player', anchors=[], bindings=[],
                                          identityKeyframes=[], modelBindings=[]) for i in range(1, 11)]}
        self.session['entities'][0]['identityReference'] = deepcopy(self.reference)
        self.request = dict(session=self.session, clientRevision=7, entityId='P1',
                            purpose='continuation', reference=self.reference,
                            range={'start': 30, 'end': 60})

    def make_agent(self, execute=None, **kwargs):
        agent = IdentityAgent(self.folder / 'agent', FrameDecoder(),
                              execute=execute or self.answer, **kwargs)
        self.addCleanup(agent.close)
        return agent

    @staticmethod
    def answer(**kwargs):
        pack = json.loads((kwargs['directory'] / 'input.json').read_text(encoding='utf-8'))
        if pack['stage'] == 'reference':
            return {'team': '紫色', 'jersey': '10', 'reason': '号码清晰'}
        if pack['stage'] == 'scan':
            return {'matches': [{'frame': 45, 'trackId': 62, 'confidence': .9, 'reason': '紫色10号'}]}
        window = pack['windows'][0]
        return {'team': '紫色', 'jersey': '10', 'segments': [dict(
            id='model-candidate', trackId=62, start=window['start'], end=window['end'],
            confidence=.9, reason='三帧衣服和号码一致', evidenceFrames=window['evidenceFrames'])]}

    def wait(self, agent, job):
        for _ in range(200):
            result = agent.get(job['jobId'], self.clip, 'fixture', True)
            if result['status'] in ('ready', 'failed', 'cancelled'):
                return result
            time.sleep(.01)
        self.fail('fixture job did not settle')

    def create(self, agent, request=None):
        return agent.create(request or self.request, self.clip, self.folder/'video.mp4', 'fixture', True)

    def test_candidates_are_bounded_reviewable_and_adopted_without_saving(self):
        original = deepcopy(self.session)
        agent = self.make_agent()
        done = self.wait(agent, self.create(agent))
        self.assertEqual(done['status'], 'ready', done)
        segment = done['candidate']['segments'][0]
        self.assertGreaterEqual(segment['start'], 30)
        self.assertLessEqual(segment['end'], 60)
        self.assertLessEqual(segment['end'] - segment['start'], 30)
        self.assertEqual(segment['trackId'], 62)
        self.assertTrue(done['previewFrames'])
        for preview in done['previewFrames']:
            pixels = base64.b64decode(preview['dataUrl'].split(',', 1)[1])
            self.assertEqual(preview.get('sha256'), hashlib.sha256(pixels).hexdigest())
        result = agent.adopt(done['jobId'], {**self.request, 'selectedIds': [segment['id']]}, self.clip, 'fixture', True)
        self.assertEqual(result['candidate']['segments'], [segment])
        self.assertEqual(self.session, original)
        self.assertFalse((self.folder/'saved').exists())

    def test_adopt_checks_complete_session_revision_and_context(self):
        self.session['metadata'] = {'annotationCount': 1}
        agent = self.make_agent()
        done = self.wait(agent, self.create(agent))
        self.assertEqual(done['status'], 'ready', done)
        adopted = {**self.request, 'selectedIds': [done['candidate']['segments'][0]['id']]}
        changed = deepcopy(adopted)
        changed['session']['entities'][1]['name'] = 'unsaved edit'
        changed_type = deepcopy(adopted)
        changed_type['session']['metadata']['annotationCount'] = True
        for request in (changed, changed_type, {**adopted, 'clientRevision': 7.0},
                        {**adopted, 'clientRevision': 8}, {**adopted, 'selectedIds': ['invented']},
                        {**adopted, 'selectedIds': adopted['selectedIds'] * 2}):
            with self.assertRaises(ValueError):
                agent.adopt(done['jobId'], request, self.clip, 'fixture', True)
        for clip, variant, qa in (({**self.clip, 'tracking_revision':'other'}, 'fixture', True),
                                  (self.clip, 'other', True), (self.clip, 'fixture', False)):
            with self.assertRaises(ValueError):
                agent.get(done['jobId'], clip, variant, qa)

    def test_creation_requires_exact_detector_and_saved_reference(self):
        agent = self.make_agent()
        for key, value in [('frame', True), ('trackId', 99), ('box', [9,10,40,80]),
                           ('videoHash', 'x'*64), ('trackingFingerprint', 'x'*64), ('jersey', '')]:
            request = deepcopy(self.request)
            request['reference'][key] = value
            with self.assertRaises(ValueError):
                self.create(agent, request)
        request = deepcopy(self.request)
        request['session']['entities'][0].pop('identityReference')
        with self.assertRaises(ValueError):
            self.create(agent, request)
        for interval in ({'start':True, 'end':60}, {'start':60,'end':30}, {'start':0,'end':61}):
            with self.assertRaises(ValueError):
                self.create(agent, {**self.request, 'range':interval})

    def test_reference_recognition_allows_empty_labels_but_no_segments(self):
        agent = self.make_agent()
        request = deepcopy(self.request)
        request.update(purpose='reference', reference={**self.reference, 'team':'', 'jersey':''})
        request['session']['entities'][0].pop('identityReference')
        done = self.wait(agent, self.create(agent, request))
        self.assertEqual(done['status'], 'ready', done)
        self.assertEqual(done['candidate'], {'team':'紫色', 'jersey':'10', 'reason':'号码清晰', 'segments':[]})
        self.assertNotIn('identityReference', request['session']['entities'][0])

    def test_missing_detector_frame_and_risk_switch_do_not_get_bridged(self):
        self.clip['frames'][43]['tracks'] = [self.clip['frames'][43]['tracks'][0]]
        self.clip['frames'][48]['track_evidence'] = {'62':{'color_conflict':True}}
        agent = self.make_agent()
        done = self.wait(agent, self.create(agent))
        self.assertEqual(done['status'], 'ready', done)
        segment = done['candidate']['segments'][0]
        self.assertEqual((segment['start'], segment['end']), (44,47))

    def test_hallucinated_or_repeated_segments_cannot_become_ready(self):
        mutations = [lambda r: r['segments'][0].update(start=0),
                     lambda r: r['segments'].append(deepcopy(r['segments'][0])),
                     lambda r: r.update(team='white'),
                     lambda r: r['segments'][0].update(confidence=float('nan'))]
        for mutate in mutations:
            def bad(**kwargs):
                result = self.answer(**kwargs)
                if 'segments' in result:
                    mutate(result)
                return result
            agent = self.make_agent(bad)
            self.assertEqual(self.wait(agent, self.create(agent))['status'], 'failed')

    def test_adjacent_scan_hits_produce_disjoint_supported_windows(self):
        self.request['range'] = {'start': 0, 'end': 60}
        self.clip['sourceCuts'] = []
        def adjacent(**kwargs):
            pack = json.loads((kwargs['directory']/'input.json').read_text(encoding='utf-8'))
            if pack['stage'] == 'scan':
                return {'matches': [dict(frame=f,trackId=62,confidence=.9,reason='紫色10号') for f in [15,35,55]]}
            return {'team':'紫色','jersey':'10','segments':[
                dict(id=str(i),trackId=w['trackId'],start=w['start'],end=w['end'],
                     confidence=.9,reason='候选多帧一致',evidenceFrames=w['evidenceFrames'])
                for i,w in enumerate(pack['windows'])]}
        agent = self.make_agent(adjacent)
        done = self.wait(agent, self.create(agent))
        self.assertEqual(done['status'], 'ready', done)
        self.assertEqual([(s['start'],s['end']) for s in done['candidate']['segments']], [(0,30),(31,50),(51,60)])

    def test_cancel_and_unconfigured_api_never_produce_adoptable_result(self):
        gate = threading.Event()
        def slow(**kwargs):
            gate.wait(2)
            return self.answer(**kwargs)
        agent = self.make_agent(slow)
        job = self.create(agent)
        agent.cancel(job['jobId'], self.clip, 'fixture', True)
        gate.set()
        self.assertEqual(self.wait(agent, job)['status'], 'cancelled')
        with self.assertRaises(ValueError):
            agent.adopt(job['jobId'], self.request, self.clip, 'fixture', True)
        other = self.make_agent(provider='multimodal-api')
        self.assertFalse(other.status()['available'])
        with self.assertRaises(ValueError):
            self.create(other)


if __name__ == '__main__':
    unittest.main()
