"""Build and verify a self-contained fresh deployment bundle without touching AWS.

Default/build: --source-config FILE --agent-zip FILE --output tmp/FRESH
discover: --source-config FILE --output tmp/FRESH-inventory.json --profile nba
upload: --bundle tmp/FRESH --profile nba (fresh verified discovery required)

Discovery is read-only. Upload only creates immutable S3 objects; neither operation
deploys, destroys or modifies CloudFormation resources. Access codes stay in tmp/.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib
import json
from pathlib import Path, PurePosixPath
import re
import secrets
import stat
import subprocess
import uuid
import zipfile

import update_release


ROOT = update_release.ROOT
STABLE_FIELDS = ('account', 'bucket', 'vpc', 'vpcCidr', 'subnet', 'ami', 'nodeSha',
                 'cachePolicyId', 'originRequestPolicyId')
PUBLIC_BLOCK_FIELDS = ('BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets')
MAX_DISCOVERY_AGE = timedelta(hours=1)
AMI_PARAMETER = '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id'
TIMEZONE = timezone(timedelta(hours=8))


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fresh_destination(path, root, *, directory):
    path, root = path.resolve(), root.resolve()
    if not path.is_relative_to(root / 'tmp') or path == root / 'tmp' or path.exists():
        raise ValueError('Use a fresh destination below repository tmp/; existing files are preserved')
    if directory:
        path.mkdir(parents=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path, value):
    path.write_bytes(update_release.json_bytes(value))


def verified_discovery(inventory, now=None):
    if inventory.get('discoveryVerified') is not True:
        return False
    try:
        captured = datetime.fromisoformat(inventory['discoveryCapturedAt'])
        age = (now or datetime.now(TIMEZONE)) - captured
    except (KeyError, TypeError, ValueError):
        return False
    return timedelta(0) <= age <= MAX_DISCOVERY_AGE


def stable_inventory(source):
    result = {field: source[field] for field in STABLE_FIELDS}
    if not all(isinstance(value, str) and value for value in result.values()):
        raise ValueError('Discovery fields must be nonempty strings')
    if not re.fullmatch('[a-f0-9]{64}', result['nodeSha']):
        raise ValueError('Expected the pinned Node.js archive SHA-256')
    return result


def original_selection(root, source_path, source):
    previous_path = source_path.parent / 'release-manifest.json'
    if previous_path.is_file():
        previous = load_json(previous_path)
        library = update_release.existing_library(source_path, source)
        videos = update_release.validate_selection(library, previous)
    else:
        registered = load_json(root / 'data/videos/tactics/acceptance/review-library.json')
        samples = registered['samples']
        library = {'defaultSample': registered['defaultSample'], 'initiallyActiveSamples': [s['id'] for s in samples], 'samples': samples}
        videos = [{'path': sample['video'], 'sha256': sample['videoSha256'],
                   'bytes': update_release.source_path(root, sample['video']).stat().st_size}
                  for sample in samples]
        previous = {'files': [], 'videos': videos}
        update_release.validate_selection(library, previous)
    return library, videos, previous


def copy_verified(source, destination, expected_sha, expected_bytes=None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    received = hashlib.sha256()
    total = 0
    with source.open('rb') as incoming, destination.open('xb') as outgoing:
        while chunk := incoming.read(1024 * 1024):
            received.update(chunk)
            total += len(chunk)
            outgoing.write(chunk)
    if received.hexdigest() != expected_sha or (expected_bytes is not None and total != expected_bytes):
        raise ValueError('Local source or copied file differs from registered SHA-256/size: ' + source.name)
    # Verify local recovery storage, not only the bytes read from the source.
    if sha(destination) != expected_sha:
        raise ValueError('Copied bundle file failed readback SHA-256: ' + destination.name)
    return total


def rebuild_agent(source_zip, destination, entrypoint):
    """Reuse local pure Python SDK dependencies, always insert today's entrypoint."""
    with zipfile.ZipFile(source_zip) as original, zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED) as output:
        names = set()
        for item in original.infolist():
            name = item.filename
            path = PurePosixPath(name)
            if (path.is_absolute() or '\\' in name or ':' in name or '..' in path.parts or
                    stat.S_ISLNK(item.external_attr >> 16) or name in names):
                raise ValueError('Unsafe or duplicate Agent dependency archive member: ' + name)
            names.add(name)
            if item.is_dir() or name == 'agent_main.py' or '__pycache__' in path.parts or path.suffix == '.pyc':
                continue
            if path.suffix.lower() in {'.so', '.pyd', '.dll'}:
                raise ValueError('Native Agent dependency requires explicit Linux ARM64 packaging: ' + name)
            if any(part.startswith('.env') or part in {'.git', '.codex'} for part in path.parts):
                raise ValueError('Private Agent dependency archive member: ' + name)
            output.writestr(name, original.read(item))
        if not {'boto3/__init__.py', 'botocore/__init__.py'}.issubset(names):
            raise ValueError('Agent dependency ZIP must contain boto3 and botocore')
        code = entrypoint.read_bytes()
        output.writestr('agent_main.py', code)
    return {'sha256': sha(destination), 'entrypointSha256': update_release.digest(code),
            'dependencyZipSha256': sha(source_zip), 'bytes': destination.stat().st_size}


