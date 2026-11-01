#!/bin/bash
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

tool="${1:?usage: security-scan.sh <tool> <gate|report>}"
mode="${2:?usage: security-scan.sh <tool> <gate|report>}"
case "$mode" in gate|report) ;; *) echo "mode must be gate or report" >&2; exit 2 ;; esac

cd "$(git rev-parse --show-toplevel)"
root="$PWD"
work="$(mktemp -d)"
findings="$work/findings.tsv"      # rule <TAB> file:line, one per finding

# Scripts parse git's output: force color off whatever the user's config says.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=color.ui GIT_CONFIG_VALUE_0=never
export GIT_CONFIG_KEY_1=color.diff GIT_CONFIG_VALUE_1=never

fail() { echo "::error title=$tool::$*"; exit 1; }

# Tracked files matching the given pathspecs, NUL-separated, names unquoted.
tracked() { git -c core.quotePath=false ls-files -z -- "$@"; }

# Fail if any tracked file matching the pathspecs contains the pattern.
refuse() {  # description, extended regex, pathspec...
    local what="$1" re="$2"; shift 2
    local hits
    hits=$(git -c core.quotePath=false grep -l -I -E -e "$re" -- "$@" || true)
    [ -z "$hits" ] || fail "$what found (not allowed; exceptions go in .github/scan/): $(tr '\n' ' ' <<<"$hits")"
}

