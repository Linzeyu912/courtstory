"""Package the current workbench for an existing deployment; never create resources.

Run from the repository root. --output must be a fresh directory below tmp/.
Only --upload uses AWS; local packaging does not require boto3 or credentials.
The existing deployment config, access code, AgentCore package and videos stay intact.
"""
import argparse
import ast
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CODE_PREFIXES = ('engineering/scripts/', 'engineering/configs/',
                 'engineering/tools/player-review/', 'engineering/tools/tactical-overlay/', 'engineering/tools/commentary-preview/',
                 'engineering/archive/tactical-video/005-authored-v2/', '2K Player Data/', 'data/player-rosters/')
REPLAY_PREFIXES = ('research/agents/qwen-ground-official-20261005/replay/',
                   'research/agents/qwen-parallel-20261007/replay/')
PRIVATE_PARTS = {'.git', '.env', '.codex', 'node_modules', '__pycache__', 'tmp', 'artifacts'}
MEDIA_SUFFIXES = {'.mp4', '.mov', '.mkv', '.avi', '.webm'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def source_path(root, name):
    """Archive names must be ordinary repository-relative files, never links."""
    relative = PurePosixPath(name)
    if (relative.is_absolute() or '\\' in name or ':' in name or
            any(part in PRIVATE_PARTS or part == '..' or part.startswith('.env') for part in relative.parts)):
        raise ValueError('Private or unsafe release path: ' + name)
    path = root.joinpath(*relative.parts)
    if (not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or
            any(parent.is_symlink() for parent in path.parents if parent != root and parent.is_relative_to(root))):
        raise ValueError('Missing or unsafe release file: ' + name)
    return path


def existing_library(config_path, config):
    """Read the original selection without copying config or access credentials."""
    adjacent = config_path.parent / 'cloud-library.json'
    if adjacent.is_file():
        return json.loads(adjacent.read_text(encoding='utf-8'))
    archive = config_path.parent / PurePosixPath(config.get('workbenchKey', 'workbench.zip')).name
    if not archive.is_file():
        raise ValueError('Place the original workbench ZIP or cloud-library.json beside config.json')
    with zipfile.ZipFile(archive) as package:
        return json.loads(package.read('cloud-library.json'))


def validate_selection(library, previous):
    videos = previous.get('videos', [])
    samples = library.get('samples', [])
    registered = {item['path']: item for item in videos}
    if len(samples) not in (2, 3) or len(videos) != len(samples) or len(registered) != len(samples):
        raise ValueError('Expected the existing two- or three-sample deployment selection')
    if len({sample['id'] for sample in samples}) != len(samples) or library.get('defaultSample') not in {s['id'] for s in samples}:
        raise ValueError('Invalid existing sample IDs or default sample')
    if {sample['video'] for sample in samples} != set(registered):
        raise ValueError('Library selection differs from the previous release manifest')
    for sample in samples:
        video = registered[sample['video']]
        if sample['videoSha256'] != video['sha256'] or not re.fullmatch('[a-f0-9]{64}', video['sha256']):
            raise ValueError('Existing library and video digests differ')
    return videos


def add_references(root, files, value):
    if isinstance(value, dict):
        if isinstance(value.get('tracks'), str):
            sidecar = value.get('metadata', str(PurePosixPath(value['tracks']).with_suffix('.meta.json')))
            if (root / sidecar).is_file():
                files.add(sidecar)
        for child in value.values():
            add_references(root, files, child)
    elif isinstance(value, list):
        for child in value:
            add_references(root, files, child)
    elif isinstance(value, str) and not value.startswith(('http:', 'https:')):
        if (root / value).is_file() and PurePosixPath(value).suffix.lower() not in MEDIA_SUFFIXES:
            files.add(value)


def dependency_closure(root, files):
    """Include new local Python/JS imports even when their files are not tracked yet."""
    pending = list(files)
    visited = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        path = source_path(root, name)
        candidates = []
        if path.suffix == '.py':
            tree = ast.parse(path.read_text(encoding='utf-8-sig'), filename=name)
            modules = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    modules.extend(alias.name.split('.')[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    modules.append(node.module.split('.')[0])
            for module in modules:
                for directory in (path.parent, root / 'engineering/scripts'):
                    candidates.extend((directory / (module + '.py'), directory / module / '__init__.py'))
        elif path.suffix in {'.mjs', '.js', '.jsx'}:
            text = path.read_text(encoding='utf-8-sig')
            for _, specifier in re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])([^"']+)\1''', text):
                if specifier.startswith('.'):
                    candidates.append(path.parent / specifier)
        for candidate in candidates:
            if not candidate.is_file():
                continue
            resolved = candidate.resolve()
            if not resolved.is_relative_to(root.resolve()):
                raise ValueError('Dependency outside repository: ' + name)
            relative = resolved.relative_to(root.resolve()).as_posix()
            source_path(root, relative)
            if relative not in files:
                files.add(relative)
                pending.append(relative)
    return files


def collect_files(root, library, previous):
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf-8').split('\0')
    files = {name for name in tracked if name and
             (name.startswith(CODE_PREFIXES) or name == 'engineering/requirements-review.txt') and
             PurePosixPath(name).suffix.lower() not in MEDIA_SUFFIXES}
    files.update(name for name in tracked if name.startswith(REPLAY_PREFIXES) and name.endswith('.json'))
    files.add('engineering/scripts/cloud_tactics_agent.py')
    files.add('engineering/scripts/cloud_gpu.py')
    files.update(path.relative_to(root).as_posix() for path in (root / 'engineering/infra/ec2-workbench').iterdir()
                 if path.suffix in {'.py', '.sh', '.json'})
    # Keep all original registered sample sidecars, including implicit metadata files.
    files.update(item['path'] for item in previous['files']
                 if item['path'].startswith(('data/videos/', 'research/')) and
                 PurePosixPath(item['path']).suffix.lower() not in MEDIA_SUFFIXES)
    add_references(root, files, library)
    return dependency_closure(root, files)


def build_release(config_path, output, root=ROOT):
    root, config_path, output = root.resolve(), config_path.resolve(), output.resolve()
    if not output.is_relative_to(root / 'tmp') or output == root / 'tmp':
        raise ValueError('Output must be a fresh subdirectory of repository tmp/')
    if output.exists():
        raise ValueError('Output already exists; use a fresh directory to preserve release evidence')
    config = json.loads(config_path.read_text(encoding='utf-8'))
    previous = json.loads((config_path.parent / 'release-manifest.json').read_text(encoding='utf-8'))
    library = existing_library(config_path, config)
    videos = validate_selection(library, previous)
    prefix = config['prefix'].rstrip('/')
    if not re.fullmatch(r'workbench/deployments/[A-Za-z0-9_-]+', prefix):
        raise ValueError('Expected the existing dedicated deployment prefix')
    files = collect_files(root, library, previous)
    moment = datetime.now(timezone(timedelta(hours=8)))
    release = moment.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=root))
    key = prefix + '/release/' + release + '/workbench.zip'
    generated = {'cloud-library.json': json_bytes(library),
                 'cloud-release.json': json_bytes({'release': release, 'baseRelease': config['release'],
                                                  'gitHead': head, 'videos': videos})}
    output.mkdir(parents=True)
    archive_path = output / 'workbench.zip'
    hashes = []
    with zipfile.ZipFile(archive_path, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            # Hash the exact bytes put in the archive, even if another session edits later.
            content = source_path(root, name).read_bytes()
            archive.writestr(name, content)
            hashes.append({'path': name, 'sha256': digest(content), 'bytes': len(content)})
        for name, content in generated.items():
            archive.writestr(name, content)
            hashes.append({'path': name, 'sha256': digest(content), 'bytes': len(content)})
    manifest = {'release': release, 'baseRelease': config['release'], 'createdAt': moment.isoformat(),
                'gitHead': head, 'workingTreeDirty': dirty, 'files': hashes, 'videos': videos,
                'workbenchKey': key, 'workbenchSha256': digest(archive_path.read_bytes()),
                'workbenchBytes': archive_path.stat().st_size, 'uploadVerified': False}
    (output / 'release-manifest.json').write_bytes(json_bytes(manifest))
    (output / 'cloud-library.json').write_bytes(generated['cloud-library.json'])
    return config, manifest


def upload_release(config, output, manifest):
    import boto3

    session = boto3.Session(profile_name='nba', region_name='us-east-1')
    identity = session.client('sts').get_caller_identity()
    if identity['Account'] != config['account'] or '/NBAHackathonParticipantRole/' not in identity['Arn']:
        raise ValueError('Expected the existing deployment account and contest participant role')
    s3 = session.client('s3')
    if not all(s3.get_public_access_block(Bucket=config['bucket'])['PublicAccessBlockConfiguration'].values()):
        raise ValueError('The existing team bucket must remain private')
    path = output / 'workbench.zip'
    if digest(path.read_bytes()) != manifest['workbenchSha256']:
        raise ValueError('Local release archive changed before upload')
    # One conditional PUT preserves immutability; managed transfers do not expose IfNoneMatch.
    if path.stat().st_size > 512 * 1024 * 1024:
        raise ValueError('Workbench source archive unexpectedly exceeds 512 MiB')
    with path.open('rb') as stream:
        s3.put_object(Bucket=config['bucket'], Key=manifest['workbenchKey'], Body=stream,
                      IfNoneMatch='*', ServerSideEncryption='AES256', ContentType='application/zip',
                      Metadata={'sha256': manifest['workbenchSha256'], 'git-head': manifest['gitHead']})
    metadata = s3.head_object(Bucket=config['bucket'], Key=manifest['workbenchKey'])
    if (metadata['ContentLength'] != manifest['workbenchBytes'] or
            metadata.get('Metadata', {}).get('sha256') != manifest['workbenchSha256']):
        raise ValueError('Uploaded archive metadata differs')
    received = hashlib.sha256()
    with s3.get_object(Bucket=config['bucket'], Key=manifest['workbenchKey'])['Body'] as stream:
        while chunk := stream.read(1024 * 1024):
            received.update(chunk)
    if received.hexdigest() != manifest['workbenchSha256']:
        raise ValueError('Uploaded archive readback SHA-256 differs')
    manifest['uploadVerified'] = True
    (output / 'release-manifest.json').write_bytes(json_bytes(manifest))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True, help='Existing deployment config.json')
    parser.add_argument('--output', type=Path, required=True, help='Fresh repository tmp/ subdirectory')
    parser.add_argument('--upload', action='store_true', help='Upload only the workbench ZIP and verify its bytes')
    args = parser.parse_args()
    config, manifest = build_release(args.config, args.output)
    if args.upload:
        upload_release(config, args.output.resolve(), manifest)
    print(json.dumps({key: manifest[key] for key in ('release', 'gitHead', 'workingTreeDirty',
                                                   'workbenchBytes', 'workbenchSha256', 'uploadVerified')} |
                     {'files': len(manifest['files']), 'videos': len(manifest['videos'])}))


if __name__ == '__main__':
    main()
