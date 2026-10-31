#!/bin/bash
# The scan behind .github/workflows/secrets-scan.yml. Kept as a script, not
# inline YAML, so it can be run and tested on a laptop the same way:
#
#     REF=refs/heads/my-branch BEFORE=<sha> AFTER=<sha> .github/scripts/secrets-scan.sh
#
# Four checks over the commits a push brings, any of which fails the run:
# their content, their commit messages, any file in them gitleaks can't read
# (documents, archives, other binary files), and -- as a warning only --
# whether the branch loosens the rules it is being judged by.
#
# Each gitleaks check runs twice: with this repository's rules
# (.gitleaks.toml) and with the standard ones (.gitleaks-standard.toml).
# The second file says why they are kept apart.

set -euo pipefail

# gitleaks reads the output of git diff and git log. A color.ui or
# color.diff of "always" in someone's git config fills that output with
# color codes, and gitleaks then finds no changes in it at all -- and
# reports success. Color is forced off for every git command from here on.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=color.ui GIT_CONFIG_VALUE_0=never
export GIT_CONFIG_KEY_1=color.diff GIT_CONFIG_VALUE_1=never

: "${REF:?}" "${AFTER:?}"
BEFORE="${BEFORE:-}"
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
# gitleaks can skip the config file it was given, so it gets copies held
# outside the repository; the files themselves are then scanned like any
# others. CONFIGS are the copies, in the same order as REPO_CONFIGS.
REPO_CONFIGS=(.gitleaks.toml .gitleaks-standard.toml)
CONFIGS=()
for config in "${REPO_CONFIGS[@]}"; do
    [ -f "$config" ] || { echo "::error::$config is missing, so the scan can't run."; exit 1; }
    cp "$config" "$TMP/rules${#CONFIGS[@]}.toml"
    CONFIGS+=("$TMP/rules${#CONFIGS[@]}.toml")
done

# Which commits are new.
#
# Any branch but main: everything on it that main doesn't have. That stays
# right after a force-push, which is how a bad commit usually gets fixed, and
# it's rescanned in full on every push, which is cheap.
#
# main: everything since its last push. After a force-push to main -- a
# history rewrite is one -- that last push no longer exists, so all of
# history is scanned instead: a rewrite is exactly when it should be clean.
#
# Tags aren't scanned: the workflow triggers on branches, and a tag normally
# points at a commit that was already scanned on its branch.
#
# The range is checked before gitleaks sees it. gitleaks given a range git
# can't resolve scans nothing and reports success.
if [ "$REF" != "refs/heads/main" ]; then
    range="origin/main..${AFTER}"
elif [ -n "$BEFORE" ] && git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
    range="${BEFORE}..${AFTER}"
else
    range="${AFTER}"
fi
count=$(git rev-list --count "$range")
echo "Scanning ${range}: ${count} commit(s)"
if [ "$count" -eq 0 ]; then
    echo "Nothing new to scan."
    exit 0
fi

failed=0

# Exceptions belong in .gitleaks.toml, where a change is visible and the
# GitHub check compares it with main's. So two other ways gitleaks offers to
# silence a finding are switched off: a `gitleaks:allow` comment on the line
# (--ignore-gitleaks-allow), and a .gitleaksignore file, which is refused.
ignore_files=$(git ls-tree -r --name-only "$AFTER" | grep -E '(^|/)\.gitleaksignore$' || true)
if [ -n "$ignore_files" ]; then
    echo "::error::Remove these and put exceptions in .gitleaks.toml instead:"
    printf '%s\n' "$ignore_files" | sed 's/^/  /'
    exit 1
fi

# Print findings as rule, file, line and commit only. gitleaks' own output
# shows the text around a finding, which may itself be personal data, and
# Actions logs outlive any later clean-up of the repository.
report() {
    jq -r '.[] | "  \(.RuleID)  \(.File):\(.StartLine)  \(.Commit[0:7])"' "$1"
}

