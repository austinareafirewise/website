#!/usr/bin/env bash
# Run one of the security scans on your own computer, as Security scan does
# on GitHub.
#
#     .github/scripts/scan-locally.sh <tool> [gate|report]
#
# Installs the pinned tool with install-scanner.sh, checked against its
# pinned hashes, into a folder outside the repository ($AAFA_SCAN_CACHE,
# default ~/.cache/aafa-scan); for Semgrep, also fetches its rules at the
# commit the workflow pins. Then runs security-scan.sh in the given mode
# (default gate). Run here rather than on GitHub, a Semgrep finding that
# isn't listed in .github/scan/semgrep-allowed.txt is printed with the hash
# that list needs.
#
# Works for the tools installed from Python packages (semgrep, checkov,
# cfn-lint, bandit, zizmor) and for exiftool. The others are pinned as Linux
# builds for GitHub's runners; on another system, use your own copy.
# Needs bash 4.4 or later (on a Mac, Homebrew's), git, curl, jq, sha256sum,
# and for the Python tools Python 3.12 or 3.13 (the workflow uses 3.12; the
# pinned packages have no builds for newer versions).
set -euo pipefail

# Not ${1:?...}: Semgrep's bash parser can't read <tool> inside it.
[ "$#" -ge 1 ] || { echo "usage: scan-locally.sh <tool> [gate|report]" >&2; exit 2; }
tool="$1"
mode="${2:-gate}"
root="$(git rev-parse --show-toplevel)"
cache="${AAFA_SCAN_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/aafa-scan}"
export SCANNER_BIN="$cache/bin"
mkdir -p "$SCANNER_BIN"

case "$tool" in
  semgrep|checkov|cfn-lint|bandit|zizmor)
    # install-scanner.sh runs python3 from PATH: point it at 3.12 or 3.13.
    py=""
    for p in python3.12 python3.13; do py="$(command -v "$p" || true)"; [ -z "$py" ] || break; done
    [ -n "$py" ] || { echo "scan-locally.sh: $tool needs Python 3.12 or 3.13 (python3.12 or python3.13 on PATH)" >&2; exit 2; }
    mkdir -p "$cache/py"
    ln -sf "$py" "$cache/py/python3"
    PATH="$cache/py:$PATH" "$root/.github/scripts/install-scanner.sh" "$tool" ;;
  exiftool)
    "$root/.github/scripts/install-scanner.sh" "$tool" ;;
  *)
    echo "scan-locally.sh: $tool is pinned as a Linux build; on this system, put your own copy on PATH and run .github/scripts/security-scan.sh" >&2
    exit 2 ;;
esac

if [ "$tool" = semgrep ]; then
    # The rules' commit, from the workflow's checkout of semgrep/semgrep-rules.
    ref="$(awk '/repository: semgrep\/semgrep-rules/ { found = 1 }
                found && /ref:/ { print $2; exit }' "$root/.github/workflows/security-scan.yml")"
    [[ "$ref" =~ ^[0-9a-f]{40}$ ]] || { echo "scan-locally.sh: no pinned semgrep-rules commit in the workflow" >&2; exit 1; }
    rules="$cache/semgrep-rules"
    [ -d "$rules/.git" ] || git clone -q --filter=blob:none --no-checkout https://github.com/semgrep/semgrep-rules.git "$rules"
    git -C "$rules" fetch -q origin "$ref"
    git -C "$rules" -c advice.detachedHead=false checkout -q "$ref"
    [ "$(git -C "$rules" rev-parse HEAD)" = "$ref" ] || { echo "scan-locally.sh: semgrep-rules isn't at $ref" >&2; exit 1; }
    export SEMGREP_RULES="$rules"
fi

PATH="$SCANNER_BIN:$PATH" env -u GITHUB_ACTIONS bash "$root/.github/scripts/security-scan.sh" "$tool" "$mode"