def build_bundle(source_config, agent_zip, output, *, inventory_path=None, state_archive=None, root=ROOT):
    root, source_config = root.resolve(), source_config.resolve()
    source = load_json(source_config)
    inventory = load_json(inventory_path) if inventory_path else source
    config = stable_inventory(inventory)
    library, original_videos, previous = original_selection(root, source_config, source)
    files = update_release.collect_files(root, library, previous)
    moment = datetime.now(TIMEZONE)
    release = moment.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
    prefix = 'workbench/deployments/' + release
    code = secrets.token_urlsafe(18)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    config.update(release=release, name='hks-web-' + release, prefix=prefix,
                  codeHash=update_release.digest(code.encode()),
                  discoveryRequired=not verified_discovery(inventory, moment),
                  discoveryCapturedAt=inventory.get('discoveryCapturedAt'),
                  workbenchKey=prefix + '/release/workbench.zip', agentKey=prefix + '/release/agent.zip')
    output = fresh_destination(output, root, directory=True)
    (output / 'access-code.txt').write_text(code, encoding='utf-8')
    videos, uploads = [], []
    samples = {sample['video']: sample for sample in library['samples']}
    for item in original_videos:
        sample = samples[item['path']]
        if not re.fullmatch('[A-Za-z0-9_-]+', sample['id']):
            raise ValueError('Unsafe registered sample ID')
        local_name = f"datasets/{sample['id']}/{item['sha256']}/video.mp4"
        size = copy_verified(update_release.source_path(root, item['path']), output / local_name,
                             item['sha256'], item.get('bytes'))
        key = prefix + '/' + local_name
        videos.append({'path': item['path'], 'key': key, 'sha256': item['sha256'], 'bytes': size})
        uploads.append({'path': local_name, 'key': key, 'sha256': item['sha256'], 'bytes': size,
                        'contentType': 'video/mp4'})
    agent = rebuild_agent(agent_zip, output / 'agent.zip', root / 'engineering/infra/ec2-workbench/agent_main.py')
    config['agentSha256'] = agent['sha256']
    generated = {'cloud-library.json': update_release.json_bytes(library),
                 'cloud-release.json': update_release.json_bytes({'release': release, 'gitHead': head, 'videos': videos})}
    hashes = []
    with zipfile.ZipFile(output / 'workbench.zip', 'x', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            content = update_release.source_path(root, name).read_bytes()
            archive.writestr(name, content)
            hashes.append({'path': name, 'sha256': update_release.digest(content), 'bytes': len(content)})
        for name, content in generated.items():
            archive.writestr(name, content)
            hashes.append({'path': name, 'sha256': update_release.digest(content), 'bytes': len(content)})
    config['workbenchSha256'] = sha(output / 'workbench.zip')
    for name, key, digest in [('workbench.zip', config['workbenchKey'], config['workbenchSha256']),
                              ('agent.zip', config['agentKey'], config['agentSha256'])]:
        uploads.append({'path': name, 'key': key, 'sha256': digest,
                        'bytes': (output / name).stat().st_size, 'contentType': 'application/zip'})
    state_summary = None
    if state_archive is not None:
        # Another module owns the state schema and traversal/conflict validation.
        state_module = importlib.import_module('state_archive')
        state_summary = state_module.verify(state_archive)
        state_sha = sha(state_archive)
        size = copy_verified(state_archive, output / 'state.zip', state_sha)
        if state_module.verify(output / 'state.zip') != state_summary:
            raise ValueError('State archive changed while preparing the rebuild bundle')
        config.update(stateKey=prefix + '/recovery/state.zip', stateSha256=state_sha)
        uploads.append({'path': 'state.zip', 'key': config['stateKey'], 'sha256': state_sha,
                        'bytes': size, 'contentType': 'application/zip'})
    manifest = {'release': release, 'createdAt': moment.isoformat(), 'gitHead': head,
                'workingTreeDirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=root)),
                'files': hashes, 'videos': videos, 'agent': agent, 'objects': uploads,
                'allDatasetsIncluded': True, 'uploadVerified': False,
                'discoveryRequired': config['discoveryRequired'], 'stateIncluded': state_archive is not None}
    if state_summary is not None:
        manifest['stateVerification'] = state_summary
    save_json(output / 'config.json', config)
    save_json(output / 'release-manifest.json', manifest)
    (output / 'cloud-library.json').write_bytes(generated['cloud-library.json'])
    return config, manifest


def verify_public_route(ec2, vpc_id, subnet_id):
    """Require the existing design's IGW and effective public IPv4 route."""
    gateways = list(ec2.get_paginator('describe_internet_gateways').paginate(
        Filters=[{'Name': 'attachment.vpc-id', 'Values': [vpc_id]}]).search('InternetGateways[]'))
    attached = {gateway['InternetGatewayId'] for gateway in gateways
                if any(link.get('VpcId') == vpc_id and link.get('State') == 'available'
                       for link in gateway.get('Attachments', []))}
    if not attached:
        raise ValueError('The selected VPC has no attached available Internet Gateway')
    tables = list(ec2.get_paginator('describe_route_tables').paginate(
        Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}]).search('RouteTables[]'))

    def associated(table, predicate):
        return any(predicate(item) and item.get('AssociationState', {}).get('State', 'associated') == 'associated'
                   for item in table.get('Associations', []))

    explicit = [table for table in tables if associated(table, lambda item: item.get('SubnetId') == subnet_id)]
    effective = explicit or [table for table in tables if associated(table, lambda item: item.get('Main') is True)]
    if len(effective) != 1:
        raise ValueError('Cannot determine one effective route table for the selected subnet')
    public = any(route.get('DestinationCidrBlock') == '0.0.0.0/0' and route.get('State') == 'active'
                 and route.get('GatewayId') in attached for route in effective[0].get('Routes', []))
    if not public:
        raise ValueError('Selected subnet requires an active 0.0.0.0/0 route to its attached IGW')
    return {'publicIpv4RouteVerified': True, 'routeTableId': effective[0]['RouteTableId']}


