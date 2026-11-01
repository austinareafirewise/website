#!/usr/bin/env bash
# Run one security scanner over the repository, failing closed.
#
#     .github/scripts/security-scan.sh <tool> <gate|report>
#
# For every tool, in this order:
#   1. Refuse the ways the tool offers to silence a finding in the files it
#      reads (inline comments, config files it would pick up on its own).
#      Exceptions live in one visible place: this script and .github/scan/.
#   2. List what it is to read from `git ls-files`, and fail if that is empty.
#   3. Run it on a sample made here that it must catch, and fail if it
#      doesn't: a scanner that can't find anything is a scanner that passes.
#   4. Run it on the repository. A tool error, or proof that it read nothing,
#      fails the job.
#
# Then, by mode:
#   gate    any finding fails the job; each is printed as rule, file and line,
#           never the matched text (Actions logs are public).
#   report  findings are counted, and only the count is printed. For tools
#           whose existing findings are still being triaged: TODO.md says
#           which, and each moves to gate in a pull request of its own.
#
# Expects the tool on PATH (install-scanner.sh) and, for Semgrep, the pinned
# rules checked out at $SEMGREP_RULES.
set -euo pipefail
# mapfile -d needs bash 4.4 (macOS's own bash is 3.2).
if [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
    echo "security-scan.sh needs bash 4.4 or later (this is $BASH_VERSION)" >&2; exit 2
fi

tool="${1:?usage: security-scan.sh <tool> <gate|report>}"
mode="${2:?usage: security-scan.sh <tool> <gate|report>}"
case "$mode" in gate|report) ;; *) echo "mode must be gate or report" >&2; exit 2 ;; esac

cd "$(git rev-parse --show-toplevel)"
root="$PWD"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT          # the tools' raw output can hold what they matched
findings="$work/findings.tsv"      # rule <TAB> file:line, one per finding

# Scripts parse git's output: force color off whatever the user's config says.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=color.ui GIT_CONFIG_VALUE_0=never
export GIT_CONFIG_KEY_1=color.diff GIT_CONFIG_VALUE_1=never

fail() { echo "::error title=$tool::$*"; exit 1; }

# Every tracked file, NUL-separated, names unquoted.
tracked() { git -c core.quotePath=false ls-files -z; }

# Fail if any of the given files contains the pattern.
refuse() {  # description, extended regex, file...
    local what="$1" re="$2"; shift 2
    local hits rc=0
    [ "$#" -gt 0 ] || return 0
    hits=$(grep -l -E -e "$re" -- "$@") || rc=$?
    # grep: 0 found, 1 not found, anything else an error.
    [ "$rc" -le 1 ] || fail "couldn't search for $what (grep exit $rc)"
    [ -z "$hits" ] || fail "$what found (not allowed; exceptions go in .github/scan/): $(tr '\n' ' ' <<<"$hits")"
}

refuse_file() {  # path...: config files the tool would pick up by itself
    local f
    for f in "$@"; do [ ! -e "$f" ] || fail "$f found: the tool would read it on its own"; done
}

# A shellcheck directive line that disables a check, whether disable= comes
# first or after other directives on the line, such as a source= one.
shellcheck_disable='#[[:space:]]*shellcheck[[:space:]]([^#]*[[:space:]])?disable='

# A file whose first line runs a shell, or Python (a CRLF line ending too).
is_shell()  { head -n1 -- "$1" | tr -d '\r' | grep -qE '^#!.*[/ ](ba|da|k)?sh( |$)'; }
is_python() { head -n1 -- "$1" | tr -d '\r' | grep -qE '^#!.*[/ ]python[0-9.]*( |$)'; }

# Every tracked file, and which of them are text. Decided by content (a NUL
# byte means binary, as git's own test), never by .gitattributes, which
# could otherwise mark a script "binary" and take it out of every scan.
mapfile -d '' all_files < <(tracked)
declare -A is_text=()
for f in "${all_files[@]}"; do
    [ -f "$f" ] || continue
    [ "$(LC_ALL=C tr -dc '\000' < "$f" | head -c1 | wc -c)" -eq 0 ] && is_text[$f]=1
