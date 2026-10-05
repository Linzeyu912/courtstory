"""The current workspace archives references, never the shared media or drafts."""
import json
from pathlib import Path
import tempfile
import unittest

import local_video_library
from serve_player_review import initially_active_samples


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def collection(self):
        self.assertTrue(hasattr(local_video_library, 'WorkspaceCollection'), 'persistent workspace collection is missing')
        return local_video_library.WorkspaceCollection(self.root / 'workspace.json')

    def test_first_use_backs_up_inventory_and_only_keeps_exact_example_005(self):
        collection = self.collection()
        samples = [{'id': '005'}, {'id': 'nba-lal-min-005'}, {'id': '006'}]
        entries = [{'id': 'local-a', 'sampleId': '005'}, {'id': 'local-b', 'sampleId': '006'}, {'id': 'local-c'}]
        collection.reconcile(samples, entries)
        self.assertEqual([s['id'] for s in collection.filter_samples(samples)], ['005'])
        self.assertEqual([s['id'] for s in collection.filter_entries(entries)], ['local-a'])
        self.assertEqual(len(collection.filter_entries(entries, scope='archived')), 2)
        backup = self.root / 'workspace.before-narrowing.json'
        self.assertTrue(backup.exists())
        self.assertEqual(set(json.loads(backup.read_text())['items']), {'005', 'nba-lal-min-005', '006', 'local-c'})
        before = backup.read_bytes()
        collection.reconcile(samples, entries)
        self.assertEqual(backup.read_bytes(), before)

    def test_archive_restore_survives_restart_and_preserves_files(self):
        video, draft = self.root / 'shared.mp4', self.root / 'draft.json'
        video.write_bytes(b'video'); draft.write_bytes(b'user edits')
        collection = self.collection()
        entries = [{'id': 'local-a', 'sampleId': '005'}]
        collection.reconcile([{'id': '005'}, {'id': '006'}], entries)
        collection.restore('006')
        collection.archive('local-a')
        self.assertEqual(collection.filter_entries(entries), [])
        collection = self.collection()
        collection.restore('005')
        self.assertEqual(len(collection.filter_entries(entries)), 1)
        self.assertEqual(video.read_bytes(), b'video'); self.assertEqual(draft.read_bytes(), b'user edits')
        with self.assertRaises(ValueError): collection.archive('unknown')

    def test_official_samples_appear_in_existing_workspace_and_keep_user_archive_choice(self):
        collection = self.collection()
        collection.reconcile([{'id': '005'}, {'id': '006'}], [])
        library = {'samples': [{'id': '005'}, {'id': '006'}, {'id': 'official-001'}, {'id': 'official-002'}],
                   'initiallyActiveSamples': ['official-001', 'official-002']}
        active = initially_active_samples(library, '005')
        collection = local_video_library.WorkspaceCollection(self.root / 'workspace.json', retained_ids=active)
        entries = [{'id': 'local-a', 'sampleId': 'official-001'}, {'id': 'local-b', 'sampleId': 'official-002'}]
        collection.reconcile(library['samples'], entries)
        self.assertEqual([s['id'] for s in collection.filter_samples(library['samples'])],
                         ['005', 'official-001', 'official-002'])
        self.assertEqual(len(collection.filter_entries(entries)), 2)
        collection.archive('official-001')
        collection = local_video_library.WorkspaceCollection(self.root / 'workspace.json', retained_ids=active)
        collection.reconcile(library['samples'], entries)
        self.assertEqual([s['id'] for s in collection.filter_samples(library['samples'])], ['005', 'official-002'])

    def test_initial_sample_config_rejects_typos_and_keeps_legacy_default(self):
        self.assertEqual(initially_active_samples({}, 'legacy'), ['legacy'])
        for value in ['005', [None], ['not-in-library']]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                initially_active_samples({'samples': [{'id': '005'}], 'initiallyActiveSamples': value}, '005')

    def test_last_active_prepared_video_cannot_be_archived_while_import_is_pending(self):
        collection = self.collection()
        entries = [{'id': 'local-a', 'sampleId': '005'}, {'id': 'local-pending'}]
        collection.reconcile([{'id': '005'}, {'id': '006'}], entries)
        collection.activate('local-pending')
        with self.assertRaisesRegex(ValueError, '至少.*视频'): collection.archive('local-a')
        collection = self.collection()
        with self.assertRaisesRegex(ValueError, '至少.*视频'): collection.archive('005')
        # Another prepared video permits archiving; a pending import alone does not.
        collection.restore('006')
        collection.archive('005')
        self.assertEqual([s['id'] for s in collection.filter_samples([{'id': '005'}, {'id': '006'}])], ['006'])

    def test_precomputed_results_cannot_replace_new_job_status(self):
        self.assertTrue(hasattr(local_video_library, 'merge_review_sources'), 'source merge helper is missing')
        for state in ['queued', 'running', 'error']:
            inventory = {'entries': [{'id': 'local-a', 'sha256': 'a', 'variants': [], 'status': state,
                                      'message': 'new job detail', 'jobVariant': 'team-stable', 'sampleId': None}]}
            clips = {'005': {'digest': 'a', 'payloads': {'ebard': b'old'}}}
            merged = local_video_library.merge_review_sources(inventory, clips)
            row = merged['entries'][0]
            self.assertEqual((row['status'], row['message'], row['jobVariant']), (state, 'new job detail', 'team-stable'))
            self.assertEqual((row['sampleId'], row['variants']), ('005', ['ebard']))
            self.assertEqual(inventory['entries'][0]['variants'], [])

    def test_disappeared_prepared_results_cannot_allow_archiving_the_last_valid_sample(self):
        collection = self.collection()
        collection.reconcile([{'id': '005'}, {'id': 'local-old'}], [])
        collection.activate('local-old')
        collection.reconcile([{'id': '005'}], [{'id': 'local-old', 'status': 'error'}])
        with self.assertRaisesRegex(ValueError, '至少.*视频'):
            collection.archive('005')


if __name__ == '__main__': unittest.main()