refuse_file() {  # path...: config files the tool would pick up by itself
    local f
    for f in "$@"; do [ ! -e "$f" ] || fail "$f found: the tool would read it on its own"; done
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

trufflehog_scan() {  # git repository
    local rc=0 bytes
    trufflehog git "file://$1" --json --no-verification --no-update \
        --no-ignore-tag --fail --fail-on-scan-errors \
        --exclude-paths "$work/trufflehog-exclude" \
        > "$work/out" 2> "$work/err" || rc=$?
    # 0 clean, 183 findings (--fail); anything else is trufflehog failing.
    [ "$rc" -eq 0 ] || [ "$rc" -eq 183 ] || fail "trufflehog failed (exit $rc): $(tail -5 "$work/err")"
    bytes=$(grep -oE '"bytes": ?[0-9]+' "$work/err" | grep -oE '[0-9]+$' | tail -1 || true)
    [ "${bytes:-0}" -gt 0 ] || fail "trufflehog read nothing (no bytes scanned reported)"
    jq -r '[.DetectorName, (.SourceMetadata.Data.Git.file + ":" + (.SourceMetadata.Data.Git.line|tostring) + " in " + .SourceMetadata.Data.Git.commit[0:12])] | @tsv' \
        "$work/out" >> "$findings"
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
    jq -r 'if type == "array" then .[] else . end | .results.failed_checks[]
           | [.check_id, (.file_path + ":" + (.file_line_range[0]|tostring))] | @tsv' \
        "$work/out" >> "$findings"
}

bandit_scan() {  # python files...
    # Medium and High severity only. Low findings (importing subprocess, a
    # fixed command run by name) aren't faults in the local helper scripts
    # here; report them by dropping --severity-level when reviewing by hand.
    bandit --format json --quiet --ignore-nosec --severity-level medium \
        -- "$@" > "$work/out" 2> "$work/err" || true
    jq -e . "$work/out" > /dev/null 2>&1 || fail "bandit failed (no JSON report): $(cat "$work/err")"
    jq -e '(.errors | length) == 0 and .metrics._totals.loc > 0' "$work/out" > /dev/null \
        || fail "bandit read nothing, or couldn't read a file: $(jq -c '.errors' "$work/out")"
    jq -r '.results[] | [.test_id, (.filename + ":" + (.line_number|tostring))] | @tsv' \
        "$work/out" >> "$findings"
}

zizmor_scan() {  # workflow and action files...
    local rc=0
    zizmor --offline --config "$root/.github/scan/zizmor.yml" --format json \
        -- "$@" > "$work/out" 2> "$work/err" || rc=$?
    # 0 clean; 10-14 findings, by highest severity; anything else is failing.
    [ "$rc" -eq 0 ] || { [ "$rc" -ge 10 ] && [ "$rc" -le 14 ]; } \
        || fail "zizmor failed (exit $rc): $(tail -5 "$work/err")"
    jq -e 'type == "array"' "$work/out" > /dev/null 2>&1 || fail "zizmor gave no JSON report"
    jq -r '.[] | . as $f | .locations[0] |
           [$f.ident, (.symbolic.key.Local.given_path + ":" + ((.concrete.location.start_point.row + 1)|tostring))] | @tsv' \
        "$work/out" >> "$findings"
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
    semgrep_unparsed=$(jq '[.errors[] | select(.path != null)] | length' "$work/out")
}

exiftool_scan() {  # files...
    local tags=(-GPS:all -XMP-exif:GPS* -Artist -Author -XMP-dc:Creator
                -By-line -LastModifiedBy -OwnerName -CameraOwnerName
                -SerialNumber -BodySerialNumber -LensSerialNumber
                -InternalSerialNumber -Company -Manager)
    exiftool -json -G1 -a -q -q "${tags[@]}" -- "$@" > "$work/out" 2> "$work/err" || true
    jq -e 'type == "array"' "$work/out" > /dev/null 2>&1 || fail "exiftool gave no JSON report: $(cat "$work/err")"
    # One entry per file, and none it couldn't read.
    [ "$(jq length "$work/out")" -eq "$#" ] || fail "exiftool read $(jq length "$work/out") of $# files"
    jq -e 'all(.[]; has("ExifTool:Error") | not)' "$work/out" > /dev/null \
        || fail "exiftool couldn't read: $(jq -r '[.[] | select(has("ExifTool:Error")) | .SourceFile] | join(" ")' "$work/out")"
    # Each non-empty tag is a finding, unless allowed by path, tag and the
    # SHA-256 of its value (so the allowed list holds no one's name).
    jq -r '.[] | .SourceFile as $f | to_entries[]
           | select(.key != "SourceFile" and (.value | tostring | length) > 0)
           | [$f, .key, (.value | tostring)] | @tsv' "$work/out" |
    while IFS=$'\t' read -r file tag value; do
        hash=$(printf '%s' "$value" | sha256sum | cut -d' ' -f1)
        if ! grep -qxF "$(printf '%s\t%s\t%s' "$file" "$tag" "$hash")" \
                <(grep -v '^#' "$root/.github/scan/exiftool-allowed.txt" | cut -f1-3); then
            printf '%s\t%s\n' "$tag" "$file" >> "$findings"
        fi
    done
}

#--------------------------------------------------------------------------
# What each tool reads, its sample, and its run over the repository.

semgrep_unparsed=0
sample="$work/sample"
mkdir -p "$sample"

case "$tool" in
  actionlint)
    refuse_file .github/actionlint.yaml .github/actionlint.yml
    refuse "a shellcheck disable directive" '#[[:space:]]*shellcheck[[:space:]]+disable=' '.github/workflows/*'
    mapfile -d '' targets < <(tracked '.github/workflows/*.yml' '.github/workflows/*.yaml')
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
    refuse "a shellcheck disable directive" '#[[:space:]]*shellcheck[[:space:]]+disable=' ':(attr:!binary)'
    targets=()
    while IFS= read -r -d '' f; do
        case "$f" in
          *.sh|*.bash) targets+=("$f") ;;
          *) head -n1 -- "$f" | grep -qE '^#!.*[/ ](ba|da|k)?sh( |$)' && targets+=("$f") || true ;;
        esac
    done < <(tracked ':(attr:!binary)')
    need "${targets[@]}"
    cat > "$sample/t.sh" <<'EOF'
