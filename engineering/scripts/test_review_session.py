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

from review_session import apply_review_edit
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

    def test_team_roles_are_explicit_and_do_not_rewrite_team_names(self):
        session, clip = fixture()
        for roles in (None, {'red': 'offense', 'blue': 'defense'}, {'red': 'defense', 'blue': 'offense'}):
            result = apply_review_edit(session, {'type': 'set_team_roles', 'teamRoles': roles}, clip)
            self.assertEqual(result['session']['teamRoles'], roles)
            self.assertEqual(result['session']['entities'][0]['team'], '球队 0')
            self.assertNotIn('affectedRange', result)

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
                   lambda s: s['courtCalibration'].update(score=float('inf'))]
        for index, change in enumerate(changes):
            session, clip = fixture()
            change(session)
            with self.subTest(index=index), self.assertRaises(ValueError):
                apply_review_edit(session, {'type': 'clear_player', 'entityId': 'P1'}, clip)


class ReviewEditHttpTests(unittest.TestCase):
    """Use a real loopback HTTP server with an isolated fixture library."""

    @classmethod
    def setUpClass(cls):
        cls.stack = ExitStack()
        cls.temp = cls.stack.enter_context(tempfile.TemporaryDirectory())
        root = Path(cls.temp)
        cls.session, cls.clip = fixture()
        cls.clip_bytes = json.dumps(cls.clip).encode('utf-8')
        library = root / 'library.json'
        library.write_text(json.dumps({'defaultSample': 'qa', 'samples': [{'id': 'qa'}]}), encoding='utf-8')
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
                                                 '--trim-root', str(root / 'trims'), '--state-file', str(root / 'server.json')]))
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


if __name__ == '__main__':
    unittest.main()
