"""Bound tactical documents and exact decoded frames for the local workbench."""
import base64
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import threading
from datetime import datetime, timezone

from local_video_library import atomic_json, file_hash

ROOT = Path(__file__).resolve().parents[2]

# Complete, independently verified 005 review snapshots; never populate this
# list from requests, saved drafts, or files discovered at runtime. Hash encoding
# is sorted-key, compact UTF-8 JSON (ensure_ascii=False, allow_nan=False).
LEGACY_CANDIDATE_REVIEW_SHA256 = frozenset({
    # bedad2c canonical exported before the real production API save:
    # artifacts/tactics-production-20261004/old-blank.json -> review.
    '754f32aa8c9714c2582ee850398e5ab19ac510fb373a5302276ee4a55b75f273',
    # Original saved candidate (same complete review before the three derived
    # basketball fields): artifacts/remote-integration-20261003/qa/tactics/qa/
    # 3c2623a9f7ee56191ee37e2cc466f5ab5344d9be101aec6fc08de027bf0f151e.json.
    '4466c751b84ac7278bee51ebe0d56849ed8880027f5a58400e53816ffbed1210',
})


def _review_sha256(review):
    value = json.dumps(review, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


class TacticalWorkbench:
    def __init__(self, folder, node=None):
        self.folder = Path(folder).resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        self.node = node or shutil.which('node')
        self.lock = threading.RLock()
        self.candidate_cache = None
        from court_preparation_store import CourtPreparationStore
        self.preparations = CourtPreparationStore(self.folder / 'court-preparations', self)

    def run(self, operation, **payload):
        if not self.node:
            raise ValueError('本机未找到 Node.js，战术保存与报告导出需要 Node.js 22 或更新版本。')
        result = subprocess.run([self.node, str(ROOT / 'engineering/tools/tactical-overlay/workbench-cli.mjs')],
            input=json.dumps({'operation': operation, **payload}, ensure_ascii=False), text=True, encoding='utf-8',
            capture_output=True, timeout=90, cwd=ROOT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise ValueError(result.stderr[:2000] or '战术定义未通过验证。')
        return json.loads(result.stdout)

    def candidate(self):
        with self.lock:
            if self.candidate_cache is None:
                self.candidate_cache = self.run('candidate')
            return self.candidate_cache

    def path(self, clip, variant, qa, kind):
        if kind not in {'workspace', 'candidate'} or type(qa) is not bool:
            raise ValueError('战术草稿空间不正确。')
        key = json.dumps([clip['video_sha256'], variant, clip['tracking_fingerprint'], qa, kind])
        return self.folder / ('qa' if qa else 'drafts') / (hashlib.sha256(key.encode()).hexdigest() + '.json')

    def load(self, clip, variant, qa, kind):
        with self.lock:
            path = self.path(clip, variant, qa, kind)
            return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {'version': 0, 'document': None}

    def check_source(self, document, clip, kind):
        if kind not in {'workspace', 'candidate'} or not isinstance(document, dict) or not isinstance(document.get('review'), dict):
            raise ValueError('战术文件或来源空间不正确。')
        review = document['review']
        if kind == 'candidate':
            original = self.candidate()['review']
            try:
                digest = _review_sha256(review)
                trusted = digest == _review_sha256(original) or digest in LEGACY_CANDIDATE_REVIEW_SHA256
            except (TypeError, ValueError):
                trusted = False
            if not trusted:
                raise ValueError('THY 示例的来源快照不可改写；请在当前视频草稿中修改轨迹。')
        elif review.get('trackingFingerprint') != clip['tracking_fingerprint'] or review.get('trackingRevision') != clip['tracking_revision']:
            raise ValueError('战术快照属于另一个模型版本。')
        if document.get('schemaVersion') == 2 and (clip.get('mediaEndTime') is None or review.get('mediaEndTime') != clip.get('mediaEndTime')):
            raise ValueError('素材片尾未确认或与解码来源不匹配。')
        expected = [{'frame': f['frame'], 'time': f['time'], 'sourceFrame': f.get('source_frame', f['frame']),
                     'sourceTime': f.get('source_time', f['time'])} for f in clip['frames']]
        if (review.get('videoSha256') != clip['video_sha256'] or review.get('sourceFrameMapping') != expected
                or review.get('width') != clip['width'] or review.get('height') != clip['height']
                or kind == 'candidate' and review.get('sourceVideoSha256')
                != (clip.get('source_video_sha256') or clip['video_sha256'])):
            raise ValueError('战术快照与视频或逐帧时间映射不匹配。')
        self.preparations.verify_document(review, clip, clip['tracking_revision'])

    def save(self, document, clip, variant, qa, kind, expected_version):
        self.check_source(document, clip, kind)
        self.run('validate', document=document)
        with self.lock:
            current = self.load(clip, variant, qa, kind)
            if type(expected_version) is not int or expected_version != current['version']:
                raise ValueError('另一页面已保存新版本。请导出当前草稿备份，再重新读取已保存版本。')
            result = {'version': expected_version + 1, 'savedAt': datetime.now(timezone.utc).isoformat(), 'document': document}
            path = self.path(clip, variant, qa, kind)
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(path, result)
            return result

    def frames(self, video, clip, indices):
        import av
        if (not isinstance(indices, list) or not indices or len(indices) > 40
                or any(type(i) is not int or not 0 <= i < len(clip['frames']) for i in indices)):
            raise ValueError('冻结帧范围不正确，一次最多读取 40 帧。')
        if file_hash(video) != clip['video_sha256']:
            raise ValueError('视频文件已变化，请重启服务重新核对来源。')
        requested = set(indices)
        result = []
        with av.open(str(video)) as container:
            container.streams.video[0].thread_type = 'AUTO'
            for index, frame in enumerate(container.decode(video=0)):
                if index not in requested:
                    continue
                record = clip['frames'][index]
                if frame.time is None or abs(float(frame.time) - record['time']) > 1e-7:
                    raise ValueError('解码时间与轨迹帧时间不一致，已停止叠加。')
                if (frame.width, frame.height) != (clip['width'], clip['height']):
                    raise ValueError('视频尺寸与轨迹不一致。')
                buffer = io.BytesIO(); frame.to_image().save(buffer, format='JPEG', quality=94)
                data = buffer.getvalue()
                result.append({'frame': index, 'time': record['time'], 'sourceFrame': record.get('source_frame', index),
                    'sourceTime': record.get('source_time', record['time']), 'videoSha256': clip['video_sha256'],
                    'sha256': hashlib.sha256(data).hexdigest(), 'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(data).decode(),
                    'decoder': f'PyAV {av.__version__}', 'pts': frame.pts, 'timeBase': str(frame.time_base)})
                if len(result) == len(requested): break
        if len(result) != len(requested):
            raise ValueError('未解码到全部冻结帧。')
        return result