done

# Tracked files whose names match the regex (any case), or that pass the
# optional test. Each must be text: a script or template that isn't can't
# be read, so it is refused rather than skipped.
pick() {  # regex [test-function]
    local re="$1" test="${2:-}" f hit
    picked=()
    for f in "${all_files[@]}"; do
        hit=0
        shopt -s nocasematch; [[ "$f" =~ $re ]] && hit=1; shopt -u nocasematch
        if [ "$hit" -eq 0 ] && [ -n "$test" ] && [ -n "${is_text[$f]:-}" ] && "$test" "$f"; then hit=1; fi
        [ "$hit" -eq 1 ] || continue
        [ -n "${is_text[$f]:-}" ] || fail "$f isn't text, so $tool can't read it"
        picked+=("$f")
    done
}

need() { [ "$#" -gt 0 ] || fail "nothing to scan: no files of the kind this tool reads"; }

count() { if [ -s "$findings" ]; then wc -l < "$findings" | tr -d ' '; else echo 0; fi; }

# Run the tool on its sample; it must report at least one finding there.
expect_caught() {  # description, then the scan command and its arguments
    local what="$1"; shift
    : > "$findings"
    "$@"
    [ "$(count)" -gt 0 ] || fail "did not catch its known sample ($what): it isn't working"
    echo "ok   catches its known sample ($what): $(count) finding(s)"
    : > "$findings"
}

# A random string of the given length from the given characters. tr reads a
# fixed amount, so nothing is cut off mid-pipe.
random() {
    local s
    s=$(LC_ALL=C tr -dc "$1" < <(head -c 8192 /dev/urandom))
    [ "${#s}" -ge "$2" ] || fail "couldn't make a random sample"
    printf '%s' "${s:0:$2}"
}

#--------------------------------------------------------------------------
# One function per tool: scan the given targets, append findings, and fail
# on anything that isn't a clean run or a finding.

actionlint_scan() {  # workflow files...
    local rc=0
    : > "$work/actionlint.yaml"     # an empty config: no repository settings
    actionlint -no-color -config-file "$work/actionlint.yaml" \
        -shellcheck "$(command -v shellcheck)" -format '{{json .}}' \
        "$@" > "$work/out" 2> "$work/err" || rc=$?
    # 0 clean, 1 findings; anything else is actionlint failing.
    [ "$rc" -le 1 ] || fail "actionlint failed (exit $rc): $(cat "$work/err")"
    jq -e 'type == "array"' "$work/out" > /dev/null 2>&1 || fail "actionlint gave no JSON report"
    jq -r '.[] | [.kind, (.filepath + ":" + (.line|tostring))] | @tsv' "$work/out" >> "$findings"
    [ "$rc" -eq 0 ] || [ -s "$findings" ] || fail "actionlint exited 1 but reported nothing it could parse"
}

shellcheck_scan() {  # shell scripts...
    local rc=0
    shellcheck --norc --external-sources --format=gcc "$@" > "$work/out" 2> "$work/err" || rc=$?
    [ "$rc" -le 1 ] || fail "shellcheck failed (exit $rc): $(cat "$work/err")"
    # file:line:col: severity: message [SCnnnn]
    sed -nE 's/^(.+):([0-9]+):[0-9]+: [a-z]+: .*\[(SC[0-9]+)\]$/\3\t\1:\2/p' "$work/out" >> "$findings"
    [ "$rc" -eq 0 ] || [ -s "$findings" ] || fail "shellcheck exited 1 but reported nothing it could parse"
}

