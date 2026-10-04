"""Service-local visibility only: archives never move media, results or drafts."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import threading
import uuid


def _write(path, value):
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class WorkspaceCollection:
    def __init__(self, path, retained_ids=('005',)):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.retained_ids = set(retained_ids)
        self.lock = threading.RLock()
        self.data = json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else None
        if self.data is not None and (self.data.get('version') != 1 or not isinstance(self.data.get('items'), dict)
                                      or not isinstance(self.data.get('aliases'), dict)):
            raise ValueError('工作集合文件格式无效，请从备份恢复；原素材未修改。')

    def reconcile(self, samples, entries):
        """Register trusted server inventory before filtering; new imports activate explicitly."""
        with self.lock:
            first = self.data is None
            data = copy.deepcopy(self.data or {'version': 1, 'items': {}, 'aliases': {}})
            for item in data['items'].values():
                item['prepared'] = False
            for sample in samples:
                ident = sample['id']
                data['items'].setdefault(ident, {'archived': ident not in self.retained_ids})
                data['items'][ident]['prepared'] = True
            for entry in entries:
                ident, key = entry['id'], entry.get('sampleId') or entry['id']
                data['items'].setdefault(key, data['items'].get(ident, {'archived': key not in self.retained_ids}))
                if ident != key:
                    data['aliases'][ident] = key
                    # A local digest may be registered before its precomputed source is known.
                    data['items'].pop(ident, None)
            if first:
                backup = self.path.with_name(self.path.stem + '.before-narrowing.json')
                # Never replace the original migration evidence after a restart/retry.
                if not backup.exists():
                    original = copy.deepcopy(data)
                    for item in original['items'].values(): item['archived'] = False
                    _write(backup, original)
            if data != self.data:
                _write(self.path, data)
                self.data = data

    def key(self, ident):
        return (self.data or {}).get('aliases', {}).get(ident, ident)

    def _set(self, ident, archived, allow_new=False):
        with self.lock:
            if self.data is None: self.reconcile([], [])
            key = self.key(ident)
            if not isinstance(key, str) or not key or (key not in self.data['items'] and not allow_new):
                raise ValueError('视频不在当前工作集合中，请刷新列表。')
            if archived and not self._archived(key) and self.data['items'][key].get('prepared'):
                prepared = {self.key(item_id) for item_id, item in self.data['items'].items()
                            if item.get('prepared') and not self._archived(item_id)}
                if not prepared - {key}:
                    raise ValueError('请至少保留一个已识别、可打开的视频；可先导入并完成识别，或恢复另一个视频，再归档当前视频。')
            updated = copy.deepcopy(self.data)
            updated['items'][key] = {**updated['items'].get(key, {}), 'archived': archived}
            _write(self.path, updated)
            self.data = updated
            return {'id': key, 'archived': archived}

    def activate(self, ident):
        return self._set(ident, False, allow_new=True)

    def archive(self, ident):
        return self._set(ident, True)

    def restore(self, ident):
        return self._set(ident, False)

    def _archived(self, ident):
        return (self.data or {}).get('items', {}).get(self.key(ident), {'archived': True})['archived']

    def filter_samples(self, samples):
        with self.lock:
            return [copy.deepcopy(sample) for sample in samples if not self._archived(sample['id'])]

    def filter_entries(self, entries, scope='active'):
        if scope not in {'active', 'archived', 'all'}: raise ValueError('无效的工作集合视图。')
        with self.lock:
            result = []
            for entry in entries:
                key = self.key(entry['id'])
                archived = self._archived(key)
                if scope == 'all' or archived == (scope == 'archived'):
                    result.append({**copy.deepcopy(entry), 'collectionId': key, 'archived': archived})
            return result
