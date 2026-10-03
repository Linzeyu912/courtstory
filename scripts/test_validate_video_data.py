"""Regression checks for explicit user-upload provenance in video manifests."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import validate_video_data as validator


class UserUploadValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / 'data/videos/uploads/test'
        self.base.mkdir(parents=True)
        self.dataset = {
            'dataset_id': 'uploads-test', 'season': None, 'purpose': 'user_upload',
            'root': 'data/videos/uploads/test',
            'manifest': 'data/videos/uploads/test/manifest.json',
            'entry_count': 1, 'included_count': 0, 'awaiting_upload_count': 1,
        }
        self.entry = {
            'clip_id': 'uploads-test-001', 'local_id': '001',
            'annotation_path': 'label.json',
            'source': {
                'kind': 'user_upload', 'url': None, 'publisher': None,
                'start_seconds': None, 'end_seconds': None,
                'collected_at': '2026-10-03', 'uploaded_filename': 'clip.mp4',
                'unknown_reason': 'User supplied a file without original source details.',
            },
            'game': {'season': None, 'date_local': None,
                     'unknown_reason': 'Game date has not been verified.'},
            'tactic': {'label_status': 'provisional_from_collector_notes',
                       'tags': ['待复核'], 'basis': 'User supplied file; no action review.'},
            'asset': {'availability': 'awaiting_upload', 'storage': 'not_shared',
                      'path': None, 'bytes': None, 'sha256': None},
            'video': {'measurement_status': 'unverified', 'duration_seconds': None,
                      'width': None, 'height': None, 'fps': None},
            'review': {'visual_status': 'unverified', 'decode_status': 'unverified',
                       'normal_speed': None, 'original_broadcast': None,
                       'full_possession': None},
            'dedup': {'similar_to': []},
        }

    def validate(self):
        def write(path, value):
            path.write_text(json.dumps(value), encoding='utf-8')
        write(self.root / 'data/videos/catalog.json', {
            'schema_version': '1.0.0', 'datasets': [self.dataset],
        })
        write(self.base / 'manifest.json', {
            'schema_version': '1.0.0', 'dataset_id': 'uploads-test', 'season': None,
            'timezone': 'Asia/Shanghai',
            'source_manifest': 'data/videos/uploads/test/source.json',
            'entries': [self.entry],
        })
        write(self.base / 'source.json', {'kind': 'user_upload'})
        write(self.base / 'label.json', {'id': '001', 'season': None})
        with patch.object(validator, 'ROOT', self.root):
            return validator.validate(metadata_only=True)

    def test_upload_with_explicit_unknown_provenance_is_accepted(self):
        self.assertEqual(self.validate()['entries'], 1)

    def test_missing_source_reason_is_rejected(self):
        self.entry['source']['unknown_reason'] = ''
        with self.assertRaises(ValueError):
            self.validate()

    def test_missing_game_reason_is_rejected(self):
        self.entry['game']['unknown_reason'] = ''
        with self.assertRaises(ValueError):
            self.validate()

    def test_partial_unknown_source_interval_is_rejected(self):
        for start, end in [(0, None), (None, 8)]:
            with self.subTest(start=start, end=end):
                self.entry['source']['start_seconds'] = start
                self.entry['source']['end_seconds'] = end
                with self.assertRaises(ValueError):
                    self.validate()

    def test_missing_uploaded_filename_is_rejected(self):
        self.entry['source']['uploaded_filename'] = ''
        with self.assertRaises(ValueError):
            self.validate()

    def test_only_dataset_purpose_cannot_exempt_unknown_source(self):
        self.entry['source']['kind'] = 'web'
        with self.assertRaises(ValueError):
            self.validate()

    def test_only_source_kind_cannot_exempt_unknown_source(self):
        self.dataset['purpose'] = 'training'
        with self.assertRaises(ValueError):
            self.validate()

    def test_existing_web_source_contract_stays_valid(self):
        self.dataset['purpose'] = 'training'
        self.entry['source'].update(kind='web', url='https://example.com/source',
                                    start_seconds=1, end_seconds=4)
        self.entry['game']['date_local'] = '2025-05-23'
        self.assertEqual(self.validate()['entries'], 1)


if __name__ == '__main__':
    unittest.main()
