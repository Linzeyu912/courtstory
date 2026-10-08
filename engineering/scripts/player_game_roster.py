"""Exact per-game roster lookup, independent of the optional 2K rating package."""
import json
from pathlib import Path
import re


class PlayerGameRoster:
    def __init__(self, root, game_id):
        if not isinstance(game_id, str) or not re.fullmatch(r'\d{10}', game_id):
            raise ValueError('比赛编号必须为十位 NBA game ID。')
        path = Path(root) / (game_id + '.json')
        if not path.is_file():
            raise ValueError('尚未整理这场比赛名单，请使用已收录比赛或赛季名单。')
        self.data = json.loads(path.read_text(encoding='utf-8'))
        if self.data.get('gameId') != game_id or not self.data.get('sourceUrl') or not isinstance(self.data.get('players'), list):
            raise ValueError('比赛名单缺少来源或比赛编号。')
        self.game_id = game_id

    def options(self, season=None):
        actual = self.data['season']
        if season is not None and season != actual:
            raise ValueError('所选赛季与比赛名单不一致。')
        return {'seasons': [actual], 'teams': [{'abbreviation': team} for team in self.data['teams']],
            'dataset_scope': '官方当场出场名单；名字候选仍需图像号码与身份关联证据。'}

    def lookup(self, season, team, jersey):
        self.options(season)
        if not isinstance(jersey, str) or not re.fullmatch(r'\d{1,3}', jersey):
            raise ValueError('球衣号码必须为保留前导零的字符串。')
        rows = [p for p in self.data['players'] if p['team'] == team and p['jersey'] == jersey and p.get('played', True)]
        candidates = [{'name': p['name'], 'player_id': 'name:' + re.sub(r'[^a-z0-9]', '', p['name'].lower()),
            'season': season, 'team_abbreviation': team, 'jersey_number': jersey,
            'season_roster': [{'association_kind': 'game_roster', 'game_id': self.game_id,
                'date': self.data['gameDate'], 'url': self.data['sourceUrl'], 'retrieved_date': self.data['retrievedDate']}]} for p in rows]
        return {'status': 'unique_candidate' if len(candidates) == 1 else 'multiple_candidates' if candidates else 'no_match',
            'candidates': candidates, 'query': {'gameId': self.game_id, 'season': season, 'team': team, 'jersey': jersey}}
