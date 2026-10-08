"""Local, explicitly started name-identification jobs over a review snapshot."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import threading
import uuid

from local_video_library import atomic_json
from review_session import validate_session


class PlayerNameJobs:
    def __init__(self, folder, tactics, player_data, provider, recognize=None, roster_root=None):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.tactics, self.player_data, self.provider = tactics, player_data, provider
        self.recognize = recognize
        self.roster_root = Path(roster_root or Path(__file__).resolve().parents[2]/'data/player-rosters')
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='player-names')
        self.lock = threading.RLock()
        self.jobs, self.cancellations = {}, {}

    def status(self):
        return {**self.provider.status(), 'purpose': 'player_names'}

    @staticmethod
    def _context(clip, variant, qa):
        if type(qa) is not bool or not isinstance(variant, str):
            raise ValueError('姓名识别草稿空间不正确。')
        return [clip['video_sha256'], clip['tracking_fingerprint'], clip['tracking_revision'], variant, qa]

    def create(self, request, clip, video, variant, qa):
        context = self._context(clip, variant, qa)
        session = request.get('session')
        validate_session(session, clip)
        revision = request.get('clientRevision')
        if type(revision) is not int or revision < 0:
            raise ValueError('草稿修订不正确。')
        season, teams = request.get('season'), request.get('teamMap')
        game_id = request.get('gameId') or None
        if game_id is not None:
            from player_game_roster import PlayerGameRoster
            PlayerGameRoster(self.roster_root, game_id).options(season)
        if season is not None and (not isinstance(season, str) or len(season) > 16):
            raise ValueError('识别赛季不正确。')
        if teams is not None and (not isinstance(teams, dict) or any(k not in ('A', 'B') or
                not isinstance(v, str) or len(v) > 3 for k, v in teams.items())):
            raise ValueError('请用球队三字母缩写指定红蓝球队。')
        if not self.status().get('available'):
            raise ValueError(self.status().get('message', '姓名识别模型不可用。'))
        frozen = deepcopy(session)
        from player_name_identity import ALGORITHM
        provider_status=self.status()
        method_stamp={'algorithm':ALGORITHM,'provider':provider_status.get('provider'),'model':provider_status.get('model')}
        key = hashlib.sha256(json.dumps([context, frozen, season, teams, game_id, method_stamp], sort_keys=True,
            separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        with self.lock:
            for existing in self.jobs.values():
                incomplete=existing.get('candidate',{}).get('usage',{}).get('failedModelRequests',0) if isinstance(existing.get('candidate'),dict) else 0
                if existing['sourceKey'] == key and (existing['status'] in ('queued', 'running') or
                    existing['status']=='ready' and not incomplete):
                    return deepcopy(existing)
            ident = str(uuid.uuid4())
            job = {'jobId': ident, 'purpose': 'player_names', 'status': 'queued', 'sourceKey': key,
                'base': {'videoHash': context[0], 'trackingFingerprint': context[1],
                    'trackingRevision': context[2], 'variant': variant, 'qa': qa, 'clientRevision': revision},
                'candidate': None, 'method':method_stamp,'message': '已排队，按全员有效轨迹选取号码证据。'}
            self.jobs[ident] = job
            self.cancellations[ident] = threading.Event()
            self._save(job)
            self.pool.submit(self._run, ident, frozen, deepcopy(clip), video, season, deepcopy(teams), game_id)
            return deepcopy(job)

    def _save(self, job):
        atomic_json(self.folder / (job['jobId'] + '.json'), job)

    def _run(self, ident, session, clip, video, season, teams, game_id):
        with self.lock:
            job = self.jobs[ident]
            if self.cancellations[ident].is_set():
                return
            job.update(status='running', message='正在读取球衣证据并匹配名单。')
            self._save(job)
        try:
            if self.recognize is None:
                from player_name_identity import recognize_player_names
                recognize = recognize_player_names
            else:
                recognize = self.recognize
            roster = self.player_data
            if game_id:
                from player_game_roster import PlayerGameRoster
                roster = PlayerGameRoster(self.roster_root, game_id)
            candidate = recognize(session, clip, video, self.tactics, roster,
                season=season, team_map=teams, provider=self.provider,
                work_dir=self.folder/ident, cancel_event=self.cancellations[ident])
            usage=candidate.get('usage',{})
            if usage.get('modelRequests',0)>0 and usage.get('successfulModelRequests')==0 and usage.get('failedModelRequests',0)>0:
                raise ValueError('本轮模型请求全部失败，未生成姓名识别结果；原草稿保留，请检查连接后重试。')
            with self.lock:
                if self.cancellations[ident].is_set():
                    return
                job.update(status='ready', candidate=candidate, message=
                    '部分模型请求失败；已保留成功证据，可再次发起识别。' if usage.get('failedModelRequests',0) else
                    '姓名候选已完成；未知和冲突保留。')
                self._save(job)
        except Exception as error:
            # Provider errors must already be redacted. Avoid persisting request headers or bodies.
            message = str(error)[:600]
            import re
            message = re.sub(r'sk-[A-Za-z0-9_-]+|Bearer\s+\S+', '[redacted]', message, flags=re.I)
            with self.lock:
                if self.cancellations[ident].is_set():
                    return
                job.update(status='failed', message=message or '姓名识别失败，可重新运行。')
                self._save(job)

    def get(self, ident, clip, variant, qa):
        context = self._context(clip, variant, qa)
        with self.lock:
            job = self.jobs.get(ident)
            if job is None:
                path = self.folder / (ident + '.json')
                if not path.is_file():
                    raise ValueError('找不到姓名识别任务。')
                job = json.loads(path.read_text(encoding='utf-8'))
                if job['status'] in ('queued', 'running'):
                    job.update(status='failed', message='服务已重启，请显式重新运行姓名识别。')
                self.jobs[ident] = job
            base = job['base']
            if context != [base['videoHash'], base['trackingFingerprint'], base['trackingRevision'], base['variant'], base['qa']]:
                raise ValueError('姓名任务不属于当前视频、跟踪版本或草稿空间。')
            return deepcopy(job)

    def cancel(self, ident, clip, variant, qa):
        self.get(ident, clip, variant, qa)
        with self.lock:
            job = self.jobs[ident]
            if job['status'] in ('queued', 'running'):
                self.cancellations.setdefault(ident, threading.Event()).set()
                job.update(status='cancelled', message='已取消姓名识别，保留原身份数据。')
                self._save(job)
            return deepcopy(job)

    def close(self):
        with self.lock:
            for event in self.cancellations.values():
                event.set()
        self.pool.shutdown(wait=False, cancel_futures=True)
