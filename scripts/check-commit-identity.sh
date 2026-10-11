#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"
. "$repo_root/.githooks/identity-policy.sh"
check_revision_identity "${1:-HEAD}"
printf '%s\n' "Commit identities match $expected_identity."
