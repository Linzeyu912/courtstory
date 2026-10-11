#!/bin/sh
set -eu
replace_hooks=0
case "${1:-}" in
    '') ;;
    --replace-hooks-path) replace_hooks=1 ;;
    *) printf '%s\n' 'Usage: sh scripts/setup-git-identity.sh [--replace-hooks-path]' >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then
    printf '%s\n' 'Unexpected extra arguments.' >&2
    exit 2
fi

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"
git rev-parse --show-toplevel >/dev/null
. "$repo_root/.githooks/identity-policy.sh"

configured_hooks=$(git config --get core.hooksPath || :)
active_hooks=$(git rev-parse --path-format=absolute --git-path hooks)
if [ "$configured_hooks" != '.githooks' ] && [ "$replace_hooks" -eq 0 ]; then
    for hook_file in "$active_hooks"/*; do
        [ -f "$hook_file" ] || continue
        case "$hook_file" in *.sample) continue ;; esac
        printf '%s\n' "Existing hooks found: $active_hooks" \
            'Integrate them first, or explicitly use --replace-hooks-path. Existing files will be preserved.' >&2
        exit 1
    done
fi

for identity_section in user author committer; do
    git config --local "$identity_section.name" "$identity_name"
    git config --local "$identity_section.email" "$identity_email"
done
git config --local user.useConfigOnly true
git config --local core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
check_current_identity
printf '%s\n' "Author:    $expected_identity" "Committer: $expected_identity" \
    'Repository hooks: .githooks' 'GitHub authentication has not been changed.'
