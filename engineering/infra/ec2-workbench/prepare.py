"""Build explicit native deployment archives and upload immutable release objects."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone, timedelta

import boto3

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--upload', action='store_true')
    args = parser.parse_args()
    dest = args.output.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    if (dest / 'config.json').exists():
        raise ValueError('Use a fresh release folder; existing deployment state is preserved')
    session = boto3.Session(profile_name='nba', region_name='us-east-1')
    identity = session.client('sts').get_caller_identity()
    if '/NBAHackathonParticipantRole/' not in identity['Arn']:
        raise ValueError('Expected contest participant role')
    account = identity['Account']
    bucket = f'nba-hackathon-{account}-team25'
    s3 = session.client('s3')
    access = s3.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
    if not all(access.values()):
        raise ValueError('Private team bucket required')
    ec2 = session.client('ec2')
    vpc, = ec2.describe_vpcs(Filters=[{'Name': 'is-default', 'Values': ['true']}])['Vpcs']
    subnets = ec2.describe_subnets(Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}])['Subnets']
    subnet = sorted((s for s in subnets if s['AvailabilityZoneId'] != 'use1-az3'),
                    key=lambda s: (s['AvailabilityZoneId'] != 'use1-az6', s['AvailabilityZoneId']))[0]
    ami = session.client('ssm').get_parameter(Name='/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id')['Parameter']['Value']
    release = datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')
    prefix = 'workbench/deployments/' + release
    code = secrets.token_urlsafe(18)
    sums = urllib.request.urlopen('https://nodejs.org/dist/v22.19.0/SHASUMS256.txt', timeout=30).read().decode()
    node_sha = next(line.split()[0] for line in sums.splitlines() if line.endswith('  node-v22.19.0-linux-x64.tar.xz'))
    config = {'account': account, 'bucket': bucket, 'prefix': prefix, 'release': release,
              'name': 'hks-web-' + release, 'vpc': vpc['VpcId'], 'vpcCidr': vpc['CidrBlock'],
              'subnet': subnet['SubnetId'], 'ami': ami, 'nodeSha': node_sha,
              'codeHash': hashlib.sha256(code.encode()).hexdigest()}
    cf = session.client('cloudfront')
    caches = cf.list_cache_policies(Type='managed').get('CachePolicyList', {}).get('Items', [])
    origins = cf.list_origin_request_policies(Type='managed').get('OriginRequestPolicyList', {}).get('Items', [])
    config['cachePolicyId'] = next(p['CachePolicy']['Id'] for p in caches if p['CachePolicy']['CachePolicyConfig']['Name'] == 'Managed-CachingDisabled')
    config['originRequestPolicyId'] = next(p['OriginRequestPolicy']['Id'] for p in origins if p['OriginRequestPolicy']['OriginRequestPolicyConfig']['Name'] == 'Managed-AllViewer')
    (dest / 'access-code.txt').write_text(code, encoding='utf-8')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    files = {p for p in tracked if p and (
        p.startswith(('engineering/scripts/', 'engineering/configs/', 'engineering/tools/player-review/', 'engineering/tools/tactical-overlay/', 'engineering/tools/commentary-preview/',
                      'engineering/archive/tactical-video/005-authored-v2/', '2K Player Data/', 'data/player-rosters/'))
        or p == 'engineering/requirements-review.txt') and Path(p).suffix.lower() not in ('.mp4', '.mov')}
    files.add('engineering/scripts/cloud_tactics_agent.py')
    files.add('engineering/scripts/cloud_gpu.py')
    files.add('engineering/scripts/commentary_fonts.py')
    files.update(p.relative_to(ROOT).as_posix() for p in HERE.iterdir() if p.suffix in ('.py', '.sh', '.json'))
    library = json.loads((ROOT / 'data/videos/tactics/acceptance/review-library.json').read_text(encoding='utf-8'))
    selected = library['samples']
    if not selected:
        raise ValueError('Expected at least one registered sample')

    def referenced(value):
        if isinstance(value, dict):
            if isinstance(value.get('tracks'), str):
                sidecar = ROOT / value.get('metadata', str(Path(value['tracks']).with_suffix('.meta.json')))
                if sidecar.is_file():
                    files.add(sidecar.relative_to(ROOT).as_posix())
            for v in value.values():
                referenced(v)
        elif isinstance(value, list):
            for v in value:
                referenced(v)
        elif isinstance(value, str) and not value.startswith(('http:', 'https:')):
            path = ROOT / value
            if path.is_file() and path.suffix.lower() != '.mp4':
                files.add(path.relative_to(ROOT).as_posix())
    referenced(selected)
    videos = []
    for sample in selected:
        path = ROOT / sample['video']
        digest = sha(path)
        if digest != sample['videoSha256']:
            raise ValueError('Registered sample digest differs')
        key = prefix + '/datasets/' + digest + '.mp4'
        videos.append({'path': sample['video'], 'key': key, 'sha256': digest, 'bytes': path.stat().st_size})
    package = dest / 'workbench.zip'
    hashes = []
    with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
        for value in sorted(files):
            path = ROOT / value
            if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(ROOT):
                raise ValueError('Invalid release file: ' + value)
            if any(part in ('.env', 'node_modules', '.git', 'tmp') for part in Path(value).parts):
                raise ValueError('Private path in package')
            archive.write(path, value)
            hashes.append({'path': value, 'sha256': sha(path), 'bytes': path.stat().st_size})
        archive.writestr('cloud-library.json', json.dumps({'defaultSample': selected[0]['id'], 'initiallyActiveSamples': [s['id'] for s in selected], 'samples': selected}, ensure_ascii=False))
        archive.writestr('cloud-release.json', json.dumps({'release': release, 'videos': videos}, ensure_ascii=False))
    target = dest / 'agent-package'
    if boto3.__version__ == '1.43.108':
        target.mkdir(exist_ok=True)
        for name in ('boto3', 'botocore', 's3transfer', 'dateutil', 'jmespath', 'urllib3', 'six'):
            source = Path(importlib.util.find_spec(name).origin)
            if source.name == '__init__.py':
                shutil.copytree(source.parent, target / name, dirs_exist_ok=True)
            else:
                shutil.copy2(source, target / source.name)
    else:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '--target', str(target), 'boto3==1.43.108'], check=True)
    shutil.copy2(HERE / 'agent_main.py', target / 'agent_main.py')
    with zipfile.ZipFile(dest / 'agent.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in target.rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                archive.write(path, path.relative_to(target).as_posix())
    (dest / 'config.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
    (dest / 'release-manifest.json').write_text(json.dumps({'release': release, 'files': hashes, 'videos': videos}, indent=2), encoding='utf-8')
    print(json.dumps({'release': release, 'files': len(hashes), 'workbenchBytes': package.stat().st_size,
                      'agentBytes': (dest / 'agent.zip').stat().st_size, 'videos': len(videos)}), flush=True)
    if args.upload:
        uploads = [(package, prefix + '/release/workbench.zip'), (dest / 'agent.zip', prefix + '/release/agent.zip')]
        uploads += [(ROOT / v['path'], v['key']) for v in videos if v['key'].startswith(prefix)]
        for path, key in uploads:
            digest = sha(path)
            with path.open('rb') as stream:
                s3.put_object(Bucket=bucket, Key=key, Body=stream, ServerSideEncryption='AES256',
                              Metadata={'sha256': digest}, IfNoneMatch='*')
            head = s3.head_object(Bucket=bucket, Key=key)
            if head['ContentLength'] != path.stat().st_size or head['Metadata']['sha256'] != digest:
                raise ValueError('Uploaded object metadata differs')
            received = hashlib.sha256()
            with s3.get_object(Bucket=bucket, Key=key)['Body'] as stream:
                while chunk := stream.read(1024 * 1024):
                    received.update(chunk)
            if received.hexdigest() != digest:
                raise ValueError('Uploaded object readback digest differs')
            print('Uploaded and verified: ' + json.dumps(path.name, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
