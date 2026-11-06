#!/usr/bin/env sh
# test-hooks.sh - self-contained test suite for the .githooks/ system.
#
# Spins up a throwaway git repo in a temp directory, copies the hook files
# into it, runs setup.sh, then exercises every scenario:
#   - core.hooksPath wiring
#   - branch-name matcher (valid / invalid / exempt)
#   - commit-msg format (FE_/BE_ subject, blank line 2, exemptions)
#   - pre-commit merge-marker + linter dispatcher
#   - pre-push branch-name hard-fail
#   - internal maintenance escape hatch is honoured silently
#
# Read-only w.r.t. the real repo. Exits 0 if all tests pass, 1 otherwise.

set -u

# PATH shim so this script works when invoked directly by sh.exe on Windows
# (git-for-windows normally injects /usr/bin when running hooks, but not when
# a user launches sh.exe from PowerShell / cmd.exe).
for _d in /usr/bin /mingw64/bin /mingw32/bin; do
    if [ -d "$_d" ]; then
        case ":$PATH:" in
            *":$_d:"*) : ;;
            *) PATH="$_d:$PATH" ;;
        esac
    fi
done
export PATH
unset _d

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
    printf 'ERROR: run from inside the repository.\n' 1>&2
    exit 1
fi

# Colors when the terminal supports them.
if [ -t 1 ]; then
    R="$(printf '\033[31m')"; G="$(printf '\033[32m')"
    Y="$(printf '\033[33m')"; B="$(printf '\033[1m')"; Z="$(printf '\033[0m')"
else
    R=""; G=""; Y=""; B=""; Z=""
fi

PASS=0
FAIL=0
FAIL_NAMES=""

# it <name> <expected_exit> <expected_substring_or_-> <cmd...>
it() {
    _name="$1"; _want_exit="$2"; _want_grep="$3"; shift 3
    _out="$("$@" 2>&1)"; _got_exit=$?
    _ok=1
    if [ "$_got_exit" != "$_want_exit" ]; then
        _ok=0
    fi
    if [ "$_want_grep" != "-" ] && ! printf '%s' "$_out" | grep -q -- "$_want_grep"; then
        _ok=0
    fi
    if [ "$_ok" = "1" ]; then
        printf '  %s[PASS]%s %s\n' "$G" "$Z" "$_name"
        PASS=$((PASS + 1))
    else
        printf '  %s[FAIL]%s %s   (exit=%s want=%s)\n' "$R" "$Z" "$_name" "$_got_exit" "$_want_exit"
        [ "$_want_grep" != "-" ] && printf '         expected substring: %s\n' "$_want_grep"
        printf '         --- output ---\n%s\n         --------------\n' "$_out"
        FAIL=$((FAIL + 1))
        FAIL_NAMES="$FAIL_NAMES\n  - $_name"
    fi
}

section() { printf '\n%s== %s ==%s\n' "$B" "$1" "$Z"; }

# ---------------------------------------------------------------------------
# Build a throwaway sandbox git repo mirroring the hook framework.
# ---------------------------------------------------------------------------
SANDBOX="$(mktemp -d 2>/dev/null || printf '/tmp/hook-test-%s' "$$")"
mkdir -p "$SANDBOX"
trap 'rm -rf "$SANDBOX"' EXIT INT TERM

printf '%sSandbox:%s %s\n' "$B" "$Z" "$SANDBOX"

# Init a fresh repo with sane defaults.
(
    cd "$SANDBOX"
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name  "Hook Tester"
    git config commit.gpgsign false
) || { printf 'git init failed\n'; exit 1; }

# Copy the hook framework + setup + doctor + .gitattributes.
mkdir -p "$SANDBOX/.githooks/lib" "$SANDBOX/.github/scripts"
cp "$REPO_ROOT/.githooks/pre-commit"     "$SANDBOX/.githooks/"
cp "$REPO_ROOT/.githooks/pre-push"       "$SANDBOX/.githooks/"
cp "$REPO_ROOT/.githooks/commit-msg"     "$SANDBOX/.githooks/"
cp "$REPO_ROOT/.githooks/lib/common.sh"  "$SANDBOX/.githooks/lib/"
cp "$REPO_ROOT/.githooks/lib/linters.sh" "$SANDBOX/.githooks/lib/"
cp "$REPO_ROOT/.github/scripts/setup.sh"  "$SANDBOX/.github/scripts/"
cp "$REPO_ROOT/.github/scripts/doctor.sh" "$SANDBOX/.github/scripts/"
[ -f "$REPO_ROOT/.gitattributes" ] && cp "$REPO_ROOT/.gitattributes" "$SANDBOX/"