# TruffleHog's git mode reads each commit's diff, so text that exists only in
# how a merge's conflict was resolved is never shown to it. Reading the files
# themselves as they stand in HEAD covers that.
trufflehog_files_scan() {  # directory holding HEAD's files
    local rc=0 bytes detector file line raw text
    trufflehog filesystem "$1" --json --no-verification --no-update \
        --no-ignore-tag --fail --fail-on-scan-errors \
        > "$work/out" 2> "$work/err" || rc=$?
    [ "$rc" -eq 0 ] || [ "$rc" -eq 183 ] || fail "trufflehog failed on the files (exit $rc): $(tail -5 "$work/err")"
    bytes=$(grep -oE '"bytes": ?[0-9]+' "$work/err" | grep -oE '[0-9]+$' | tail -1 || true)
    [ "${bytes:-0}" -gt 0 ] || fail "trufflehog read none of the files (no bytes scanned reported)"
    jq -e -s 'all(.[]; type == "object")' "$work/out" > /dev/null 2>&1 \
        || fail "trufflehog's output isn't the JSON results it should be"
    jq -r '[.DetectorName, .SourceMetadata.Data.Filesystem.file, (.SourceMetadata.Data.Filesystem.line|tostring), .Raw]
           | @tsv' "$work/out" > "$work/results.tsv" || fail "couldn't read trufflehog's results"
    local kept=0 dropped=0
    while IFS=$'\t' read -r detector file line raw; do
        file=${file#"$1"/}
        if [ "$detector" = SentryToken ] && [[ "$file" =~ ^\.github/scan/requirements/[a-z-]+\.txt$ ]]; then
            text=$(sed -n "${line}p" "$1/$file")
            if [[ "$text" =~ ^\ {4}--hash=sha256:[0-9a-f]{64}(\ \\)?$ ]] && [[ "$text" == *"$raw"* ]]; then
                dropped=$((dropped + 1)); continue
            fi
        fi
        printf '%s\t%s:%s in HEAD\n' "$detector" "$file" "$line" >> "$findings"
        kept=$((kept + 1))
    done < "$work/results.tsv"
    [ "$rc" -ne 183 ] || [ $((kept + dropped)) -gt 0 ] || fail "trufflehog reported findings, but none could be read"
}

trufflehog_scan() {  # git repository
    local rc=0 bytes
    trufflehog git "file://$1" --json --no-verification --no-update \
        --no-ignore-tag --fail --fail-on-scan-errors \
        > "$work/out" 2> "$work/err" || rc=$?
    # 0 clean, 183 findings (--fail); anything else is trufflehog failing.
    [ "$rc" -eq 0 ] || [ "$rc" -eq 183 ] || fail "trufflehog failed (exit $rc): $(tail -5 "$work/err")"
    bytes=$(grep -oE '"bytes": ?[0-9]+' "$work/err" | grep -oE '[0-9]+$' | tail -1 || true)
    [ "${bytes:-0}" -gt 0 ] || fail "trufflehog read nothing (no bytes scanned reported)"
    # The one exception: the hash-locked requirements name a package
    # "policy-sentry", and TruffleHog's Sentry detector then reads the
    # SHA-256 hashes near it as tokens. A Sentry result in one of those files
    # is dropped only if, in that commit, its line is a hash line and holds
    # what was matched. The matched text is compared here, never printed.
    local detector file line commit raw text kept=0 dropped=0
    jq -e -s 'all(.[]; type == "object")' "$work/out" > /dev/null 2>&1 \
        || fail "trufflehog's output isn't the JSON results it should be"
    jq -r '[.DetectorName, .SourceMetadata.Data.Git.file, (.SourceMetadata.Data.Git.line|tostring),
            .SourceMetadata.Data.Git.commit, .Raw] | @tsv' "$work/out" > "$work/results.tsv" \
        || fail "couldn't read trufflehog's results"
    while IFS=$'\t' read -r detector file line commit raw; do
        if [ "$detector" = SentryToken ] && [[ "$file" =~ ^\.github/scan/requirements/[a-z-]+\.txt$ ]]; then
            text=$(git -C "$1" show "$commit:$file" 2>/dev/null | sed -n "${line}p")
            if [[ "$text" =~ ^\ {4}--hash=sha256:[0-9a-f]{64}(\ \\)?$ ]] && [[ "$text" == *"$raw"* ]]; then
                dropped=$((dropped + 1)); continue
            fi
        fi
        printf '%s\t%s:%s in %s\n' "$detector" "$file" "$line" "${commit:0:12}" >> "$findings"
        kept=$((kept + 1))
    done < "$work/results.tsv"
    # "Found something" must come with something found.
    [ "$rc" -ne 183 ] || [ $((kept + dropped)) -gt 0 ] || fail "trufflehog reported findings, but none could be read"
}

