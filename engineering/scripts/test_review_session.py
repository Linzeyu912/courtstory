"""Roster edits preserve unaffected draft data and stay local to each request."""

from contextlib import ExitStack
from copy import deepcopy
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from review_session import apply_review_edit, validate_session
import serve_player_review


def fixture():
    clip = {'video_sha256': 'video-one', 'frames': [{'frame': i, 'time': i / 10, 'tracks': []}
                                                for i in range(40)], 'sourceCuts': [30]}
    session = {'version': 1, 'videoHash': clip['video_sha256'], 'maxGapSeconds': .5, 'cuts': [],
               'identitySelection': {'confirmedAt': 'before'},
               'entities': [{'id': f'P{i}', 'role': 'player', 'name': f'球员 {i}', 'anchors': []}
                            for i in range(1, 11)],
               'courtCalibration': {'keyframes': [{'frame': 0, 'image': [[10, 10], [20, 20]]}]},
               'sceneObjects': {'unchanged': True}, 'liveSelection': {'confirmedAt': 'before'}}
    for index in (0, 5):
        session['entities'][index].update({
            'name': f'姓名 {index}', 'team': f'球队 {index}', 'jersey': str(index), 'description': f'说明 {index}',
            'anchors': [{'frame': 0, 'x': 10 + index, 'y': 20, 'trackId': index + 1, 'box': [0, 0, 20, 20]},
                        {'frame': 7, 'x': 30, 'y': 30, 'trackId': None}],
            'identityKeyframes': [{'frame': 0, 'kind': 'track', 'trackId': index + 1, 'order': 1},
                                  {'frame': 20, 'kind': 'track', 'trackId': index + 2, 'order': 3}],
            'bindings': [{'start': 10, 'end': 12, 'kind': 'track', 'trackId': 99, 'order': 2}],
            'courtAnchors': [{'frame': 8, 'x': 5, 'y': 7}],
            'events': [{'id': 'event', 'frame': 8, 'type': 'screen'}],
            'customMetadata': {'evidence': index},
        })
    return session, clip


