"""Visibility states must survive ordinary server edits without leaking between people."""
from copy import deepcopy
import unittest

from review_session import apply_review_edit, validate_session
from test_review_session import fixture


class PlayerVisibilityTests(unittest.TestCase):
    def test_swap_clear_and_assignment_preserve_the_visibility_contract(self):
        session, clip = fixture()
        ranges = [{'start': 0, 'end': 5, 'state': 'out_of_view', 'origin': 'human_visibility_review'},
                  {'start': 6, 'end': 7, 'state': 'occluded', 'origin': 'human_visibility_review'}]
        session['entities'][0]['visibilityRanges'] = deepcopy(ranges)
        before = deepcopy(session)
        validate_session(session, clip)
        moved = apply_review_edit(session, {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'P6'}, clip)['session']
        self.assertEqual(moved['entities'][5]['visibilityRanges'], ranges)
        self.assertNotIn('visibilityRanges', moved['entities'][0])
        cleared = apply_review_edit(moved, {'type': 'clear_player', 'entityId': 'P6'}, clip)['session']
        self.assertEqual(cleared['entities'][5]['visibilityRanges'], [])
        clip['frames'][8]['tracks'] = [[0, 0, 10, 30, 1, .9]]
        assigned = apply_review_edit(session, {'type': 'assign_track', 'entityId': 'P1', 'trackId': 1, 'frame': 8}, clip)['session']
        self.assertEqual(assigned['entities'][0]['visibilityRanges'], ranges)
        self.assertEqual(session, before)

    def test_reject_invalid_or_overlapping_visibility_ranges(self):
        for ranges in (
            [{'start': -1, 'end': 2, 'state': 'out_of_view'}],
            [{'start': 0, 'end': 40, 'state': 'out_of_view'}],
            [{'start': 3, 'end': 2, 'state': 'occluded'}],
            [{'start': 1, 'end': 2, 'state': 'invented'}],
            [{'start': 1, 'end': 2, 'state': 'visible'}, {'start': 2, 'end': 3, 'state': 'out_of_view'}],
            [{'start': True, 'end': 2, 'state': 'visible'}], None,
        ):
            session, clip = fixture()
            session['entities'][0]['visibilityRanges'] = ranges
            with self.subTest(ranges=ranges), self.assertRaises(ValueError):
                validate_session(session, clip)


if __name__ == '__main__':
    unittest.main()
