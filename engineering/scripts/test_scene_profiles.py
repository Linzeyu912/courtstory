"""Keep foot/court proposals bound to the exact video, detector and trim timeline."""
import copy
import hashlib
import json
import unittest

import test_review_variants as fixtures
from court_propagation import fit_seed
from review_video_trim import trim_review_clip


class SceneProfileTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.VariantTests('test_default_and_fingerprints_do_not_mix_models')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root, self.sample = self.fixture.root, self.fixture.sample
        records = json.loads((self.root / 'ebard.json').read_text('utf-8'))
        foot = {'x': 10., 'y': 39., 'score': .8, 'groundPoint': False,
                'contactState': 'unknown', 'needsReview': True}
        self.feet = {'schemaVersion': 1, 'videoHash': self.fixture.digest,
                     'trackingFingerprint': hashlib.sha256((self.root / 'ebard.json').read_bytes()).hexdigest(),
                     'source': 'rtmpose_s_halpe26', 'groundPoint': False, 'contactState': 'unknown',
                     'frames': [{'frame': r['frame'], 'time': r['time'],
                                 'feet': [{'trackId': r['tracks'][0][4], 'left': copy.deepcopy(foot),
                                           'right': None, 'groundPoint': False, 'contactState': 'unknown'}]}
                                for r in records]}
        self.court = {'schemaVersion': 1, 'videoHash': self.fixture.digest,
                      'template': 'NBA', 'referenceFrame': 1, 'maxKeyframeGapSeconds': 0,
                      'keyframes': [{'frame': i, 'side': 'left', 'status': 'needs_review',
                                     'points': [{'id': k, 'image': xy, 'source': 'model'} for k, xy in
                                                zip('ABCD', [[1., 1.], [30., 1.], [30., 30.], [1., 30.]])]}
                                    for i in range(6)], 'invalidFrames': []}
        self.sample.update(feetCandidates=str(self.root / 'feet.json'),
                           courtCandidates=str(self.root / 'court.json'))
        self.write_profiles()

    def write_profiles(self):
        (self.root / 'feet.json').write_text(json.dumps(self.feet), encoding='utf-8')
        (self.root / 'court.json').write_text(json.dumps(self.court), encoding='utf-8')

    def loaded(self):
        return self.fixture.load(self.sample)

    def test_feet_are_available_only_on_matching_detector(self):
        clip = self.loaded()
        self.assertIsNone(json.loads(clip['payloads']['original'])['feetCandidates'])
        data = json.loads(clip['payloads']['ebard'])
        self.assertEqual(data['feetCandidates']['trackingFingerprint'], data['tracking_fingerprint'])

    def test_hash_mismatch_rejected(self):
        self.feet['trackingFingerprint'] = '0' * 64
        self.write_profiles()
        with self.assertRaises((ValueError, SystemExit)):
            self.loaded()

    def test_feet_nonfinite_coordinates_rejected(self):
        self.feet['frames'][0]['feet'][0]['left']['x'] = float('nan')
        self.write_profiles()
        with self.assertRaises((ValueError, SystemExit)):
            self.loaded()

    def test_feet_wrong_time_rejected(self):
        self.feet['frames'][3]['time'] += .2
        self.write_profiles()
        with self.assertRaises((ValueError, SystemExit)):
            self.loaded()

    def test_foreign_and_duplicate_track_ids_rejected(self):
        row = self.feet['frames'][0]['feet']
        for replacement in [[{**row[0], 'trackId': 9001}], [row[0], copy.deepcopy(row[0])]]:
            with self.subTest(replacement=replacement):
                self.feet['frames'][0]['feet'] = replacement
                self.write_profiles()
                with self.assertRaises((ValueError, SystemExit)):
                    self.loaded()

    def test_court_nonfinite_and_duplicate_frames_rejected(self):
        original = copy.deepcopy(self.court)
        for mutation in ('nan', 'duplicate', 'unknown-point', 'duplicate-point', 'invalid-list', 'unknown-status', 'wrong-support-frame'):
            with self.subTest(mutation=mutation):
                self.court = copy.deepcopy(original)
                if mutation == 'nan':
                    self.court['keyframes'][0]['points'][0]['image'][0] = float('inf')
                elif mutation == 'duplicate':
                    self.court['keyframes'].append(copy.deepcopy(self.court['keyframes'][0]))
                elif mutation == 'unknown-point':
                    self.court['keyframes'][0]['points'][0]['id'] = 'hoop'
                elif mutation == 'duplicate-point':
                    self.court['keyframes'][0]['points'][0]['id'] = 'B'
                elif mutation == 'invalid-list':
                    self.court['invalidFrames'] = [1]
                elif mutation == 'unknown-status':
                    self.court['keyframes'][0]['status'] = 'automatic_truth'
                else:
                    self.court['keyframes'][0]['quality'] = {'referenceFrame': 0, 'cameraSupportFrame': 6}
                self.write_profiles()
                with self.assertRaises((ValueError, SystemExit)):
                    self.loaded()

    def test_actual_trim_remaps_feet_and_court_and_preserves_lineage(self):
        for key in self.court['keyframes']:
            key.update(source='camera_propagation', quality={'referenceFrame': 1, 'method': 'sift_anchor'})
        self.court['keyframes'][4].update(status='invalid', points=[])
        self.court['invalidFrames'] = [4]
        self.write_profiles()
        clip = self.loaded()
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        first = trim_review_clip({'video': clip['video'], 'payload': payloads['original'], 'payloads': payloads},
                                 [{'start': 1, 'end': 2}, {'start': 4, 'end': 5}], self.root / 'cut')
        derived = self.fixture.load(first)
        new_payloads = {key: json.loads(value) for key, value in derived['payloads'].items()}
        b = new_payloads['ebard']
        self.assertEqual(b['sourceCuts'], [2])
        self.assertEqual([f['sourceFrame'] for f in b['feetCandidates']['frames']], [1, 2, 4, 5])
        self.assertEqual([f['time'] for f in b['feetCandidates']['frames']], [f['time'] for f in b['frames']])
        self.assertEqual([f['sourceTime'] for f in b['feetCandidates']['frames']], [.1, .2, .4, .5])
        self.assertEqual(b['feetCandidates']['trackingFingerprint'], b['tracking_fingerprint'])
        self.assertEqual(b['feetCandidates']['videoHash'], b['video_sha256'])
        self.assertIsNone(new_payloads['original']['feetCandidates'])
        self.assertEqual([k['frame'] for k in b['courtCandidates']['keyframes']], [0, 1, 2, 3])
        self.assertEqual([k['sourceFrame'] for k in b['courtCandidates']['keyframes']], [1, 2, 4, 5])
        self.assertEqual(b['courtCandidates']['invalidFrames'], [2])
        self.assertEqual(b['courtCandidates']['sourceReferenceFrame'], 1)
        self.assertEqual([k['quality']['referenceFrame'] for k in b['courtCandidates']['keyframes']], [0, 0, 0, 0])
        self.assertEqual([k['quality']['sourceReferenceFrame'] for k in b['courtCandidates']['keyframes']], [1, 1, 1, 1])
        self.assertEqual([k['quality']['cameraSupportFrame'] for k in b['courtCandidates']['keyframes']], [0, 0, 2, 2])
        # Re-trimming should preserve root source frame references and the original cut.
        second = trim_review_clip({'video': derived['video'], 'payload': b, 'payloads': new_payloads},
                                  [{'start': 1, 'end': 3}], self.root / 'cut-again')
        result = json.loads(self.fixture.load(second)['payloads']['ebard'])
        self.assertEqual(result['sourceCuts'], [1])
        self.assertEqual([f['sourceFrame'] for f in result['feetCandidates']['frames']], [2, 4, 5])
        self.assertEqual([f['time'] for f in result['feetCandidates']['frames']], [f['time'] for f in result['frames']])
        self.assertEqual([f['sourceTime'] for f in result['feetCandidates']['frames']], [.2, .4, .5])
        self.assertEqual([k['sourceFrame'] for k in result['courtCandidates']['keyframes']], [2, 4, 5])
        self.assertEqual(result['courtCandidates']['invalidFrames'], [1])
        self.assertEqual(result['courtCandidates']['sourceReferenceFrame'], 1)
        self.assertIsNone(result['courtCandidates']['referenceFrame'])
        self.assertEqual([k['quality']['referenceFrame'] for k in result['courtCandidates']['keyframes']], [None, None, None])
        self.assertEqual([k['quality']['sourceReferenceFrame'] for k in result['courtCandidates']['keyframes']], [1, 1, 1])
        self.assertEqual([k['quality']['cameraSupportFrame'] for k in result['courtCandidates']['keyframes']], [0, 1, 1])
        # A third trim must use the retained support anchor after the true reference disappeared.
        third_payloads = {k: json.loads(v) for k, v in self.fixture.load(second)['payloads'].items()}
        third = trim_review_clip({'video': second['video'], 'payload': third_payloads['ebard'], 'payloads': third_payloads},
                                 [{'start': 2, 'end': 2}], self.root / 'cut-third')
        final = json.loads(self.fixture.load(third)['payloads']['ebard'])
        key = final['courtCandidates']['keyframes'][0]
        self.assertEqual(key['quality']['referenceFrame'], None)
        self.assertEqual(key['quality']['sourceReferenceFrame'], 1)
        self.assertEqual(key['quality']['cameraSupportFrame'], 0)
        self.assertEqual(key['sourceFrame'], 5)
        self.assertEqual(final['feetCandidates']['frames'][0]['sourceFrame'], 5)

    def test_camera_reference_after_retained_interval_uses_its_end(self):
        from review_video_trim import remap_camera_quality
        records = [{'frame': i, 'source_frame': i + 100} for i in range(10)]
        kept = [1, 2, 3, 7, 8]
        remap = {source: i for i, source in enumerate(kept)}
        quality = {'referenceFrame': 8, 'method': 'sift_anchor'}
        first = remap_camera_quality(quality, 1, records, kept, [3], remap)
        self.assertEqual(first['referenceFrame'], 4)
        self.assertEqual(first['sourceReferenceFrame'], 108)
        self.assertEqual(first['cameraSupportFrame'], 2)
        last = remap_camera_quality(quality, 7, records, kept, [3], remap)
        self.assertEqual(last['cameraSupportFrame'], 4)

    def test_inherited_source_cut_creates_distinct_camera_support_segments(self):
        from review_video_trim import remap_camera_quality
        records = [{'frame': i} for i in range(6)]
        kept = list(range(6))
        remap = dict(enumerate(kept))
        # Even with a contiguous retained range, the existing source cut at 3 separates guards.
        quality = remap_camera_quality({'referenceFrame': 1}, 4, records, kept, [3], remap)
        self.assertEqual(quality['referenceFrame'], 1)
        self.assertEqual(quality['cameraSupportFrame'], 3)

    def test_trim_preserves_independently_reviewed_support_anchor(self):
        for key in self.court['keyframes']:
            key.update(source='camera_propagation', cameraSupportFrame=4,
                       quality={'referenceFrame': 1, 'cameraSupportFrame': 3, 'method': 'sift_anchor'})
        self.write_profiles()
        clip = self.loaded()
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        cut = trim_review_clip({'video': clip['video'], 'payload': payloads['ebard'], 'payloads': payloads},
                               [{'start': 2, 'end': 5}], self.root / 'review-anchor-cut')
        result = json.loads(self.fixture.load(cut)['payloads']['ebard'])
        for key in result['courtCandidates']['keyframes']:
            self.assertIsNone(key['quality']['referenceFrame'])
            self.assertEqual(key['quality']['sourceReferenceFrame'], 1)
            self.assertEqual(key['cameraSupportFrame'], 2)
            self.assertEqual(key['quality']['cameraSupportFrame'], 2)
        from review_video_trim import remap_camera_quality
        records = [{'frame': i} for i in range(6)]
        quality_only = remap_camera_quality({'referenceFrame': 1, 'cameraSupportFrame': 4},
                                           3, records, [2, 3, 4, 5], [], {2: 0, 3: 1, 4: 2, 5: 3})
        self.assertEqual(quality_only['cameraSupportFrame'], 2)

    def test_single_payload_feet_cache_uses_new_track_fingerprint(self):
        clip = self.loaded()
        payload = json.loads(clip['payloads']['ebard'])
        result = trim_review_clip({'video': clip['video'], 'payload': payload},
                                  [{'start': 2, 'end': 4}], self.root / 'single-payload')
        derived = json.loads(self.fixture.load(result)['payloads']['original'])
        self.assertEqual(derived['feetCandidates']['trackingFingerprint'], derived['tracking_fingerprint'])
        self.assertEqual([f['sourceFrame'] for f in derived['feetCandidates']['frames']], [2, 3, 4])
        self.assertEqual([f['time'] for f in derived['feetCandidates']['frames']], [f['time'] for f in derived['frames']])

    def test_empty_court_candidate_profile_is_allowed(self):
        self.court.update(keyframes=[], invalidFrames=[], referenceFrame=None)
        self.write_profiles()
        loaded = json.loads(self.loaded()['payloads']['ebard'])
        self.assertEqual(loaded['courtCandidates']['keyframes'], [])

    def test_malformed_seed_and_nonfinite_seed_rejected_cleanly(self):
        for points in [[None] * 4, ['A'] * 4, {'A': [1, 2]},
                       [{'id': k, 'image': [float('nan'), 1]} for k in 'ABCD']]:
            with self.subTest(points=points):
                with self.assertRaises(ValueError):
                    fit_seed({'frame': 0, 'side': 'left', 'points': points}, 6, 64, 48)


if __name__ == '__main__':
    unittest.main()
