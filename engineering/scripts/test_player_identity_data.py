"""Identity candidates and ratings retain season, number and source boundaries."""

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

try:
    from player_identity_data import PlayerIdentityData, PlayerIdentityDataUnavailable
except ModuleNotFoundError:
    PlayerIdentityData = None
    PlayerIdentityDataUnavailable = RuntimeError


SCRIPT_ROOT = Path(__file__).resolve().parent
DATA_ROOT = SCRIPT_ROOT.parents[1] / '2K Player Data'
FIELDS = (
    'overall', 'three_point_shot', 'mid_range_shot', 'close_shot', 'layup',
    'driving_dunk', 'ball_handle', 'speed_with_ball', 'perimeter_defense',
    'interior_defense', 'block', 'help_defense_iq', 'defensive_consistency',
)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False) + '\n', encoding='utf-8')


def make_package(root):
    """Tiny independent package also covers out-of-scope, missing and mixed data."""
    names = {'name:zero': 'Zero Player', 'name:doublezero': 'Double Zero Player',
             'name:first': 'First Player', 'name:second': 'Second Player',
             'name:missing': 'Missing Ratings', 'name:partial': 'Partial Ratings'}
    jerseys = {'name:zero': ('DET', '0'), 'name:doublezero': ('DET', '00'),
               'name:first': ('BOS', '44'), 'name:second': ('BOS', '44'),
               'name:missing': ('MIN', '88'), 'name:partial': ('MIN', '99')}
    index = {'schema_version': '1.1.0', 'players': {}, 'by_record': {},
             'history_by_player': {}, 'by_jersey': {}}
    records, histories, provenance = [], [], {}
    for line, (pid, name) in enumerate(names.items(), 1):
        team, jersey = jerseys[pid]
        record_id = pid + '@2024-25'
        history_pointer = {'path': 'team_history.jsonl', 'line': line}
        index['players'][pid] = {'player_name': name, 'history': history_pointer, 'seasons': {
            '2024-25': {'scope_status': 'in_rating_scope', 'record_id': record_id},
            '2025-26': {'scope_status': 'not_in_rating_scope', 'record_id': None}}}
        index['history_by_player'][pid] = history_pointer
        index['by_record'][record_id] = {'path': 'players/2024-25.jsonl', 'line': line}
        index['by_jersey'].setdefault('2024-25|' + team + '|' + jersey, []).append(pid)
        index['by_jersey'].setdefault('2025-26|' + team + '|' + jersey, []).append(pid)
        stint = {'season': '2024-25', 'team_abbreviation': team,
                 'team_name': team + ' Team', 'team_name_zh': team + '球队',
                 'jersey': jersey, 'jersey_numbers': [jersey],
                 'association_kind': 'season_team_roster', 'phase': 'season roster',
                 'source_id': 'roster', 'source_retrieved_date': '2026-09-30'}
        future = {**stint, 'season': '2025-26'}
        histories.append({'player_id': pid, 'player_name': name, 'stints': [stint, future]})
        ratings = {key: 75 for key in FIELDS}
        status = 'complete'
        if pid == 'name:missing':
            ratings = dict.fromkeys(FIELDS)
            status = 'missing_record'
        elif pid == 'name:partial':
            ratings = dict.fromkeys(FIELDS)
            ratings['overall'] = 67
            status = 'partial'
        records.append({'record_id': record_id, 'player_id': pid, 'player_name': name,
                        'season': '2024-25', 'game': 'NBA 2K25', 'ratings': ratings,
                        'availability': {'status': status}, 'season_teams': [stint]})
        provenance[record_id] = {'baseline_fields': list(FIELDS),
                                 'default_source_id': 'baseline', 'field_source_ids': {}}
    provenance['name:first@2024-25']['field_source_ids']['three_point_shot'] = 'field'
    write_json(root / 'manifest.json', {'schema_version': '1.1.0', 'seasons': ['2024-25', '2025-26']})
    write_json(root / 'index.json', index)
    write_json(root / 'teams.json', {'teams': []})
    write_json(root / 'sources.json', {'catalog': {'roster': {'url': 'https://example.org/roster'}}})
    sources = {sid: {'source_id': sid, 'source_url': 'https://example.org/' + sid,
                     'game': 'NBA 2K25', 'snapshot_date': '2024-11-26T02:25:26Z',
                     'date_basis': sid + ' commit, game patch date unknown'}
               for sid in ['baseline', 'field']}
    write_json(root / 'field_provenance.json', {'sources': sources, 'records': provenance})
    for path, rows in [('players/2024-25.jsonl', records), ('team_history.jsonl', histories)]:
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
    return index


class IdentityDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'package'
        self.index = make_package(self.root)

    def data(self, root=None):
        self.assertIsNotNone(PlayerIdentityData, 'Player identity data provider is not implemented')
        return PlayerIdentityData(root or self.root)

    def test_options_can_load_seasons_before_user_selects_one(self):
        value = self.data().options()
        self.assertEqual(value['seasons'], ['2024-25', '2025-26'])
        self.assertEqual(value['teams'], [])
        self.assertIn('dataset_scope', value)

    def test_team_options_include_known_history_outside_playoff_team_table(self):
        value = self.data().options('2024-25')
        self.assertEqual([team['abbreviation'] for team in value['teams']], ['BOS', 'DET', 'MIN'])
        self.assertEqual(value['teams'][2]['name'], 'MIN Team')
        self.assertEqual(value['teams'][2]['name_zh'], 'MIN球队')

    def test_zero_and_double_zero_are_distinct_textual_numbers(self):
        data = self.data()
        zero = data.lookup('2024-25', 'DET', '0')
        double = data.lookup('2024-25', 'DET', '00')
        self.assertEqual(zero['candidates'][0]['player_id'], 'name:zero')
        self.assertEqual(double['candidates'][0]['player_id'], 'name:doublezero')
        self.assertEqual(double['candidates'][0]['jersey_number'], '00')

    def test_multiple_players_with_one_number_remain_unconfirmed_candidates(self):
        value = self.data().lookup('2024-25', 'BOS', '44')
        self.assertEqual(value['status'], 'multiple_candidates')
        self.assertEqual([item['player_id'] for item in value['candidates']], ['name:first', 'name:second'])
        self.assertNotIn('confirmed', value)

    def test_unknown_number_returns_empty_candidates_without_invented_match(self):
        value = self.data().lookup('2024-25', 'MIN', '77')
        self.assertEqual(value['status'], 'no_match')
        self.assertEqual(value['candidates'], [])

    def test_exact_thirteen_fields_and_field_source_override_are_returned(self):
        value = self.data().lookup('2024-25', 'BOS', '44')['candidates'][0]
        self.assertEqual(value['name'], 'First Player')
        self.assertEqual(value['season'], '2024-25')
        self.assertEqual(value['team_abbreviation'], 'BOS')
        self.assertEqual(set(value['rating']['ratings']), set(FIELDS))
        provenance = value['rating']['field_provenance']
        self.assertEqual(provenance['three_point_shot']['source_id'], 'field')
        self.assertEqual(provenance['overall']['source_id'], 'baseline')
        for source in provenance.values():
            self.assertTrue({'source_id', 'url', 'game', 'snapshot_date', 'date_basis'} <= set(source))

    def test_partial_values_stay_null_and_have_no_value_source(self):
        rating = self.data().lookup('2024-25', 'MIN', '99')['candidates'][0]['rating']
        self.assertEqual(rating['status'], 'partial')
        self.assertEqual(rating['ratings']['overall'], 67)
        self.assertIsNone(rating['ratings']['three_point_shot'])
        self.assertIsNone(rating['field_provenance']['three_point_shot'])

    def test_missing_record_is_different_from_out_of_rating_scope(self):
        data = self.data()
        missing = data.lookup('2024-25', 'MIN', '88')['candidates'][0]['rating']
        absent = data.lookup('2025-26', 'MIN', '88')['candidates'][0]['rating']
        self.assertEqual(missing['status'], 'missing_record')
        self.assertEqual(missing['record_id'], 'name:missing@2024-25')
        self.assertEqual(absent['status'], 'not_in_rating_scope')
        self.assertIsNone(absent['record_id'])
        self.assertEqual(absent['game'], 'NBA 2K26')
        self.assertTrue(all(value is None for value in absent['ratings'].values()))

    def test_roster_evidence_uses_current_season_team_and_number(self):
        value = self.data().lookup('2024-25', 'DET', '00')['candidates'][0]
        self.assertEqual(len(value['season_roster']), 1)
        row = value['season_roster'][0]
        self.assertEqual(row['season'], '2024-25')
        self.assertEqual(row['jersey'], '00')
        self.assertEqual(row['url'], 'https://example.org/roster')

    def test_invalid_or_nontext_number_is_rejected(self):
        data = self.data()
        for season, team, jersey in [('2023-24', 'MIN', '10'), ('2024-25', 'BAD', '10'),
                                     ('2024-25', 'MIN', 0), ('2024-25', 'MIN', ''),
                                     ('2024-25', 'MIN', '../00'), ('2024-25', 'MIN', '0,00'),
                                     ('2024-25', 'MIN', '0' * 200)]:
            with self.subTest(season=season, team=team, jersey=jersey):
                with self.assertRaises(ValueError):
                    data.lookup(season, team, jersey)

    def test_missing_package_is_lazy_and_unavailable_on_request(self):
        data = self.data(self.root / 'missing')
        with self.assertRaises(PlayerIdentityDataUnavailable):
            data.options()

    def test_corrupt_pointer_cannot_read_outside_package(self):
        self.index['by_record']['name:zero@2024-25']['path'] = '../secret.jsonl'
        write_json(self.root / 'index.json', self.index)
        with self.assertRaises(PlayerIdentityDataUnavailable):
            self.data().lookup('2024-25', 'DET', '0')

    def test_wrong_person_at_record_pointer_is_rejected(self):
        self.index['by_record']['name:zero@2024-25']['line'] = 2
        write_json(self.root / 'index.json', self.index)
        with self.assertRaises(PlayerIdentityDataUnavailable):
            self.data().lookup('2024-25', 'DET', '0')

    def test_nonempty_rating_with_wrong_game_source_is_rejected(self):
        path = self.root / 'field_provenance.json'
        value = json.loads(path.read_text(encoding='utf-8'))
        value['sources']['field']['game'] = 'NBA 2K26'
        write_json(path, value)
        with self.assertRaises(PlayerIdentityDataUnavailable):
            self.data().lookup('2024-25', 'BOS', '44')

    def test_query_does_not_mutate_package_or_allow_response_to_mutate_cache(self):
        before = {p.relative_to(self.root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in self.root.rglob('*') if p.is_file()}
        data = self.data()
        first = data.lookup('2024-25', 'DET', '0')
        first['candidates'][0]['rating']['ratings']['overall'] = 1
        first['candidates'][0]['season_roster'][0]['jersey'] = '77'
        again = data.lookup('2024-25', 'DET', '0')
        self.assertEqual(again['candidates'][0]['rating']['ratings']['overall'], 75)
        self.assertEqual(again['candidates'][0]['season_roster'][0]['jersey'], '0')
        after = {p.relative_to(self.root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_real_data_conley_and_curry_keep_exact_values_and_provenance(self):
        data = self.data(DATA_ROOT)
        conley = data.lookup('2024-25', 'MIN', '10')
        self.assertEqual(conley['status'], 'unique_candidate')
        player = conley['candidates'][0]
        self.assertEqual(player['name'], 'Mike Conley')
        self.assertEqual(player['rating']['ratings']['three_point_shot'], 83)
        curry = data.lookup('2024-25', 'GSW', '30')['candidates'][0]['rating']
        self.assertEqual(curry['ratings']['three_point_shot'], 99)
        self.assertEqual(curry['ratings']['ball_handle'], 97)
        self.assertIn('bdf93420a846f073e4028de432a5cbd8a557ed51', curry['field_provenance']['overall']['url'])
        self.assertEqual(curry['field_provenance']['overall']['snapshot_date'], '2024-11-26T02:25:26Z')

    def test_real_data_bos_44_keeps_candidates_and_curry_uses_requested_game_version(self):
        data = self.data(DATA_ROOT)
        self.assertEqual(len(data.lookup('2024-25', 'BOS', '44')['candidates']), 2)
        # Dataset 2.0 includes all teams in both seasons; the synthetic package
        # above still tests genuinely out-of-scope records independently.
        rating = data.lookup('2025-26', 'GSW', '30')['candidates'][0]['rating']
        self.assertEqual(rating['status'], 'complete')
        self.assertEqual(rating['record_id'], 'name:stephencurry@2025-26')
        self.assertEqual(rating['game'], 'NBA 2K26')
        self.assertEqual(rating['ratings']['three_point_shot'], 99)
        self.assertEqual(rating['field_provenance']['three_point_shot']['game'], 'NBA 2K26')
        self.assertIsNone(rating['field_provenance']['three_point_shot']['snapshot_date'])


class IdentityHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import av
        import numpy as np
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.data_root = cls.root / 'data'
        make_package(cls.data_root)
        video = cls.root / 'video.mp4'
        with av.open(str(video), 'w') as container:
            stream = container.add_stream('libx264', rate=25)
            stream.width, stream.height, stream.pix_fmt = 64, 48, 'yuv420p'
            for _ in range(2):
                frame = av.VideoFrame.from_ndarray(np.zeros((48, 64, 3), dtype=np.uint8), format='rgb24')
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        with av.open(str(video)) as container:
            times = [float(frame.time) for frame in container.decode(video=0)]
        tracks = cls.root / 'tracks.json'
        write_json(tracks, [{'frame': i, 'time': t, 'tracks': [[1, 2, 20, 40, 1, .9, 2]]}
                            for i, t in enumerate(times)])
        cls.command = [sys.executable, str(SCRIPT_ROOT / 'serve_player_review.py'),
                       '--video', str(video), '--tracks', str(tracks), '--port', '0',
                       '--trim-root', str(cls.root / 'trim'), '--court-profile', str(cls.root / 'no-court.json'),
                       '--video-folder', str(cls.root / 'inbox'), '--import-cache', str(cls.root / 'imports'),
                       '--tactics-folder', str(cls.root / 'tactics')]

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def start_server(self, root=None):
        state = self.root / ('state-' + str(time.monotonic_ns()) + '.json')
        process = subprocess.Popen(self.command + ['--state-file', str(state), '--player-data-root', str(root or self.data_root)],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.addCleanup(self.stop_server, process)
        deadline = time.monotonic() + 10
        while not state.is_file() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(state.is_file(), 'Identity HTTP fixture did not reach readiness; identity data CLI/API may be missing')
        return json.loads(state.read_text(encoding='utf-8'))['url']

    @staticmethod
    def stop_server(process):
        if process.poll() is None:
            process.terminate()
        process.communicate(timeout=5)

    def get_json(self, url, method='GET'):
        with urlopen(Request(url, method=method), timeout=4) as response:
            content = response.read()
            return response, json.loads(content) if content else None

    def test_options_and_lookup_return_utf8_json_no_store_and_ignore_sample(self):
        url = self.start_server()
        response, options = self.get_json(url + 'api/player-identity/options?season=2024-25&sample=missing')
        self.assertEqual(response.status, 200)
        self.assertIn('application/json', response.headers['Content-Type'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(options['teams'][2]['name_zh'], 'MIN球队')
        _, lookup = self.get_json(url + 'api/player-identity/lookup?season=2024-25&team=DET&jersey=%30%30')
        self.assertEqual(lookup['candidates'][0]['player_id'], 'name:doublezero')

    def test_head_matches_get_headers_and_has_no_body(self):
        url = self.start_server()
        route = url + 'api/player-identity/lookup?season=2024-25&team=BOS&jersey=44'
        get, payload = self.get_json(route)
        head, body = self.get_json(route, 'HEAD')
        self.assertEqual(payload['status'], 'multiple_candidates')
        self.assertEqual(head.headers['Content-Length'], get.headers['Content-Length'])
        self.assertIsNone(body)

    def test_bad_missing_duplicate_blank_and_long_parameters_return_400_json(self):
        url = self.start_server()
        for suffix in ['?season=2024-25&team=DET', '?season=2024-25&team=DET&jersey=',
                       '?season=2024-25&team=DET&jersey=0&jersey=00',
                       '?season=2024-25&season=2025-26&team=DET&jersey=0',
                       '?season=2024-25&team=BAD&jersey=0',
                       '?season=2024-25&team=DET&jersey=' + '1' * 200]:
            with self.subTest(suffix=suffix):
                with self.assertRaises(HTTPError) as caught:
                    self.get_json(url + 'api/player-identity/lookup' + suffix)
                self.assertEqual(caught.exception.code, 400)
                self.assertIn('error', json.loads(caught.exception.read()))

    def test_missing_package_only_disables_identity_api(self):
        url = self.start_server(self.root / 'absent-package')
        response, _ = self.get_json(url + 'api/library')
        self.assertEqual(response.status, 200)
        with self.assertRaises(HTTPError) as caught:
            self.get_json(url + 'api/player-identity/options')
        self.assertEqual(caught.exception.code, 503)
        error = json.loads(caught.exception.read())['error']
        self.assertNotIn(str(self.root), error)

    def test_original_clip_payload_remains_unchanged_when_using_identity_api(self):
        url = self.start_server()
        _, before = self.get_json(url + 'api/clip')
        self.get_json(url + 'api/player-identity/lookup?season=2024-25&team=DET&jersey=0')
        _, after = self.get_json(url + 'api/clip')
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()