# Make an initial commit so `git diff --cached` and pre-push work.
# The hook files are included in this commit with mode 100755 baked into
# the tree - so any later `git restore --staged` preserves the exec bit
# and setup.sh's chmod step is idempotent.
(
    cd "$SANDBOX"
    echo "readme" > README.md
    git add README.md
    # Force 100755 in the index for every executable hook / helper script.
    for _exec in .githooks/pre-commit .githooks/pre-push .githooks/commit-msg \
                 .github/scripts/setup.sh .github/scripts/doctor.sh; do
        [ -f "$_exec" ] || continue
        git add --chmod=+x -- "$_exec"
    done
    # Add remaining non-executable files (lib/, gitattributes).
    git add -A
    git -c core.hooksPath=/dev/null commit -q -m "chore: initial"
) || { printf 'initial commit failed\n'; exit 1; }

# ---------------------------------------------------------------------------
# Run tests inside the sandbox.
# ---------------------------------------------------------------------------
cd "$SANDBOX"

# ===========================================================================
section "setup.sh"
# ===========================================================================
it "setup.sh runs cleanly" 0 "core.hooksPath = .githooks" \
    sh .github/scripts/setup.sh
it "core.hooksPath is .githooks" 0 ".githooks" \
    git config --get core.hooksPath

# ===========================================================================
section "commit-msg"
# ===========================================================================
_run_msg() {
    printf '%s' "$1" > "$SANDBOX/_msg.tmp"
    sh .githooks/commit-msg "$SANDBOX/_msg.tmp"
    _e=$?
    rm -f "$SANDBOX/_msg.tmp"
    return $_e
}

it "accept FE_ subject"                       0 -  _run_msg "FE_3-7571_Library: Added retry logic"
it "accept BE_ subject"                       0 -  _run_msg "BE_3-9999_Event_Layer: Fixed linting"
it "accept FE_ subject with single-digit AMT" 0 -  _run_msg "FE_1_App: tiny change"
it "accept BE_ subject with plain AMT"        0 -  _run_msg "BE_7571_Module: work"
it "accept FE_ subject with 3-part AMT"       0 -  _run_msg "FE_1-2-3_App: work"
it "accept FE_ subject with DF-1471 AMT"      0 -  _run_msg "FE_DF-1471_Library: apply risk mitigation null check"
it "accept BE_ subject with US-140 AMT"       0 -  _run_msg "BE_US-140_Backend: add audit trail"
it "accept FE_ subject with AMT-5678 AMT"     0 -  _run_msg "FE_AMT-5678_App: add audit trail"
it "accept BE_ subject with BUG-12 AMT"       0 -  _run_msg "BE_BUG-12_Module: fix null pointer"
it "accept FE_ subject with US-140-DF-123 AMT" 0 - _run_msg "FE_US-140-DF-123_App: new permission model"
it "accept FE_ subject with RCA-2025-01 AMT"  0 -  _run_msg "FE_RCA-2025-01_Analytics: capture initial findings"
it "accept Merge commit (exempt)"             0 -  _run_msg "Merge branch 'foo' into 'main'"
it "accept Revert commit (exempt)"            0 -  _run_msg "Revert \"something\""
it "reject wrong prefix"                      1 "does not match" _run_msg "feat: nope"
it "reject missing colon"                     1 "does not match" _run_msg "FE_3-7571_Library subject"
it "reject bad AMT_ID"                        1 "does not match" _run_msg "FE_wrong_Library: msg"
it "reject lowercase AMT letters"             1 "does not match" _run_msg "FE_df-1471_Library: msg"
it "reject AMT_ID with trailing hyphen"       1 "does not match" _run_msg "FE_1-_App: msg"
it "reject AMT_ID with underscore inside"     1 "does not match" _run_msg "FE_DF_1471_App: msg"
it "accept multi-line with blank line 2"      0 -  _run_msg "$(printf 'FE_3-7571_App: subject\n\nBody line')"
it "reject non-blank line 2"                  1 "must be empty"  _run_msg "$(printf 'FE_3-7571_App: subject\nBODY\nmore')"
it "silent maintenance bypass on commit-msg"  0 -  env SKIP_HOOKS=1 sh -c 'echo "junk" > /tmp/m.$$; sh .githooks/commit-msg /tmp/m.$$; e=$?; rm -f /tmp/m.$$; exit $e'

# ===========================================================================
section "branch matcher (via pre-push simulation)"
# ===========================================================================
# pre-push reads local_ref tuples from stdin. Build a valid + invalid ref.
_push_hook() {
    _refname="$1"
    _sha="$(git rev-parse HEAD)"
    # NOTE: pre-push also runs mvn/npm blocks; skip via SKIP_HOOKS - branch
    #       check happens BEFORE those, but bypass is easier. Instead we
    #       call the branch validator directly for the branch test to keep
    #       the test hermetic:
    #
    # For a real push-hook test, we craft a temporary commit + branch below.
    printf 'refs/heads/%s %s refs/heads/%s 0000000000000000000000000000000000000000\n' \
        "$_refname" "$_sha" "$_refname" | \
        sh .githooks/pre-push origin dummy
}

