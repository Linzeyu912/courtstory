"""Range edits round-trip through roster operations with explicit provenance."""
from copy import deepcopy
import unittest

from review_session import apply_review_edit, validate_session
from test_review_session import fixture


def range_fixture():
    session, clip = fixture()
    for record in clip['frames']:
        record['tracks'] = [[100, 30, 140, 170, 7, .9, 0]]
    person = session['entities'][0]
    person['bindings'].append({'start': 5, 'end': 25, 'kind': 'track', 'trackId': 7,
                               'origin': 'human_range_replacement', 'order': 4,
                               'exclusive': True, 'reviewRequired': True})
    person['anchors'].append({'frame': 6, 'x': 125, 'y': 172, 'trackId': 7,
                              'box': [105, 32, 145, 172], 'source': 'manual_range',
                              'identityConfirmed': False, 'rangeCorrection': {
                                  'operationId': 'range-test', 'method': 'relative_keyframe_interpolation',
                                  'mode': 'box', 'supportFrames': [5, 8], 'keyframe': False,
                                  'originalSource': 'tracked', 'originalTrackId': 7}})
    return session, clip


class ReviewRangeTests(unittest.TestCase):
    def test_valid_range_source_is_preserved_when_players_swap(self):
        session, clip = range_fixture()
        before = deepcopy(session)
        validate_session(session, clip)
        result = apply_review_edit(session, {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'P2'}, clip)
        self.assertEqual(result['session']['entities'][1]['anchors'], before['entities'][0]['anchors'])
        self.assertEqual(result['session']['entities'][1]['bindings'], before['entities'][0]['bindings'])
        self.assertEqual(session, before)
        self.assertEqual(validate_session(result['session'], clip), 40)

    def test_range_metadata_and_unobserved_track_are_rejected(self):
        session, clip = range_fixture()
        for field, value in [('originalSource', 'interpolated'), ('operationId', ''),
                             ('supportFrames', []), ('supportFrames', [50]),
                             ('keyframe', 'true'), ('mode', 'copy'),
                             ('method', 'copy_box'), ('originalTrackId', 99)]:
            with self.subTest(field=field, value=value):
                broken = deepcopy(session)
                broken['entities'][0]['anchors'][-1]['rangeCorrection'][field] = value
                with self.assertRaises(ValueError):
                    validate_session(broken, clip)
        broken_clip = deepcopy(clip)
        broken_clip['frames'][6]['tracks'] = []
        with self.assertRaises(ValueError):
            validate_session(session, broken_clip)

    def test_range_override_requires_finite_track_claim_and_release_uses_effective_end(self):
        session, clip = range_fixture()
        result = apply_review_edit(session, {'type': 'release_identity', 'entityId': 'P1', 'frame': 6}, clip)
        self.assertEqual(result['affectedRange'], {'start': 6, 'end': 25})
        for field, value in [('exclusive', False), ('kind', 'unassigned'), ('order', None)]:
            broken = deepcopy(session)
            broken['entities'][0]['bindings'][-1][field] = value
            with self.assertRaises(ValueError):
                validate_session(broken, clip)


if __name__ == '__main__':
    unittest.main()
