#!/usr/bin/env bash
# Run the accessibility check on your own computer, as the workflow does.
#
#     .github/a11y/run-local.sh
#
# Installs the pinned tools here (npm ci: exactly the locked versions, each
# checked against its integrity hash, no install scripts), downloads the
# Chromium that the pinned Playwright expects, and runs check.mjs.
#
# On a Mac the first run may ask whether Node can "find devices on your local
# network". The check listens only on this computer (127.0.0.1), so "Don't
# Allow" is fine.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
command -v node > /dev/null || { echo "run-local.sh: Node.js isn't installed" >&2; exit 2; }
cd "$here"
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright install chromium --only-shell
node "$here/check.mjs"
