"""Check real label coverage, feedback persistence, and seekable local media."""
import copy
import json
import shutil
import threading
import unittest
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from serve_material_label_review import ROOT, Conflict, ReviewStore, handler, fingerprint, atomic_json


class ReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_root = ROOT / 'artifacts/material-label-review-tests'
        test_root.mkdir(parents=True, exist_ok=True)
        cls.temp = test_root / str(uuid.uuid4())
        cls.temp.mkdir()
        cls.store = ReviewStore(cls.temp, shared_reviews=False)
        cls.cid = next(iter(cls.store.clips))
        cls.clip = cls.store.clips[cls.cid]
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), handler(cls.store))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        assert cls.temp.resolve().is_relative_to((ROOT / 'artifacts/material-label-review-tests').resolve())
        shutil.rmtree(cls.temp)

    def setUp(self):
        for path in (self.temp / 'records').glob('*.json'):
            path.unlink()

    def payload(self, complete=False):
        return {'label_fingerprint': self.clip['label_fingerprint'], 'video_sha256': self.clip['video_sha256'],
                'expected_revision': 0, 'status': 'completed' if complete else 'draft',
                'evaluations': {f['key']: {'verdict': 'correct' if complete else 'pending',
                    'comment': '', 'issue_type': 'label', 'observed_at_seconds': None} for f in self.clip['fields']},
                'retention': {'decision': 'keep' if complete else 'pending', 'reason': ''}, 'comments': ''}

    def request(self, route, body=None, **kwargs):
        headers = kwargs.pop('headers', {})
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        req = Request(self.url + route, data=data, headers=headers, **kwargs)
        return urlopen(req, timeout=10)

    def test_every_video_including_exclusions_is_reviewable(self):
        catalog = self.store.catalog()
        expected = sum(d['included_count'] for d in json.loads((ROOT / 'data/videos/catalog.json').read_text(encoding='utf-8'))['datasets'])
        self.assertEqual(len(catalog['clips']), expected)
        self.assertEqual(len({c['dataset_id'] for c in catalog['clips']}), 8)
        excluded = [c for c in catalog['clips'] if not c['machine_selection']['recommended']]
        for c in catalog['clips']:
            keys = [f['key'] for f in c['fields']]
            self.assertEqual(sum(k.startswith('scenarios.') for k in keys), 10)
            self.assertEqual(len(keys), len(set(keys)))
            self.assertIn('source', keys)
            self.assertIn('selection', keys)

    def test_feedback_survives_reopen_with_original_labels_untouched(self):
        original = self.clip['annotation'].read_bytes()
        payload = self.payload(complete=True)
        payload['evaluations']['scenarios.camera_zoom'] = {'verdict': 'incorrect', 'comment': '应为横向跟拍；区间缩短',
            'issue_type': 'timing', 'observed_at_seconds': 2.5}
        payload['retention'] = {'decision': 'discard', 'reason': '人工认为重复'}
        with self.request('/api/review/' + self.cid, payload) as response:
            record = json.load(response)['review']
        self.assertEqual(record['revision'], 1)
        fresh = ReviewStore(self.temp, shared_reviews=False)
        self.assertEqual(fresh.load(self.cid), record)
        self.assertEqual(fresh.session()['last_clip_id'], self.cid)
        self.assertEqual(record['annotation_snapshot'], self.clip['label'])
        self.assertEqual(record['evaluations']['scenarios.camera_zoom']['comment'], '应为横向跟拍；区间缩短')
        self.assertEqual(self.clip['annotation'].read_bytes(), original)
        self.assertTrue(self.clip['video'].is_file())
        self.assertEqual(fresh.export()['reviewed_count'], 1)
        backup = fresh.backup()
        self.assertTrue(Path(backup['path']).is_file())
        self.assertEqual(json.loads(Path(backup['path']).read_text(encoding='utf-8'))['reviews'], [record])

    def test_incomplete_or_invalid_feedback_cannot_be_completed(self):
        incomplete = self.payload()
        incomplete['status'] = 'completed'
        with self.assertRaises(ValueError): self.store.save(self.cid, incomplete)
        for bad in ([], {'retention': []}):
            payload = bad if isinstance(bad, list) else {**self.payload(), **bad}
            with self.assertRaises(ValueError): self.store.save(self.cid, payload)
        self.assertIsNone(self.store.load(self.cid))

    def test_shared_human_feedback_and_deleted_records_survive_export(self):
        record = self.store.save(self.cid, self.payload(complete=True))
        shared = self.temp / 'shared'
        atomic_json(shared / 'records' / (self.cid + '.json'), record)
        removed = {**record, 'clip_id': 'removed-human-clip',
                   'retention': {'decision': 'discard', 'reason': '人工丢弃'}}
        atomic_json(shared / 'records' / 'removed-human-clip.json', removed)
        atomic_json(shared / 'index.json', {'clips': [
            {'clip_id': self.cid, 'retention': 'keep'},
            {'clip_id': 'removed-human-clip', 'retention': 'discard'}]})
        self.store.path(self.cid).unlink()
        with patch('serve_material_label_review.SHARED_REVIEWS', shared):
            fresh = ReviewStore(self.temp)
            self.assertEqual(fresh.load(self.cid), record)
            export = fresh.export()
            self.assertEqual(export['reviewed_count'], 2)
            self.assertEqual(export['archived_discard_count'], 1)
            self.assertEqual(export['reviews'], [record, removed])
            with self.assertRaises(KeyError): fresh.path('removed-human-clip')

    def test_applied_review_requires_matching_receipt_and_current_label(self):
        payload = self.payload(complete=True)
        payload['evaluations']['scenarios.camera_zoom']['verdict'] = 'incorrect'
        record = self.store.save(self.cid, payload)
        current = copy.deepcopy(record['annotation_snapshot'])
        current['content']['description'] += ' 修正'
        annotation = self.temp / 'changed-label.json'
        atomic_json(annotation, {'material_labels': current})
        receipt = {'clip_id': self.cid, 'review_revision': record['revision'],
            'review_updated_at': record['updated_at'], 'original_label_fingerprint': record['label_fingerprint'],
            'result_label_fingerprint': fingerprint(current), 'resolved_keys': ['scenarios.camera_zoom']}
        updates = self.temp / 'updates.json'
        original = self.store.path(self.cid).read_bytes()
        with patch.dict(self.clip, annotation=annotation), patch('serve_material_label_review.UPDATES_PATH', updates):
            atomic_json(updates, {'reviews': [receipt]})
            summary = self.store.summary()[self.cid]
            self.assertFalse(summary['stale'])
            self.assertEqual(summary['issues'], 0)
            self.assertEqual(self.store.export()['reviewed_count'], 1)
            for key in ('review_revision', 'review_updated_at', 'original_label_fingerprint', 'result_label_fingerprint'):
                atomic_json(updates, {'reviews': [{**receipt, key: 'invalid'}]})
                self.assertTrue(self.store.summary()[self.cid]['stale'])
            atomic_json(updates, {'reviews': [receipt]})
            current['content']['description'] += ' 再次变化'
            atomic_json(annotation, {'material_labels': current})
            self.assertTrue(self.store.summary()[self.cid]['stale'])
        self.assertEqual(self.store.path(self.cid).read_bytes(), original)

    def test_editing_applied_review_archives_original_even_when_labels_unchanged(self):
        record = self.store.save(self.cid, self.payload(complete=True))
        receipt = {'clip_id': self.cid, 'review_revision': record['revision'],
            'review_updated_at': record['updated_at'], 'original_label_fingerprint': record['label_fingerprint'],
            'result_label_fingerprint': record['label_fingerprint'], 'resolved_keys': []}
        updates = self.temp / 'updates.json'
        atomic_json(updates, {'reviews': [receipt]})
        payload = self.payload()
        payload['expected_revision'] = record['revision']
        payload['comments'] = '用户再次修改'
        with patch('serve_material_label_review.UPDATES_PATH', updates):
            saved = self.store.save(self.cid, payload)
            self.assertIsNone(self.store.applied(self.cid, saved))
        archived = self.temp / 'history' / self.cid / (record['label_fingerprint'] + '.json')
        self.assertEqual(json.loads(archived.read_text(encoding='utf-8')), record)
        self.assertEqual(saved['revision'], record['revision'] + 1)

    def test_sample_catalog_retains_all_videos_and_drafts_are_not_completed(self):
        ids = list(self.store.clips)[:40]
        sample = self.temp / 'sample.json'
        atomic_json(sample, {'target_count': 40, 'clip_ids': ids})
        self.store.save(self.cid, self.payload())
        with patch('serve_material_label_review.SAMPLE_PATH', sample):
            catalog = self.store.catalog()
            self.assertEqual(catalog['sample']['clip_ids'], ids)
            expected = sum(d['included_count'] for d in json.loads((ROOT / 'data/videos/catalog.json').read_text(encoding='utf-8'))['datasets'])
            self.assertEqual(len(catalog['clips']), expected)
            self.assertEqual(self.store.export()['reviewed_count'], 0)

    def test_stale_label_and_second_page_cannot_overwrite_saved_review(self):
        payload = self.payload(complete=True)
        self.store.save(self.cid, payload)
        original = self.store.path(self.cid).read_bytes()
        with self.assertRaises(Conflict): self.store.save(self.cid, payload)
        for key in ('label_fingerprint', 'video_sha256'):
            stale = copy.deepcopy(payload)
            stale['expected_revision'] = 1
            stale[key] = 'old'
            with self.assertRaises(Conflict): self.store.save(self.cid, stale)
        self.assertEqual(self.store.path(self.cid).read_bytes(), original)

    def test_failed_atomic_write_keeps_saved_feedback(self):
        payload = self.payload(complete=True)
        self.store.save(self.cid, payload)
        original = self.store.path(self.cid).read_bytes()
        payload['expected_revision'] = 1
        payload['comments'] = '第二次修改'
        with patch('serve_material_label_review.os.replace', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError): self.store.save(self.cid, payload)
        self.assertEqual(self.store.path(self.cid).read_bytes(), original)

    def test_video_range_seek_head_and_local_routes(self):
        path = self.clip['video']
        with self.request('/video/' + self.cid, headers={'Range': 'bytes=64-95'}) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers['Content-Range'], f'bytes 64-95/{path.stat().st_size}')
            with path.open('rb') as source:
                source.seek(64)
                self.assertEqual(response.read(), source.read(32))
        with self.request('/video/' + self.cid, headers={'Range': 'bytes=-16'}) as response:
            with path.open('rb') as source:
                source.seek(-16, 2)
                self.assertEqual(response.read(), source.read())
        with self.request('/video/' + self.cid, method='HEAD') as response:
            self.assertEqual(int(response.headers['Content-Length']), path.stat().st_size)
            self.assertEqual(response.read(), b'')
        for route, headers, status in [('/video/' + self.cid, {'Range': 'bytes=9999999999-'}, 416),
                                       ('/.git/config', {}, 404)]:
            with self.assertRaises(HTTPError) as error: self.request(route, headers=headers)
            self.assertEqual(error.exception.code, status)
        with self.assertRaises(HTTPError) as error:
            self.request('/api/review/' + self.cid, self.payload(), headers={'Origin': 'https://example.com'})
        self.assertEqual(error.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
