"""Local release isolation and immutable upload checks; never contact AWS."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location('update_release', Path(__file__).with_name('update_release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_build_preserves_deployment_and_includes_untracked_imports_and_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = root / 'tmp/existing'
            old.mkdir(parents=True)
            config = {'prefix': 'workbench/deployments/old', 'release': 'old',
                      'account': '123', 'bucket': 'private', 'codeHash': 'DO_NOT_PACKAGE'}
            config_path = old / 'config.json'
            config_path.write_text(json.dumps(config))
            videos = [{'path': f'data/videos/{index}.mp4', 'key': f'old/{index}.mp4',
                       'sha256': str(index) * 64, 'bytes': 1} for index in (1, 2, 3)]
            samples = [{'id': str(index), 'video': video['path'], 'videoSha256': video['sha256']}
                       for index, video in enumerate(videos, 1)]
            (old / 'cloud-library.json').write_text(json.dumps({'defaultSample': '1', 'samples': samples}))
            (old / 'release-manifest.json').write_text(json.dumps({'files': [], 'videos': videos}))
            paths = {
                'engineering/scripts/main.py': 'import new_dependency\n',
                'engineering/scripts/new_dependency.py': 'value = 1\n',
                'engineering/scripts/cloud_tactics_agent.py': 'value = 2\n',
                'engineering/tools/player-review/app.mjs': "import './new-feature.mjs';\n",
                'engineering/tools/player-review/new-feature.mjs': 'export const value = 1;\n',
                'engineering/infra/ec2-workbench/gateway.py': 'value = 3\n',
                'research/agents/qwen-parallel-20261007/replay/index.json': '{}',
            }
            for name, content in paths.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            tracked = [name for name in paths if 'new_dependency' not in name and 'new-feature' not in name]

            def git(command, **kwargs):
                if command[1] == 'ls-files':
                    return ('\0'.join(tracked) + '\0').encode()
                if command[1] == 'rev-parse':
                    return 'a' * 40 + '\n'
                return b'?? untracked\n'

            output = root / 'tmp/new'
            with patch.object(release.subprocess, 'check_output', side_effect=git):
                loaded, manifest = release.build_release(config_path, output, root=root)
            self.assertEqual(json.loads(config_path.read_text()), config)
            self.assertEqual(loaded, config)
            self.assertTrue(manifest['workbenchKey'].startswith(config['prefix'] + '/release/'))
            self.assertEqual(manifest['gitHead'], 'a' * 40)
            self.assertFalse(manifest['uploadVerified'])
            with zipfile.ZipFile(output / 'workbench.zip') as archive:
                self.assertTrue(set(paths).issubset(archive.namelist()))
                self.assertNotIn('config.json', archive.namelist())
                self.assertNotIn('access-code.txt', archive.namelist())
                self.assertEqual(json.loads(archive.read('cloud-release.json'))['videos'], videos)
                for item in manifest['files']:
                    content = archive.read(item['path'])
                    self.assertEqual(hashlib.sha256(content).hexdigest(), item['sha256'])
                    self.assertEqual(len(content), item['bytes'])
            with self.assertRaisesRegex(ValueError, 'already exists'):
                release.build_release(config_path, output, root=root)

    def test_archive_paths_reject_traversal_and_private_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ('../secret', '/absolute', 'C:/secret', 'tmp/secret', '.env',
                         'engineering/.env.production', 'engineering/node_modules/key'):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    release.source_path(Path(folder), name)

    def test_upload_uses_conditional_put_and_detects_corrupt_readback(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            content = b'archive bytes'
            (output / 'workbench.zip').write_bytes(content)
            manifest = {'workbenchKey': 'old/release/new/workbench.zip',
                        'workbenchSha256': hashlib.sha256(content).hexdigest(),
                        'workbenchBytes': len(content), 'gitHead': 'a' * 40, 'uploadVerified': False}
            calls = []

            class S3:
                body = content
                def get_public_access_block(self, **kwargs):
                    return {'PublicAccessBlockConfiguration': {'BlockPublicAcls': True}}
                def put_object(self, **kwargs):
                    calls.append(kwargs | {'Body': kwargs['Body'].read()})
                def head_object(self, **kwargs):
                    return {'ContentLength': len(content), 'Metadata': {'sha256': manifest['workbenchSha256']}}
                def get_object(self, **kwargs):
                    return {'Body': io.BytesIO(self.body)}

            s3 = S3()
            sts = types.SimpleNamespace(get_caller_identity=lambda: {'Account': '123', 'Arn':
                'arn:aws:sts::123:assumed-role/NBAHackathonParticipantRole/test'})
            session = types.SimpleNamespace(client=lambda name: s3 if name == 's3' else sts)
            sdk = types.SimpleNamespace(Session=lambda **kwargs: session)
            with patch.dict(sys.modules, {'boto3': sdk}):
                release.upload_release({'account': '123', 'bucket': 'private'}, output, manifest)
                self.assertTrue(manifest['uploadVerified'])
                self.assertEqual(calls[0]['IfNoneMatch'], '*')
                self.assertEqual(calls[0]['Body'], content)
                s3.body = b'corrupted'
                with self.assertRaisesRegex(ValueError, 'readback'):
                    release.upload_release({'account': '123', 'bucket': 'private'}, output, manifest)


if __name__ == '__main__':
    unittest.main()
