#!/usr/bin/env python3
"""Extract pinned, unchanged source slices for reading; not standalone modules."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMMITS = {
    'opencode': '907b3bc518fa48e90e8ec24dd327d13eee71c36c',
    'codex': '7f892275e31002f0422477c6219189284560e689',
    'hub': '42a1d60999b711dc09acc06db7edfdcf4c396b09',
}
# name, repository-relative source, inclusive line range
SLICES = {
    'opencode': [
        ('ui-file-picker', 'packages/app/src/constants/file-picker.ts', 1, 79),
        ('ui-attachment-mime', 'packages/app/src/components/prompt-input/files.ts', 39, 98),
        ('cli-file-entry', 'packages/opencode/src/cli/cmd/run.ts', 356, 415),
        ('prompt-file-ingest', 'packages/opencode/src/session/prompt.ts', 947, 971),
        ('message-file-lowering', 'packages/opencode/src/session/message-v2.ts', 203, 235),
        ('media-scope', 'packages/opencode/src/util/media.ts', 1, 26),
        ('read-media', 'packages/opencode/src/tool/read.ts', 300, 329),
        ('modality-gate', 'packages/opencode/src/provider/transform.ts', 408, 445),
        ('modality-definition', 'packages/opencode/src/provider/transform.ts', 1, 16),
        ('model-capabilities', 'packages/opencode/src/provider/provider.ts', 1339, 1360),
        ('runtime-selection', 'packages/opencode/src/session/llm.ts', 224, 285),
        ('native-file-lowering', 'packages/opencode/src/session/llm/native-request.ts', 55, 65),
        ('v2-file-schema', 'packages/schema/src/prompt.ts', 12, 34),
        ('v2-file-lowering', 'packages/core/src/session/runner/to-llm-message.ts', 1, 22),
        ('v2-user-message', 'packages/core/src/session/runner/to-llm-message.ts', 115, 131),
        ('v2-read-tool', 'packages/core/src/tool/read.ts', 16, 111),
        ('image-normalization', 'packages/core/src/image.ts', 56, 76),
        ('llm-media-schema', 'packages/llm/src/schema/messages.ts', 26, 45),
        ('llm-media-validation', 'packages/llm/src/protocols/shared.ts', 158, 209),
        ('gemini-media', 'packages/llm/src/protocols/gemini.ts', 181, 285),
        ('gemini-body-schema', 'packages/llm/src/protocols/gemini.ts', 27, 71),
        ('responses-media', 'packages/llm/src/protocols/openai-responses.ts', 307, 321),
    ],
    'codex': [
        ('user-input', 'codex-rs/protocol/src/user_input.rs', 1, 71),
        ('content-types', 'codex-rs/protocol/src/models.rs', 875, 938),
        ('model-modalities', 'codex-rs/protocol/src/openai_models.rs', 170, 193),
        ('exec-image-input', 'codex-rs/exec/src/lib.rs', 985, 1009),
        ('local-image-serialization', 'codex-rs/protocol/src/models.rs', 1999, 2084),
        ('image-processing-modes', 'codex-rs/utils/image/src/lib.rs', 24, 83),
        ('image-budget', 'codex-rs/core/src/image_preparation.rs', 378, 425),
        ('history-preparation', 'codex-rs/core/src/session/mod.rs', 3323, 3364),
        ('local-input-defer', 'codex-rs/core/src/session/mod.rs', 3399, 3414),
        ('view-image-input', 'codex-rs/core/src/tools/handlers/view_image.rs', 94, 216),
        ('view-image-output', 'codex-rs/core/src/tools/handlers/view_image.rs', 221, 268),
        ('mcp-multimodal-result', 'codex-rs/protocol/src/models.rs', 2352, 2440),
        ('responses-input', 'codex-rs/codex-api/src/common.rs', 279, 300),
    ],
    'hub': [
        ('vision-provider', 'engineering/scripts/vision_provider.py', 1, 62),
        ('codex-cli-command', 'engineering/scripts/tactics_agent.py', 171, 192),
        ('tactics-frame-sampling', 'engineering/scripts/tactics_agent.py', 254, 262),
        ('tactics-input-pack', 'engineering/scripts/tactics_agent.py', 306, 341),
        ('identity-frame-sampling', 'engineering/scripts/identity_agent.py', 60, 63),
        ('identity-evidence-crop', 'engineering/scripts/identity_agent.py', 170, 201),
        ('identity-scan', 'engineering/scripts/identity_agent.py', 343, 373),
        ('frame-decoder-entry', 'engineering/scripts/tactical_workbench.py', 106, 133),
    ],
    'sdk-google': [
        ('google-file-conversion', 'src/convert-to-google-generative-ai-messages.ts', 194, 234),
        ('google-content-types', 'src/google-generative-ai-prompt.ts', 24, 69),
        ('google-supported-urls', 'src/google-provider.ts', 165, 184),
    ],
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream-root', type=Path, required=True)
    parser.add_argument('--hub-root', type=Path, default=ROOT.parents[2])
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    records = []
    for name, slices in SLICES.items():
        source = args.hub_root if name == 'hub' else args.upstream_root / name
        if name == 'sdk-google':
            source /= 'package'
            assert json.loads((source / 'package.json').read_text())['version'] == '3.0.73'
            ref = '@ai-sdk/google@3.0.73'
        else:
            ref = COMMITS[name]
            # The hub may have moved ahead; always extract from the recorded commit.
            subprocess.run(['git', '-C', str(source), 'cat-file', '-e', ref + '^{commit}'], check=True)
        repo_url = {'opencode': 'https://github.com/anomalyco/opencode',
                    'codex': 'https://github.com/openai/codex',
                    'hub': 'https://github.com/Linzeyu912/broadcastcode-team-hub',
                    'sdk-google': 'https://registry.npmjs.org/@ai-sdk/google/-/google-3.0.73.tgz'}[name]
        for key, path, start, end in slices:
            data = (source / path).read_bytes() if name == 'sdk-google' else subprocess.check_output(
                ['git', '-C', str(source), 'show', f'{ref}:{path}'])
            lines = data.splitlines(keepends=True)
            assert 1 <= start <= end <= len(lines), (name, path, start, end, len(lines))
            excerpt = b''.join(lines[start-1:end])
            target = ROOT / 'excerpts' / name / (key + Path(path).suffix)
            if args.verify:
                assert target.read_bytes() == excerpt, str(target)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(excerpt)
            records.append(dict(repository=name, ref=ref, path=path, start_line=start, end_line=end,
                                source_sha256=sha(data), excerpt_sha256=sha(excerpt),
                                excerpt=target.relative_to(ROOT).as_posix(),
                                url=repo_url if name == 'sdk-google' else f'{repo_url}/blob/{ref}/{path}#L{start}-L{end}'))
        for filename in (['LICENSE', 'NOTICE'] if name == 'codex' else ['LICENSE'] if name != 'hub' else []):
            data = (source / filename).read_bytes() if name == 'sdk-google' else subprocess.check_output(
                ['git', '-C', str(source), 'show', f'{ref}:{filename}'])
            target = ROOT / 'licenses' / name / filename
            if args.verify:
                assert target.read_bytes() == data
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    manifest = dict(collected_date='2026-10-05', timezone='Etc/UTC',
                    kind='unmodified_source_excerpts_not_standalone_modules',
                    sdk_google_tarball_sha256=sha((args.upstream_root / 'sdk-google' / 'ai-sdk-google-3.0.73.tgz').read_bytes()),
                    sources=records)
    if args.verify:
        assert json.loads((ROOT / 'sources.json').read_text()) == manifest
    else:
        (ROOT / 'sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'mode': 'verify' if args.verify else 'extract', 'source_slices': len(records), 'status': 'passed'}))


if __name__ == '__main__':
    main()
