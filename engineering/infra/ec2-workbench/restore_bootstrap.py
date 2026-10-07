"""Install a verified state archive into a newly unpacked, unused release."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile

from state_archive import restore, verify
from relocate_state import relocate


def install_state(archive, target):
    target = Path(target).resolve(strict=True)
    if not (target / 'cloud-release.json').is_file():
        raise ValueError('Target must be a newly unpacked workbench release')
    manifest = verify(archive)
    for name in ['data/local-workbench', 'data/local-videos',
                 'artifacts/cloud-imports', 'artifacts/cloud-trims']:
        path = target / name
        if path.exists() or path.is_symlink():
            raise ValueError('Refusing existing mutable state: ' + name)
    for entry in manifest['files']:
        destination = target / entry['path']
        for part in [destination, *destination.parents]:
            if part == target:
                break
            if part.is_symlink() or getattr(part, 'is_junction', lambda: False)():
                raise ValueError('State destination contains a link')
        if not destination.resolve().is_relative_to(target):
            raise ValueError('State destination escapes release')
        if destination.exists() and entry['path'] != 'cloud-library.json':
            raise ValueError('Refusing to overwrite existing state: ' + entry['path'])
    with tempfile.TemporaryDirectory(prefix='hks-state-') as directory:
        staged = Path(directory) / 'state'
        restore(archive, staged)
        changes = relocate(staged, manifest['sourceRoot'], str(target), apply=True)
        for entry in manifest['files']:
            destination = target / entry['path']
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(staged / entry['path'], destination)
    return {'restoredFiles': len(manifest['files']), 'relocation': changes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--target', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(install_state(args.archive, args.target), ensure_ascii=False))


if __name__ == '__main__':
    main()