class ReviewSessionTests(unittest.TestCase):
    def test_clear_removes_machine_identity_proofs_without_losing_human_name(self):
        session,clip=fixture();person=session['entities'][0]
        for field in ('machineIdentityBindings','machineNameIdentities','machineNameIdentityConflicts'):
            person[field]=[{'start':0,'end':3,'trackId':1}]
        person['machinePlayerProfile']={'name':'Machine Name','status':'candidate'}
        result=apply_review_edit(session,{'type':'clear_player','entityId':'P1'},clip)['session']['entities'][0]
        for field in ('machineIdentityBindings','machineNameIdentities','machineNameIdentityConflicts'):self.assertEqual(result[field],[])
        self.assertNotIn('machinePlayerProfile',result);self.assertEqual(result['name'],person['name'])

    def test_human_can_confirm_a_frame_on_the_new_machine_binding_scope(self):
        session,clip=fixture()
        session['entities'][0]['frameConfirmations']=[{'frame':0,'trackId':1,'identityOrder':1,
            'identityScope':'machine_name_binding','identityToken':'actual-source-bound-machine-token','origin':'human_frame_review'}]
        self.assertEqual(validate_session(session,clip),len(clip['frames']))

    def test_clear_removes_all_person_records_but_keeps_labels_and_others(self):
        session, clip = fixture()
        before = deepcopy(session)
        result = apply_review_edit(session, {'type': 'clear_player', 'entityId': 'P1'}, clip)
        person = result['session']['entities'][0]
        for field in ('anchors', 'identityKeyframes', 'bindings', 'courtAnchors', 'events'):
            self.assertEqual(person[field], [])
        for field in ('name', 'team', 'jersey', 'description', 'role', 'customMetadata'):
            self.assertEqual(person[field], before['entities'][0][field])
        self.assertEqual(result['session']['entities'][5]['anchors'], before['entities'][5]['anchors'])
        for field in ('courtCalibration', 'sceneObjects', 'liveSelection'):
            self.assertEqual(result['session'][field], before[field])
        self.assertIsNone(result['session']['identitySelection'])
        self.assertEqual(result['affectedRange'], {'start': 0, 'end': 39})
        self.assertEqual(session, before)

    def test_clear_referee_keeps_the_slot_and_role(self):
        session, clip = fixture()
        session['entities'].append({'id': 'R1', 'role': 'referee', 'name': '裁判',
                                    'anchors': [{'frame': 0, 'x': 1, 'y': 2, 'trackId': 7}]})
        result = apply_review_edit(session, {'type': 'clear_player', 'entityId': 'R1'}, clip)
        self.assertEqual(result['session']['entities'][-1]['role'], 'referee')
        self.assertEqual(result['session']['entities'][-1]['anchors'], [])

    def test_release_stops_at_next_binding_start_and_preserves_evidence(self):
        session, clip = fixture()
        result = apply_review_edit(session, {'type': 'release_identity', 'entityId': 'P1', 'frame': 5}, clip)
        self.assertEqual(result['affectedRange'], {'start': 5, 'end': 9})
        person = result['session']['entities'][0]
        self.assertEqual(person['bindings'][-1], {'kind': 'unassigned', 'trackId': None, 'start': 5, 'end': 9,
                         'order': 4, 'exclusive': True, 'origin': 'human_release', 'identitySource': 'human'})
        for field in ('anchors', 'courtAnchors', 'identityKeyframes', 'events'):
            self.assertEqual(person[field], session['entities'][0][field])
        self.assertIsNone(result['session']['identitySelection'])

    def test_release_stops_at_confirmation_cut_or_end_and_handles_same_frame(self):
        for start, end in ((10, 19), (20, 29), (30, 39), (39, 39)):
            with self.subTest(start=start):
                session, clip = fixture()
                result = apply_review_edit(session, {'type': 'release_identity', 'entityId': 'P1', 'frame': start}, clip)
                self.assertEqual(result['affectedRange'], {'start': start, 'end': end})
                self.assertEqual(result['session']['cuts'], [30])

    def test_release_after_binding_end_does_not_revive_old_identity(self):
        session, clip = fixture()
        result = apply_review_edit(session, {'type': 'release_identity', 'entityId': 'P1', 'frame': 11}, clip)
        self.assertEqual(result['affectedRange'], {'start': 11, 'end': 19})
        again = apply_review_edit(result['session'], {'type': 'release_identity', 'entityId': 'P1', 'frame': 11}, clip)
        self.assertEqual(again['session']['entities'][0]['bindings'][-1]['order'], 5)

    def test_legacy_anchor_identity_is_migrated_before_release(self):
        session, clip = fixture()
        player = session['entities'][0]
        del player['identityKeyframes']
        player['bindings'] = []
        player['anchors'] += [{'frame': 15, 'x': 1, 'y': 2, 'trackId': 3}]
        result = apply_review_edit(session, {'type': 'release_identity', 'entityId': 'P1', 'frame': 5}, clip)
        self.assertEqual(result['affectedRange'], {'start': 5, 'end': 14})
        self.assertEqual(result['session']['entities'][0]['identityKeyframes'][0]['origin'], 'legacy_anchor')
        self.assertNotIn('identityKeyframes', player)

    def test_swap_moves_complete_person_data_but_ids_and_sides_belong_to_slots(self):
        session, clip = fixture()
        before = deepcopy(session)
        result = apply_review_edit(session, {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'P6'}, clip)
        players = result['session']['entities']
        self.assertEqual(players[0], {**before['entities'][5], 'id': 'P1', 'teamSide': 'red'})
        self.assertEqual(players[5], {**before['entities'][0], 'id': 'P6', 'teamSide': 'blue'})
        self.assertIsNone(result['session']['identitySelection'])
        self.assertEqual(session, before)
        twice = apply_review_edit(result['session'], {'type': 'swap_players', 'sourceId': 'P6', 'targetId': 'P1'}, clip)
        self.assertEqual(twice['session']['entities'][0]['anchors'], before['entities'][0]['anchors'])

    def test_swap_with_empty_slot_and_within_team_is_supported(self):
        session, clip = fixture()
        for target in ('P2', 'P7'):
            result = apply_review_edit(session, {'type': 'swap_players', 'sourceId': 'P1', 'targetId': target}, clip)
            self.assertEqual(result['session']['entities'][0]['anchors'], [])
            self.assertEqual(result['session']['entities'][int(target[1:]) - 1]['name'], '姓名 0')

    def test_all_edits_remove_legacy_roles_and_keep_color_groups_and_person_data(self):
        absent = object()
        operations = [{'type': 'clear_player', 'entityId': 'P2'},
                      {'type': 'release_identity', 'entityId': 'P2', 'frame': 5},
                      {'type': 'swap_players', 'sourceId': 'P2', 'targetId': 'P3'},
                      {'type': 'assign_track', 'entityId': 'P2', 'trackId': 71, 'frame': 5}]
        for roles in (absent, None, {'red': 'offense', 'blue': 'defense'}, {'red': 'defense', 'blue': 'offense'}):
            for operation in operations:
                with self.subTest(roles='absent' if roles is absent else roles, operation=operation['type']):
                    session, clip = fixture()
                    if roles is not absent:
                        session['teamRoles'] = roles
                    for field in ('automaticAnnotation', 'modelSuggestionLoad'):
                        session[field] = {'version': 1, 'teamLayout': 'fixed_red_offense_blue_defense_v1',
                                          'method': 'existing-observations'}
                    clip['frames'][5]['tracks'] = [[1, 2, 20, 40, 71, .9, 0]]
                    before = deepcopy(session)
                    result = apply_review_edit(session, operation, clip)['session']
                    self.assertNotIn('teamRoles', result)
                    self.assertEqual([person['teamSide'] for person in result['entities']],
                                     ['red'] * 5 + ['blue'] * 5)
                    self.assertEqual(result['entities'][0], {**before['entities'][0], 'teamSide': 'red'})
                    self.assertEqual(result['entities'][5], {**before['entities'][5], 'teamSide': 'blue'})
                    for field in ('automaticAnnotation', 'modelSuggestionLoad'):
                        self.assertEqual(result[field], {**before[field], 'teamLayout': 'fixed_red_blue_color_only_v1'})
                    self.assertEqual(session, before)
                    restored = json.loads(json.dumps(result))
                    self.assertNotIn('teamRoles', apply_review_edit(restored, operation, clip)['session'])

    def test_color_metadata_migration_does_not_add_missing_objects_or_layout_fields(self):
        session, clip = fixture()
        result = apply_review_edit(session, {'type': 'set_team_roles', 'teamRoles': None}, clip)['session']
        for field in ('automaticAnnotation', 'modelSuggestionLoad'):
            self.assertNotIn(field, result)
            session[field] = {'version': 1, 'method': 'existing-observations'}
        result = apply_review_edit(session, {'type': 'set_team_roles', 'teamRoles': None}, clip)['session']
        for field in ('automaticAnnotation', 'modelSuggestionLoad'):
            self.assertEqual(result[field], session[field])
            self.assertNotIn('teamLayout', result[field])
        self.assertTrue(all(entity['role'] == 'player' for entity in result['entities']))

    def test_legacy_role_operation_only_clears_labels_and_rejects_new_assignments(self):
        session, clip = fixture()
        session['teamRoles'] = {'red': 'offense', 'blue': 'defense'}
        before = deepcopy(session)
        result = apply_review_edit(session, {'type': 'set_team_roles', 'teamRoles': None}, clip)
        self.assertNotIn('teamRoles', result['session'])
        self.assertIn('颜色分队', result['message'])
        self.assertEqual(result['session']['entities'][0], {**before['entities'][0], 'teamSide': 'red'})
        self.assertEqual(session, before)
        for roles in ({'red': 'offense', 'blue': 'defense'}, {'red': 'defense', 'blue': 'offense'}, {}, [], False):
            with self.subTest(roles=roles), self.assertRaisesRegex(ValueError, '当前只记录红蓝颜色分队'):
                apply_review_edit(session, {'type': 'set_team_roles', 'teamRoles': roles}, clip)

    def test_clear_suppresses_model_reinitialization_but_keeps_confirmed_profile(self):
        session, clip = fixture()
        player = session['entities'][0]
        player.update(modelBindings=[{'kind': 'track', 'trackId': 71, 'start': 0, 'end': 39}],
                      modelTeamGroup='A', modelTeamHint='red', automaticTeamEvidence={'votes': 3},
                      playerProfile={'playerId': 'name:player'}, ratingReference={'recordId': 'player@2024-25'})
        result = apply_review_edit(session, {'type': 'clear_player', 'entityId': 'P1'}, clip)
        cleared = result['session']['entities'][0]
        self.assertEqual(cleared['modelBindings'], [])
        self.assertTrue(cleared['identitySuggestionsDismissed'])
        self.assertEqual(cleared['dismissedModelBindings'], player['modelBindings'])
        for field in ('playerProfile', 'ratingReference'):
            self.assertEqual(cleared[field], player[field])
        for field in ('modelTeamGroup', 'modelTeamHint', 'automaticTeamEvidence'):
            self.assertNotIn(field, cleared)
        self.assertNotIn('identitySuggestionsDismissed', player)

    def test_release_crops_model_bindings_and_preserves_outside_intervals(self):
        session, clip = fixture()
        original = {'kind': 'track', 'trackId': 71, 'start': 0, 'end': 39,
                    'reviewRequired': True, 'method': 'thy-observed-tracks'}
        session['entities'][0]['modelBindings'] = [original]
        result = apply_review_edit(session, {'type': 'release_identity', 'entityId': 'P1', 'frame': 5}, clip)
        player = result['session']['entities'][0]
        self.assertEqual(result['affectedRange'], {'start': 5, 'end': 9})
        self.assertEqual(player['modelBindings'], [{**original, 'end': 4}, {**original, 'start': 10}])
        self.assertEqual(player['dismissedModelBindings'], [{**original, 'start': 5, 'end': 9}])
        self.assertEqual(player['bindings'][-1]['kind'], 'unassigned')
        self.assertEqual(session['entities'][0]['modelBindings'], [original])

    def test_swap_moves_model_identity_profile_and_suppression_as_one_person(self):
        session, clip = fixture()
        left, right = session['entities'][0], session['entities'][5]
        left.update(modelBindings=[{'kind': 'track', 'trackId': 71, 'start': 0, 'end': 39}],
                    playerProfile={'playerId': 'name:left'}, ratingReference={'recordId': 'left@2024-25'},
                    modelTeamGroup='A')
        right.update(modelBindings=[], playerProfile={'playerId': 'name:right'},
                     ratingReference={'recordId': 'right@2024-25'}, identitySuggestionsDismissed=True)
        result = apply_review_edit(session, {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'P6'}, clip)
        a, b = result['session']['entities'][0], result['session']['entities'][5]
        self.assertEqual(a, {**right, 'id': 'P1', 'teamSide': 'red'})
        self.assertEqual(b, {**left, 'id': 'P6', 'teamSide': 'blue'})
        self.assertNotIn('teamRoles', result['session'])

    def test_dismissed_observations_survive_repeated_clear_and_swap_to_empty_slot(self):
        for operation in ({'type': 'clear_player', 'entityId': 'P1'},
                          {'type': 'release_identity', 'entityId': 'P1', 'frame': 5}):
            with self.subTest(operation=operation['type']):
                session, clip = fixture()
                binding = {'kind': 'track', 'trackId': 71, 'start': 0, 'end': 39}
                session['entities'][0]['modelBindings'] = [binding]
                first = apply_review_edit(session, operation, clip)['session']
                again = apply_review_edit(first, operation, clip)['session']
                self.assertEqual(again['entities'][0]['dismissedModelBindings'],
                                 first['entities'][0]['dismissedModelBindings'])
                moved = apply_review_edit(again, {'type': 'swap_players', 'sourceId': 'P1',
                                                 'targetId': 'P9'}, clip)['session']
                self.assertEqual(moved['entities'][8]['dismissedModelBindings'],
                                 first['entities'][0]['dismissedModelBindings'])
                self.assertNotIn('dismissedModelBindings', moved['entities'][0])
                restored = json.loads(json.dumps(moved))
                self.assertEqual(restored['entities'][8]['dismissedModelBindings'],
                                 moved['entities'][8]['dismissedModelBindings'])

    def test_invalid_operations_do_not_mutate_the_input(self):
        session, clip = fixture()
        before = deepcopy(session)
        operations = [None, {}, {'type': 'drop_all'}, {'type': 'clear_player', 'entityId': 'P11'},
                      {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'P1'},
                      {'type': 'release_identity', 'entityId': 'P1', 'frame': True},
                      {'type': 'release_identity', 'entityId': 'P1', 'frame': 40},
                      {'type': 'release_identity', 'entityId': 'P1', 'frame': -1},
                      {'type': 'set_team_roles'},
                      {'type': 'set_team_roles', 'teamRoles': {'red': 'offense', 'blue': 'offense'}},
                      {'type': 'set_team_roles', 'teamRoles': {'red': [], 'blue': 'offense'}}]
        for operation in operations:
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                apply_review_edit(session, operation, clip)
            self.assertEqual(session, before)

    def test_referees_cannot_be_swapped_into_player_roster(self):
        session, clip = fixture()
        session['entities'].append({'id': 'R1', 'role': 'referee', 'anchors': []})
        with self.assertRaises(ValueError):
            apply_review_edit(session, {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'R1'}, clip)

    def test_schema_hash_slot_and_numeric_validation(self):
        changes = [lambda s: s.update(version=True), lambda s: s.update(version=2),
                   lambda s: s.update(videoHash='wrong'), lambda s: s.update(maxGapSeconds=float('nan')),
                   lambda s: s.update(identitySequence=True), lambda s: s.update(cuts=[40]),
                   lambda s: s.update(maxGapSeconds=10**400),
                   lambda s: s.update(entities=s['entities'][:-1]),
                   lambda s: s['entities'][1].update(id='P1'),
                   lambda s: s['entities'][0].update(role='referee'),
                   lambda s: s['entities'][0]['anchors'][0].update(x=True),
                   lambda s: s['entities'][0]['anchors'][0].update(frame=-1),
                   lambda s: s['entities'][0]['anchors'][0].update(box=[2, 3, 1, 4]),
                   lambda s: s['entities'][0]['bindings'][0].update(end=40),
                   lambda s: s['entities'][0]['identityKeyframes'][0].update(trackId=True),
                   lambda s: s['entities'][0].update(identitySuggestionsDismissed='true'),
                   lambda s: s['entities'][0].update(modelBindings=[{'kind': 'track', 'trackId': 1, 'start': 0, 'end': 40}]),
                   lambda s: s['entities'][0].update(modelBindings=[{'kind': 'unassigned', 'trackId': None, 'start': 0, 'end': 1}]),
                   lambda s: s['entities'][0].update(dismissedModelBindings=[{'kind': 'track', 'trackId': 1, 'start': 0, 'end': 40}]),
                   lambda s: s['courtCalibration'].update(score=float('inf'))]
        for index, change in enumerate(changes):
            session, clip = fixture()
            change(session)
            with self.subTest(index=index), self.assertRaises(ValueError):
                apply_review_edit(session, {'type': 'clear_player', 'entityId': 'P1'}, clip)


