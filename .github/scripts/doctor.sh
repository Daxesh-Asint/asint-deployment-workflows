#!/usr/bin/env sh
# doctor.sh - validate the local dev environment for git hooks + linters.
#
# Read-only. Exits 0 if every required check passes, 1 otherwise.
# Reuses helpers from .githooks/lib/common.sh so the checks stay in sync
# with what the hooks actually do at commit / push time.
#
# Usage:  ./.github/scripts/doctor.sh

set -u

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
    printf 'ERROR: not inside a Git repository.\n' 1>&2
    exit 1
fi
cd "$REPO_ROOT"

# Source the shared helpers used by all hooks.
. "$REPO_ROOT/.githooks/lib/common.sh"

PASS=0
FAIL=0
SKIP=0

_check() { log_ok   "$1${2:+ - $2}"; PASS=$((PASS + 1)); }
_miss()  { log_fail "$1${2:+ - $2}"; FAIL=$((FAIL + 1)); }
_skip()  { log_skip "$1${2:+ - $2}"; SKIP=$((SKIP + 1)); }

CR="$(printf '\r')"
has_crlf() { grep -l "$CR" "$1" >/dev/null 2>&1; }

# ===========================================================================
# 1. Git hook wiring
# ===========================================================================
log_header "1. Git hook wiring"

_hp="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ "$_hp" = ".githooks" ]; then
    _check "core.hooksPath" ".githooks"
else
    _miss "core.hooksPath not set to .githooks" "run .github/scripts/setup.sh (or setup.ps1 on Windows)"
fi

for _h in pre-commit pre-push commit-msg; do
    if [ -f ".githooks/$_h" ]; then
        _mode="$(git ls-files --stage ".githooks/$_h" 2>/dev/null | awk '{print $1}')"
        case "$_mode" in
            100755) _check "hook .githooks/$_h" "executable bit set in index" ;;
            100644) _miss  "hook .githooks/$_h" "not executable in index - re-run setup script after committing" ;;
            *)      _skip  "hook .githooks/$_h" "not yet tracked by git" ;;
        esac
    else
        _miss "hook .githooks/$_h" "file missing"
    fi
done

for _h in .githooks/pre-commit .githooks/pre-push .githooks/commit-msg \
          .githooks/lib/common.sh .githooks/lib/linters.sh; do
    [ -f "$_h" ] || continue
    if has_crlf "$_h"; then
        _miss "$_h has CRLF line endings" "add .gitattributes rule 'eol=lf'"
    fi
done

# ===========================================================================
# 2. Toolchain
# ===========================================================================
log_header "2. Toolchain"

if have_cmd git;  then _check "git"  "$(git --version | awk '{print $3}')"; else _miss "git"  "not on PATH"; fi
if have_cmd node; then _check "node" "$(node --version)"; else _skip "node" "not installed (needed for JS/CSS/HTML linters)"; fi
if have_cmd npm;  then _check "npm"  "$(npm --version)";  else _skip "npm"  "not installed"; fi
if have_cmd npx;  then _check "npx"  "$(npx --version 2>/dev/null)"; else _skip "npx"  "not installed"; fi
if have_cmd java; then _check "java" "$(java -version 2>&1 | head -n1 | sed 's/"//g')"; else _skip "java" "not installed (needed for Maven / Checkstyle)"; fi
if have_cmd mvn; then
    _check "mvn" "$(mvn -v 2>/dev/null | head -n1 | awk '{print $3}')"
elif [ -x "$REPO_ROOT/mvnw" ]; then
    _check "mvn" "wrapper (./mvnw) present"
else
    _skip "mvn" "not installed and no ./mvnw wrapper"
fi

# ===========================================================================
# 3. Project detection
# ===========================================================================
log_header "3. Project detection"
is_maven_project  && _check "Maven project"  "pom.xml present"       || _skip "Maven project"  "no pom.xml"
is_node_project   && _check "Node project"   "package.json present"  || _skip "Node project"   "no package.json"

# ===========================================================================
# 4. Linter configs + CLIs
#    For each linter: (a) is a config file present? (b) is the CLI installed?
# ===========================================================================
log_header "4. Linters"

