#!/usr/bin/env sh
# One-shot developer setup.
# Usage:  ./.github/scripts/setup.sh
# Works on macOS, Linux, and Git Bash / WSL on Windows.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
    printf 'ERROR: run this script from inside the repository.\n' 1>&2
    exit 1
fi
cd "$REPO_ROOT"

if [ ! -d .githooks ]; then
    printf 'ERROR: .githooks/ directory not found in %s\n' "$REPO_ROOT" 1>&2
    exit 1
fi

# 1. Tell Git to use the versioned hooks directory.
git config core.hooksPath .githooks
printf '[OK]  git config core.hooksPath = .githooks\n'

# 2. Make every hook executable. Setting the bit in the Git index preserves
#    it for other clones, but only works once the file is tracked, so we
#    guard on ls-files. First-time committer should re-run this AFTER the
#    initial `git add .githooks/` so the exec bit is stored in the tree.
for hook in .githooks/pre-commit .githooks/pre-push .githooks/commit-msg .github/scripts/doctor.sh; do
    if [ -f "$hook" ]; then
        chmod +x "$hook" 2>/dev/null || true
        if [ -n "$(git ls-files -- "$hook")" ]; then
            git update-index --chmod=+x "$hook" >/dev/null 2>&1 || true
        fi
    fi
done
printf '[OK]  hooks marked executable\n'

# 3. Sanity check: Git >= 2.9 is required for core.hooksPath.
GIT_VER="$(git --version | awk '{print $3}')"
GIT_MAJOR="$(printf '%s' "$GIT_VER" | cut -d. -f1)"
GIT_MINOR="$(printf '%s' "$GIT_VER" | cut -d. -f2)"
if [ "$GIT_MAJOR" -lt 2 ] || { [ "$GIT_MAJOR" -eq 2 ] && [ "$GIT_MINOR" -lt 9 ]; }; then
    printf '[!!]  Git %s detected — core.hooksPath needs Git >= 2.9.\n' "$GIT_VER" 1>&2
    exit 1
fi

printf '\nDone. Git hooks are now active.\n'
printf 'Run ./.github/scripts/doctor.sh to verify your environment.\n'
