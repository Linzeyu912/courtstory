"""Upload the two registered training clips to the team's existing S3 bucket.

Uses the AWS CLI credential chain; never reads or copies credential files.
Default is local validation and a plan. --upload creates immutable objects.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / 'data/videos/uploads/2026-10-05-official-training'
PREFIX = 'workbench/datasets/broadcastcode-training-20261005'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def local_plan():
    manifest = json.loads((DATASET / 'manifest.json').read_text(encoding='utf-8'))
    rows = []
    for entry in manifest['entries']:
        asset = entry['asset']
        path = (DATASET / asset['path']).resolve()
        if not path.is_relative_to(DATASET.resolve()) or path.suffix.lower() != '.mp4':
            raise ValueError('Invalid registered video path')
        if path.stat().st_size != asset['bytes'] or digest(path) != asset['sha256']:
            raise ValueError(f"Video differs from manifest: {entry['clip_id']}")
        rows.append({
            'clip_id': entry['clip_id'],
            'source_path': path.relative_to(ROOT).as_posix(),
            'bytes': asset['bytes'], 'sha256': asset['sha256'],
            'key': f"{PREFIX}/{entry['local_id']}/{asset['sha256']}/video.mp4",
            'source_url': entry['source']['url'],
        })
    return rows


def aws(args, *command):
    process = subprocess.run(
        ['aws', *command, '--profile', args.profile, '--region', 'us-east-1',
         '--output', 'json', '--no-cli-pager'],
        capture_output=True, text=True, encoding='utf-8', timeout=900,
    )
    if process.returncode:
        raise RuntimeError(process.stderr.strip())
    return json.loads(process.stdout or '{}')


def ensure_object(args, account, path, key, sha256, content_type, existing):
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode('ascii')
    if key not in existing:
        aws(args, 's3api', 'put-object', '--bucket', args.bucket, '--key', key,
            '--body', str(path), '--expected-bucket-owner', account,
            '--content-type', content_type, '--checksum-algorithm', 'SHA256',
            '--checksum-sha256', checksum, '--if-none-match', '*',
            '--metadata', f'sha256={sha256}')
    head = aws(args, 's3api', 'head-object', '--bucket', args.bucket,
               '--key', key, '--expected-bucket-owner', account,
               '--checksum-mode', 'ENABLED')
    if (head.get('ContentLength') != path.stat().st_size
            or head.get('ChecksumSHA256') != checksum
            or head.get('Metadata', {}).get('sha256') != sha256):
        raise ValueError(f'S3 object verification failed; object was not overwritten: {key}')
    return {'key': key, 'bytes': head['ContentLength'], 'sha256': sha256,
            'checksum_verified': True, 'encryption': head.get('ServerSideEncryption'),
            'version_id': head.get('VersionId'), 'created': key not in existing}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', default='nba')
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--upload', action='store_true')
    parser.add_argument('--report', type=Path,
                        default=ROOT / 'tmp/aws-training-upload/report.json')
    args = parser.parse_args()
    rows = local_plan()  # Validate every local file before any cloud mutation.
    if not args.upload:
        print(json.dumps({'mode': 'plan', 'entries': rows}, ensure_ascii=False, indent=2))
        return
    identity = aws(args, 'sts', 'get-caller-identity')
    account = identity['Account']
    if ':assumed-role/NBAHackathonParticipantRole/' not in identity['Arn']:
        raise ValueError('Use the team participant profile (nba), not the shared SSO account')
    if args.bucket != f'nba-hackathon-{account}-team25':
        raise ValueError('Bucket must be the verified Team25 bucket in the active account')
    location = aws(args, 's3api', 'get-bucket-location', '--bucket', args.bucket,
                   '--expected-bucket-owner', account)
    if location.get('LocationConstraint') not in (None, 'us-east-1'):
        raise ValueError('The contest bucket must be in us-east-1')
    access = aws(args, 's3api', 'get-public-access-block', '--bucket', args.bucket,
                 '--expected-bucket-owner', account)['PublicAccessBlockConfiguration']
    if not all(access.get(key) for key in (
            'BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets')):
        raise ValueError('The target bucket must keep all four public-access blocks enabled')
    listing = aws(args, 's3api', 'list-objects-v2', '--bucket', args.bucket,
                  '--prefix', PREFIX + '/', '--expected-bucket-owner', account)
    existing = {entry['Key'] for entry in listing.get('Contents', [])}
    report = {'checked_at': datetime.now(timezone.utc).isoformat(),
              'bucket': args.bucket, 'region': 'us-east-1', 'objects': []}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    for row in rows:
        print(f"Uploading/verifying {row['clip_id']} ({row['bytes']} bytes)", flush=True)
        verified = ensure_object(args, account, ROOT / row['source_path'], row['key'],
                                 row['sha256'], 'video/mp4', existing)
        report['objects'].append(verified)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(f"Verified SHA-256: {row['clip_id']}", flush=True)
    # No account IDs, secrets, or local absolute paths inside the dataset manifest.
    with tempfile.TemporaryDirectory(prefix='training-s3-') as directory:
        path = Path(directory) / 'manifest.json'
        path.write_text(json.dumps({'dataset_id': 'broadcastcode-training-20261005',
                                   'entries': rows}, ensure_ascii=False, indent=2) + '\n',
                        encoding='utf-8')
        sha256 = digest(path)
        key = f'{PREFIX}/manifests/{sha256}.json'
        report['manifest'] = ensure_object(args, account, path, key, sha256,
                                          'application/json', existing)
    report['completed_at'] = datetime.now(timezone.utc).isoformat()
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Verified {len(rows)} videos and the manifest. Report: {args.report}')


if __name__ == '__main__':
    main()
