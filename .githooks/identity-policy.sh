#!/bin/sh
# Shared author/committer policy. Authentication remains each collaborator's own.
identity_root=$(git rev-parse --show-toplevel) || return 1
identity_config="$identity_root/config/commit-identity.config"
identity_name=$(git config --file "$identity_config" --get identity.name) || return 1
identity_email=$(git config --file "$identity_config" --get identity.email) || return 1
identity_baseline=$(git config --file "$identity_config" --get identity.baseline) || return 1
expected_identity="$identity_name <$identity_email>"

identity_mismatch() {
    printf '%s\n' "Identity check rejected $1." "Required: $expected_identity" "Actual:   $2" >&2
    return 1
}

check_current_identity() {
    for identity_role in AUTHOR COMMITTER; do
        identity_value=$(git var "GIT_${identity_role}_IDENT") || return 1
        identity_value=${identity_value% *}
        identity_value=${identity_value% *}
        if [ "$identity_value" != "$expected_identity" ]; then
            identity_mismatch "$identity_role" "$identity_value"
            return 1
        fi
    done
}

check_commit_identity() {
    identity_commit=$1
    identity_author=$(git show --no-patch --no-show-signature --format='%an <%ae>' "$identity_commit") || return 1
    identity_committer=$(git show --no-patch --no-show-signature --format='%cn <%ce>' "$identity_commit") || return 1
    if [ "$identity_author" != "$expected_identity" ]; then
        identity_mismatch "AUTHOR in $identity_commit" "$identity_author"
        return 1
    fi
    if [ "$identity_committer" != "$expected_identity" ]; then
        identity_mismatch "COMMITTER in $identity_commit" "$identity_committer"
        return 1
    fi
}

check_revision_identity() {
    identity_revision=$(git rev-parse --verify --end-of-options "${1}^{commit}") || return 1
    if ! git cat-file -e "${identity_baseline}^{commit}" 2>/dev/null; then
        printf '%s\n' 'Identity baseline is missing. Fetch full history before checking.' >&2
        return 1
    fi
    identity_legacy_baseline=$(git config --file "$identity_config" --get identity.legacyBaseline) || identity_legacy_baseline=
    if [ -n "$identity_legacy_baseline" ]; then
        if ! git cat-file -e "${identity_legacy_baseline}^{commit}" 2>/dev/null; then
            printf '%s\n' 'Legacy history baseline is missing. Fetch full history before checking.' >&2
            return 1
        fi
        identity_commits=$(git rev-list "$identity_revision" "^$identity_baseline" "^$identity_legacy_baseline" --) || return 1
    else
        identity_commits=$(git rev-list "$identity_revision" "^$identity_baseline" --) || return 1
    fi
    for identity_oid in $identity_commits; do
        check_commit_identity "$identity_oid" || return 1
    done
}
