"""Read exact roster candidates and season-specific NBA 2K values on demand."""

import copy
import json
import re
import threading
from pathlib import Path
from urllib.parse import urlsplit


RATING_FIELDS = (
    'overall', 'three_point_shot', 'mid_range_shot', 'close_shot', 'layup',
    'driving_dunk', 'ball_handle', 'speed_with_ball', 'perimeter_defense',
    'interior_defense', 'block', 'help_defense_iq', 'defensive_consistency',
)
GAMES = {'2024-25': 'NBA 2K25', '2025-26': 'NBA 2K26'}
DATASET_SCOPE = ('已收录球员的整季球队名单，含离队球员，不证明当场阵容；'
                 '能力表限各季16支季后赛球队的筛选范围。未找到只表示本资料包查无候选，不证明该队没有这名球员。')
UNAVAILABLE_MESSAGE = '本地 2K 数据包暂不可用，请检查数据包后重试。'


class PlayerIdentityDataUnavailable(RuntimeError):
    """Missing or inconsistent local data must not produce a guessed identity."""


class PlayerIdentityData:
    """Cache only lookup metadata; read requested JSONL rows by index pointer."""

    def __init__(self, root):
        self.root = Path(root).resolve()
        self._metadata = None
        self._lock = threading.RLock()

    @staticmethod
    def _unavailable():
        raise PlayerIdentityDataUnavailable(UNAVAILABLE_MESSAGE)

    def _read_json(self, path):
        def reject_constant(value):
            raise ValueError('Nonfinite JSON value')
        try:
            return json.loads(path.read_text(encoding='utf-8'), parse_constant=reject_constant)
        except (OSError, UnicodeError, ValueError):
            self._unavailable()

    def _load(self):
        with self._lock:
            if self._metadata is None:
                values = {name: self._read_json(self.root / (name + '.json'))
                          for name in ['manifest', 'index', 'field_provenance', 'sources', 'teams']}
                try:
                    seasons = values['manifest']['seasons']
                    if (not isinstance(seasons, list) or not seasons
                            or any(season not in GAMES for season in seasons)
                            or len(set(seasons)) != len(seasons)):
                        self._unavailable()
                    index = values['index']
                    for key in ['players', 'by_record', 'by_jersey']:
                        if not isinstance(index[key], dict):
                            self._unavailable()
                    if not isinstance(values['sources']['catalog'], dict):
                        self._unavailable()
                    if not isinstance(values['teams']['teams'], list):
                        self._unavailable()
                    for key in ['records', 'sources']:
                        if not isinstance(values['field_provenance'][key], dict):
                            self._unavailable()
                except (KeyError, TypeError):
                    self._unavailable()
                self._metadata = values
            return self._metadata

    def _season(self, value, metadata):
        if not isinstance(value, str) or len(value) > 16 or value.strip() not in metadata['manifest']['seasons']:
            raise ValueError('请选择资料包支持的赛季。')
        return value.strip()

    def _team_keys(self, season, metadata):
        result = {}
        try:
            for key, candidates in metadata['index']['by_jersey'].items():
                row_season, team, _ = key.split('|')
                if row_season == season:
                    if not re.fullmatch('[A-Z]{3}', team) or not isinstance(candidates, list):
                        self._unavailable()
                    result.setdefault(team, []).extend(candidates)
        except (ValueError, TypeError, AttributeError):
            self._unavailable()
        return result

    def _jsonl(self, location):
        try:
            line = location['line']
            path = (self.root / location['path']).resolve()
            if (type(line) is not int or line < 1 or not path.is_relative_to(self.root)
                    or path.suffix != '.jsonl'):
                self._unavailable()
            with path.open(encoding='utf-8') as handle:
                for number, value in enumerate(handle, 1):
                    if number == line:
                        row = json.loads(value, parse_constant=lambda value: self._unavailable())
                        if not isinstance(row, dict):
                            self._unavailable()
                        return row
        except (OSError, UnicodeError, ValueError, KeyError, TypeError):
            self._unavailable()
        self._unavailable()

    def _history(self, player_id, metadata):
        try:
            entry = metadata['index']['players'][player_id]
            history = self._jsonl(entry['history'])
            if history['player_id'] != player_id or not isinstance(history['stints'], list):
                self._unavailable()
            return history
        except (KeyError, TypeError):
            self._unavailable()

    def options(self, season=None):
        metadata = self._load()
        result = {'seasons': list(metadata['manifest']['seasons']), 'teams': [], 'dataset_scope': DATASET_SCOPE}
        if season is None:
            return result
        season = self._season(season, metadata)
        names = {row['team_abbreviation']: row for row in metadata['teams']['teams']
                 if row.get('season') == season}
        for team, candidates in sorted(self._team_keys(season, metadata).items()):
            source = names.get(team)
            if source is None:
                for player_id in dict.fromkeys(candidates):
                    source = next((row for row in self._history(player_id, metadata)['stints']
                                   if row.get('season') == season and row.get('team_abbreviation') == team
                                   and row.get('association_kind') == 'season_team_roster'), None)
                    if source is not None:
                        break
            if source is None or not isinstance(source.get('team_name'), str):
                self._unavailable()
            option = {'abbreviation': team, 'name': source['team_name']}
            if isinstance(source.get('team_name_zh'), str):
                option['name_zh'] = source['team_name_zh']
            result['teams'].append(option)
        return result

    def _rating(self, player_id, season, metadata):
        try:
            slot = metadata['index']['players'][player_id]['seasons'][season]
            record_id = slot['record_id']
            result = {'record_id': record_id, 'game': GAMES[season], 'season': season,
                      'status': 'not_in_rating_scope', 'ratings': dict.fromkeys(RATING_FIELDS),
                      'field_provenance': dict.fromkeys(RATING_FIELDS)}
            if record_id is None:
                if slot['scope_status'] != 'not_in_rating_scope':
                    self._unavailable()
                return result
            record = self._jsonl(metadata['index']['by_record'][record_id])
            if (record['record_id'] != record_id or record['player_id'] != player_id
                    or record['season'] != season or record['game'] != GAMES[season]
                    or slot['scope_status'] != 'in_rating_scope'):
                self._unavailable()
            status = record['availability']['status']
            if status not in {'complete', 'partial', 'missing_record'}:
                self._unavailable()
            result['status'] = status
            field_record = metadata['field_provenance']['records'][record_id]
            for key in RATING_FIELDS:
                value = record['ratings'].get(key)
                if value is None:
                    continue
                if type(value) is not int or not 25 <= value <= 99:
                    self._unavailable()
                source_id = field_record['field_source_ids'].get(key)
                if source_id is None and key in field_record['baseline_fields']:
                    source_id = field_record['default_source_id']
                source = metadata['field_provenance']['sources'][source_id]
                parsed = urlsplit(source['source_url'])
                if source['game'] != result['game'] or parsed.scheme not in {'http', 'https'} or not parsed.netloc:
                    self._unavailable()
                result['ratings'][key] = value
                result['field_provenance'][key] = {
                    'source_id': source_id, 'url': source['source_url'], 'game': source['game'],
                    'snapshot_date': source['snapshot_date'], 'date_basis': source['date_basis'],
                }
            return result
        except (KeyError, TypeError, AttributeError, ValueError):
            self._unavailable()

    def lookup(self, season, team, jersey):
        metadata = self._load()
        season = self._season(season, metadata)
        if (not isinstance(team, str) or len(team) > 8
                or team.strip().upper() not in self._team_keys(season, metadata)):
            raise ValueError('请选择本赛季已收录的球队。')
        team = team.strip().upper()
        if not isinstance(jersey, str) or len(jersey) > 8 or not re.fullmatch('[0-9]{1,2}', jersey.strip()):
            raise ValueError('球衣号码须为一至两位文字数字，0 与 00 分开查询。')
        jersey = jersey.strip()
        candidates = []
        try:
            player_ids = metadata['index']['by_jersey'].get('|'.join([season, team, jersey]), [])
            for player_id in dict.fromkeys(player_ids):
                entry = metadata['index']['players'][player_id]
                roster = []
                for row in self._history(player_id, metadata)['stints']:
                    if (row.get('season') == season and row.get('team_abbreviation') == team
                            and row.get('association_kind') == 'season_team_roster'
                            and jersey in row.get('jersey_numbers', [])):
                        evidence = copy.deepcopy(row)
                        evidence['url'] = metadata['sources']['catalog'][row['source_id']]['url']
                        roster.append(evidence)
                if not roster or not isinstance(entry['player_name'], str):
                    self._unavailable()
                candidates.append({'player_id': player_id, 'name': entry['player_name'], 'season': season,
                                   'team_abbreviation': team, 'jersey_number': jersey, 'season_roster': roster,
                                   'rating': self._rating(player_id, season, metadata)})
        except (KeyError, TypeError, AttributeError):
            self._unavailable()
        status = 'no_match' if not candidates else 'unique_candidate' if len(candidates) == 1 else 'multiple_candidates'
        return {'query': {'season': season, 'team': team, 'jersey': jersey}, 'status': status,
                'candidates': candidates, 'dataset_scope': DATASET_SCOPE}