def discovery(source_config, output, *, profile='nba', root=ROOT):
    import boto3

    source = stable_inventory(load_json(source_config))
    session = boto3.Session(profile_name=profile, region_name='us-east-1')
    identity = session.client('sts').get_caller_identity()
    if '/NBAHackathonParticipantRole/' not in identity['Arn']:
        raise ValueError('Expected the contest participant role')
    account = identity['Account']
    bucket = source['bucket']
    if account != source['account']:
        old_pattern = 'nba-hackathon-' + source['account'] + '-'
        if not bucket.startswith(old_pattern):
            raise ValueError('Account changed; provide an explicitly verified new team bucket in source config')
        bucket = 'nba-hackathon-' + account + '-' + bucket[len(old_pattern):]
    access = session.client('s3').get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
    if not all(access.get(field) is True for field in PUBLIC_BLOCK_FIELDS):
        raise ValueError('The team bucket is missing required public access blocks')
    ec2 = session.client('ec2')
    vpcs = list(ec2.get_paginator('describe_vpcs').paginate(
        Filters=[{'Name': 'is-default', 'Values': ['true']}]).search('Vpcs[]'))
    if len(vpcs) != 1:
        raise ValueError('Expected exactly one default VPC; rediscover the supplied contest environment')
    vpc = vpcs[0]
    subnets = list(ec2.get_paginator('describe_subnets').paginate(
        Filters=[{'Name': 'vpc-id', 'Values': [vpc['VpcId']]}]).search('Subnets[]'))
    eligible = [subnet for subnet in subnets if subnet.get('State') == 'available'
                and subnet.get('AvailableIpAddressCount', 0) >= 8 and subnet.get('AvailabilityZoneId') != 'use1-az3']
    if not eligible:
        raise ValueError('No available subnet for the existing CloudFront VPC-origin design')
    subnet = sorted(eligible, key=lambda item: (item['AvailabilityZoneId'] != 'use1-az6', item['AvailabilityZoneId']))[0]
    network = verify_public_route(ec2, vpc['VpcId'], subnet['SubnetId'])
    ami = session.client('ssm').get_parameter(Name=AMI_PARAMETER)['Parameter']['Value']
    cf = session.client('cloudfront')
    cache = cf.get_cache_policy(Id=source['cachePolicyId'])['CachePolicy']['CachePolicyConfig']
    origin = cf.get_origin_request_policy(Id=source['originRequestPolicyId'])['OriginRequestPolicy']['OriginRequestPolicyConfig']
    if cache['Name'] != 'Managed-CachingDisabled' or origin['Name'] != 'Managed-AllViewer':
        raise ValueError('Expected existing managed CloudFront policies')
    session.client('iam').get_policy(PolicyArn=f'arn:aws:iam::{account}:policy/NBAHackathonParticipantBoundary')
    stacks = session.client('cloudformation').describe_stacks(StackName='CDKToolkit')['Stacks']
    if len(stacks) != 1 or stacks[0]['StackStatus'] not in {'CREATE_COMPLETE', 'UPDATE_COMPLETE'}:
        raise ValueError('Contest CDKToolkit bootstrap is not ready; do not bootstrap without organizer guidance')
    inventory = source | {'account': account, 'bucket': bucket, 'vpc': vpc['VpcId'],
                          'vpcCidr': vpc['CidrBlock'], 'subnet': subnet['SubnetId'], 'ami': ami,
                          'discoveryVerified': True, 'discoveryCapturedAt': datetime.now(TIMEZONE).isoformat(),
                          'region': 'us-east-1', 'network': network,
                          'prerequisites': 'team-bucket-boundary-bootstrap-verified'}
    output = fresh_destination(output, root, directory=False)
    save_json(output, inventory)
    return inventory