#!/bin/sh
echo $1
EOF
    expect_caught "an unquoted variable" shellcheck_scan "$sample/t.sh"
    shellcheck_scan "${targets[@]}" ;;

  trufflehog)
    : > "$work/trufflehog-exclude"
    [ "$(git rev-parse --is-shallow-repository)" = false ] || fail "the checkout is shallow: fetch the full history"
    git -C "$sample" init -q
    printf 'github_token = "ghp_%s"\naws_access_key_id = AKIA%s\naws_secret_access_key = %s\n' \
        "$(random 'A-Za-z0-9' 36)" "$(random 'A-Z2-7' 16)" "$(random 'A-Za-z0-9/+' 40)" > "$sample/config"
    git -C "$sample" add config
    git -C "$sample" -c user.name=sample -c user.email=sample@example.invalid commit -q -m sample
    expect_caught "a GitHub token and an AWS key, made up just now" trufflehog_scan "$sample"
    # The hash-locked requirements hold only package pins and their SHA-256
    # hashes, some of which TruffleHog's Sentry detector reads as tokens. They
    # are left out of its scan once every line is shown to be one of those;
    # gitleaks still reads them.
    bs=$'\\\\'       # a regex for one backslash
    pin="[A-Za-z0-9._-]+==[A-Za-z0-9.+!-]+( ;[ A-Za-z0-9_.<>=!'\"()-]+)? $bs"
    hash="    --hash=sha256:[0-9a-f]{64}( $bs)?"
    via='    # via( -r \.github/scan/requirements/[a-z-]+\.in| [A-Za-z0-9._-]+)?|    #   [A-Za-z0-9._ (),-]+'
    mapfile -d '' locks < <(tracked '.github/scan/requirements/*.txt')
    need "${locks[@]}"
    for f in "${locks[@]}"; do
        ! grep -qvxE "$pin|$hash|$via" -- "$f" \
            || fail "$f has a line that isn't a pin, a hash or a comment (line $(grep -nvxE "$pin|$hash|$via" -- "$f" | head -1 | cut -d: -f1))"
    done
    printf '%s\n' '^\.github/scan/requirements/[a-z-]+\.txt$' > "$work/trufflehog-exclude"
    targets=("the full git history")
    trufflehog_scan "$root" ;;

  cfn-lint|checkov)
    refuse_file .cfnlintrc .cfnlintrc.yaml .cfnlintrc.yml .checkov.yaml .checkov.yml
    mapfile -d '' templates < <(tracked '*.yaml' '*.yml' '*.json' '*.template')
    targets=()
    for f in "${templates[@]}"; do grep -q AWSTemplateFormatVersion -- "$f" && targets+=("$f"); done
    need "${targets[@]}"
    refuse "a cfn-lint or checkov setting inside a template" 'cfn-lint|checkov' "${targets[@]}"
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
    mapfile -d '' targets < <(tracked '*.py')
    need "${targets[@]}"
    printf 'import subprocess\nimport sys\nsubprocess.call(sys.argv[1], shell=True)\n' > "$sample/t.py"
    expect_caught "a shell command built from input" bandit_scan "$sample/t.py"
    bandit_scan "${targets[@]}" ;;

  zizmor)
    refuse_file zizmor.yml .github/zizmor.yml
    refuse "a zizmor ignore comment" '#[[:space:]]*zizmor:[[:space:]]*ignore\[' '.github/*'
    mapfile -d '' targets < <(tracked '.github/workflows/*.yml' '.github/workflows/*.yaml' \
        '.github/actions/*/action.yml' '.github/actions/*/action.yaml' '.github/dependabot.yml')
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
    zizmor_scan "${targets[@]}" ;;

  semgrep)
    : "${SEMGREP_RULES:?set SEMGREP_RULES to the pinned semgrep-rules checkout}"
    export SEMGREP_SEND_METRICS=off
    targets=()
    while IFS= read -r -d '' f; do
        case "$f" in
          *.js|*.mjs|*.cjs|*.py|*.sh|*.bash|*.html|*.htm|*.yml|*.yaml) targets+=("$f") ;;
        esac
    done < <(tracked ':(attr:!binary)')
    need "${targets[@]}"
    printf 'const input = location.hash;\neval(input);\n' > "$sample/t.js"
    expect_caught "eval() of text from the address bar" semgrep_scan "$sample/t.js"
    semgrep_scan "${targets[@]}" ;;

  exiftool)
    targets=()
    while IFS= read -r -d '' f; do
        shopt -s nocasematch
        case "$f" in
          *.png|*.jpg|*.jpeg|*.gif|*.webp|*.heic|*.heif|*.tif|*.tiff|*.bmp|*.svg|\
          *.mp3|*.m4a|*.aac|*.wav|*.ogg|*.flac|*.mp4|*.m4v|*.mov|*.webm|\
          *.pdf|*.docx|*.xlsx|*.pptx|*.odt|*.ods|*.odp) targets+=("$f") ;;
        esac
        shopt -u nocasematch
    done < <(tracked)
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

n=$(count)
echo "$tool read ${#targets[@]} target(s); $n finding(s)"
[ "$tool" != semgrep ] || [ "$semgrep_unparsed" -eq 0 ] || echo "::warning title=$tool::$semgrep_unparsed file(s) couldn't be parsed"

if [ "$mode" = gate ]; then
    [ "$n" -eq 0 ] || { sort -u "$findings"; fail "$n finding(s)"; }
    echo "PASS: $tool found nothing"
else
    [ "$n" -eq 0 ] || echo "::warning title=$tool::$n finding(s), report-only until they are triaged (TODO.md)"
    echo "REPORT: $tool, $n finding(s); details are not printed here"
fi
