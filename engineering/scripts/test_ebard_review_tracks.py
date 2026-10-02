"""Contract checks for role-isolated tracking; no model or GPU dependency."""
import copy
import unittest

from build_ebard_review_tracks import (frame_objects, global_tracks, longest_runs,
                                      role_conflicts, summarize_tracks, verify_records)


class EBardTrackContractTests(unittest.TestCase):
    def test_same_internal_id_in_two_roles_has_distinct_stable_output_ids(self):
        ids = {}
        player = [0, 0, 20, 40, 1, .9, 2, 0]
        referee = [0, 0, 20, 40, 1, .9, 3, 0]
        self.assertEqual(global_tracks('player', [player], ids)[0][4], 1)
        self.assertEqual(global_tracks('referee', [referee], ids)[0][4], 2)
        self.assertEqual(global_tracks('player', [player], ids)[0][4], 1)

    def test_objects_never_become_people_or_ground_anchors(self):
        raw = [[0, 0, 10, 10, .8, 0], [20, 20, 40, 40, .7, 1],
               [30, 30, 50, 70, .9, 2], [30, 30, 50, 70, .2, 0]]
        objects = frame_objects(raw)
        self.assertEqual([obj['kind'] for obj in objects], ['basketball', 'hoop'])
        self.assertTrue(all(obj['groundPoint'] is False and 'trackId' not in obj for obj in objects))

    def test_cross_role_overlap_is_flagged_without_deleting_candidates(self):
        tracks = [[0, 0, 20, 40, 1, .9, 2], [1, 0, 21, 40, 2, .8, 3],
                  [0, 0, 20, 40, 3, .8, 2]]
        original = copy.deepcopy(tracks)
        conflicts = role_conflicts(tracks)
        self.assertEqual(tracks, original)
        self.assertEqual([item['trackIds'] for item in conflicts], [[1, 2], [3, 2]])

    def test_validation_rejects_class_leak_and_tracks_real_observation_gaps(self):
        frames = [{'frame': i, 'time': i / 30, 'tracks': [[0, 0, 20, 40, 1, .9, 2]] if i != 2 else [],
                   'track_roles': {'1': 'player'} if i != 2 else {}, 'objects': [], 'pending_detections': []}
                  for i in range(5)]
        self.assertTrue(verify_records(frames, 5))
        summaries = summarize_tracks(frames)
        self.assertEqual(summaries[0]['visibleIntervals'], [[0, 1], [3, 4]])
        self.assertEqual(longest_runs(summaries)['player']['frames'], 2)
        frames[0]['tracks'][0][6] = 0
        with self.assertRaisesRegex(ValueError, 'Non-person'):
            verify_records(frames, 5)


if __name__ == '__main__':
    unittest.main()
