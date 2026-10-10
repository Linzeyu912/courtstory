"""Package pinned vision inputs and a one-time notebook verifier for CDK."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import uuid
import zipfile

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[3]
INFRA = Path(__file__).resolve().parent
WEIGHTS = {
    'tmp/models/BODD_yolov8n_0001.pt': 'dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641',
    'tmp/models/yolov8s.pt': '1f47a78bf100391c2a140b7ac73a1caae18c32779be7d310658112f7ac9aa78a',
    'tmp/court-models-v2/best.pt': '68e5faf5fb5388cf83477238abe22e9824a69fb33a4cf34f79ab61858f410064',
}
FIXTURE = 'data/videos/nba/2024-25/clips/005_LAL-MIN_Q2_catch-shoot_10.8s_720p.mp4'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expected-account', required=True)
    parser.add_argument('--profile', default='nba')
    parser.add_argument('--notebook-name', required=True)
    parser.add_argument('--stack-name', default='CourtStoryVisionGpu')
    parser.add_argument('--instance-type', choices=['ml.g5.xlarge','ml.g5.2xlarge'], default='ml.g5.2xlarge')
    parser.add_argument('--upload', action='store_true')
    args = parser.parse_args()
    out = args.output.resolve()
    if not out.is_relative_to(ROOT/'tmp'):
        raise ValueError('Private deployment output must be inside the ignored repository tmp directory.')
    out.mkdir(parents=True, exist_ok=False)
    session = boto3.Session(profile_name=args.profile, region_name='us-east-1')
    config = Config(connect_timeout=10,read_timeout=60,retries={'total_max_attempts':3,'mode':'standard'})
    account = session.client('sts',config=config).get_caller_identity()['Account']
    if account != args.expected_account:
        raise RuntimeError('AWS account differs from the explicitly supplied expected account.')
    for name, expected in WEIGHTS.items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest() != expected:
            raise ValueError('Pinned model checksum mismatch: '+name)
    tracked = subprocess.check_output(['git','ls-files','--','engineering/scripts','engineering/configs/tracking'],cwd=ROOT,text=True).splitlines()
    files = [p for p in tracked if Path(p).suffix in {'.py','.yaml','.json'}]+list(WEIGHTS)+[FIXTURE]
    manifest = {'git_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'files':[]}
    bundle = out/'vision-bundle.zip'
    with zipfile.ZipFile(bundle,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as archive:
        for name in files:
            content = (ROOT/name).read_bytes()
            if b'sk-or-v1-' in content:
                raise ValueError('Credential-like text found in selected input.')
            if name == FIXTURE and content.startswith(b'version https://git-lfs.github.com/spec/v1'):
                raise ValueError('Fetch the actual LFS video before packaging.')
            archive.writestr(name,content)
            manifest['files'].append({'path':name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
    manifest['bundle_sha256'] = hashlib.sha256(bundle.read_bytes()).hexdigest()
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    bootstrap = out/'bootstrap.zip'
    with zipfile.ZipFile(bootstrap,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for name in ['bootstrap.py','vision_smoke.py']:
            archive.write(INFRA/name,name)
        archive.write(out/'manifest.json','manifest.json')
        for package in ['rsa','pyasn1']:
            package_root = Path(importlib.util.find_spec(package).origin).parent
            for source in package_root.rglob('*.py'):
                archive.write(source,'vendor/'+package+'/'+source.relative_to(package_root).as_posix())
    meta = {'account':account,'region':'us-east-1','stack_name':args.stack_name,'notebook_name':args.notebook_name,
            'instance_type':args.instance_type,'bucket':f'nba-hackathon-{account}-team25',
            'prefix':'workspace/gpu-setup/'+uuid.uuid4().hex+'/',
            'bootstrap_sha256':hashlib.sha256(bootstrap.read_bytes()).hexdigest()}
    (out/'deploy-private.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    if args.upload:
        s3 = session.client('s3',config=config)
        for file in [bundle,bootstrap]:
            s3.upload_file(str(file),meta['bucket'],meta['prefix']+file.name,
                           ExtraArgs={'ServerSideEncryption':'AES256'})
    print(json.dumps({'source_files':len(files),'bundle_bytes':bundle.stat().st_size,'uploaded':args.upload}))


if __name__ == '__main__':
    main()
