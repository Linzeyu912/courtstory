"""Keep initialization evidence truthful through actual and repeated video cuts."""
import copy
import json
import unittest

import test_review_variants as fixtures
from review_video_trim import trim_review_clip


class CourtInitializationTrimTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.VariantTests('test_default_and_fingerprints_do_not_mix_models')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.orientation = {'side': 'left', 'sourceFrame': 4, 'sourceTime': .4,
                            'objectVariant': 'ebard', 'objectTrackingFingerprint': 'source-detection',
                            'reviewRequired': True}
        points = [{'id': name, 'image': xy, 'source': 'hoop_constrained_court48'}
                  for name, xy in zip('ABCD', [[1., 1.], [30., 1.], [30., 30.], [1., 30.]])]
        matrix = [1., 0., 0., 0., 1., 0., 0., 0., 1.]
        self.profile = {'schemaVersion': 1, 'videoHash': self.fixture.digest, 'template': 'NBA',
                        'referenceFrame': 4, 'maxKeyframeGapSeconds': 0,
                        'initialization': {'frame': 4, 'sourceFrame': 4, 'sourceTime': .4,
                                           'side': 'left', 'status': 'needs_review',
                                           'reason': 'direction_from_hoop',
                                           'orientation': copy.deepcopy(self.orientation)},
                        'keyframes': [{'frame': i, 'side': 'left', 'status': 'needs_review',
                                       'source': 'hoop_constrained_court48' if i == 4 else 'camera_propagation',
                                       'points': copy.deepcopy(points), 'imageToCourt': matrix,
                                       'orientation': copy.deepcopy(self.orientation),
                                       'quality': {'referenceFrame': 4, 'cameraSupportFrame': 4}}
                                      for i in (4, 5)],
                        'invalidFrames': [], 'summary': {'startFrame': 4, 'endFrame': 5,
                                                        'validFrames': 2, 'totalFrames': 2}}

    def load_profile(self):
        path = self.root / 'court.json'
        path.write_text(json.dumps(self.profile), encoding='utf-8')
        return self.fixture.load({**self.fixture.sample, 'courtCandidates': str(path)})

    def trim(self, clip, ranges, name):
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        result = trim_review_clip({'video': clip['video'], 'payload': payloads['ebard'], 'payloads': payloads},
                                 ranges, self.root / name)
        derived = self.fixture.load(result)
        return derived, json.loads(derived['payloads']['ebard'])

    def test_retained_initialization_and_orientation_keep_root_evidence(self):
        original = copy.deepcopy(self.profile)
        clip, payload = self.trim(self.load_profile(), [{'start': 1, 'end': 2}, {'start': 4, 'end': 5}], 'first')
        profile = payload['courtCandidates']
        self.assertEqual(profile['initialization']['frame'], 2)
        self.assertEqual(profile['initialization']['sourceFrame'], 4)
        self.assertEqual(profile['initialization']['sourceTime'], .4)
        self.assertEqual(profile['initialization']['status'], 'needs_review')
        self.assertEqual(profile['initialization']['orientation'], self.orientation)
        self.assertEqual(profile['keyframes'][0]['orientation'], self.orientation)
        self.assertEqual(profile['keyframes'][0]['imageToCourt'], original['keyframes'][0]['imageToCourt'])
        self.assertEqual(profile['referenceFrame'], 2)
        self.assertEqual(profile['videoHash'], payload['video_sha256'])
        self.assertEqual(profile['sourceVideoHash'], self.fixture.digest)
        self.assertEqual(payload['sourceCuts'], [2])
        _, again = self.trim(clip, [{'start': 2, 'end': 3}], 'second')
        self.assertEqual(again['courtCandidates']['initialization']['frame'], 0)
        self.assertEqual(again['courtCandidates']['initialization']['sourceFrame'], 4)
        self.assertEqual(again['courtCandidates']['initialization']['sourceTime'], .4)
        self.assertEqual(self.profile, original)

    def test_removed_initialization_stays_removed_across_later_cut(self):
        first, _ = self.trim(self.load_profile(), [{'start': 1, 'end': 2}, {'start': 4, 'end': 5}], 'first')
        second, payload = self.trim(first, [{'start': 0, 'end': 1}, {'start': 3, 'end': 3}], 'second')
        profile = payload['courtCandidates']
        initial = profile['initialization']
        self.assertIsNone(initial['frame'])
        self.assertEqual(initial['status'], 'source_removed')
        self.assertTrue(initial['sourceRemoved'])
        self.assertEqual(initial['previousStatus'], 'needs_review')
        self.assertEqual(initial['previousReason'], 'direction_from_hoop')
        self.assertEqual((initial['sourceFrame'], initial['sourceTime']), (4, .4))
        self.assertEqual(initial['orientation'], self.orientation)
        self.assertIsNone(profile['referenceFrame'])
        self.assertEqual(profile['sourceReferenceFrame'], 4)
        # A surviving propagated frame keeps its own cut guard, not the removed seed.
        self.assertEqual(profile['keyframes'][0]['sourceFrame'], 5)
        self.assertEqual(profile['keyframes'][0]['quality']['cameraSupportFrame'], 2)
        _, third = self.trim(second, [{'start': 2, 'end': 2}], 'third')
        self.assertEqual(third['courtCandidates']['initialization'], initial)
        self.assertEqual(third['courtCandidates']['keyframes'][0]['quality']['cameraSupportFrame'], 0)

    def test_unresolved_orientation_remaps_without_inventing_a_side(self):
        self.profile.update(keyframes=[], unresolvedFrames=[4],
                            summary={'startFrame': 4, 'endFrame': 4, 'validFrames': 0, 'totalFrames': 1})
        self.profile['initialization'].update(side=None, status='invalid', reason='orientation_unknown')
        self.profile['initialization']['orientation'].update(side=None)
        first, payload = self.trim(self.load_profile(), [{'start': 1, 'end': 2}, {'start': 4, 'end': 5}], 'first')
        profile = payload['courtCandidates']
        self.assertEqual(profile['unresolvedFrames'], [2])
        self.assertEqual(profile['keyframes'], [])
        self.assertEqual(profile['invalidFrames'], [])
        self.assertIsNone(profile['initialization']['side'])
        self.assertEqual(profile['initialization']['frame'], 2)
        self.assertEqual(profile['initialization']['status'], 'invalid')
        self.assertEqual(profile['summary'], {'startFrame': 2, 'endFrame': 2, 'validFrames': 0, 'totalFrames': 1})
        _, removed = self.trim(first, [{'start': 0, 'end': 1}, {'start': 3, 'end': 3}], 'second')
        profile = removed['courtCandidates']
        self.assertEqual(profile['unresolvedFrames'], [])
        self.assertEqual(profile['initialization']['status'], 'source_removed')
        self.assertEqual(profile['initialization']['previousStatus'], 'invalid')
        self.assertEqual(profile['initialization']['previousReason'], 'orientation_unknown')
        self.assertEqual(profile['initialization']['sourceFrame'], 4)
        self.assertEqual(profile['summary'], {'startFrame': None, 'endFrame': None, 'validFrames': 0, 'totalFrames': 0})


if __name__ == '__main__':
    unittest.main()
