"""Immutable 2D snapshots, recomputed against source observations on save."""
import hashlib
import json
import threading
import re
from datetime import datetime, timezone
from pathlib import Path
from local_video_library import atomic_json


class CourtPreparationStore:
    def __init__(self, folder, tactics):
        self.folder = Path(folder)
        self.tactics = tactics
        self.lock = threading.RLock()

    def path(self, clip, variant, qa):
        if type(qa) is not bool or variant != clip['tracking_revision']:
            raise ValueError('准备结果的来源空间无效。')
        key = json.dumps([clip['video_sha256'], clip['tracking_fingerprint'], variant, qa])
        return self.folder / (hashlib.sha256(key.encode()).hexdigest() + '.json')

    def load(self, clip, variant, qa):
        with self.lock:
            path = self.path(clip, variant, qa)
            return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {'version': 0, 'preparation': None}

    def _candidate_path(self, candidate):
        if (not isinstance(candidate, dict) or not isinstance(candidate.get('jobId'), str)
                or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', candidate['jobId'])
                or type(candidate.get('revision')) is not int or candidate['revision'] < 1):
            raise ValueError('模型候选缺少有效的任务编号和版本。')
        return self.folder / 'ground-candidates' / candidate['jobId'] / f'{candidate["revision"]}.json'

    def register_candidate(self, candidate, context, adopted=False):
        """Only the backend worker/adopt path calls this; no HTTP journal-write API."""
        with self.lock:
            path = self._candidate_path(candidate)
            current = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None
            if current and current.get('adopted') and (current['candidate'] != candidate or current['context'] != context):
                raise ValueError('已经采用的模型候选不可改写。')
            if adopted and (not current or current['candidate'] != candidate or current['context'] != context):
                raise ValueError('采用候选与后台已生成记录不一致。')
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(path, {'candidate': candidate, 'context': context,
                'adopted': bool(adopted or current and current.get('adopted'))})

    def validate(self, preparation, session, clip, require_adopted=True, variant=None, qa=None):
        if not isinstance(preparation, dict):
            raise ValueError('2D 准备结果必须是对象。')
        operations = preparation.get('operations', [])
        if not isinstance(operations, list):
            raise ValueError('2D 准备操作记录必须是列表。')
        for operation in operations:
            if not isinstance(operation, dict):
                raise ValueError('准备操作格式不正确。')
            if operation.get('type') != 'qwen_ground_fit':
                continue  # Existing smoothing still uses the shared replay validator.
            candidate = operation.get('candidate')
            path = self._candidate_path(candidate)
            with self.lock:
                value = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None
            if not value or value.get('candidate') != candidate or require_adopted and not value.get('adopted'):
                raise ValueError('模型修正不属于后端已生成并采用的可信候选。')
            context = value.get('context')
            if (not isinstance(context, list) or len(context) != 5
                    or context[:3] != [clip['video_sha256'], clip['tracking_fingerprint'], clip['tracking_revision']]):
                raise ValueError('模型候选与当前视频或跟踪来源不一致。')
            if variant is not None and context[3:] != [variant, qa]:
                raise ValueError('模型候选不属于当前模型及草稿空间。')
        self.tactics.run('court-preparation-validate', preparation=preparation, session=session, clip=clip)

    def save(self, preparation, session, clip, variant, qa, expected_version):
        # Node uses exactly the browser's projection and smoothing algorithms.
        self.validate(preparation, session, clip, require_adopted=True, variant=variant, qa=qa)
        with self.lock:
            current = self.load(clip, variant, qa)
            if type(expected_version) is not int or expected_version != current['version']:
                raise ValueError('另一页面已保存 2D 准备新版本，请先备份再重新读取。')
            result = {'version': expected_version + 1, 'savedAt': datetime.now(timezone.utc).isoformat(), 'preparation': preparation,
                      'sourceSession': {key: session.get(key) for key in ('entities', 'courtCalibration', 'cuts', 'maxGapSeconds', 'groundComparison')}}
            path = self.path(clip, variant, qa)
            path.parent.mkdir(parents=True, exist_ok=True)
            snapshot = path.with_name(path.stem + f'.v{result["version"]}.json')
            atomic_json(snapshot, result)
            atomic_json(path, result)
            return result

    def verify_document(self, review, clip, variant):
        """Only server-recomputed immutable snapshots can enter tactical jobs."""
        preparation = review.get('courtPreparation')
        if preparation is None:
            return
        if (preparation.get('videoSha256') != clip['video_sha256']
                or preparation.get('frameMapping') != review.get('sourceFrameMapping')
                or preparation.get('mediaEndTime') != clip.get('mediaEndTime')):
            raise ValueError('2D 准备来源与视频不匹配。')
        with self.lock:
            snapshots = []
            for qa in (False, True):
                path = self.path(clip, variant, qa)
                snapshots.extend(path.parent.glob(path.stem + '.v*.json'))
            saved = next((value for path in snapshots
                          if (value := json.loads(path.read_text(encoding='utf-8'))).get('preparation') == preparation), None)
        if saved is None:
            raise ValueError('请先保存此 2D 准备版本；战术任务只读取服务验证过的快照。')
        session = saved['sourceSession']
        fields = ('bindings', 'modelBindings', 'identityKeyframes', 'identityReference', 'identitySuggestionsDismissed',
                  'visibilityRanges', 'anchors', 'courtAnchors', 'positionCorrections')
        entities = {entity['id']: entity for entity in session['entities']}
        for entity in review.get('entities', []):
            original = entities.get(entity['id'])
            if original is None or any(entity.get(key) != original.get(key) for key in fields):
                raise ValueError('球员身份或位置已变化，请重新建立并保存 2D 准备。')
            if entity.get('courtTrajectory') != preparation['preparedByPlayer'].get(entity['id']):
                raise ValueError('战术轨迹未使用已采用的 2D 准备位置。')
        if (review.get('court', {}).get('calibration') != session['courtCalibration']
                or review.get('settings', {}).get('maxGapSeconds') != session['maxGapSeconds']
                or sorted(set(review.get('settings', {}).get('cuts', []))) != sorted(set((session['cuts'] or []) + clip.get('sourceCuts', [])))):
            raise ValueError('标定、切镜或准备参数已变化，请重新保存 2D 准备。')
