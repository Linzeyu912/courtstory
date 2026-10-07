"""Atomic, bounded persistence for generated agent jobs (never user drafts)."""
import hashlib
import json
from pathlib import Path
import re
import time
import uuid

PREVIEW_FIELDS = ('previewDocument', 'previewFrames')
MAX_PREVIEW_BYTES = 128 * 1024 * 1024
REPLACE_DELAYS = (.025, .075, .15)


class StorageFailure(ValueError):
    code = 'storage'

    def __init__(self, message, *, retryable=False):
        super().__init__(message)
        self.retryable = retryable


def _encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def _atomic_bytes(path, data):
    path = Path(path)
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temporary.write_bytes(data)
        for attempt in range(len(REPLACE_DELAYS) + 1):
            try:
                temporary.replace(path)
                return
            except OSError as exc:
                if getattr(exc, 'winerror', None) not in (5, 32, 33) or attempt == len(REPLACE_DELAYS):
                    raise
                time.sleep(REPLACE_DELAYS[attempt])
    except OSError as exc:
        # Access denied can be a permanent ACL failure; four attempts are final.
        raise StorageFailure(f'任务记录保存失败（{path.name}）：{exc}',
                             retryable=getattr(exc, 'winerror', None) in (5, 32, 33)) from exc
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            # Never replace the original I/O error with temporary-file cleanup.
            pass


def atomic_job_json(path, value):
    _atomic_bytes(path, _encoded(value))


class JobStateStore:
    def __init__(self):
        self.cache = {}

    def save(self, directory, state):
        try:
            return self._save(directory, state)
        except OSError as exc:
            raise StorageFailure(f'任务记录存储访问失败：{exc}') from exc

    def _save(self, directory, state):
        directory = Path(directory)
        disk = {key:value for key,value in state.items() if key not in (*PREVIEW_FIELDS, 'previewRefs', 'storageVersion')}
        refs = {}
        for field in PREVIEW_FIELDS:
            if field not in state:
                continue
            value = state[field]
            key = (str(directory.resolve()), field)
            cached = self.cache.get(key)
            # Publication replaces these immutable snapshots; progress only
            # updates separate fields, so don't re-encode megabytes each second.
            if cached is not None and cached[0] is value:
                ref = cached[1]
                if not (directory / ref['file']).is_file():
                    raise StorageFailure('任务预览文件已丢失；保留当前结果，请恢复文件后重试保存。')
            else:
                data = _encoded(value)
                if len(data) > MAX_PREVIEW_BYTES:
                    raise StorageFailure('任务预览超过单文件保存上限；当前结果仍保留在内存。')
                digest = hashlib.sha256(data).hexdigest()
                ref = {'file':f'{field}-{digest}.json', 'sha256':digest, 'bytes':len(data)}
                path = directory / ref['file']
                if path.exists():
                    _read_preview(directory, field, ref)
                else:
                    _atomic_bytes(path, data)
                self.cache[key] = (value, ref)
            refs[field] = ref
        if refs:
            disk.update(storageVersion=1, previewRefs=refs)
        # References become visible only after all immutable files are durable.
        atomic_job_json(directory / 'state.json', disk)


def _read_preview(directory, field, ref):
    if (not isinstance(ref, dict) or set(ref) != {'file', 'sha256', 'bytes'} or
        not isinstance(ref['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', ref['sha256']) or
        ref['file'] != f"{field}-{ref['sha256']}.json" or
        type(ref['bytes']) is not int or not 0 < ref['bytes'] <= MAX_PREVIEW_BYTES):
        raise StorageFailure('任务预览引用无效；未读取引用文件。')
    path = directory / ref['file']
    if path.resolve().parent != directory.resolve():
        raise StorageFailure('任务预览引用超出当前任务目录。')
    try:
        if path.stat().st_size != ref['bytes']:
            raise StorageFailure('任务预览文件长度校验失败。')
        data = path.read_bytes()
    except OSError as exc:
        raise StorageFailure(f'任务预览文件读取失败：{exc}') from exc
    if len(data) != ref['bytes'] or hashlib.sha256(data).hexdigest() != ref['sha256']:
        raise StorageFailure('任务预览文件摘要校验失败。')
    return json.loads(data)


def read_job_state(directory):
    directory = Path(directory)
    try:
        state = json.loads((directory / 'state.json').read_text(encoding='utf-8'))
        if 'previewRefs' not in state:
            return state  # Backward compatible with full inline legacy state.
        refs = state.pop('previewRefs')
        if state.pop('storageVersion', None) != 1 or not isinstance(refs, dict) or set(refs) - set(PREVIEW_FIELDS):
            raise StorageFailure('任务预览引用版本无效。')
        for field, ref in refs.items():
            state[field] = _read_preview(directory, field, ref)
        return state
    except StorageFailure:
        raise
    except (OSError, ValueError, TypeError) as exc:
        raise StorageFailure(f'任务记录读取失败：{exc}') from exc