# ---- ESLint ------------------------------------------------------------
# ESLint v9 uses flat config; legacy .eslintrc.* is no longer discovered by
# the default CLI. Only look for flat-config filenames.
ESLINT_CFG="$(find_config \
    eslint.config.js eslint.config.mjs eslint.config.cjs \
    .github/linters/eslint.config.js \
    .github/linters/eslint.config.mjs \
    .github/linters/eslint.config.cjs || true)"
ESLINT_READY=0
if [ -n "$ESLINT_CFG" ]; then
    _check "ESLint config" "${ESLINT_CFG#$REPO_ROOT/}"
    if have_cmd npx && npx --no-install eslint --version >/dev/null 2>&1; then
        _check "ESLint CLI" "$(npx --no-install eslint --version 2>&1)"
        ESLINT_READY=1
    else
        _skip "ESLint CLI" "not installed - only needed if this repo has .js/.ts files. Run 'npm install --save-dev eslint' when required."
    fi
else
    _skip "ESLint" "no config found (looked in repo root + .github/linters/)"
fi

# ---- Stylelint ---------------------------------------------------------
STYLELINT_CFG="$(find_config \
    stylelint.config.js stylelint.config.cjs stylelint.config.mjs \
    .stylelintrc .stylelintrc.js .stylelintrc.json .stylelintrc.yml .stylelintrc.yaml \
    .github/linters/stylelint.config.js .github/linters/stylelint.config.cjs \
    .github/linters/.stylelintrc.json || true)"
STYLELINT_READY=0
if [ -n "$STYLELINT_CFG" ]; then
    _check "Stylelint config" "${STYLELINT_CFG#$REPO_ROOT/}"
    if have_cmd npx && npx --no-install stylelint --version >/dev/null 2>&1; then
        _check "Stylelint CLI" "$(npx --no-install stylelint --version 2>&1)"
        STYLELINT_READY=1
    else
        _skip "Stylelint CLI" "not installed - only needed if this repo has .css/.scss files."
    fi
else
    _skip "Stylelint" "no config found"
fi

# ---- HTMLHint ----------------------------------------------------------
HTMLHINT_CFG="$(find_config .htmlhintrc htmlhint.config.js .github/linters/.htmlhintrc || true)"
HTMLHINT_READY=0
if [ -n "$HTMLHINT_CFG" ]; then
    _check "HTMLHint config" "${HTMLHINT_CFG#$REPO_ROOT/}"
    if have_cmd npx && npx --no-install htmlhint --version >/dev/null 2>&1; then
        _check "HTMLHint CLI" "$(npx --no-install htmlhint --version 2>&1)"
        HTMLHINT_READY=1
    else
        _skip "HTMLHint CLI" "not installed - only needed if this repo has .html files."
    fi
else
    _skip "HTMLHint" "no config found"
fi

# ---- Checkstyle --------------------------------------------------------
# Plugin must be declared in pom.xml OR any child-module pom.xml (team
# convention allows either — aggregator repos typically wire it in submodules
# only). Config path is passed by the hook at invocation time via
# -Dcheckstyle.config.location, so the .github/linters/checkstyle.xml file is
# authoritative even if pom.xml declares a different <configLocation>.
CHECKSTYLE_READY=0
CHECKSTYLE_CFG="$(find_config .github/linters/checkstyle.xml checkstyle.xml || true)"
if ! is_maven_project; then
    _skip "Checkstyle" "no pom.xml at repo root - Java lint gate will skip"
elif ! maven_has_plugin "maven-checkstyle-plugin"; then
    _miss "Checkstyle plugin" "maven-checkstyle-plugin not declared in pom.xml (or any child module pom.xml)."
elif [ -z "$CHECKSTYLE_CFG" ]; then
    _miss "Checkstyle config" ".github/linters/checkstyle.xml missing - the hook has nothing to attach"
