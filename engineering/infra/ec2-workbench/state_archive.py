"""Offline, credential-free workbench state archives (Python standard library only).

snapshot(root, output), verify(archive, target=None), and restore(archive, target)
return the manifest. Restore requires a new or empty directory; deploy code
separately and merge only the verified state paths before starting the service.
File contents, including historical absolute references, are preserved verbatim.
The archive proves byte integrity, not authenticity or application-level validity.
Snapshots reject detected concurrent changes; an idle service is recommended.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import stat
import sys
import zipfile


FORMAT = 'hks-workbench-state'
VERSION = 1
MANIFEST = 'manifest.json'
STATE_DIRECTORIES = ('data/local-workbench', 'data/local-videos',
                     'artifacts/cloud-imports', 'artifacts/cloud-trims')
STATE_FILES = ('cloud-library.json', 'artifacts/cloud-state.json')
STATE_SUFFIXES = {'.json', '.mp4', '.jpg', '.png', '.srt', '.wav'}
UPLOAD_SUFFIXES = {'.mp4', '.mov', '.mkv', '.webm', '.avi'}
BLOCKED_PARTS = {'node_modules', '__pycache__', 'sdkcache', 'sdk-cache', 'code'}
BLOCKED_NAMES = {'auth.json', 'gateway.json', 'runtime.env', 'credentials',
                 'credentials.json', 'cookies.json', 'cookie.json', 'access-code.txt',
                 'rendering.mp4'}
CHUNK_SIZE = 1024 * 1024
MAX_MANIFEST_SIZE = 16 * 1024 * 1024


def _safe_name(name):
    if not isinstance(name, str) or not name or '\\' in name:
        raise ValueError('Invalid archive path')
    parts = name.split('/')
    if any(not p or p in ('.', '..') or p.endswith((' ', '.'))
           or re.search(r'[<>:"|?*\x00-\x1f\x7f]', p)
           or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', p)
           for p in parts):
        raise ValueError('Unsafe archive path: ' + name)
    if PurePosixPath(name).is_absolute():
        raise ValueError('Absolute archive path')
    return parts


def _blocked(parts):
    return any(p.startswith('.') or p.casefold() in BLOCKED_PARTS for p in parts) or parts[-1].casefold() in BLOCKED_NAMES


def is_allowed(path: str) -> bool:
    """Whether a canonical repository-relative POSIX file path is state."""
    try:
        parts = _safe_name(path)
    except ValueError:
        return False
    if _blocked(parts):
        return False
    if path in STATE_FILES:
        return True
    suffix = PurePosixPath(path).suffix.lower()
    return any(path.startswith(base + '/') for base in STATE_DIRECTORIES) and (
        suffix in STATE_SUFFIXES or path.startswith('data/local-videos/') and suffix in UPLOAD_SUFFIXES)


def _linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def _root(value):
    root = Path(value).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Workspace root must be a directory')
    return root


def _walk_error(error):
    raise error  # An unreadable state subtree must not silently vanish from a backup.


def state_files(root: Path | str) -> list[Path]:
    """Enumerate allowed regular files without following links or cache trees."""
    root = _root(root)
    result = []
    for name in STATE_FILES:
        path = root / name
        if path.exists() and not _linked(path) and not any(_linked(p) for p in path.parents if p != root and p.is_relative_to(root)):
            if stat.S_ISREG(path.stat().st_mode):
                result.append(path)
    for name in STATE_DIRECTORIES:
        directory = root / name
        if not directory.is_dir() or _linked(directory) or any(_linked(p) for p in directory.parents if p != root and p.is_relative_to(root)):
            continue
        for parent, dirs, files in os.walk(directory, followlinks=False, onerror=_walk_error):
            parent = Path(parent)
            dirs[:] = sorted(d for d in dirs if not _linked(parent / d)
                             and not _blocked((parent / d).relative_to(root).parts))
            for filename in files:
                path = parent / filename
                if is_allowed(path.relative_to(root).as_posix()) and not _linked(path) and stat.S_ISREG(path.stat().st_mode):
                    result.append(path)
    return sorted(result, key=lambda p: p.relative_to(root).as_posix())


def _stamp(value):
    # Python 3.12 on Windows can report birth time in stat().st_ctime_ns but
    # change time in fstat().st_ctime_ns. Use its explicit, consistent birth time;
    # Linux retains ctime as an additional change detector alongside mtime.
    change = getattr(value, 'st_birthtime_ns', value.st_ctime_ns) if os.name == 'nt' else value.st_ctime_ns
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, change)


def _inventory(root):
    return {path.relative_to(root).as_posix(): _stamp(path.lstat()) for path in state_files(root)}


def _copy_hash(source, target=None):
    digest, size = hashlib.sha256(), 0
    while chunk := source.read(CHUNK_SIZE):
        digest.update(chunk)
        size += len(chunk)
        if target is not None:
            target.write(chunk)
    return size, digest.hexdigest()


def snapshot(root: Path | str, output: Path | str) -> dict:
    """Create a fresh ZIP; fail and remove it if any selected state changes."""
    root, output = _root(root), Path(output)
    before = _inventory(root)
    if not before:
        raise ValueError('No allowed workspace state files found')
    folded = [name.casefold() for name in before]
    if len(folded) != len(set(folded)):
        raise ValueError('Case-colliding state paths cannot be restored portably')
    manifest = {'format': FORMAT, 'version': VERSION, 'sourceRoot': str(root),
                'createdAt': datetime.now(timezone.utc).isoformat(), 'files': []}
    # Exclusive creation never replaces a previous recovery artifact.
    with output.open('xb') as destination:
        try:
            with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for name, expected in before.items():
                    path = root / name
                    if _linked(path) or _stamp(path.lstat()) != expected:
                        raise ValueError('State changed before reading: ' + name)
                    with path.open('rb') as source:
                        if _stamp(os.fstat(source.fileno())) != expected:
                            raise ValueError('State replaced before reading: ' + name)
                        with archive.open(name, 'w', force_zip64=True) as entry:
                            size, sha = _copy_hash(source, entry)
                        if _stamp(os.fstat(source.fileno())) != expected:
                            raise ValueError('State changed while reading: ' + name)
                    if _linked(path) or _stamp(path.lstat()) != expected or size != expected[2]:
                        raise ValueError('State changed while reading: ' + name)
                    manifest['files'].append({'path': name, 'size': size, 'sha256': sha})
                if _inventory(root) != before:
                    raise ValueError('Workspace state changed during snapshot (files added, removed, or modified)')
                archive.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8'))
        except BaseException:
            destination.close()
            output.unlink()
            raise
    return manifest


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate manifest field: ' + key)
        result[key] = value
    return result


def _validate(archive):
    infos = archive.infolist()
    names = [item.filename for item in infos]
    if len(names) != len(set(name.casefold() for name in names)):
        raise ValueError('Duplicate or case-colliding ZIP entries')
    folded_names = {name.casefold() for name in names}
    for item in infos:
        parts = _safe_name(item.orig_filename)
        if item.orig_filename != item.filename:
            raise ValueError('Noncanonical ZIP entry name')
        if any('/'.join(parts[:length]).casefold() in folded_names for length in range(1, len(parts))):
            raise ValueError('ZIP file and directory paths collide')
        file_type = stat.S_IFMT(item.external_attr >> 16)
        if item.is_dir() or item.external_attr & 0x10 or file_type not in (0, stat.S_IFREG):
            raise ValueError('ZIP links and non-regular entries are forbidden')
        if item.flag_bits & 1:
            raise ValueError('Encrypted ZIP entries are unsupported')
        if item.filename != MANIFEST and not is_allowed(item.filename):
            raise ValueError('ZIP entry is outside the state allowlist: ' + item.filename)
    if MANIFEST not in names or archive.getinfo(MANIFEST).file_size > MAX_MANIFEST_SIZE:
        raise ValueError('Missing or oversized state manifest')
    manifest = json.loads(archive.read(MANIFEST), object_pairs_hook=_unique_object)
    if not isinstance(manifest, dict) or set(manifest) != {'format', 'version', 'sourceRoot', 'createdAt', 'files'}:
        raise ValueError('Invalid state manifest fields')
    if manifest['format'] != FORMAT or type(manifest['version']) is not int or manifest['version'] != VERSION:
        raise ValueError('Unsupported state archive format')
    if not isinstance(manifest['createdAt'], str) or not isinstance(manifest['files'], list) or not manifest['files']:
        raise ValueError('Invalid state manifest')
    source_root = manifest['sourceRoot']
    if not isinstance(source_root, str) or re.search(r'[\x00-\x1f]', source_root) or not (
            PurePosixPath(source_root).is_absolute() or PureWindowsPath(source_root).is_absolute()):
        raise ValueError('Invalid original workspace root')
    expected = {}
    for item in manifest['files']:
        if not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'}:
            raise ValueError('Invalid manifest file entry')
        name = item['path']
        if not is_allowed(name) or name.casefold() in expected:
            raise ValueError('Invalid or duplicate manifest path')
        if type(item['size']) is not int or item['size'] < 0 or not isinstance(item['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', item['sha256']):
            raise ValueError('Invalid manifest size or SHA-256')
        expected[name.casefold()] = item
    if set(names) != {MANIFEST, *(item['path'] for item in expected.values())}:
        raise ValueError('ZIP contents differ from the manifest')
    for item in manifest['files']:
        if archive.getinfo(item['path']).file_size != item['size']:
            raise ValueError('ZIP size differs from the manifest: ' + item['path'])
        with archive.open(item['path']) as source:
            size, sha = _copy_hash(source)
        if size != item['size'] or sha != item['sha256']:
            raise ValueError('ZIP content differs from the manifest: ' + item['path'])
    return manifest


def verify(archive: Path | str, target: Path | str | None = None) -> dict:
    """Verify every archived byte; optionally also compare the restored state."""
    with zipfile.ZipFile(archive) as source:
        manifest = _validate(source)
    if target is not None:
        root = _root(target)
        before = _inventory(root)
        if set(before) != {item['path'] for item in manifest['files']}:
            raise ValueError('Restored state file list differs from the archive')
        for item in manifest['files']:
            with (root / item['path']).open('rb') as source:
                size, sha = _copy_hash(source)
            if (size, sha) != (item['size'], item['sha256']):
                raise ValueError('Restored state differs from archive: ' + item['path'])
        if _inventory(root) != before:
            raise ValueError('Restored state changed during verification')
    return manifest


def _empty_target(target):
    if _linked(target) or target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ValueError('Restore target must be a new or empty non-symlink directory')


def restore(archive: Path | str, target: Path | str) -> dict:
    """Fully validate the ZIP before creating any state file in an empty target."""
    target = Path(target)
    _empty_target(target)
    with Path(archive).open('rb') as raw, zipfile.ZipFile(raw) as source:
        before = _stamp(os.fstat(raw.fileno()))
        manifest = _validate(source)
        if _stamp(os.fstat(raw.fileno())) != before:
            raise ValueError('State archive changed during verification')
        _empty_target(target)
        target.mkdir(parents=True, exist_ok=True)
        root = target.resolve(strict=True)
        for item in manifest['files']:
            path = root / item['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.resolve().is_relative_to(root) or any(_linked(p) for p in path.parents if p != root and p.is_relative_to(root)):
                raise ValueError('Restore encountered a linked destination directory')
            with source.open(item['path']) as incoming, path.open('xb') as outgoing:
                size, sha = _copy_hash(incoming, outgoing)
            if (size, sha) != (item['size'], item['sha256']):
                raise ValueError('Archive changed during restoration; discard this staged directory')
        if _stamp(os.fstat(raw.fileno())) != before:
            raise ValueError('Archive changed during restoration; discard this staged directory')
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('snapshot')
    create.add_argument('--root', required=True, type=Path)
    create.add_argument('--output', required=True, type=Path)
    check = commands.add_parser('verify')
    check.add_argument('--archive', required=True, type=Path)
    check.add_argument('--target', type=Path)
    recover = commands.add_parser('restore')
    recover.add_argument('--archive', required=True, type=Path)
    recover.add_argument('--target', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        manifest = snapshot(args.root, args.output) if args.command == 'snapshot' else (
            restore(args.archive, args.target) if args.command == 'restore' else verify(args.archive, args.target))
        print(json.dumps({'operation': args.command, 'verified': True, 'files': len(manifest['files']),
                          'bytes': sum(item['size'] for item in manifest['files'])}, ensure_ascii=False))
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print('State archive failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
