"""Fresh rebuild closure tests; all AWS and state integrations are local fakes."""
from datetime import datetime, timedelta
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

import prepare_rebuild as rebuild


class RebuildTests(unittest.TestCase):
    def make_source(self, root):
        source = root / 'tmp/source'
        source.mkdir(parents=True)
        config = {'account': '123', 'bucket': 'private', 'vpc': 'vpc-old', 'vpcCidr': '10.0.0.0/16',
                  'subnet': 'subnet-old', 'ami': 'ami-old', 'nodeSha': 'a' * 64,
                  'cachePolicyId': 'cache', 'originRequestPolicyId': 'origin',
                  'name': 'old-name', 'release': 'old', 'prefix': 'workbench/deployments/old',
                  'codeHash': 'old-code', 'instanceId': 'old-instance', 'privateDns': 'old-private',
                  'domain': 'old.cloudfront.net', 'runtimeArn': 'old-runtime',
                  'cloudfrontSecurityGroup': 'old-sg', 'stateKey': 'old/state.zip'}
        rebuild.save_json(source / 'config.json', config)
        samples, videos = [], []
        for index in (1, 2, 3):
            relative = f'data/videos/sample{index}.mp4'
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f'video {index}'.encode())
            digest = rebuild.sha(path)
            samples.append({'id': str(index), 'video': relative, 'videoSha256': digest})
            videos.append({'path': relative, 'key': f'OLD-S3-PREFIX/{index}',
                           'sha256': digest, 'bytes': path.stat().st_size})
        rebuild.save_json(source / 'cloud-library.json', {'defaultSample': '1', 'samples': samples})
        rebuild.save_json(source / 'release-manifest.json', {'files': [], 'videos': videos})
        code = root / 'engineering/infra/ec2-workbench/agent_main.py'
        code.parent.mkdir(parents=True)
        code.write_text('print("CURRENT_FIXED_AGENT")\n')
        with zipfile.ZipFile(source / 'agent.zip', 'w') as archive:
            archive.writestr('boto3/__init__.py', 'SDK')
            archive.writestr('botocore/__init__.py', 'SDK CORE')
            archive.writestr('agent_main.py', 'STALE AGENT')
        return source, config

    def git(self, command, **kwargs):
        return 'b' * 40 + '\n' if command[1] == 'rev-parse' else b'?? current files'

    def build(self, root, source, output, **kwargs):
        with patch.object(rebuild.update_release, 'collect_files', return_value={'engineering/infra/ec2-workbench/agent_main.py'}), \
                patch.object(rebuild.subprocess, 'check_output', side_effect=self.git):
            return rebuild.build_bundle(source / 'config.json', source / 'agent.zip', output, root=root, **kwargs)

    def test_offline_bundle_replaces_all_old_resources_and_copies_all_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, old = self.make_source(root)
            output = root / 'tmp/rebuild'
            config, manifest = self.build(root, source, output)
            self.assertEqual(rebuild.load_json(source / 'config.json'), old)
            self.assertTrue(config['discoveryRequired'])
            self.assertNotEqual(config['codeHash'], old['codeHash'])
            self.assertEqual(config['codeHash'], hashlib.sha256((output / 'access-code.txt').read_bytes()).hexdigest())
            for field in ('instanceId', 'privateDns', 'domain', 'runtimeArn', 'cloudfrontSecurityGroup', 'stateKey'):
                self.assertNotIn(field, config)
            self.assertNotEqual(config['prefix'], old['prefix'])
            self.assertEqual(len(manifest['objects']), 5)
            for item in manifest['objects']:
                self.assertTrue(item['key'].startswith(config['prefix'] + '/'))
                self.assertEqual(rebuild.sha(output / item['path']), item['sha256'])
                self.assertNotIn('OLD-S3-PREFIX', item['key'])
            with zipfile.ZipFile(output / 'workbench.zip') as archive:
                self.assertNotIn('config.json', archive.namelist())
                self.assertNotIn('access-code.txt', archive.namelist())
                generated = json.loads(archive.read('cloud-release.json'))
                self.assertEqual(generated['videos'], manifest['videos'])
                self.assertNotIn('OLD-S3-PREFIX', json.dumps(generated))
            with zipfile.ZipFile(output / 'agent.zip') as archive:
                self.assertEqual(archive.read('agent_main.py'), (root / 'engineering/infra/ec2-workbench/agent_main.py').read_bytes())
            self.assertEqual(rebuild.sha(output / 'workbench.zip'), config['workbenchSha256'])
            self.assertEqual(rebuild.sha(output / 'agent.zip'), config['agentSha256'])

    def test_missing_or_changed_local_video_fails_even_with_old_s3_key(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, _ = self.make_source(root)
            (root / 'data/videos/sample2.mp4').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'registered SHA-256'):
                self.build(root, source, root / 'tmp/rebuild')

    def test_state_is_verified_locally_and_rekeyed_to_fresh_prefix(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, old = self.make_source(root)
            state_path = source / 'state.zip'
            state_path.write_bytes(b'verified state')
            calls = []
            verifier = types.SimpleNamespace(verify=lambda path: calls.append(path) or {'format': 'hks-workbench-state', 'files': []})
            with patch.dict(sys.modules, {'state_archive': verifier}):
                config, manifest = self.build(root, source, root / 'tmp/rebuild', state_archive=state_path)
            self.assertEqual(calls, [state_path, root / 'tmp/rebuild/state.zip'])
            self.assertEqual(config['stateKey'], config['prefix'] + '/recovery/state.zip')
            self.assertNotEqual(config['stateKey'], old['stateKey'])
            self.assertEqual(config['stateSha256'], rebuild.sha(state_path))
            self.assertTrue(manifest['stateIncluded'])
            self.assertEqual(len(manifest['objects']), 6)

    def test_discovery_age_prevents_reusing_pre_reset_inventory(self):
        now = datetime.now(rebuild.TIMEZONE)
        self.assertFalse(rebuild.verified_discovery({'discoveryVerified': True,
            'discoveryCapturedAt': (now - timedelta(hours=2)).isoformat()}, now))
        self.assertFalse(rebuild.verified_discovery({'discoveryVerified': True,
            'discoveryCapturedAt': (now + timedelta(minutes=1)).isoformat()}, now))
        self.assertTrue(rebuild.verified_discovery({'discoveryVerified': True,
            'discoveryCapturedAt': now.isoformat()}, now))

    def test_agent_rejects_unsafe_members(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, _ = self.make_source(root)
            with zipfile.ZipFile(source / 'bad-agent.zip', 'w') as archive:
                archive.writestr('../outside', 'BAD')
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                rebuild.rebuild_agent(source / 'bad-agent.zip', root / 'bad-output.zip',
                                      root / 'engineering/infra/ec2-workbench/agent_main.py')

    def test_effective_subnet_route_requires_attached_igw_and_explicit_route_wins(self):
        gateways = [{'InternetGatewayId': 'igw-1', 'Attachments': [{'VpcId': 'vpc-1', 'State': 'available'}]}]
        tables = [{'RouteTableId': 'main', 'Associations': [{'Main': True}],
                   'Routes': [{'DestinationCidrBlock': '0.0.0.0/0', 'State': 'active', 'GatewayId': 'igw-1'}]}]

        def paginator(operation):
            rows = gateways if operation == 'describe_internet_gateways' else tables
            return types.SimpleNamespace(paginate=lambda **kwargs: types.SimpleNamespace(search=lambda query: rows))

        ec2 = types.SimpleNamespace(get_paginator=paginator)
        self.assertEqual(rebuild.verify_public_route(ec2, 'vpc-1', 'subnet-1')['routeTableId'], 'main')
        tables.append({'RouteTableId': 'explicit', 'Associations': [{'SubnetId': 'subnet-1'}],
                       'Routes': [{'DestinationCidrBlock': '0.0.0.0/0', 'State': 'active', 'NatGatewayId': 'nat-1'}]})
        with self.assertRaisesRegex(ValueError, 'active 0.0.0.0/0 route'):
            rebuild.verify_public_route(ec2, 'vpc-1', 'subnet-1')
        tables[1]['Routes'] = [{'DestinationCidrBlock': '0.0.0.0/0', 'State': 'blackhole', 'GatewayId': 'igw-1'}]
        with self.assertRaisesRegex(ValueError, 'active 0.0.0.0/0 route'):
            rebuild.verify_public_route(ec2, 'vpc-1', 'subnet-1')
        gateways.clear()
        with self.assertRaisesRegex(ValueError, 'no attached available'):
            rebuild.verify_public_route(ec2, 'vpc-1', 'subnet-1')

    def test_upload_rejects_unverified_bundle_before_any_aws_client(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, _ = self.make_source(root)
            output = root / 'tmp/rebuild'
            self.build(root, source, output)
            sdk = types.SimpleNamespace(Session=lambda **kwargs: self.fail('AWS must not be contacted'))
            with patch.dict(sys.modules, {'boto3': sdk}), self.assertRaisesRegex(ValueError, 'discovery'):
                rebuild.upload_bundle(output)

    def test_upload_uses_fresh_keys_and_checks_each_body(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, _ = self.make_source(root)
            inventory = rebuild.load_json(source / 'config.json') | {'discoveryVerified': True,
                         'discoveryCapturedAt': datetime.now(rebuild.TIMEZONE).isoformat()}
            rebuild.save_json(source / 'inventory.json', inventory)
            output = root / 'tmp/rebuild'
            config, manifest = self.build(root, source, output, inventory_path=source / 'inventory.json')
            objects = {}
            puts = []

            class NoSuchKey(Exception):
                pass

            class S3:
                exceptions = types.SimpleNamespace(NoSuchKey=NoSuchKey)
                def get_public_access_block(self, **kwargs):
                    return {'PublicAccessBlockConfiguration': dict.fromkeys(rebuild.PUBLIC_BLOCK_FIELDS, True)}
                def put_object(self, **kwargs):
                    assert kwargs['IfNoneMatch'] == '*'
                    assert kwargs['Key'].startswith(config['prefix'] + '/')
                    objects[kwargs['Key']] = (kwargs['Body'].read(), kwargs['Metadata'])
                    puts.append(kwargs['Key'])
                def head_object(self, **kwargs):
                    body, metadata = objects[kwargs['Key']]
                    return {'ContentLength': len(body), 'Metadata': metadata}
                def get_object(self, **kwargs):
                    if kwargs['Key'] not in objects:
                        raise NoSuchKey()
                    return {'Body': io.BytesIO(objects[kwargs['Key']][0])}

            s3 = S3()
            sts = types.SimpleNamespace(get_caller_identity=lambda: {'Account': '123',
                'Arn': 'arn:aws:sts::123:assumed-role/NBAHackathonParticipantRole/test'})
            sdk = types.SimpleNamespace(Session=lambda **kwargs:
                types.SimpleNamespace(client=lambda name: s3 if name == 's3' else sts))
            with patch.dict(sys.modules, {'boto3': sdk}):
                result = rebuild.upload_bundle(output)
                self.assertEqual(len(puts), len(manifest['objects']))
                rebuild.upload_bundle(output)
                self.assertEqual(len(puts), len(manifest['objects']), 'matching existing keys must not be overwritten')
                first = manifest['objects'][0]['key']
                body, metadata = objects[first]
                objects[first] = (b'X' * len(body), metadata)
                with self.assertRaisesRegex(ValueError, 'readback differs; never overwrite'):
                    rebuild.upload_bundle(output)
                self.assertEqual(len(puts), len(manifest['objects']))
            self.assertTrue(result['uploadVerified'])
            self.assertEqual(len(objects), len(manifest['objects']))


if __name__ == '__main__':
    unittest.main()