# Branch validator (unit-test the function directly).
_valid_branch() {
    sh -c ". .githooks/lib/common.sh && branch_name_is_valid \"$1\""
}
it "branch valid: main (exempt)"                          0 - _valid_branch "main"
it "branch valid: dev (exempt)"                           0 - _valid_branch "dev"
it "branch valid: release/1.0"                            0 - _valid_branch "release/1.0"
it "branch valid: feature/3-7571-desc"                    0 - _valid_branch "feature/3-7571-custom-event"
it "branch valid: feature/1-x (single-digit AMT_ID)"      0 - _valid_branch "feature/1-x"
it "branch valid: feature/7571-add-githooks (plain AMT)"  0 - _valid_branch "feature/7571-add-githooks"
it "branch valid: feature/1-2-3-multi-part-amt"           0 - _valid_branch "feature/1-2-3-desc"
it "branch valid: defect/3-6145"                          0 - _valid_branch "defect/3-6145"
it "branch valid: defect/1 (no description)"              0 - _valid_branch "defect/1"
it "branch valid: defect/3-6145-optional-kebab"           0 - _valid_branch "defect/3-6145-fix-thing"
# Alphanumeric AMT IDs (typed prefixes: DF/US/AMT/BUG/RCA/etc.)
it "branch valid: defect/DF-1471-apply-...-null-check"    0 - _valid_branch "defect/DF-1471-apply-risk-mitigation-null-check"
it "branch valid: feature/US-140-DF-123-new-perm-model"   0 - _valid_branch "feature/US-140-DF-123-new-permission-model"
it "branch valid: feature/AMT-5678-add-audit-trail"       0 - _valid_branch "feature/AMT-5678-add-audit-trail"
it "branch valid: defect/BUG-12-fix-null-pointer"         0 - _valid_branch "defect/BUG-12-fix-null-pointer"
it "branch valid: defect/DF-1471 (no description)"        0 - _valid_branch "defect/DF-1471"
it "branch valid: feature/RCA-2025-01-capture-findings"   0 - _valid_branch "feature/RCA-2025-01-capture-findings"
it "branch invalid: no AMT_ID"                            1 - _valid_branch "feature/no-id"
it "branch invalid: feature without kebab description"    1 - _valid_branch "feature/3-7571"
it "branch invalid: feature with typed AMT and no desc"   1 - _valid_branch "feature/DF-1471"
it "branch invalid: wrong prefix (bugfix)"                1 - _valid_branch "bugfix/3-7571-thing"
it "branch invalid: uppercase in kebab"                   1 - _valid_branch "feature/3-7571-BadKebab"
it "branch invalid: defect with uppercase kebab"          1 - _valid_branch "defect/1-BadKebab"
it "branch invalid: lowercase in AMT prefix"              1 - _valid_branch "feature/df-1471-fix-thing"
it "branch invalid: underscore inside AMT"                1 - _valid_branch "feature/DF_1471-fix-thing"

# ===========================================================================
section "PR title matcher"
# ===========================================================================
_valid_pr_title() {
    sh -c ". .githooks/lib/common.sh && printf '%s' \"\$1\" | grep -Eq \"\$PR_TITLE_RE\"" -- "$1"
}
it "PR valid: US_3-7571: description"          0 - _valid_pr_title "US_3-7571: Expose custom events"
it "PR valid: DE_3-6145: description"          0 - _valid_pr_title "DE_3-6145: Fix download template"
it "PR valid: US_1: single-digit AMT_ID"       0 - _valid_pr_title "US_1: Tiny story"
it "PR valid: DE_7571: plain AMT_ID"           0 - _valid_pr_title "DE_7571: Some fix"
it "PR valid: US_DF-1471: typed AMT_ID"        0 - _valid_pr_title "US_DF-1471: apply risk mitigation null check"
it "PR valid: DE_BUG-12: typed AMT_ID"         0 - _valid_pr_title "DE_BUG-12: fix null pointer"
it "PR valid: US_AMT-5678: typed AMT_ID"       0 - _valid_pr_title "US_AMT-5678: add audit trail"
it "PR valid: US_US-140-DF-123: combined"      0 - _valid_pr_title "US_US-140-DF-123: new permission model"
it "PR invalid: lowercase type"                1 - _valid_pr_title "us_3-7571: nope"
it "PR invalid: lowercase in AMT"              1 - _valid_pr_title "US_df-1471: nope"
it "PR invalid: missing AMT_ID"                1 - _valid_pr_title "US_: nope"
it "PR invalid: missing description"           1 - _valid_pr_title "US_3-7571: "
it "PR invalid: wrong type prefix"             1 - _valid_pr_title "FE_3-7571: nope"

