"""Offline regression tests; no AWS credentials, network, or application needed."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile


spec = importlib.util.spec_from_file_location('state_archive', Path(__file__).with_name('state_archive.py'))
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)


class StateArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.root = self.folder / 'workspace'
        self.root.mkdir()
        self.archive = self.folder / 'state.zip'
        self.target = self.folder / 'restored'

    def write(self, name, content=b'fixture'):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def fixture(self):
        files = {'cloud-library.json': b'{"samples":[]}',
                 'artifacts/cloud-state.json': b'{"port":8876}',
                 'data/local-workbench/tactics/saved.json': b'{"version":3}',
                 'data/local-workbench/tactics/render-jobs/job/video.mp4': b'movie',
                 'data/local-workbench/tactics/commentary-jobs/job/render/commentary.srt': b'1\n00:00:01,000 --> 00:00:02,000\nNarration\n',
                 'data/local-workbench/tactics/commentary-jobs/job/audio/cue.wav': b'RIFF narration audio',
                 'data/local-workbench/tactics/agent-jobs/job/frame.jpg': b'image',
                 'data/local-videos/Chinese\u4e2d\u6587.MOV': b'uploaded original',
                 'artifacts/cloud-imports/workspace.json': b'{"active":[]}',
                 'artifacts/cloud-trims/clip/tracks.json': b'[]'}
        for name, content in files.items():
            self.write(name, content)
        return files

    def manifest(self, files):
        return {'format': state.FORMAT, 'version': state.VERSION, 'createdAt': '2026-10-07T00:00:00+00:00',
                'sourceRoot': str(self.root.resolve()), 'files': [
                    {'path': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                    for name, data in files.items()]}

    def zip(self, files, manifest=None, extra=()):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, data in files.items():
                archive.writestr(name, data)
            archive.writestr('manifest.json', json.dumps(manifest or self.manifest(files)))
            for name, data in extra:
                archive.writestr(name, data)

    def assert_restore_rejected_without_writes(self):
        with self.assertRaises((ValueError, zipfile.BadZipFile)):
            state.restore(self.archive, self.target)
        self.assertFalse(self.target.exists(), 'invalid input must not create a target')

    def test_round_trip_preserves_all_bytes_relative_names_and_source_root(self):
        files = self.fixture()
        manifest = state.snapshot(self.root, self.archive)
        self.assertEqual(manifest['sourceRoot'], str(self.root.resolve()))
        self.assertEqual({i['path'] for i in manifest['files']}, set(files))
        self.assertEqual(state.verify(self.archive), manifest)
        self.assertEqual(state.restore(self.archive, self.target), manifest)
        self.assertEqual(state.verify(self.archive, self.target), manifest)
        for name, data in files.items():
            self.assertEqual((self.target / name).read_bytes(), data)

    def test_allowlist_excludes_credentials_code_caches_and_incomplete_outputs(self):
        files = self.fixture()
        ignored = ['engineering/scripts/serve.py', '.git/config', '.aws/credentials',
                   'runtime.env', 'gateway.json', 'data/local-workbench/auth.json',
                   'data/local-workbench/gateway.json', 'artifacts/cloud-imports/credentials.json',
                   'data/local-workbench/.codex/auth.json', 'data/local-workbench/.cache/sdk/item.json',
                   'data/local-workbench/node_modules/cache.json', 'data/local-workbench/sdk-cache/cache.json',
                   'data/local-workbench/code/copied.json', 'data/local-workbench/rendering.mp4',
                   'data/local-workbench/.pending.json', 'data/local-workbench/update.py',
                   'data/local-workbench/document.json.tmp']
        for name in ignored:
            self.write(name, b'never archive')
        selected = state.state_files(self.root)
        self.assertTrue(all(path.is_absolute() for path in selected))
        self.assertEqual({p.relative_to(self.root).as_posix() for p in selected}, set(files))
        state.snapshot(self.root, self.archive)
        with zipfile.ZipFile(self.archive) as archive:
            self.assertEqual(set(archive.namelist()), set(files) | {'manifest.json'})

    def test_supported_uploaded_source_formats_are_preserved(self):
        for suffix in ('.mp4', '.mov', '.mkv', '.webm', '.avi'):
            self.write('data/local-videos/source' + suffix)
        self.assertEqual(len(state.snapshot(self.root, self.archive)['files']), 5)

    def test_existing_archive_is_never_replaced(self):
        self.fixture()
        self.archive.write_bytes(b'previous backup')
        with self.assertRaises(FileExistsError):
            state.snapshot(self.root, self.archive)
        self.assertEqual(self.archive.read_bytes(), b'previous backup')

    def test_empty_snapshot_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'No allowed'):
            state.snapshot(self.root, self.archive)
        self.assertFalse(self.archive.exists())

    def test_snapshot_rejects_file_changed_while_being_read(self):
        source = self.write('cloud-library.json', b'old')
        original = state._copy_hash
        def changing(stream, target=None):
            result = original(stream, target)
            source.write_bytes(b'new')
            os.utime(source, ns=(source.stat().st_atime_ns, source.stat().st_mtime_ns + 1_000_000))
            return result
        with patch.object(state, '_copy_hash', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'changed while reading'):
                state.snapshot(self.root, self.archive)
        self.assertFalse(self.archive.exists())

    def test_global_snapshot_check_rejects_new_files(self):
        self.write('cloud-library.json')
        original = state._copy_hash
        def adding(stream, target=None):
            result = original(stream, target)
            self.write('data/local-videos/new.mp4')
            return result
        with patch.object(state, '_copy_hash', side_effect=adding):
            with self.assertRaisesRegex(ValueError, 'Workspace state changed'):
                state.snapshot(self.root, self.archive)
        self.assertFalse(self.archive.exists())

    def test_global_snapshot_check_rejects_changed_or_deleted_earlier_files(self):
        for operation in ('change', 'delete'):
            with self.subTest(operation=operation):
                first = self.write('artifacts/cloud-state.json', b'old')
                self.write('cloud-library.json')
                original, calls = state._copy_hash, []
                def changing(stream, target=None):
                    result = original(stream, target)
                    calls.append(1)
                    if len(calls) == 2:
                        if operation == 'delete':
                            first.unlink()
                        else:
                            first.write_bytes(b'new')
                            os.utime(first, ns=(first.stat().st_atime_ns, first.stat().st_mtime_ns + 1_000_000))
                    return result
                with patch.object(state, '_copy_hash', side_effect=changing):
                    with self.assertRaisesRegex(ValueError, 'Workspace state changed'):
                        state.snapshot(self.root, self.archive)
                self.assertFalse(self.archive.exists())

    def test_restoration_rejects_nonempty_target_even_if_it_only_contains_code(self):
        self.fixture()
        state.snapshot(self.root, self.archive)
        self.target.mkdir()
        (self.target / 'app.py').write_text('existing code')
        with self.assertRaisesRegex(ValueError, 'new or empty'):
            state.restore(self.archive, self.target)
        self.assertEqual(list(self.target.iterdir()), [self.target / 'app.py'])

    def test_restoration_accepts_existing_empty_target(self):
        self.fixture()
        state.snapshot(self.root, self.archive)
        self.target.mkdir()
        state.restore(self.archive, self.target)
        state.verify(self.archive, self.target)

    def test_all_contents_are_verified_before_any_restore_write(self):
        files = {'cloud-library.json': b'good', 'artifacts/cloud-state.json': b'original'}
        manifest = self.manifest(files)
        files['artifacts/cloud-state.json'] = b'altered!'
        self.zip(files, manifest)
        self.assert_restore_rejected_without_writes()

    def test_size_mismatch_and_missing_or_extra_files_are_rejected(self):
        files = {'cloud-library.json': b'fixture'}
        for kind in ('size', 'missing', 'extra'):
            with self.subTest(kind=kind):
                manifest = self.manifest(files)
                if kind == 'size':
                    manifest['files'][0]['size'] += 1
                if kind == 'missing':
                    manifest['files'].append({'path': 'artifacts/cloud-state.json', 'size': 0, 'sha256': hashlib.sha256(b'').hexdigest()})
                self.zip(files, manifest, [('artifacts/cloud-state.json', b'extra')] if kind == 'extra' else [])
                self.assert_restore_rejected_without_writes()

    def test_unsafe_zip_names_are_rejected(self):
        for name in ('../escape.json', '/tmp/escape.json', 'data/local-videos/../escape.mp4',
                     'data//local-videos/escape.mp4', 'data\\local-videos\\escape.mp4',
                     'data/local-videos/a.mp4:stream', 'data/local-videos/NUL.mp4',
                     'data/local-videos/clip.mp4.', 'data/local-workbench/auth.json'):
            with self.subTest(name=name):
                self.zip({'cloud-library.json': b'fixture'}, extra=[(name, b'bad')])
                self.assert_restore_rejected_without_writes()

    def test_duplicate_and_case_colliding_zip_entries_are_rejected(self):
        for name in ('cloud-library.json', 'CLOUD-LIBRARY.JSON'):
            with self.subTest(name=name), warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                self.zip({'cloud-library.json': b'fixture'}, extra=[(name, b'duplicate')])
                self.assert_restore_rejected_without_writes()

    def test_zip_symlink_is_rejected_without_following_it(self):
        files = {'cloud-library.json': b'fixture'}
        link = zipfile.ZipInfo('data/local-videos/linked.mp4')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.zip(files, extra=[(link, b'/etc/passwd')])
        self.assert_restore_rejected_without_writes()

    def test_zip_file_directory_collision_is_rejected_before_restore(self):
        files = {'data/local-workbench/parent.json': b'file',
                 'data/local-workbench/parent.json/child.json': b'child'}
        self.zip(files)
        self.assert_restore_rejected_without_writes()

    def test_snapshot_excludes_symlink_files_and_directories(self):
        self.fixture()
        try:
            (self.root / 'data/local-videos/linked.mp4').symlink_to(self.root / 'cloud-library.json')
            (self.root / 'data/local-workbench/linked').symlink_to(self.root / 'artifacts', target_is_directory=True)
        except OSError as error:
            self.skipTest('Host cannot create symlinks: ' + str(error))
        names = {i['path'] for i in state.snapshot(self.root, self.archive)['files']}
        self.assertFalse(any('linked' in name for name in names))

    def test_restore_rejects_target_symlink(self):
        self.fixture()
        state.snapshot(self.root, self.archive)
        outside = self.folder / 'outside'
        outside.mkdir()
        try:
            self.target.symlink_to(outside, target_is_directory=True)
        except OSError as error:
            self.skipTest('Host cannot create symlinks: ' + str(error))
        with self.assertRaisesRegex(ValueError, 'non-symlink'):
            state.restore(self.archive, self.target)
        self.assertEqual(list(outside.iterdir()), [])

    def test_invalid_manifest_types_and_duplicate_records_are_rejected(self):
        files = {'cloud-library.json': b'fixture'}
        for kind in ('bool-size', 'digest', 'duplicate', 'extra-field', 'relative-root'):
            with self.subTest(kind=kind):
                manifest = self.manifest(files)
                if kind == 'bool-size':
                    manifest['files'][0]['size'] = True
                elif kind == 'digest':
                    manifest['files'][0]['sha256'] = 'not a digest'
                elif kind == 'duplicate':
                    manifest['files'].append(dict(manifest['files'][0]))
                elif kind == 'extra-field':
                    manifest['unexpected'] = True
                else:
                    manifest['sourceRoot'] = '../workspace'
                self.zip(files, manifest)
                self.assert_restore_rejected_without_writes()

    def test_duplicate_manifest_json_keys_are_rejected(self):
        files = {'cloud-library.json': b'fixture'}
        raw = json.dumps(self.manifest(files)).replace('"version": 1', '"version": 1, "version": 1')
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr('cloud-library.json', b'fixture')
            archive.writestr('manifest.json', raw)
        self.assert_restore_rejected_without_writes()

    def test_target_verification_detects_tampering_and_extra_state(self):
        self.fixture()
        state.snapshot(self.root, self.archive)
        state.restore(self.archive, self.target)
        path = self.target / 'cloud-library.json'
        old = path.read_bytes()
        path.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'Restored state differs'):
            state.verify(self.archive, self.target)
        path.write_bytes(old)
        (self.target / 'data/local-videos/extra.mp4').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'file list differs'):
            state.verify(self.archive, self.target)

    def test_cli_roundtrip_uses_only_stdlib_and_reports_failures(self):
        self.fixture()
        commands = [('snapshot', '--root', str(self.root), '--output', str(self.archive)),
                    ('verify', '--archive', str(self.archive)),
                    ('restore', '--archive', str(self.archive), '--target', str(self.target)),
                    ('verify', '--archive', str(self.archive), '--target', str(self.target))]
        for args in commands:
            result = subprocess.run([sys.executable, '-S', str(Path(state.__file__)), *args], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads(result.stdout)['verified'])
        failed = subprocess.run([sys.executable, '-S', str(Path(state.__file__)), *commands[2]], capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('new or empty', failed.stderr)


if __name__ == '__main__':
    unittest.main()