cfn_lint_scan() {  # templates...
    local rc=0
    # W3002: a local path as Code or similar, which only `aws cloudformation
    # package` resolves. That is how these templates are deployed
    # (infra/README.md), so it is expected, not a fault.
    cfn-lint --format parseable --ignore-checks W3002 -- "$@" \
        > "$work/out" 2> "$work/err" || rc=$?
    # Exit codes are a bitmask of 2 (error), 4 (warning) and 8 (info); any
    # other bit, or output it can't parse, is cfn-lint failing.
    [ $(( rc & ~14 )) -eq 0 ] || fail "cfn-lint failed (exit $rc): $(cat "$work/err")"
    # file:line:col:endline:endcol:rule:message
    sed -nE 's/^(.+):([0-9]+):[0-9]+:[0-9]+:[0-9]+:([A-Z][0-9]+):.*$/\3\t\1:\2/p' "$work/out" >> "$findings"
    [ "$rc" -eq 0 ] || [ -s "$findings" ] || fail "cfn-lint exited $rc but reported nothing it could parse"
}

checkov_scan() {  # templates...
    local args=() f
    for f in "$@"; do args+=(-f "$f"); done
    checkov --framework cloudformation --quiet --compact --skip-download \
        --output json "${args[@]}" > "$work/out" 2> "$work/err" || true
    jq -e . "$work/out" > /dev/null 2>&1 || fail "checkov failed (no JSON report): $(tail -5 "$work/err")"
    # One report, or a list of them; every template must have been parsed.
    jq -e '[if type == "array" then .[] else . end | .summary]
           | (map(.parsing_errors) | add) == 0 and (map(.passed + .failed) | add) > 0' \
        "$work/out" > /dev/null || fail "checkov parsed nothing, or failed to parse a template"
    # A skipped check means a suppression somewhere, whatever form it took.
    jq -e '[if type == "array" then .[] else . end | .summary.skipped] | add == 0' \
        "$work/out" > /dev/null || fail "checkov skipped checks: a suppression is in a template"
    jq -r 'if type == "array" then .[] else . end | .results.failed_checks[]
           | [.check_id, (.file_path + ":" + (.file_line_range[0]|tostring))] | @tsv' \
        "$work/out" >> "$findings"
}

bandit_scan() {  # python files...
    # Medium and High severity only. Low findings (importing subprocess, a
    # fixed command run by name) aren't faults in the local helper scripts
    # here; report them by dropping --severity-level when reviewing by hand.
    # -x '': none of Bandit's default excludes (.tox, __pycache__ and so on),
    # which it applies even to files it is given by name.
    bandit --format json --quiet --ignore-nosec --severity-level medium -x '' \
        -- "$@" > "$work/out" 2> "$work/err" || true
    jq -e . "$work/out" > /dev/null 2>&1 || fail "bandit failed (no JSON report): $(cat "$work/err")"
    jq -e '(.errors | length) == 0 and .metrics._totals.loc > 0' "$work/out" > /dev/null \
        || fail "bandit read nothing, or couldn't read a file: $(jq -c '.errors' "$work/out")"
    # Every file it was given must have been read.
    # (Bandit writes a relative path with ./ in front.)
    jq -r '.metrics | keys[] | select(. != "_totals") | sub("^\\./"; "")' "$work/out" | sort > "$work/read"
    printf '%s\n' "$@" | sort > "$work/wanted"
    [ -z "$(comm -23 "$work/wanted" "$work/read")" ] \
        || fail "bandit skipped $(comm -23 "$work/wanted" "$work/read" | wc -l | tr -d ' ') file(s) it was given"
    jq -r '.results[] | [.test_id, (.filename + ":" + (.line_number|tostring))] | @tsv' \
        "$work/out" >> "$findings"
}

