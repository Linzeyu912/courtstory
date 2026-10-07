"""Relocate known live manifests in a restored, state-only staging directory.

Use old_root from the verified state archive's sourceRoot. The archive itself is
never opened or changed. Deploy code separately, then move the staged state to
new_root before starting services. Metadata, tracks, hashes, drafts, render
results, and historical evidence are deliberately byte-preserved: metadata is
part of the workbench's tracking fingerprint.

relocate(root, old_root, new_root) plans without writing; apply=True rebuilds
and validates the whole plan, stages all bytes, then replaces files. Ordinary
commit failures roll back completed replacements. A crash cannot make a group
of filesystem renames atomic: discard the staging directory and restore the
original archive again after an interrupted application.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import stat
import tempfile


STATE_DIRS = ('data/local-workbench', 'data/local-videos',
              'artifacts/cloud-imports', 'artifacts/cloud-trims')
STATE_FILES = {'cloud-library.json', 'artifacts/cloud-state.json'}
SAMPLE_PATHS = ('video', 'tracks', 'alternativeTracks', 'courtProfile',
                'courtCandidates', 'feetCandidates')
VARIANT_PATHS = ('tracks', 'metadata')
BLOCKED = {'auth.json', 'gateway.json', 'runtime.env', 'credentials',
           'credentials.json', 'cookies.json', 'cookie.json', 'access-code.txt'}
JOB = r'[a-zA-Z0-9-]{1,80}'
TASK_VIDEO = re.compile(
    rf'data/local-workbench/tactics/(?:(?:agent-jobs|identity-jobs)/{JOB}/request\.json'
    rf'|ground-trajectory-jobs/(?:{JOB}/(?:source|job)\.json|sources/{JOB}\.json))')


def _linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def _path(value, *, absolute=False):
    if not isinstance(value, str) or not value or re.search(r'[\x00-\x1f\x7f]', value):
        raise ValueError('Expected a nonempty safe path string')
    windows = bool(re.match(r'^[a-zA-Z]:[\\/]', value))
    if value.startswith(('//', '\\\\')) or not windows and ('\\' in value or ':' in value):
        raise ValueError('UNC, drive-relative, and mixed path syntax are unsupported')
    path = PureWindowsPath(value) if windows else PurePosixPath(value)
    if '..' in path.parts:
        raise ValueError('Parent traversal is forbidden in state paths')
    if absolute and (not path.is_absolute() or len(path.parts) < 2):
        raise ValueError('Source and destination roots must be absolute non-root directories')
    return path


def _within(path, base):
    return type(path) is type(base) and path.is_relative_to(base)


def _staged_files(value, old_root):
    requested = Path(value).absolute()
    if any(_linked(p) for p in (requested, *requested.parents)):
        raise ValueError('Staged state root must not pass through links')
    root = requested.resolve(strict=True)
    if not root.is_dir() or _within(_path(str(root), absolute=True), old_root):
        raise ValueError('Use a separate restored staging directory, never the source workspace')
    files = []
    for parent, dirs, names in os.walk(root, followlinks=False):
        parent = Path(parent)
        for name in dirs + names:
            path = parent / name
            relative = path.relative_to(root).as_posix()
            if _linked(path) or name.startswith('.') or name.casefold() in BLOCKED:
                raise ValueError('Linked, hidden, or authentication file in staging: ' + relative)
            if path.is_dir():
                if not any(relative == base or relative.startswith(base + '/') or
                           base.startswith(relative + '/') for base in STATE_DIRS):
                    raise ValueError('Root must contain restored state only: ' + relative)
            elif not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError('Non-regular state file: ' + relative)
            elif relative not in STATE_FILES and not any(relative.startswith(base + '/') for base in STATE_DIRS):
                raise ValueError('Root must contain restored state only: ' + relative)
            else:
                files.append(path)
    return root, sorted(files)


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field: ' + key)
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError('Non-finite JSON number: ' + value)


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _plan(root, files, old_root, new_root):
    changes, planned = [], []
    for path in files:
        name = path.relative_to(root).as_posix()
        kind = ('cloud' if name == 'cloud-library.json' else
                'import' if name == 'artifacts/cloud-imports/library.json' else
                'trim' if name == 'artifacts/cloud-trims/library.json' else
                'task' if TASK_VIDEO.fullmatch(name) else None)
        if kind is None:
            continue
        before = path.read_bytes()
        value = json.loads(before.decode('utf-8-sig'), object_pairs_hook=_json_object,
                           parse_constant=_reject_constant)
        first_change = len(changes)

        def move(record, key, field):
            if key not in record or record[key] is None:
                return
            original = record[key]
            source = _path(original)
            if not source.is_absolute():
                return  # Relative repository paths already survive a root change.
            if _within(source, new_root):
                return  # An already-applied staged manifest is idempotent.
            if not _within(source, old_root):
                raise ValueError(f'External absolute path in {name}:{field}')
            relative = source.relative_to(old_root)
            if not relative.parts:
                raise ValueError(f'Expected file path in {name}:{field}')
            updated = str(new_root.joinpath(*relative.parts))
            record[key] = updated
            changes.append({'file': name, 'field': field, 'before': original, 'after': updated})

        def sample(record, field):
            if not isinstance(record, dict):
                raise ValueError('Invalid sample in ' + name)
            for key in SAMPLE_PATHS:
                move(record, key, field + '.' + key)
            variants = record.get('trackingVariants', [])
            if not isinstance(variants, list):
                raise ValueError('Invalid trackingVariants in ' + name)
            for index, variant in enumerate(variants):
                if not isinstance(variant, dict):
                    raise ValueError('Invalid tracking variant in ' + name)
                for key in VARIANT_PATHS:
                    move(variant, key, f'{field}.trackingVariants[{index}].{key}')

        if kind == 'cloud':
            if not isinstance(value, dict) or not isinstance(value.get('samples'), list):
                raise ValueError('Invalid cloud library')
            for index, item in enumerate(value['samples']):
                sample(item, f'samples[{index}]')
        elif kind == 'import':
            if not isinstance(value, dict):
                raise ValueError('Invalid imported library')
            for ident, item in value.items():
                sample(item, f'samples[{ident}]')
        elif kind == 'trim':
            if not isinstance(value, list):
                raise ValueError('Invalid trimmed library')
            for index, item in enumerate(value):
                sample(item, f'samples[{index}]')
        else:
            if not isinstance(value, dict):
                raise ValueError('Invalid task source in ' + name)
            move(value, 'video', 'video')
        if len(changes) != first_change:
            after = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
            planned.append((path, before, after))
    return changes, planned


def _apply(root, planned):
    # All parsing/validation happened before this function. Keep source bytes
    # available for rollback; the verified archive remains the crash recovery.
    with tempfile.TemporaryDirectory(prefix='.relocate-', dir=root) as directory:
        temporary = Path(directory)
        for index, (path, before, after) in enumerate(planned):
            (temporary / f'{index}.original').write_bytes(before)
            (temporary / f'{index}.updated').write_bytes(after)
            for suffix in ('original', 'updated'):
                os.chmod(temporary / f'{index}.{suffix}', stat.S_IMODE(path.stat().st_mode))
        for path, before, _ in planned:
            if any(_linked(p) for p in (path, *path.parents)) or path.read_bytes() != before:
                raise ValueError('Staged manifest changed after planning: ' + str(path))
        done = []
        try:
            for index, (path, _, _) in enumerate(planned):
                os.replace(temporary / f'{index}.updated', path)
                done.append((index, path))
        except BaseException as failure:
            rollback_errors = []
            for index, path in reversed(done):
                try:
                    os.replace(temporary / f'{index}.original', path)
                except OSError as error:
                    rollback_errors.append(error)
            if rollback_errors:
                raise RuntimeError('Rollback incomplete; discard staged state and restore the original archive') from failure
            raise


def relocate(root, old_root, new_root, apply=False):
    """Plan/apply explicit path edits only; return hashes and every edited field.

    root must contain only newly restored state, without code, credentials or
    links. old_root and new_root are explicit absolute deployment roots, may use
    POSIX or Windows syntax, and must not overlap. No files outside root are
    opened. No decoding or model calls are needed.
    """
    old_root, new_root = _path(str(old_root), absolute=True), _path(str(new_root), absolute=True)
    if _within(old_root, new_root) or _within(new_root, old_root):
        raise ValueError('Source and destination roots must be separate, non-overlapping directories')
    root, files = _staged_files(root, old_root)
    changes, planned = _plan(root, files, old_root, new_root)
    report = {'version': 1, 'root': str(root), 'oldRoot': str(old_root),
              'newRoot': str(new_root), 'applied': False, 'filesChanged': len(planned),
              'changes': changes, 'files': [
                  {'path': path.relative_to(root).as_posix(), 'beforeSha256': _hash(before),
                   'afterSha256': _hash(after)} for path, before, after in planned]}
    if apply:
        lock = root / '.relocate.lock'
        # A stale lock means an interrupted staging operation, never permission
        # to modify another operation's files. Restore into a fresh directory.
        with lock.open('x'):
            pass
        try:
            _apply(root, planned)
        finally:
            lock.unlink()
        report['applied'] = True
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path, help='Restored state-only staging directory')
    parser.add_argument('--old-root', required=True, help='Verified archive manifest.sourceRoot')
    parser.add_argument('--new-root', required=True, help='Final deployed workspace root')
    parser.add_argument('--apply', action='store_true', help='Apply the fully validated plan in staging')
    args = parser.parse_args()
    print(json.dumps(relocate(args.root, args.old_root, args.new_root, apply=args.apply),
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