class IdentityReferenceTests(unittest.TestCase):
    def setUp(self):
        self.session, self.clip = fixture()
        self.clip['tracking_fingerprint'] = 'tracking-one'
        self.clip['frames'][5]['tracks'] = [[10.5, 20, 40, 70, 71, .9, 0]]
        self.reference = {'version': 1, 'videoHash': 'video-one', 'trackingFingerprint': 'tracking-one',
                          'frame': 5, 'trackId': 71, 'box': [10.5, 20, 40, 70], 'team': '紫队', 'jersey': '00'}
        self.session['entities'][0]['identityReference'] = deepcopy(self.reference)

    def test_valid_reference_survives_json_roundtrip_without_creating_track_bindings(self):
        before = deepcopy(self.session)
        restored = json.loads(json.dumps(self.session))
        self.assertEqual(validate_session(restored, self.clip), 40)
        edited = apply_review_edit(restored, {'type': 'clear_player', 'entityId': 'P2'}, self.clip)['session']
        self.assertEqual(edited['entities'][0], {**before['entities'][0], 'teamSide': 'red'})
        self.assertEqual(self.session, before)

    def test_reference_source_geometry_schema_and_profile_tampering_is_rejected(self):
        changes = [{'version': True}, {'version': 2}, {'videoHash': 'other-video'},
                   {'trackingFingerprint': 'old-tracking'}, {'trackingFingerprint': None},
                   {'frame': 4}, {'frame': True}, {'frame': 40}, {'trackId': 72}, {'trackId': 0},
                   {'box': [11, 20, 40, 70]}, {'box': [10.5, 20, float('inf'), 70]},
                   {'box': [10.5, 20, 40]}, {'team': 'x' * 41}, {'team': 1}, {'team': '紫\x00队'},
                   {'jersey': '1234'}, {'jersey': '１０'}, {'jersey': 10}, {'arbitrary': True}]
        for change in changes:
            candidate = deepcopy(self.session)
            candidate['entities'][0]['identityReference'].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_session(candidate, self.clip)
        for missing in self.reference:
            candidate = deepcopy(self.session)
            del candidate['entities'][0]['identityReference'][missing]
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                validate_session(candidate, self.clip)

    def test_clear_removes_reference_but_keeps_confirmed_profile_and_undo_snapshot(self):
        before = deepcopy(self.session)
        cleared = apply_review_edit(self.session, {'type': 'clear_player', 'entityId': 'P1'}, self.clip)['session']
        self.assertNotIn('identityReference', cleared['entities'][0])
        for field in ('name', 'team', 'jersey'):
            self.assertEqual(cleared['entities'][0][field], before['entities'][0][field])
        self.assertEqual(self.session, before)

    def test_swap_moves_reference_with_person_and_can_roundtrip_back(self):
        moved = apply_review_edit(self.session, {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'P6'}, self.clip)['session']
        self.assertNotIn('identityReference', moved['entities'][0])
        self.assertEqual(moved['entities'][5]['identityReference'], self.reference)
        restored = apply_review_edit(moved, {'type': 'swap_players', 'sourceId': 'P6', 'targetId': 'P1'}, self.clip)['session']
        self.assertEqual(restored['entities'][0]['identityReference'], self.reference)
        self.assertEqual(validate_session(restored, self.clip), 40)


