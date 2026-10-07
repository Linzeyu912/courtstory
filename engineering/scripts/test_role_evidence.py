import copy
import unittest

from role_evidence import add_reference_role_evidence, METHOD


def fixture(count=8):
    records = [{'frame': frame, 'time': frame / 25,
                'tracks': [[frame, 0, frame + 40, 100, 13, .8, 2],
                           [150, 0, 190, 100, 14, .9, 2]],
                'track_evidence': {'13': {'raw_detection_index': 0, 'identity_review_required': False}}}
               for frame in range(count)]
    reference = [{'frame': frame, 'time': frame / 25,
                  'tracks': [[frame, 0, frame + 40, 100, 14, .8, 3]],
                  'track_roles': {'14': 'referee'}} for frame in range(count)]
    return records, reference


def apply(records, reference, **kwargs):
    options = dict(video_sha256='video', reference_video_sha256='video',
                   reference_fingerprint='reference', class_names={'2': 'player'},
                   reference_class_names={'3': 'referee'})
    options.update(kwargs)
    return add_reference_role_evidence(records, reference, **options)


def flagged(record):
    return [item['playerTrackId'] for item in record.get('role_conflicts', [])]


class RoleEvidenceTests(unittest.TestCase):
    def test_narrow_active_box_on_the_verified_frame8_referee_is_still_flagged(self):
        records, reference = fixture(1)
        records[0]['tracks'][0][:4] = [1598.181885, 295.909088, 1658.181885, 490.227264]
        reference[0]['tracks'][0][:4] = [1586.124755859375, 297.6357421875, 1669.0433349609375, 489.5267333984375]
        derived, source = apply(records, reference)
        self.assertEqual(source['minimumIoU'], .70)
        self.assertEqual(flagged(derived[0]), [13])

    def test_geometry_maps_different_ids_without_colliding_with_a_real_player(self):
        records, reference = fixture()
        derived, source = apply(records, reference)
        self.assertEqual(flagged(derived[0]), [13])
        self.assertEqual(derived[0]['role_conflicts'][0]['reference']['trackId'], 14)
        self.assertEqual(derived[0]['role_conflicts'][0]['trackIds'], [13])
        self.assertNotIn('refereeTrackId', derived[0]['role_conflicts'][0])
        self.assertNotIn('14', derived[0]['track_evidence'])
        self.assertEqual(source['trackingRawFingerprint'], 'reference')

    def test_input_bytes_geometry_and_other_risk_evidence_are_unchanged(self):
        records, reference = fixture()
        original, original_reference = copy.deepcopy(records), copy.deepcopy(reference)
        records[0]['track_evidence']['13']['color_conflict'] = True
        original[0]['track_evidence']['13']['color_conflict'] = True
        derived, _ = apply(records, reference)
        self.assertEqual(records, original)
        self.assertEqual(reference, original_reference)
        self.assertTrue(derived[0]['track_evidence']['13']['color_conflict'])
        self.assertEqual(derived[0]['tracks'], records[0]['tracks'])
        self.assertEqual(derived[0]['track_evidence']['13']['raw_detection_index'], 0)

    def test_other_video_count_index_time_and_pts_are_rejected(self):
        records, reference = fixture()
        with self.assertRaisesRegex(ValueError, 'same source video'):
            apply(records, reference, reference_video_sha256='other')
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            apply(records, reference, reference_fingerprint='')
        for kind in ('count', 'index', 'time', 'pts'):
            bad = copy.deepcopy(reference)
            current = copy.deepcopy(records)
            if kind == 'count': bad.pop()
            if kind == 'index': bad[1]['frame'] = 2
            if kind == 'time': bad[1]['time'] += .02
            if kind == 'pts':
                current[1]['source_frame_pts'], bad[1]['source_frame_pts'] = 40, 41
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                apply(current, bad)

    def test_single_overlap_is_not_promoted_to_whole_track_role(self):
        records, reference = fixture()
        for row in reference:
            if row['frame'] != 3: row['tracks'] = []
        derived, source = apply(records, reference)
        self.assertEqual([r['frame'] for r in derived if flagged(r)], [3])
        self.assertEqual(source['intervals'], [])

    def test_repeated_role_evidence_bridges_only_its_observed_endpoints(self):
        records, reference = fixture(12)
        for row in reference:
            if row['frame'] not in (1, 4, 8): row['tracks'] = []
        derived, source = apply(records, reference)
        self.assertEqual([r['frame'] for r in derived if flagged(r)], list(range(1, 9)))
        self.assertEqual(source['directConflictObservations'], 3)
        self.assertEqual(source['reviewObservations'], 8)
        self.assertEqual(derived[2]['track_evidence']['13']['role_evidence']['evidenceFrames'], [1, 4, 8])

    def test_cuts_long_absences_and_geometric_jumps_end_continuity(self):
        for kind in ('cut', 'absence', 'jump'):
            records, reference = fixture(20)
            for row in reference:
                if row['frame'] not in (0, 2, 17, 19): row['tracks'] = []
            kwargs = {}
            if kind == 'cut': kwargs['source_cuts'] = [10]
            if kind == 'absence':
                for row in records[4:15]: row['tracks'] = [row['tracks'][1]]
            if kind == 'jump':
                for row in records[10:]:
                    row['tracks'][0][0] += 1000
                    row['tracks'][0][2] += 1000
                for row in reference[10:]:
                    for box in row['tracks']: box[0] += 1000; box[2] += 1000
            derived, source = apply(records, reference, **kwargs)
            with self.subTest(kind=kind):
                self.assertEqual([r['frame'] for r in derived if flagged(r)], [0, 2, 17, 19])
                self.assertEqual(source['intervals'], [])

    def test_no_position_is_invented_in_a_bridged_detection_gap(self):
        records, reference = fixture(12)
        for row in reference:
            if row['frame'] not in (1, 4, 8): row['tracks'] = []
        records[5]['tracks'] = [records[5]['tracks'][1]]
        derived, _ = apply(records, reference)
        self.assertEqual(flagged(derived[5]), [])
        self.assertEqual(derived[5]['tracks'], records[5]['tracks'])
        self.assertEqual(flagged(derived[6]), [13])

    def test_weak_reference_and_nearby_overlap_do_not_flag_role(self):
        records, reference = fixture()
        for row in reference: row['tracks'][0][5] = .24
        self.assertTrue(all(not flagged(r) for r in apply(records, reference)[0]))
        for row in reference:
            row['tracks'][0][5] = .9
            row['tracks'][0][0] += 20
            row['tracks'][0][2] += 20
        self.assertTrue(all(not flagged(r) for r in apply(records, reference)[0]))

    def test_existing_role_conflicts_and_declared_referees_are_preserved(self):
        records, reference = fixture()
        records[0]['role_conflicts'] = [{'trackIds': [14, 19], 'status': 'needs_review'}]
        records[1]['track_roles'] = {'13': 'referee'}
        derived, _ = apply(records, reference)
        self.assertEqual(derived[0]['role_conflicts'][0], records[0]['role_conflicts'][0])
        self.assertEqual(flagged(derived[1]), [])

    def test_explicit_class_names_or_roles_are_required_for_reference(self):
        records, reference = fixture()
        for row in reference: row.pop('track_roles')
        derived, _ = apply(records, reference, reference_class_names={})
        self.assertTrue(all(not flagged(r) for r in derived))
        derived, source = apply(records, reference, reference_class_names=['ball', 'hoop', 'player', 'referee'])
        self.assertEqual(flagged(derived[0]), [13])
        self.assertEqual(source['method'], METHOD)

    def test_reloading_derived_output_is_idempotent_and_trim_does_not_inherit_parent_ranges(self):
        records, reference = fixture(12)
        for row in reference:
            if row['frame'] not in (1, 4, 8): row['tracks'] = []
        derived, source = apply(records, reference)
        again, second_source = apply(derived, reference)
        self.assertEqual(again, derived)
        self.assertEqual(second_source, source)
        # A retained slice contains no referee observation. Its inherited review
        # layer must not keep claiming the parent's evidence frames 1/4/8 exist.
        sliced, reference_slice = copy.deepcopy(derived[5:8]), copy.deepcopy(reference[5:8])
        for index, (row, ref) in enumerate(zip(sliced, reference_slice)):
            row['frame'] = ref['frame'] = index
            row['time'] = ref['time'] = index / 25
        recomputed, _ = apply(sliced, reference_slice)
        self.assertTrue(all(not flagged(row) for row in recomputed))
        self.assertTrue(all(row['track_evidence']['13']['identity_review_required'] is False for row in recomputed))
        self.assertTrue(all('role_evidence' not in row['track_evidence']['13'] for row in recomputed))


if __name__ == '__main__':
    unittest.main()