else
    # Aggregator repos commonly declare the plugin in submodule poms only;
    # surface the exact locations so devs can audit at a glance. paste's -d
    # option cycles through each character, so a multi-char delimiter like
    # ", " prints ", " / " " alternately — join with a single comma then
    # add spacing with sed for a clean list.
    _cs_poms="$(maven_plugin_locations "maven-checkstyle-plugin" \
        | paste -sd ',' - | sed 's/,/, /g')"
    [ -z "$_cs_poms" ] && _cs_poms="pom.xml"
    _check "Checkstyle plugin" "declared in $_cs_poms"
    _check "Checkstyle config" "${CHECKSTYLE_CFG#$REPO_ROOT/} (attached at invocation)"
    CHECKSTYLE_READY=1
fi

# ===========================================================================
# 5. Team conventions - active regexes and current branch verdict
# ===========================================================================
log_header "5. Team conventions"
log_info "Branch pattern:    $BRANCH_RE"
log_info "Exempt branches:   $BRANCH_EXEMPT_RE"
log_info "Commit subject:    $COMMIT_SUBJECT_RE"
printf '\n'

_b="$(current_branch)"
if [ -z "$_b" ]; then
    _skip "current branch" "detached HEAD - branch check disabled"
elif branch_name_is_valid "$_b"; then
    _check "current branch" "'$_b' matches convention"
else
    _miss  "current branch" "'$_b' does NOT match convention"
    print_branch_rule
fi

# ===========================================================================
# 6. Preview - which linters would fire on the currently staged files
# ===========================================================================
log_header "6. Preview: what pre-commit will do RIGHT NOW"

_all_staged="$(git diff --cached --name-only --diff-filter=ACMR)"
if [ -z "$_all_staged" ]; then
    _skip "no staged files" "run 'git add <files>' and re-run doctor to preview"
else
    printf 'Staged files (%s):\n' "$(printf '%s\n' "$_all_staged" | wc -l | tr -d ' ')"
    printf '%s\n' "$_all_staged" | sed 's/^/    /'
    printf '\n'

    _predict() {
        # $1 = linter name, $2 = staged-file list, $3 = ready flag (0/1),
        # $4 = why-not string when ready=0
        _name="$1"; _files="$2"; _ready="$3"; _why="$4"
        # Count non-empty lines. awk is used because 'grep -c .' emits "0" on
        # empty input AND exits 1, which broke `_n=$(... || echo 0)`.
        _n=$(printf '%s\n' "$_files" | awk 'NF{c++} END{print c+0}')
        if [ "$_n" = "0" ]; then
            printf '    %s%-12s%s  no matching staged files\n' "$C_YELLOW" "$_name" "$C_RESET"
        elif [ "$_ready" = "1" ]; then
            printf '    %s%-12s%s  WILL RUN on %s file(s)\n' "$C_GREEN" "$_name" "$C_RESET" "$_n"
        else
            printf '    %s%-12s%s  will SKIP - %s\n' "$C_YELLOW" "$_name" "$C_RESET" "$_why"
        fi
    }

    _predict "ESLint"     "$(staged_files_of_kind jsts)" "$ESLINT_READY"     "$( [ -z "$ESLINT_CFG" ] && printf 'no config' || printf 'CLI not installed' )"
    _predict "Stylelint"  "$(staged_files_of_kind css)"  "$STYLELINT_READY"  "$( [ -z "$STYLELINT_CFG" ] && printf 'no config' || printf 'CLI not installed' )"
    _predict "HTMLHint"   "$(staged_files_of_kind html)" "$HTMLHINT_READY"   "$( [ -z "$HTMLHINT_CFG" ] && printf 'no config' || printf 'CLI not installed' )"
    _predict "Checkstyle" "$(staged_files_of_kind java)" "$CHECKSTYLE_READY" "no Maven plugin and no local CLI"
fi

# ===========================================================================
# Summary
# ===========================================================================
printf '\n'
log_header "Summary"
printf '  passed:  %s%d%s\n' "$C_GREEN"  "$PASS" "$C_RESET"
printf '  failed:  %s%d%s\n' "$C_RED"    "$FAIL" "$C_RESET"
printf '  skipped: %s%d%s\n' "$C_YELLOW" "$SKIP" "$C_RESET"
printf '\n'

if [ "$FAIL" -gt 0 ]; then
    log_fail "Environment has $FAIL failing check(s). Address them before committing."
    exit 1
fi
log_ok "All required checks passed. You're good to commit."
exit 0