class WholeTrackAssignmentTests(unittest.TestCase):
    """An assignment groups observations; it does not certify every frame."""

    def setUp(self):
        self.session, self.clip = fixture()
        self.session['cuts'] = [11]
        self.observed = [*range(2, 6), *range(8, 13), *range(17, 20), *range(25, 32)]
        self.ranges = [{'start': 2, 'end': 5}, {'start': 8, 'end': 10}, {'start': 11, 'end': 12},
                       {'start': 17, 'end': 19}, {'start': 25, 'end': 29}, {'start': 30, 'end': 31}]
        for frame in self.observed:
            self.clip['frames'][frame]['tracks'].append([10, 20, 40, 70, 71, .95, 0])

    def assign(self, session=None, *, entity='P2', track=71, frame=18):
        return apply_review_edit(session or self.session, {
            'type': 'assign_track', 'entityId': entity, 'trackId': track, 'frame': frame,
        }, self.clip)

    def test_middle_selection_includes_all_previous_and_later_observations(self):
        before, original = deepcopy(self.session), deepcopy(self.clip)
        result = self.assign()
        player = result['session']['entities'][1]
        self.assertEqual(result['assignment'], {'trackId': 71, 'observationCount': 19,
                                               'rangeCount': 6, 'ranges': self.ranges})
        self.assertIn('仍待逐帧核对', result['message'])
        self.assertEqual(player['bindings'], [
            {'kind': 'track', 'trackId': 71, **span, 'scope': 'track_occurrences',
             'origin': 'human_track_assignment', 'selectionFrame': 18, 'order': 4,
             'exclusive': False, 'reviewRequired': True} for span in self.ranges])
        self.assertEqual(player['anchors'], [])
        self.assertEqual(player['identityKeyframes'], [])
        self.assertEqual(result['session']['identitySequence'], 4)
        self.assertEqual(self.session, before)
        self.assertEqual(self.clip, original)

    def test_gaps_remain_empty_and_source_and_session_cuts_split_ranges(self):
        bindings = self.assign()['session']['entities'][1]['bindings']
        assigned = {frame for binding in bindings for frame in range(binding['start'], binding['end'] + 1)}
        self.assertEqual(assigned, set(self.observed))
        for boundary in (11, 30):
            self.assertFalse(any(binding['start'] < boundary <= binding['end'] for binding in bindings))
        self.assertFalse({6, 7, 13, 14, 15, 16, 20, 21, 22, 23, 24} & assigned)

    def test_repeated_selection_accumulates_only_clicked_frames_and_same_frame_is_idempotent(self):
        first = self.assign()
        restored = json.loads(json.dumps(first['session']))
        self.assertEqual(self.assign(restored), first)
        second = self.assign(restored, frame=31)
        self.assertEqual(second['assignment'], first['assignment'])
        self.assertEqual(second['session']['entities'][1]['bindings'], first['session']['entities'][1]['bindings'])
        self.assertEqual(second['session']['identitySequence'], first['session']['identitySequence'])
        self.assertEqual(second['session']['entities'][1]['frameConfirmations'], [
            {'frame': frame, 'trackId': 71, 'origin': 'human_track_selection',
             'identityOrder': 4, 'identityScope': 'track_occurrences'} for frame in (18, 31)])
        self.assertEqual(self.assign(second['session'], frame=31), second)
        self.assertEqual(validate_session(restored, self.clip), 40)

    def test_duplicate_detections_in_a_frame_count_as_one_observation(self):
        self.clip['frames'][18]['tracks'].append([15, 25, 45, 75, 71, .7, 0])
        self.assertEqual(self.assign()['assignment']['observationCount'], 19)

    def test_repeated_assignment_splits_new_cuts_without_changing_claim_or_human_evidence(self):
        for source in ('session', 'clip'):
            with self.subTest(source=source):
                self.setUp()
                first = self.assign(entity='P1')['session']
                before = deepcopy(first)
                if source == 'session':
                    first['cuts'].append(4)
                else:
                    self.clip['sourceCuts'].append(4)
                result = self.assign(first, entity='P1', frame=4)
                after = result['session']
                bulk = [binding for binding in after['entities'][0]['bindings']
                        if binding.get('scope') == 'track_occurrences']
                expected = [{'start': 2, 'end': 3}, {'start': 4, 'end': 5}, *self.ranges[1:]]
                self.assertEqual(result['assignment']['ranges'], expected)
                self.assertEqual([(b['start'], b['end']) for b in bulk],
                                 [(r['start'], r['end']) for r in expected])
                self.assertTrue(all(binding['order'] == 4 and binding['selectionFrame'] == 18 for binding in bulk))
                self.assertEqual(after['identitySequence'], before['identitySequence'])
                self.assertEqual(after['entities'][0]['bindings'][0], before['entities'][0]['bindings'][0])
                for field in ('anchors', 'identityKeyframes', 'courtAnchors', 'events'):
                    self.assertEqual(after['entities'][0][field], before['entities'][0][field])
                self.assertEqual(self.assign(after, entity='P1', frame=4), result)

    def test_multiple_tracks_accumulate_and_ambiguous_observations_are_retained(self):
        for frame in (13, 14, 15, 18):
            self.clip['frames'][frame]['tracks'].append([20, 20, 50, 70, 72, .9, 0])
        first = self.assign()['session']
        second = self.assign(first, track=72, frame=14)['session']
        self.assertEqual(second['entities'][1]['bindings'][:6], first['entities'][1]['bindings'])
        extra = second['entities'][1]['bindings'][6:]
        self.assertEqual([(binding['start'], binding['end']) for binding in extra], [(13, 15), (18, 18)])
        self.assertTrue(all(binding['order'] == 5 for binding in extra))
        # Both candidates at frame 18 survive for the resolver to mark a conflict.
        self.assertEqual({binding['trackId'] for binding in second['entities'][1]['bindings']
                          if binding['start'] <= 18 <= binding['end']}, {71, 72})
        third = self.assign(second, entity='P3')['session']
        self.assertEqual(third['entities'][1], second['entities'][1])
        self.assertTrue(third['entities'][2]['bindings'])

    def test_assignment_preserves_manual_locations_keys_other_tracks_and_scene_data(self):
        original = deepcopy(self.session)
        result = self.assign(entity='P1')['session']
        player, previous = result['entities'][0], original['entities'][0]
        for field in ('anchors', 'courtAnchors', 'identityKeyframes', 'events', 'customMetadata'):
            self.assertEqual(player[field], previous[field])
        self.assertEqual(player['bindings'][:1], previous['bindings'])
        for field in ('courtCalibration', 'sceneObjects', 'liveSelection'):
            self.assertEqual(result[field], original[field])
        self.assertEqual(result['entities'][5]['anchors'], original['entities'][5]['anchors'])

    def test_invalid_track_frame_and_slot_are_rejected_without_mutating_inputs(self):
        before, original = deepcopy(self.session), deepcopy(self.clip)
        invalid = [{'track': 0}, {'track': -1}, {'track': True}, {'track': 71.0}, {'track': '71'},
                   {'track': 999}, {'frame': 6}, {'frame': -1}, {'frame': 40}, {'frame': True},
                   {'entity': 'P11'}]
        for arguments in invalid:
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                self.assign(**arguments)
            self.assertEqual(self.session, before)
            self.assertEqual(self.clip, original)

    def test_clear_records_bulk_observations_and_preserves_them_after_swap_and_restore(self):
        first = self.assign()['session']
        bulk = deepcopy(first['entities'][1]['bindings'])
        cleared = apply_review_edit(first, {'type': 'clear_player', 'entityId': 'P2'}, self.clip)['session']
        self.assertEqual(cleared['entities'][1]['bindings'], [])
        self.assertEqual(cleared['entities'][1]['frameConfirmations'], [])
        self.assertEqual(cleared['entities'][1]['dismissedModelBindings'], bulk)
        self.assertTrue(cleared['entities'][1]['identitySuggestionsDismissed'])
        repeated = apply_review_edit(cleared, {'type': 'clear_player', 'entityId': 'P2'}, self.clip)['session']
        self.assertEqual(repeated, cleared)
        swapped = apply_review_edit(json.loads(json.dumps(cleared)), {
            'type': 'swap_players', 'sourceId': 'P2', 'targetId': 'P9'}, self.clip)['session']
        self.assertEqual(swapped['entities'][8]['dismissedModelBindings'], bulk)
        self.assertEqual(swapped['entities'][8]['teamSide'], 'blue')
        self.assertEqual(first['entities'][1]['bindings'], bulk)
        # Restoring the pre-clear snapshot retains the complete observation set.
        restored = json.loads(json.dumps(first))
        self.assertEqual(self.assign(restored)['session'], first)

    def test_release_stops_at_bulk_end_and_keeps_earlier_and_later_evidence(self):
        first = self.assign()['session']
        first['entities'][1]['modelBindings'] = [{'kind': 'track', 'trackId': 71, 'start': 0, 'end': 39}]
        bulk = deepcopy(first['entities'][1]['bindings'])
        released = apply_review_edit(first, {'type': 'release_identity', 'entityId': 'P2', 'frame': 18}, self.clip)
        player = released['session']['entities'][1]
        self.assertEqual(released['affectedRange'], {'start': 18, 'end': 19})
        self.assertEqual(player['bindings'][:6], bulk)
        self.assertEqual(player['bindings'][-1]['kind'], 'unassigned')
        self.assertEqual(player['bindings'][-1]['order'], 5)
        self.assertEqual(player['frameConfirmations'], [])
        self.assertEqual(player['modelBindings'], [
            {'kind': 'track', 'trackId': 71, 'start': 0, 'end': 17},
            {'kind': 'track', 'trackId': 71, 'start': 20, 'end': 39}])
        self.assertEqual([(binding['start'], binding['end']) for binding in player['dismissedModelBindings']],
                         [(18, 19), (18, 19)])
        again = apply_review_edit(released['session'], {
            'type': 'release_identity', 'entityId': 'P2', 'frame': 18}, self.clip)['session']
        self.assertEqual(again['entities'][1]['dismissedModelBindings'], player['dismissedModelBindings'])
        # Re-grouping T71 must not remove the explicit cancellation barrier.
        reassigned = self.assign(again, frame=31)['session']
        self.assertEqual(reassigned['entities'][1]['bindings'], again['entities'][1]['bindings'])
        self.assertEqual([item['frame'] for item in reassigned['entities'][1]['frameConfirmations']], [31])

    def test_release_keeps_confirmations_outside_the_cancelled_range(self):
        first = self.assign()['session']
        for frame in (2, 19, 31):
            first = self.assign(first, frame=frame)['session']
        result = apply_review_edit(first, {'type': 'release_identity', 'entityId': 'P2', 'frame': 18}, self.clip)['session']
        self.assertEqual([item['frame'] for item in result['entities'][1]['frameConfirmations']], [2, 31])
        self.assertEqual([item['frame'] for item in first['entities'][1]['frameConfirmations']], [18, 2, 19, 31])

    def test_frame_confirmation_schema_accepts_browser_review_tokens_and_rejects_invalid_records(self):
        for scope in ('manual_forward', 'manual_range', 'model_suggestion', 'manual_position'):
            session = deepcopy(self.session)
            record = {'frame': 2, 'trackId': None if scope == 'manual_position' else 71,
                      'origin': 'human_frame_review', 'identityScope': scope, 'identityOrder': 0,
                      'identityToken': '["saved-identity"]'}
            if scope == 'manual_position':
                record['anchorSignature'] = '[2,10,20]'
            session['entities'][1]['frameConfirmations'] = [record]
            self.assertEqual(validate_session(session, self.clip), 40)
        first = self.assign()['session']
        for change in ({'frame': True}, {'frame': 40}, {'trackId': None}, {'trackId': 0},
                       {'identityOrder': -1}, {'identityScope': 'whole_video'}, {'origin': 'model'},
                       {'identityToken': []}, {'identityToken': 'x' * 8193},
                       {'origin': 'human_frame_review'}):
            candidate = deepcopy(first)
            candidate['entities'][1]['frameConfirmations'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_session(candidate, self.clip)

    def test_swap_moves_bulk_assignments_and_cancelled_ranges_as_complete_person_records(self):
        first = self.assign()['session']
        first = apply_review_edit(first, {'type': 'release_identity', 'entityId': 'P2', 'frame': 18}, self.clip)['session']
        original = deepcopy(first)
        moved = apply_review_edit(first, {'type': 'swap_players', 'sourceId': 'P2', 'targetId': 'P9'}, self.clip)['session']
        self.assertEqual(moved['entities'][8], {**original['entities'][1], 'id': 'P9', 'teamSide': 'blue'})
        restored = json.loads(json.dumps(moved))
        self.assertEqual(validate_session(restored, self.clip), 40)
        self.assertEqual(first, original)

    def test_scope_and_selection_frame_are_validated_without_rejecting_old_drafts(self):
        first = self.assign()['session']
        for change in ({'scope': 'all_video'}, {'scope': None}, {'scope': []}, {'selectionFrame': True},
                       {'selectionFrame': -1}, {'selectionFrame': 40}, {'trackId': 0}):
            candidate = deepcopy(first)
            candidate['entities'][1]['bindings'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_session(candidate, self.clip)
        self.assertEqual(validate_session(self.session, self.clip), 40)
        self.assertEqual(first['identityBindingMode'], 'forward_only_v1')


class ReviewEditHttpTests(unittest.TestCase):
    """Use a real loopback HTTP server with an isolated fixture library."""

    @classmethod
    def setUpClass(cls):
        cls.stack = ExitStack()
        cls.temp = cls.stack.enter_context(tempfile.TemporaryDirectory())
        root = Path(cls.temp)
        cls.session, cls.clip = fixture()
        cls.clip['tracking_fingerprint'] = 'tracking-one'
        cls.clip['tracking_revision'] = 'original'
        for frame in (1, 2, 5, 6, 30, 31):
            cls.clip['frames'][frame]['tracks'].append([1, 2, 20, 40, 71, .9, 0])
        cls.clip_bytes = json.dumps(cls.clip).encode('utf-8')
        library = root / 'library.json'
        library.write_text(json.dumps({'defaultSample': 'qa', 'samples': [{'id': 'qa',
            'video': str(root / 'unread-video.mp4'), 'tracks': str(root / 'unread-tracks.json')}]}), encoding='utf-8')
        # This HTTP fixture must not hash a contributor's full shared video library.
        catalog = root / 'catalog.json'
        catalog.write_text(json.dumps({'datasets': []}), encoding='utf-8')
        ready = threading.Event()

        def server_factory(address, handler):
            cls.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
            ready.set()
            return cls.server

        cls.stack.enter_context(patch.object(serve_player_review, 'ThreadingHTTPServer', server_factory))
        cls.stack.enter_context(patch.object(serve_player_review, 'load_clip', return_value={
            'video': root / 'unread-video.mp4', 'digest': 'video-one', 'frames': 40,
            'defaultVariant': 'original', 'payloads': {'original': cls.clip_bytes}}))
        cls.stack.enter_context(patch('sys.argv', ['serve_player_review.py', '--library', str(library),
                                                 '--shared-video-catalog', str(catalog),
                                                 '--trim-root', str(root / 'trims'), '--state-file', str(root / 'server.json'),
                                                 '--video-folder', str(root / 'inbox'), '--import-cache', str(root / 'imports'),
                                                 '--tactics-folder', str(root / 'tactics'),
                                                 '--identity-agent-provider', 'multimodal-api']))
        cls.thread = threading.Thread(target=serve_player_review.main, daemon=True)
        cls.thread.start()
        if not ready.wait(5):
            cls.stack.close()
            raise RuntimeError('测试 HTTP 服务未启动。')

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(5)
        cls.stack.close()

    def request(self, body, headers=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request('POST', '/api/review-edit', json.dumps(body),
                           {'Content-Type': 'application/json', **(headers or {})})
        response = connection.getresponse()
        status, data = response.status, response.read()
        connection.close()
        return status, data

    def payload(self):
        return {'sample': 'qa', 'variant': 'original', 'qa': True, 'session': deepcopy(self.session),
                'operation': {'type': 'swap_players', 'sourceId': 'P1', 'targetId': 'P6'}}

    def test_real_http_exchange_leaves_server_clip_and_disk_unchanged(self):
        before = {str(p.relative_to(self.temp)): p.read_bytes() for p in Path(self.temp).rglob('*') if p.is_file()}
        status, data = self.request(self.payload())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)['session']['entities'][0]['name'], '姓名 5')
        after = {str(p.relative_to(self.temp)): p.read_bytes() for p in Path(self.temp).rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(json.loads(self.clip_bytes), self.clip)

    def test_large_local_draft_is_accepted_and_qa_flag_does_not_select_storage(self):
        body = self.payload()
        body['qa'] = False
        body['session']['opaqueMetadata'] = 'x' * 100_000
        status, data = self.request(body)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)['session']['opaqueMetadata'], body['session']['opaqueMetadata'])

    def test_whole_track_assignment_round_trips_without_writing_source_data(self):
        body = self.payload()
        body['operation'] = {'type': 'assign_track', 'entityId': 'P2', 'trackId': 71, 'frame': 5}
        before = {str(p.relative_to(self.temp)): p.read_bytes() for p in Path(self.temp).rglob('*') if p.is_file()}
        status, data = self.request(body)
        self.assertEqual(status, 200)
        result = json.loads(data)
        self.assertEqual(result['assignment'], {'trackId': 71, 'observationCount': 6, 'rangeCount': 3,
            'ranges': [{'start': 1, 'end': 2}, {'start': 5, 'end': 6}, {'start': 30, 'end': 31}]})
        body['session'] = result['session']
        body['operation']['frame'] = 31
        status, data = self.request(body)
        self.assertEqual(status, 200)
        repeated = json.loads(data)
        self.assertEqual(repeated['assignment'], result['assignment'])
        self.assertEqual(repeated['session']['entities'][1]['bindings'], result['session']['entities'][1]['bindings'])
        self.assertEqual([record['frame'] for record in repeated['session']['entities'][1]['frameConfirmations']], [5, 31])
        body['operation']['frame'] = 20
        self.assertEqual(self.request(body)[0], 400)
        after = {str(p.relative_to(self.temp)): p.read_bytes() for p in Path(self.temp).rglob('*') if p.is_file()}
        self.assertEqual(after, before)
        self.assertEqual(json.loads(self.clip_bytes), self.clip)

    def test_http_rejects_wrong_hash_variant_schema_and_nonfinite(self):
        changes = [lambda b: b['session'].update(videoHash='another'), lambda b: b.update(variant='missing'),
                   lambda b: b.update(sample='missing'), lambda b: b['session'].update(version=2),
                   lambda b: b['session'].update(maxGapSeconds=float('nan'))]
        for index, change in enumerate(changes):
            body = self.payload()
            change(body)
            with self.subTest(index=index):
                status, data = self.request(body)
                self.assertEqual(status, 400)
                self.assertIn('error', json.loads(data))

    def test_http_rejects_external_origin_and_wrong_media_type(self):
        self.assertEqual(self.request(self.payload(), {'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.request(self.payload(), {'Content-Type': 'text/plain'})[0], 415)

    def identity_request(self, method, route, body=None, headers=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request(method, '/api/identity-agent/' + route,
                               json.dumps(body) if body is not None else None,
                               {'Content-Type': 'application/json', **(headers or {})})
            response = connection.getresponse()
            return response.status, response.read(), response.getheader('Cache-Control')
        finally:
            connection.close()

    def test_identity_unconfigured_provider_is_explicit_and_does_not_change_draft_or_disk(self):
        status, data, cache = self.identity_request('GET', 'status')
        self.assertEqual(status, 200)
        provider = json.loads(data)
        self.assertEqual(provider['provider'], 'multimodal-api')
        self.assertFalse(provider['available'])
        self.assertTrue(provider['message'])
        self.assertEqual(cache, 'no-store')
        before = {str(p.relative_to(self.temp)): p.read_bytes() for p in Path(self.temp).rglob('*') if p.is_file()}
        body = self.payload()
        body.pop('operation')
        body.update(clientRevision=1, entityId='P1', purpose='reference', reference={
            'version': 1, 'videoHash': 'video-one', 'trackingFingerprint': 'tracking-one',
            'frame': 5, 'trackId': 71, 'box': [1, 2, 20, 40], 'team': '', 'jersey': ''})
        original = deepcopy(body)
        status, data, _ = self.identity_request('POST', 'jobs', body)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(data)['error'], provider['message'])
        self.assertEqual(body, original)
        after = {str(p.relative_to(self.temp)): p.read_bytes() for p in Path(self.temp).rglob('*') if p.is_file()}
        self.assertEqual(after, before)

    def test_identity_routes_reject_cross_origin_and_wrong_host_before_dispatch(self):
        for method, route in [('GET', 'status'), ('GET', 'jobs/missing?sample=qa&variant=original&qa=1'),
                              ('POST', 'jobs'), ('POST', 'jobs/missing/cancel'), ('POST', 'jobs/missing/adopt')]:
            for headers in ({'Origin': 'https://example.com'}, {'Host': 'evil.example'}):
                with self.subTest(method=method, route=route, headers=headers):
                    self.assertEqual(self.identity_request(method, route, self.payload(), headers)[0], 403)

    def test_identity_routes_reject_malformed_requests_and_source_selectors(self):
        self.assertEqual(self.identity_request('POST', 'jobs', {}, {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.identity_request('POST', 'jobs', {}, {'Content-Length': str(32 * 1024 * 1024 + 1)})[0], 400)
        for body in ([], {'sample': 'qa', 'variant': 'original', 'qa': '1'},
                     {'sample': 'missing', 'variant': 'original'}, {'sample': 'qa', 'variant': 'missing'},
                     {'sample': 'qa', 'variant': 'original', 'clientRevision': float('nan')}):
            with self.subTest(body=body):
                status, data, _ = self.identity_request('POST', 'jobs', body)
                self.assertEqual(status, 400)
                self.assertIn('error', json.loads(data))
        for query in ('sample=qa&variant=missing', 'sample=missing&variant=original',
                      'sample=qa&variant=original&qa=wat', 'sample=qa&sample=other&variant=original'):
            with self.subTest(query=query):
                self.assertEqual(self.identity_request('GET', 'jobs/missing?' + query)[0], 400)

    def test_http_rejects_tampered_reference_without_modifying_source(self):
        body = self.payload()
        reference = {'version': 1, 'videoHash': 'video-one', 'trackingFingerprint': 'tracking-one',
                     'frame': 5, 'trackId': 71, 'box': [1, 2, 20, 40], 'team': '紫队', 'jersey': '10'}
        body['session']['entities'][0]['identityReference'] = reference
        for change in ({'box': [2, 2, 20, 40]}, {'videoHash': 'other'}, {'trackingFingerprint': 'old'}):
            invalid = deepcopy(body)
            invalid['session']['entities'][0]['identityReference'].update(change)
            with self.subTest(change=change):
                self.assertEqual(self.request(invalid)[0], 400)
        self.assertEqual(self.request(body)[0], 200)
        self.assertNotIn('identityReference', self.session['entities'][0])

    def test_calibration_route_stays_available_with_identity_and_edit_routes(self):
        # Exercise the integrated HTTP dispatch without loading GPU weights or
        # relying on a local model installation for this regression test.
        with patch('court_calibration.calibrate_court', return_value={'schemaVersion': 1,
                'keyframes': [], 'reviewRequired': True}) as calibrate:
            connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
            connection.request('POST', '/api/court-calibrate', json.dumps({'sample': 'qa', 'frame': 0}),
                               {'Content-Type': 'application/json'})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertTrue(json.loads(response.read())['reviewRequired'])
            connection.close()
            self.assertEqual(calibrate.call_args.args[1], self.clip)
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request('GET', '/api/player-identity/options?season=2024-25')
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertIn('teams', json.loads(response.read()))
        connection.close()


if __name__ == '__main__':
    unittest.main()