# Run one gitleaks command. Returns 0 if clean and 1 if it found something;
# if gitleaks itself failed (a config that won't load, say), stops the whole
# scan and shows gitleaks' own error. gitleaks exits 1 for both findings and
# its own failures, so --exit-code 3 gives findings a code of their own.
# QUIET=1 leaves out the per-run "scanned" lines.
run_gitleaks() {
    local out="$1"; shift
    local rc
    set +e
    gitleaks "$@" --ignore-gitleaks-allow --exit-code 3 --redact --no-banner --no-color \
        --report-format json --report-path "$out" 2>"$TMP/gitleaks.log"
    rc=$?
    set -e
    if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then
        echo "::error::gitleaks failed to run (exit $rc); its output:"
        sed 's/^/  /' "$TMP/gitleaks.log"
        exit 1
    fi
    if [ "${QUIET:-0}" != 1 ]; then
        grep -E "scanned|no leaks|leaks found" "$TMP/gitleaks.log" | sed -E 's/^.*(INF|WRN) //' || true
    fi
    # Commits to scan, but gitleaks read none of them: whatever the reason,
    # it didn't look, so this can't count as clean.
    if [ "$1" = git ] && grep -qE '(^| )0 commits scanned' "$TMP/gitleaks.log"; then
        echo "::error::gitleaks read none of the ${count} commit(s) it was given; its output:"
        sed 's/^/  /' "$TMP/gitleaks.log"
        exit 1
    fi
    [ "$rc" -eq 0 ]
}

# 1. Content. --remerge-diff makes git show what a merge commit itself
#    changed -- the lines typed while resolving a conflict -- which plain
#    `git log -p` leaves out of merges entirely.
echo "-- content"
for config in "${CONFIGS[@]}"; do
    if ! run_gitleaks "$TMP/content.json" git -c "$config" --log-opts="--remerge-diff $range" .; then
        echo "::error::Secrets or personal data in the pushed commits ($(basename "$config")):"
        report "$TMP/content.json"
        failed=1
    fi
done

# 2. Commit messages, which the content scan doesn't read. One commit at a
#    time, so a finding names the commit it is in -- by hash only, since
#    the subject line may be the very thing that was found. The message is
#    read from a file, not a pipe: in a pipe, a gitleaks failure would stop
#    only a subshell and look like a finding.
echo "-- commit messages"
bad_messages=""
for sha in $(git rev-list "$range"); do
    git log -1 --format='%B' "$sha" > "$TMP/message.txt"
    for config in "${CONFIGS[@]}"; do
        if ! QUIET=1 run_gitleaks "$TMP/message.json" stdin -c "$config" < "$TMP/message.txt"; then
            bad_messages="${bad_messages}  $(jq -r '[.[].RuleID] | unique | join(", ")' "$TMP/message.json")  $(git log -1 --format='%h' "$sha")"$'\n'
        fi
    done
done
if [ -n "$bad_messages" ]; then
    echo "::error::Secrets or personal data in a commit message:"
    printf '%s' "$bad_messages"
    failed=1
else
    echo "$count message(s), no leaks found"
fi

# 3. Files gitleaks can't read: documents and archives by name, then
#    anything git counts as binary ("-  -" in --numstat), since gitleaks
#    reads those as nothing. --no-renames so a renamed file counts as added;
#    --remerge-diff so a file added in a merge commit is listed at all;
#    quotePath off so a name with accents is listed as typed (see
#    .githooks/check-documents).
echo "-- documents and binary files"
listing() {
    git -c core.quotePath=false log --no-renames --remerge-diff --diff-filter=ACMRT \
        --format= "$@" "$range"
}
if ! listing --name-only | sort -u | .githooks/check-documents; then
    failed=1
fi
if ! listing --numstat | awk -F'\t' '$1 == "-" && $2 == "-" { print $3 }' | sort -u \
        | .githooks/check-documents --binary; then
    failed=1
fi

# 4. A branch that loosens the rules. A branch runs with its own copy of the
#    configs, so it could allow what main would refuse. Rescan with main's
#    copy of each that changed, and say so if that finds more. A warning,
#    not a failure: loosening a rule is sometimes right, and it is a
#    reviewer's call.
if [ "$REF" != "refs/heads/main" ]; then
    for config in "${REPO_CONFIGS[@]}"; do
        if git cat-file -e "origin/main:$config" 2>/dev/null \
                && ! git diff --quiet origin/main "$AFTER" -- "$config"; then
            echo "-- $config as on main"
            git show "origin/main:$config" > "$TMP/main.toml"
            if ! run_gitleaks "$TMP/main-rules.json" git -c "$TMP/main.toml" --log-opts="--remerge-diff $range" .; then
                echo "::warning::This branch changes $config, and main's copy finds this, which the branch's allows:"
                report "$TMP/main-rules.json"
            fi
        fi
    done
    if git cat-file -e "origin/main:.githooks/allowed-documents.txt" 2>/dev/null \
            && ! git diff --quiet origin/main "$AFTER" -- .githooks/allowed-documents.txt; then
        echo "::warning::This branch changes the list of documents allowed in the repository."
    fi
fi

exit "$failed"