zizmor_scan() {  # workflow and action files...
    local rc=0
    # Online, so the audits that check each pinned SHA against its repository
    # run too (a SHA from a fork, a SHA that doesn't match its # vX comment).
    [ -n "${GH_TOKEN:-}" ] || fail "GH_TOKEN isn't set: zizmor's online audits need it"
    # --strict-collection: a file it can't parse is an error, not a warning
    # it would otherwise skip the file with.
    zizmor --strict-collection --config "$root/.github/scan/zizmor.yml" --format json \
        -- "$@" > "$work/out" 2> "$work/err" || rc=$?
    # 0 clean; 10-14 findings, by highest severity; anything else is failing.
    [ "$rc" -eq 0 ] || { [ "$rc" -ge 10 ] && [ "$rc" -le 14 ]; } \
        || fail "zizmor failed (exit $rc): $(tail -5 "$work/err")"
    jq -e 'type == "array"' "$work/out" > /dev/null 2>&1 || fail "zizmor gave no JSON report"
    jq -r '.[] | . as $f | .locations[0] |
           [$f.ident, ((.symbolic.key.Local.verbatim_path // .symbolic.key.Local.given_path // "")
                       + ":" + ((.concrete.location.start_point.row + 1)|tostring))] | @tsv' \
        "$work/out" >> "$findings"
    ! grep -q $'\t:' "$findings" || fail "zizmor reported a finding without a file name"
}

semgrep_scan() {  # files...
    local rc=0 r configs=()
    for r in javascript python bash yaml/github-actions html generic/secrets; do
        [ -d "$SEMGREP_RULES/$r" ] || fail "Semgrep rules folder $r missing from $SEMGREP_RULES"
        configs+=(--config "$SEMGREP_RULES/$r")
    done
    semgrep scan --metrics=off --disable-version-check --disable-nosem \
        --json --quiet "${configs[@]}" -- "$@" > "$work/out" 2> "$work/err" || rc=$?
    [ "$rc" -eq 0 ] || fail "semgrep failed (exit $rc): $(tail -5 "$work/err")"
    # Every target must have been read: none skipped by an ignore file.
    jq -r '.paths.scanned[]' "$work/out" | sort > "$work/scanned"
    printf '%s\n' "$@" | sort > "$work/wanted"
    if ! comm -23 "$work/wanted" "$work/scanned" | { ! read -r; }; then
        fail "semgrep skipped $(comm -23 "$work/wanted" "$work/scanned" | wc -l | tr -d ' ') file(s) it was given"
    fi
    jq -r '.results[] | [(.check_id | split(".") | last), (.path + ":" + (.start.line|tostring))] | @tsv' \
        "$work/out" >> "$findings"
    semgrep_unparsed=$(jq '[.errors[] | .path // empty] | unique | length' "$work/out")
}

# What exiftool reads: every document and media type .githooks/check-documents
# knows ($documents and $media, from the one list both use), SVG, and other
# picture, sound and video types a phone or camera writes. Not fonts, which
# carry no names or places of the kind looked for here, nor CSV, TSV or
# email, which are text that the secrets checks read. An archive is refused:
# exiftool can't see inside it.
# shellcheck source=.githooks/file-types
. "$root/.githooks/file-types"
extra_re='\.(svg|heic|heif|tiff?|bmp|mov|m4v|aac|flac)$'
skip_re='\.(woff2?|ttf|otf|csv|tsv|eml)$'
archive_re='\.(zip|7z|rar|tar|gz|tgz|xz|bz2)$'

declare -A label=()                # extracted copy -> "path (blob <id>)"
declare -A origin=()               # extracted copy -> path in the repository

exiftool_scan() {  # files...
    # -GPS* is every tag whose name starts GPS, in any group: EXIF, XMP and
    # QuickTime's (phone video). -*AgentTitle is the creator and publisher
    # names Inkscape writes into an SVG. ExifTool:Error is asked for explicitly,
    # because a tag list otherwise leaves it out and a file it can't read
    # would look clean.
    local tags=(-ExifTool:Error -GPS* -Artist -Author -XPAuthor -XMP-dc:Creator
                -By-line -LastModifiedBy -OwnerName -CameraOwnerName
                -SerialNumber -BodySerialNumber -LensSerialNumber
                -InternalSerialNumber -Company -Manager -Copyright -Rights
                -RegionName -PersonInImage -City -Sub-location -State
                -Country -Location* -*Email* -*AgentTitle)
    exiftool -json -G1 -a -q -q "${tags[@]}" -- "$@" > "$work/out" 2> "$work/err" || true
    jq -e 'type == "array"' "$work/out" > /dev/null 2>&1 || fail "exiftool gave no JSON report: $(cat "$work/err")"
    # One entry per file, and none it couldn't read.
    [ "$(jq length "$work/out")" -eq "$#" ] || fail "exiftool read $(jq length "$work/out") of $# files"
    if ! jq -e 'all(.[]; has("ExifTool:Error") | not)' "$work/out" > /dev/null; then
        local bad f
        bad=$(jq -r '.[] | select(has("ExifTool:Error")) | .SourceFile' "$work/out" |
              while IFS= read -r f; do printf '%s; ' "${label[$f]:-$f}"; done)
        fail "exiftool couldn't read: $bad"
    fi
    # Each non-empty tag is a finding, unless allowed by path, tag and the
    # SHA-256 of its value (so the allowed list holds no one's name).
    local file tag value hash
    while IFS=$'\t' read -r file tag value; do
        hash=$(printf '%s' "$value" | sha256sum | cut -d' ' -f1)
        if ! grep -qxF "$(printf '%s\t%s\t%s' "${origin[$file]:-$file}" "$tag" "$hash")" \
                <(grep -v '^#' "$root/.github/scan/exiftool-allowed.txt" | cut -f1-3); then
            printf '%s\t%s\n' "$tag" "${label[$file]:-$file}" >> "$findings"
        fi
    done < <(jq -r '.[] | .SourceFile as $f | to_entries[]
                    | select(.key != "SourceFile" and (.value | tostring | length) > 0)
                    | [$f, .key, (.value | tostring)] | @tsv' "$work/out")
}

#--------------------------------------------------------------------------
# What each tool reads, its sample, and its run over the repository.

semgrep_unparsed=0
sample="$work/sample"
mkdir -p "$sample"

case "$tool" in
  actionlint)
    refuse_file .github/actionlint.yaml .github/actionlint.yml
    pick '^\.github/workflows/[^/]+\.ya?ml$'; targets=("${picked[@]}")
    refuse "a shellcheck disable directive" "$shellcheck_disable" "${targets[@]}"
    need "${targets[@]}"
    cat > "$sample/t.yml" <<'EOF'
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    bogus: 1
    steps:
      - run: echo $1
EOF
    # The unquoted variable is shellcheck's to find: proof actionlint runs it.
    actionlint_scan "$sample/t.yml"
    grep -q $'^shellcheck\t' "$findings" || fail "did not run shellcheck on its known sample's run: block"
    expect_caught "an unknown key, and an unquoted variable" actionlint_scan "$sample/t.yml"
    actionlint_scan "${targets[@]}" ;;

  shellcheck)
    pick '\.(sh|bash)$' is_shell; targets=("${picked[@]}")
    texts=(); for f in "${all_files[@]}"; do [ -z "${is_text[$f]:-}" ] || texts+=("$f"); done
    refuse "a shellcheck disable directive" "$shellcheck_disable" "${texts[@]}"
    need "${targets[@]}"
    cat > "$sample/t.sh" <<'EOF'
