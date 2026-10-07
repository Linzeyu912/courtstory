import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('relocate_state', HERE / 'relocate_state.py')
relocation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relocation)


class RelocateStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'staged'
        self.root.mkdir()
        self.old = '/opt/hks/releases/old'
        self.new = '/opt/hks/releases/new'

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        return path

    def sample(self, base='artifacts/cloud-imports/clip'):
        return {'video': self.old + '/' + base + '/video.mp4',
                'tracks': self.old + '/' + base + '/tracks.json',
                'videoSha256': 'a' * 64, 'description': '历史位置 ' + self.old,
                'trackingVariants': [{'id': 'manual', 'tracks': self.old + '/' + base + '/tracks.json',
                                      'metadata': self.old + '/' + base + '/tracks.meta.json'}]}

    def test_plan_apply_idempotence_and_binding_preservation(self):
        library = self.write('artifacts/cloud-imports/library.json', {'clip': self.sample()})
        original = library.read_bytes()
        history = self.write('artifacts/cloud-imports/clip/sample.json', self.sample())
        metadata = self.write('artifacts/cloud-imports/clip/tracks.meta.json',
                              {'video': self.old + '/video.mp4', 'sourceFingerprint': 'a' * 64})
        preserved = {path: path.read_bytes() for path in (history, metadata)}
        plan = relocation.relocate(self.root, self.old, self.new)
        self.assertFalse(plan['applied'])
        self.assertEqual(len(plan['changes']), 4)
        self.assertEqual(library.read_bytes(), original)
        result = relocation.relocate(self.root, self.old, self.new, apply=True)
        self.assertTrue(result['applied'])
        self.assertEqual(plan['files'], result['files'])
        value = json.loads(library.read_bytes())['clip']
        self.assertEqual(value['video'], self.new + '/artifacts/cloud-imports/clip/video.mp4')
        self.assertEqual(value['description'], '历史位置 ' + self.old)
        self.assertEqual(value['videoSha256'], 'a' * 64)
        for path, content in preserved.items():
            self.assertEqual(path.read_bytes(), content)
        self.assertEqual(relocation.relocate(self.root, self.old, self.new)['changes'], [])

    def test_trim_cloud_and_live_task_sources_only(self):
        sample = self.sample('artifacts/cloud-trims/clip')
        sample.update(alternativeTracks=self.old + '/artifacts/cloud-trims/clip/alt.json',
                      courtCandidates=self.old + '/artifacts/cloud-trims/clip/court.json',
                      feetCandidates=self.old + '/artifacts/cloud-trims/clip/feet.json')
        self.write('artifacts/cloud-trims/library.json', [sample])
        self.write('cloud-library.json', {'samples': [{'video': 'data/videos/sample.mp4', 'tracks': 'data/videos/tracks.json'}]})
        names = ['agent-jobs/a/request.json', 'identity-jobs/b/request.json',
                 'ground-trajectory-jobs/c/source.json', 'ground-trajectory-jobs/sources/d.json',
                 'ground-trajectory-jobs/e/job.json']
        for name in names:
            self.write('data/local-workbench/tactics/' + name,
                       {'video': self.old + '/artifacts/cloud-imports/clip/video.mp4',
                        'clip': {'trackingMetadata': {'video': self.old + '/evidence.mp4'}}, 'context': ['immutable']})
        result = self.write('data/local-workbench/tactics/render-jobs/r/result.json',
                            {'videoUrl': '/api/tactics-render/jobs/r/video', 'sha256': 'b' * 64})
        before = result.read_bytes()
        report = relocation.relocate(self.root, self.old, self.new, apply=True)
        self.assertEqual(report['filesChanged'], 6)
        self.assertEqual(result.read_bytes(), before)
        for name in names:
            value = json.loads((self.root / 'data/local-workbench/tactics' / name).read_bytes())
            self.assertTrue(value['video'].startswith(self.new + '/'))
            self.assertEqual(value['clip']['trackingMetadata']['video'], self.old + '/evidence.mp4')
            self.assertEqual(value['context'], ['immutable'])

    def test_invalid_later_manifest_never_partially_applies(self):
        good = self.write('artifacts/cloud-imports/library.json', {'clip': self.sample()})
        before = good.read_bytes()
        self.write('artifacts/cloud-trims/library.json', [{'video': '/etc/credentials'}])
        with self.assertRaisesRegex(ValueError, 'External absolute path'):
            relocation.relocate(self.root, self.old, self.new, apply=True)
        self.assertEqual(good.read_bytes(), before)

    def test_rejects_prefix_sibling_and_parent_traversal(self):
        for value in [self.old + '-other/video.mp4', self.old + '/../other/video.mp4', '../outside.mp4']:
            with self.subTest(value=value):
                self.write('artifacts/cloud-imports/library.json', {'clip': {'video': value}})
                with self.assertRaises(ValueError):
                    relocation.relocate(self.root, self.old, self.new, apply=True)

    def test_rejects_source_root_live_code_and_credentials(self):
        with self.assertRaises(ValueError):
            relocation.relocate(self.root, str(self.root), str(self.root.parent / 'new'))
        for name in ['engineering/app.py', 'data/local-workbench/auth.json']:
            with self.subTest(name=name):
                path = self.write(name, {})
                with self.assertRaises(ValueError):
                    relocation.relocate(self.root, self.old, self.new)
                path.unlink()
                if name.startswith('engineering/'):
                    path.parent.rmdir()

    def test_rejects_linked_manifest(self):
        target = Path(self.temporary.name) / 'outside.json'
        target.write_text('{}')
        link = self.root / 'artifacts/cloud-imports/library.json'
        link.parent.mkdir(parents=True)
        try:
            link.symlink_to(target)
        except OSError as error:
            self.skipTest(str(error))
        with self.assertRaisesRegex(ValueError, 'Linked'):
            relocation.relocate(self.root, self.old, self.new, apply=True)

    def test_duplicate_fields_and_overlapping_roots_are_rejected(self):
        path = self.write('artifacts/cloud-imports/library.json', {})
        path.write_text('{"clip":{"video":"one","video":"two"}}')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            relocation.relocate(self.root, self.old, self.new, apply=True)
        path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'non-overlapping'):
            relocation.relocate(self.root, self.old, self.old + '/nested', apply=True)

    def test_concurrent_manifest_change_aborts_before_replacing_any_file(self):
        path = self.write('artifacts/cloud-imports/library.json', {'clip': self.sample()})
        plan = relocation._plan
        changed = b'{"concurrent": {"video": "data/videos/other.mp4"}}'

        def changed_after_plan(*args):
            result = plan(*args)
            path.write_bytes(changed)
            return result

        with patch.object(relocation, '_plan', side_effect=changed_after_plan):
            with self.assertRaisesRegex(ValueError, 'changed after planning'):
                relocation.relocate(self.root, self.old, self.new, apply=True)
        self.assertEqual(path.read_bytes(), changed)
        self.assertFalse((self.root / '.relocate.lock').exists())

    def test_commit_error_rolls_back_all_completed_replacements(self):
        first = self.write('artifacts/cloud-imports/library.json', {'clip': self.sample()})
        second = self.write('artifacts/cloud-trims/library.json', [self.sample('artifacts/cloud-trims/clip')])
        original = {path: path.read_bytes() for path in (first, second)}
        replace = os.replace
        calls = []

        def fail_second(source, destination):
            calls.append(str(source))
            if len(calls) == 2:
                raise OSError('simulated write failure')
            return replace(source, destination)

        with patch.object(relocation.os, 'replace', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'simulated'):
                relocation.relocate(self.root, self.old, self.new, apply=True)
        for path, content in original.items():
            self.assertEqual(path.read_bytes(), content)
        self.assertFalse(list(self.root.glob('.relocate-*')))

    def test_real_clip_validation_keeps_metadata_fingerprint_after_move(self):
        # Exercise the actual fingerprint code without requiring a media codec.
        scripts = HERE.parents[1] / 'scripts'
        sys.path.insert(0, str(scripts))
        self.addCleanup(lambda: sys.path.remove(str(scripts)))
        spec = importlib.util.spec_from_file_location('relocation_review_server', scripts / 'serve_player_review.py')
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        old = Path(self.temporary.name) / 'old'
        cache = old / 'artifacts/cloud-imports/clip'
        cache.mkdir(parents=True)
        (cache / 'video.mp4').write_bytes(b'fixed video bytes')
        sha = hashlib.sha256((cache / 'video.mp4').read_bytes()).hexdigest()
        (cache / 'tracks.json').write_text('[{"frame":0,"time":0,"tracks":[]}]')
        (cache / 'tracks.meta.json').write_text(json.dumps({'video_sha256': sha, 'frames': 1,
            'pipeline_version': 'manual-source-pts-v1', 'video': str(cache / 'video.mp4')}))
        sample = {'id': 'clip', 'video': str(cache / 'video.mp4'), 'tracks': str(cache / 'tracks.json'),
                  'videoSha256': sha, 'defaultVariant': 'manual',
                  'trackingVariants': [{'id': 'manual', 'label': 'Manual', 'tracks': str(cache / 'tracks.json')}]}
        (cache.parent / 'library.json').write_text(json.dumps({'clip': sample}))
        shutil.copytree(old / 'artifacts', self.root / 'artifacts')
        with patch.object(server, 'video_source_info', return_value=(640, 360, [0.0], sha, 1 / 30)):
            original = json.loads(server.validated_clip(sample)['payloads']['manual'])
            metadata = (self.root / 'artifacts/cloud-imports/clip/tracks.meta.json').read_bytes()
            relocation.relocate(self.root, str(old), str(self.root), apply=True)
            restored_sample = json.loads((self.root / 'artifacts/cloud-imports/library.json').read_bytes())['clip']
            restored = json.loads(server.validated_clip(restored_sample)['payloads']['manual'])
        self.assertEqual(original['tracking_fingerprint'], restored['tracking_fingerprint'])
        self.assertEqual(original['video_sha256'], restored['video_sha256'])
        self.assertEqual((self.root / 'artifacts/cloud-imports/clip/tracks.meta.json').read_bytes(), metadata)


if __name__ == '__main__':
    unittest.main()