# ===========================================================================
section "pre-commit (no staged files, no linters)"
# ===========================================================================
# On the initial 'main' branch with nothing staged, it must pass.
git checkout -q main
it "pre-commit passes with no staged files" 0 "Pre-commit checks passed" \
    sh .githooks/pre-commit

# ---------------------------------------------------------------------------
section "pre-commit (bad branch warning, still passes)"
# ---------------------------------------------------------------------------
git checkout -q -b bad-name-test 2>/dev/null || git checkout -q bad-name-test
it "pre-commit warns on bad branch but passes" 0 "does not follow" \
    sh .githooks/pre-commit

# ---------------------------------------------------------------------------
section "pre-commit (merge marker detection)"
# ---------------------------------------------------------------------------
git checkout -q main
# Build the marker sequences at runtime so this test file itself does NOT
# contain literal '<<<<<<<' / '=======' / '>>>>>>>' lines - otherwise our
# own commit of this test would trip `git diff --check`.
_LT7=$(printf '%*s' 7 '' | tr ' ' '<')
_EQ7=$(printf '%*s' 7 '' | tr ' ' '=')
_GT7=$(printf '%*s' 7 '' | tr ' ' '>')
{
    printf 'line\n'
    printf '%s HEAD\n'  "$_LT7"
    printf 'ours\n'
    printf '%s\n'       "$_EQ7"
    printf 'theirs\n'
    printf '%s other\n' "$_GT7"
} > conflict.txt
git add conflict.txt
it "pre-commit fails on merge markers" 1 "conflict markers" \
    sh .githooks/pre-commit
git restore --staged conflict.txt; rm -f conflict.txt

# ---------------------------------------------------------------------------
section "pre-commit (linter dispatcher - .github/linters/ config)"
# ---------------------------------------------------------------------------
mkdir -p .github/linters
cat > .github/linters/eslint.config.js <<'EOF'
module.exports = [{ rules: { "no-console": "error" } }];
EOF
cat > sample.js <<'EOF'
console.log('x');
EOF
git add .github sample.js
# ESLint config found, but CLI NOT installed in sandbox -> must SKIP not FAIL.
it "ESLint config found + no CLI => skip (not fail)" 0 "'eslint' not installed" \
    sh .githooks/pre-commit

# ---------------------------------------------------------------------------
section "pre-commit (silent maintenance escape hatch)"
# ---------------------------------------------------------------------------
# Even with a merge-marker file staged, the internal escape hatch must let
# the hook exit 0 silently (no advertising output).
echo "<<<<<<< HEAD" >> sample.js
git add sample.js
it "internal escape hatch bypasses pre-commit silently" 0 - \
    env SKIP_HOOKS=1 sh .githooks/pre-commit
git restore --staged .; rm -rf sample.js .github/linters/eslint.config.js

# ===========================================================================
section "pre-push (branch enforcement)"
# ===========================================================================
git checkout -q main
# Give pre-push a valid stdin tuple pointing at main (exempt).
_sha="$(git rev-parse HEAD)"
it "pre-push accepts main (exempt)" 0 "All branch names follow" \
    sh -c "printf 'refs/heads/main %s refs/heads/main 0000000000000000000000000000000000000000\n' $_sha | sh .githooks/pre-push origin dummy"

# Bad branch tuple should be rejected before Maven runs.
it "pre-push rejects bad branch" 1 "does not follow" \
    sh -c "printf 'refs/heads/no-good %s refs/heads/no-good 0000000000000000000000000000000000000000\n' $_sha | sh .githooks/pre-push origin dummy"

# ===========================================================================
section "doctor.sh"
# ===========================================================================
git checkout -q main
it "doctor runs and reports summary" 0 "Summary" \
    sh .github/scripts/doctor.sh
it "doctor detects core.hooksPath OK" 0 "core.hooksPath - .githooks" \
    sh .github/scripts/doctor.sh

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
printf '\n%s========================================%s\n' "$B" "$Z"
printf '%sTOTAL:%s  %s%d passed%s   %s%d failed%s\n' \
    "$B" "$Z" "$G" "$PASS" "$Z" "$R" "$FAIL" "$Z"
printf '%s========================================%s\n' "$B" "$Z"

if [ "$FAIL" -gt 0 ]; then
    printf '\n%sFailed:%s%s\n' "$R" "$Z" "$FAIL_NAMES"
    exit 1
fi
printf '\n%sAll scenarios passed.%s\n' "$G" "$Z"
exit 0
