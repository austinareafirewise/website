# Security scanners

`.github/workflows/security-scan.yml` runs these on every push, one job each,
through `.github/scripts/security-scan.sh`:

| Tool | Reads | Mode |
| --- | --- | --- |
| actionlint (with shellcheck) | workflows, including their `run:` blocks | gate |
| shellcheck | shell scripts (`.sh`, or a shell `#!` line) | gate |
| TruffleHog | every commit in the history, and the files as they are in HEAD | gate |
| cfn-lint | CloudFormation templates | gate |
| Bandit | Python | gate |
| zizmor | workflows, actions, Dependabot's config (online, read-only token) | gate |
| exiftool | names and locations in pictures, sound, video and documents, every version in the history | gate |
| Checkov | CloudFormation templates | report |
| Semgrep | JavaScript, Python, shell, HTML, YAML | gate |

*Gate* fails on any finding and prints its rule, file and line. *Report*
prints only a count, because Actions logs are as public as the repository;
a tool runs that way while its existing findings are triaged, and moves
to gate in a pull request of its own (TODO.md). Semgrep moved on
2026-11-02. In both modes a check fails if
the tool errors, reads nothing, or misses the known-bad sample it is given
first.

## Exceptions

All in one place, each with its reason:

- `security-scan.sh`: cfn-lint's W3002 (the templates are meant for
  `aws cloudformation package`); Bandit reports Medium and High only;
  TruffleHog drops a Sentry result in the hash-locked requirements only where
  that line, in that commit, is a hash line holding what was matched (its
  Sentry detector misreads hashes listed under a package named
  `policy-sentry`).
- `zizmor.yml`: the `self-repository` audit, until actionlint accepts the
  syntax it asks for.
- `exiftool-allowed.txt`: metadata allowed by file, tag and the SHA-256 of
  its value; the file's header says how to compute the hash.
- `semgrep-allowed.txt`: Semgrep findings allowed by rule, file and the
  SHA-256 of the lines they cover, and files Semgrep can't parse, by file
  and error type. The scan fails on any time-out, on any finding or
  unparsed file not listed, and on an entry that no longer matches
  anything, so the list can't go stale. Run on your own computer, it prints
  the hash of each finding that isn't listed; the file's header says how an
  entry is written.

Every other way the tools offer to silence a finding (inline comments, their
own config files) is refused.

## Running a scan on your own computer

`.github/scripts/scan-locally.sh <tool>` installs the pinned tool, checked
against its pinned hashes, into `~/.cache/aafa-scan` (or
`$XDG_CACHE_HOME/aafa-scan`, or `$AAFA_SCAN_CACHE`), fetches Semgrep's rules
at the commit the workflow pins, and runs the same scan as the job. Its header
lists what it needs and which tools it covers: the Python ones and exiftool
(the rest are pinned as Linux builds). It is how to get the hash of a Semgrep
finding that isn't listed yet, which the scan on GitHub doesn't print.

## Moving a pin

Choose a release at least seven days old. Dependabot isn't set up to move
these (TODO.md, T50).

- **Release files** (`tools.env`): set the version and its SHA-256, and check
  the checksum against both GitHub's record of the file
  (`gh api repos/<owner>/<repo>/releases/tags/<tag>`, its `digest`) and the
  project's own published checksums. exiftool isn't released on GitHub:
  check it against CPAN's `CHECKSUMS` file and a download of your own.
- **Python tools** (`requirements/`): change the version in `<tool>.in`, then
  regenerate `<tool>.txt` with every package's hashes, using a date seven days
  back:

  ```bash
  uv pip compile --universal --python-version 3.12 --generate-hashes --no-header --exclude-newer <YYYY-MM-DD>T00:00:00Z .github/scan/requirements/<tool>.in -o .github/scan/requirements/<tool>.txt
  ```

- **Semgrep's rules**: the `ref:` of the semgrep-rules checkout in the
  workflow, a full commit SHA.

A pull request that moves a pin shows the new version's findings in its own
run, so read that run before merging. Moving Semgrep or its rules can also
make entries in `semgrep-allowed.txt` stale, or bring findings it doesn't
list: run `.github/scripts/scan-locally.sh semgrep` to see each with its
hash, and update the list in the same pull request.