#!/bin/sh
echo $1
EOF
    expect_caught "an unquoted variable" shellcheck_scan "$sample/t.sh"
    shellcheck_scan "${targets[@]}" ;;

  trufflehog)
    [ "$(git rev-parse --is-shallow-repository)" = false ] || fail "the checkout is shallow: fetch the full history"
    git -C "$sample" init -q
    printf 'github_token = "ghp_%s"\naws_access_key_id = AKIA%s\naws_secret_access_key = %s\n' \
        "$(random 'A-Za-z0-9' 36)" "$(random 'A-Z2-7' 16)" "$(random 'A-Za-z0-9/+' 40)" > "$sample/config"
    git -C "$sample" add config
    git -C "$sample" -c user.name=sample -c user.email=sample@example.invalid commit -q -m sample
    expect_caught "a GitHub token and an AWS key, made up just now" trufflehog_scan "$sample"
    mkdir -p "$sample/files"
    cp "$sample/config" "$sample/files/config"
    expect_caught "the same token and key, as files" trufflehog_files_scan "$sample/files"
    targets=("the full git history" "the files as they are in HEAD")
    trufflehog_scan "$root"
    # HEAD's files, from git itself (git archive would honour export-ignore).
    head="$work/head"
    mkdir -p "$head"
    while IFS= read -r -d '' entry; do
        meta=${entry%%$'\t'*} path=${entry#*$'\t'}
        read -r _ type oid <<<"$meta"
        [ "$type" = blob ] || continue
        mkdir -p "$head/$(dirname -- "$path")"
        git cat-file blob "$oid" > "$head/$path"
    done < <(git -c core.quotePath=false ls-tree -r -z --full-tree HEAD)
    trufflehog_files_scan "$head" ;;

  cfn-lint|checkov)
    refuse_file .cfnlintrc .cfnlintrc.yaml .cfnlintrc.yml .checkov.yaml .checkov.yml
    pick '\.(ya?ml|json|template)$'; templates=("${picked[@]}")
    targets=()
    # AWSTemplateFormatVersion is optional, so also any file with a top-level
    # Resources section of AWS:: types.
    for f in "${templates[@]}"; do
        if grep -q AWSTemplateFormatVersion -- "$f" \
            || { grep -qE '^"?Resources"?[[:space:]]*:|"Resources"[[:space:]]*:' -- "$f" && grep -q 'AWS::' -- "$f"; }; then
            targets+=("$f")
        fi
    done
    need "${targets[@]}"
    refuse "a cfn-lint or Checkov setting inside a template" 'cfn-lint|checkov|bridgecrew|cortex' "${targets[@]}"
    printf 'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  Bucket:\n    Type: AWS::S3::Bucket\n    Properties:\n      NoSuchProperty: 1\n' > "$sample/t.yaml"
    if [ "$tool" = cfn-lint ]; then
        expect_caught "a property S3 doesn't have" cfn_lint_scan "$sample/t.yaml"
        cfn_lint_scan "${targets[@]}"
    else
        printf 'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  Bucket:\n    Type: AWS::S3::Bucket\n' > "$sample/t.yaml"
        expect_caught "an S3 bucket with no protections" checkov_scan "$sample/t.yaml"
        checkov_scan "${targets[@]}"
    fi ;;

  bandit)
    pick '\.py$' is_python; targets=("${picked[@]}")
    need "${targets[@]}"
    printf 'import subprocess\nimport sys\nsubprocess.call(sys.argv[1], shell=True)\n' > "$sample/t.py"
    expect_caught "a shell command built from input" bandit_scan "$sample/t.py"
    bandit_scan "${targets[@]}" ;;

  zizmor)
    refuse_file zizmor.yml .github/zizmor.yml
    pick '^\.github/(workflows/[^/]+|actions/[^/]+/action|dependabot)\.ya?ml$'; targets=("${picked[@]}")
    texts=(); for f in "${all_files[@]}"; do [[ "$f" != .github/* ]] || [ -z "${is_text[$f]:-}" ] || texts+=("$f"); done
    refuse "a zizmor ignore comment" '#[[:space:]]*zizmor:[[:space:]]*ignore\[' "${texts[@]}"
    need "${targets[@]}"
    mkdir -p "$sample/.github/workflows"
    cat > "$sample/.github/workflows/t.yml" <<'EOF'
on: issues
permissions: {}
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - run: echo "${{ github.event.issue.title }}"
EOF
    expect_caught "an issue title pasted into a shell command" zizmor_scan "$sample/.github/workflows/t.yml"
    # A pin whose comment names the wrong release: only the online audits see
    # it, so this proves they ran (actions/checkout's v7.0.1, called v6.0.0).
    cat > "$sample/.github/workflows/u.yml" <<'EOF'
on: push
permissions: {}
jobs:
  u:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v6.0.0
        with:
          persist-credentials: false
EOF
    zizmor_scan "$sample/.github/workflows/u.yml"
    grep -q $'^ref-version-mismatch\t' "$findings" || fail "zizmor's online audits didn't run on their known sample"
    echo "ok   catches its known sample for the online audits (a pin labelled with the wrong release)"
    : > "$findings"
    zizmor_scan "${targets[@]}" ;;

  semgrep)
    : "${SEMGREP_RULES:?set SEMGREP_RULES to the pinned semgrep-rules checkout}"
    export SEMGREP_SEND_METRICS=off
    is_script() { is_shell "$1" || is_python "$1"; }
    pick '\.(js|mjs|cjs|py|sh|bash|html?|ya?ml)$' is_script; targets=("${picked[@]}")
    need "${targets[@]}"
    printf 'const input = location.hash;\neval(input);\n' > "$sample/t.js"
    expect_caught "eval() of text from the address bar" semgrep_scan "$sample/t.js"
    semgrep_scan "${targets[@]}" ;;

  exiftool)
    # Every version of every such file in the history, not just today's: the
    # history is as public as the tree, and a picture replaced by a cleaned
    # copy is still in it. Each distinct file once, by its blob id.
    [ "$(git rev-parse --is-shallow-repository)" = false ] || fail "the checkout is shallow: fetch the full history"
    mapfile -t commits < <(git rev-list HEAD)
    need "${commits[@]}"
    declare -A seen=()
    targets=()
    for c in "${commits[@]}"; do
        while IFS= read -r -d '' entry; do
            meta=${entry%%$'\t'*} path=${entry#*$'\t'}
            read -r _ type oid <<<"$meta"
            [ "$type" = blob ] && [ -z "${seen[$oid]:-}" ] || continue
            shopt -s nocasematch
            m=0
            { [[ "$path" =~ $documents ]] || [[ "$path" =~ $media ]] || [[ "$path" =~ $extra_re ]]; } && m=1
            [[ ! "$path" =~ $skip_re ]] || m=0
            [[ ! "$path" =~ $archive_re ]] || { shopt -u nocasematch; fail "$path (in ${c:0:12}) is an archive, which exiftool can't look inside"; }
            shopt -u nocasematch
            [ "$m" -eq 1 ] || continue
            seen[$oid]=1
            mkdir -p "$work/blobs/$oid"
            copy="$work/blobs/$oid/${path##*/}"
            git cat-file blob "$oid" > "$copy"
            label[$copy]="$path (blob ${oid:0:12})" origin[$copy]="$path"
            targets+=("$copy")
        done < <(git -c core.quotePath=false ls-tree -r -z --full-tree "$c")
    done
    need "${targets[@]}"
    # The smallest valid PNG, then a location and a name written into it.
    python3 - "$sample/t.png" <<'PY'
import struct, sys, zlib
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\x00")) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
PY
    exiftool -q -overwrite_original -GPSLatitude=30.27 -GPSLatitudeRef=N \
        -GPSLongitude=97.74 -GPSLongitudeRef=W -Artist="Sample Person" "$sample/t.png"
    expect_caught "a picture with a location and a name in it" exiftool_scan "$sample/t.png"
    exiftool_scan "${targets[@]}" ;;

  *)
    echo "security-scan.sh: unknown tool '$tool'" >&2; exit 2 ;;
esac

[ ! -s "$findings" ] || sort -u -o "$findings" "$findings"
n=$(count)
echo "$tool read ${#targets[@]} target(s); $n finding(s)"
if [ "$tool" = semgrep ] && [ "$semgrep_unparsed" -gt 0 ]; then
    # A file it couldn't parse is a file it didn't read.
    [ "$mode" = report ] || fail "$semgrep_unparsed file(s) couldn't be parsed"
    echo "::warning title=$tool::$semgrep_unparsed file(s) couldn't be parsed"
fi

if [ "$mode" = gate ]; then
    [ "$n" -eq 0 ] || { sort -u "$findings"; fail "$n finding(s)"; }
    echo "PASS: $tool found nothing"
else
    [ "$n" -eq 0 ] || echo "::warning title=$tool::$n finding(s), report-only until they are triaged (TODO.md)"
    echo "REPORT: $tool, $n finding(s); details are not printed here"
fi
