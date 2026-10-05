"""Immutable 2D snapshots, recomputed against source observations on save."""
import hashlib
import json
import threading
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

    def save(self, preparation, session, clip, variant, qa, expected_version):
        # Node uses exactly the browser's projection and smoothing algorithms.
        self.tactics.run('court-preparation-validate', preparation=preparation, session=session, clip=clip)
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