def upload_bundle(bundle, *, profile='nba'):
    config, manifest = load_json(bundle / 'config.json'), load_json(bundle / 'release-manifest.json')
    evidence = {'discoveryVerified': not config.get('discoveryRequired', True),
                'discoveryCapturedAt': config.get('discoveryCapturedAt')}
    if not verified_discovery(evidence):
        raise ValueError('Run fresh read-only discovery and rebuild before upload; stale config is not deployable')
    prefix = config['prefix'] + '/'
    if not re.fullmatch(r'workbench/deployments/[A-Za-z0-9_-]+/', prefix):
        raise ValueError('Invalid fresh deployment prefix')
    objects = manifest['objects']
    if len({item['key'] for item in objects}) != len(objects):
        raise ValueError('Duplicate object keys in rebuild manifest')
    # Validate every local object before creating even the first remote object.
    paths = []
    for item in objects:
        path = update_release.source_path(bundle, item['path'])
        if (not item['key'].startswith(prefix) or path.stat().st_size != item['bytes'] or
                sha(path) != item['sha256'] or item['bytes'] > 512 * 1024 * 1024):
            raise ValueError('Bundle object is invalid or exceeds the conditional-PUT size limit: ' + item['path'])
        paths.append(path)
    expected = {config['workbenchKey']: config['workbenchSha256'], config['agentKey']: config['agentSha256']}
    if config.get('stateKey'):
        expected[config['stateKey']] = config['stateSha256']
    if len(manifest.get('videos', [])) not in (2, 3):
        raise ValueError('The rebuild manifest must include the two or three registered datasets')
    expected.update({item['key']: item['sha256'] for item in manifest['videos']})
    if any(not any(item['key'] == key and item['sha256'] == value for item in objects) for key, value in expected.items()):
        raise ValueError('Config archive checksums differ from rebuild manifest')
    import boto3

    session = boto3.Session(profile_name=profile, region_name='us-east-1')
    identity = session.client('sts').get_caller_identity()
    if identity['Account'] != config['account'] or '/NBAHackathonParticipantRole/' not in identity['Arn']:
        raise ValueError('AWS account/role changed after discovery')
    s3 = session.client('s3')
    access = s3.get_public_access_block(Bucket=config['bucket'])['PublicAccessBlockConfiguration']
    if not all(access.get(field) is True for field in PUBLIC_BLOCK_FIELDS):
        raise ValueError('The destination team bucket must remain private')
    for item, path in zip(objects, paths):
        # Typed GET errors distinguish an absent key from access/transport failures.
        # A completed prior upload is reusable only after HEAD and full byte verification.
        try:
            response = s3.get_object(Bucket=config['bucket'], Key=item['key'])
        except s3.exceptions.NoSuchKey:
            # Conditional single PUT is deliberate: managed transfers cannot guarantee non-overwrite.
            with path.open('rb') as stream:
                s3.put_object(Bucket=config['bucket'], Key=item['key'], Body=stream, IfNoneMatch='*',
                              ServerSideEncryption='AES256', ContentType=item['contentType'],
                              Metadata={'sha256': item['sha256']})
            response = s3.get_object(Bucket=config['bucket'], Key=item['key'])
        received = hashlib.sha256()
        with response['Body'] as stream:
            head = s3.head_object(Bucket=config['bucket'], Key=item['key'])
            if head['ContentLength'] != item['bytes'] or head.get('Metadata', {}).get('sha256') != item['sha256']:
                raise ValueError('Existing/uploaded object metadata differs; never overwrite: ' + item['path'])
            while chunk := stream.read(1024 * 1024):
                received.update(chunk)
        if received.hexdigest() != item['sha256']:
            raise ValueError('Existing/uploaded object readback differs; never overwrite: ' + item['path'])
    manifest['uploadVerified'] = True
    manifest['uploadVerifiedAt'] = datetime.now(TIMEZONE).isoformat()
    save_json(bundle / 'release-manifest.json', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('build', 'discover', 'upload'), nargs='?', default='build')
    parser.add_argument('--source-config', type=Path)
    parser.add_argument('--agent-zip', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--state-archive', type=Path)
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--profile', default='nba')
    args = parser.parse_args()
    if args.command == 'upload':
        if not args.bundle:
            parser.error('upload requires --bundle')
        result = upload_bundle(args.bundle.resolve(), profile=args.profile)
        print(json.dumps({'release': result['release'], 'objects': len(result['objects']), 'uploadVerified': True}))
    elif args.command == 'discover':
        if not args.source_config or not args.output:
            parser.error('discover requires --source-config and --output')
        from botocore.exceptions import ClientError

        try:
            result = discovery(args.source_config, args.output, profile=args.profile)
        except ClientError as error:
            requirement = {'GetPublicAccessBlock': 'the organizer-provided private team S3 bucket',
                           'GetPolicy': 'NBAHackathonParticipantBoundary',
                           'DescribeStacks': 'the organizer-provided CDKToolkit bootstrap'}.get(
                               error.operation_name, 'the organizer-provided AWS environment')
            code = error.response.get('Error', {}).get('Code', 'unknown')
            parser.exit(1, f'Read-only discovery could not verify {requirement} (AWS {code}). '
                        'After the full account reset, wait for the organizers to initialize the required '
                        'environment and rerun discovery. Do not create contest prerequisites or run cdk bootstrap.\n')
        print(json.dumps({'discoveryVerified': True, 'discoveryCapturedAt': result['discoveryCapturedAt']}))
    else:
        if not args.source_config or not args.agent_zip or not args.output:
            parser.error('build requires --source-config, --agent-zip and --output')
        config, result = build_bundle(args.source_config, args.agent_zip, args.output,
                                      inventory_path=args.inventory, state_archive=args.state_archive)
        print(json.dumps({'release': config['release'], 'files': len(result['files']), 'videos': len(result['videos']),
                          'objects': len(result['objects']), 'discoveryRequired': config['discoveryRequired'],
                          'uploadVerified': False}))


if __name__ == '__main__':
    main()
