#!/usr/bin/env bash
# Install one pinned scanner, checked against its pinned SHA-256 or hashes.
#
#     .github/scripts/install-scanner.sh <tool>
#
# Release files: version and checksum from .github/scan/tools.env. Python
# tools: every package, dependencies included, from
# .github/scan/requirements/<tool>.txt with --require-hashes, into a virtual
# environment of their own. Installs into $SCANNER_BIN (default
# $RUNNER_TEMP/scanners/bin) and prints the tool's version, so the log shows
# what ran.
set -euo pipefail

tool="${1:?usage: install-scanner.sh <tool>}"
root="$(git rev-parse --show-toplevel)"
bin="${SCANNER_BIN:-${RUNNER_TEMP:?}/scanners/bin}"
mkdir -p "$bin"
base="$(cd "$bin/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# shellcheck source=.github/scan/tools.env
. "$root/.github/scan/tools.env"

# Download a release file into $got and check it before anything reads it.
# Called directly, never inside $(...), where set -e is off and a failed
# check would carry on.
fetch() {  # url sha256
    got="$work/${1##*/}"
    curl -sSfL --retry 3 -o "$got" "$1"
    if ! sha256sum -c --quiet - <<<"$2  $got" >&2; then
        echo "install-scanner.sh: checksum mismatch for $1" >&2
        exit 1
    fi
}

python_tool() {  # name: venv with only the hash-pinned packages
    local venv="$base/${1}-venv"
    python3 -m venv "$venv"
    "$venv/bin/python" -m pip install --quiet --disable-pip-version-check \
        --require-hashes --no-deps --only-binary :all: \
        -r "$root/.github/scan/requirements/$1.txt"
    ln -sf "$venv/bin/$1" "$bin/$1"
}

case "$tool" in
  actionlint)
    fetch "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" "$ACTIONLINT_SHA256"; f="$got"
    tar -xzf "$f" -C "$bin" actionlint
    "$bin/actionlint" -version | head -1 ;;
  shellcheck)
    fetch "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz" "$SHELLCHECK_SHA256"; f="$got"
    tar -xJf "$f" -C "$work"
    install "$work/shellcheck-v${SHELLCHECK_VERSION}/shellcheck" "$bin/"
    "$bin/shellcheck" --version | sed -n 2p ;;
  trufflehog)
    fetch "https://github.com/trufflesecurity/trufflehog/releases/download/v${TRUFFLEHOG_VERSION}/trufflehog_${TRUFFLEHOG_VERSION}_linux_amd64.tar.gz" "$TRUFFLEHOG_SHA256"; f="$got"
    tar -xzf "$f" -C "$bin" trufflehog
    "$bin/trufflehog" --version 2>&1 | head -1 ;;
  exiftool)
    fetch "https://cpan.metacpan.org/authors/id/E/EX/EXIFTOOL/Image-ExifTool-${EXIFTOOL_VERSION}.tar.gz" "$EXIFTOOL_SHA256"; f="$got"
    dest="$base/exiftool-dist"
    mkdir -p "$dest"
    tar -xzf "$f" -C "$dest" --strip-components=1
    ln -sf "$dest/exiftool" "$bin/exiftool"
    echo "exiftool $("$bin/exiftool" -ver)" ;;
  semgrep|checkov|cfn-lint|bandit|zizmor)
    python_tool "$tool"
    "$bin/$tool" --version 2>&1 | grep -v -i warning | head -1 ;;
  *)
    echo "install-scanner.sh: unknown tool '$tool'" >&2; exit 2 ;;
esac
