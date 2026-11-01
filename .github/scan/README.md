# Security scanners

`.github/workflows/security-scan.yml` runs these on every push, one job each,
through `.github/scripts/security-scan.sh`:

| Tool | Reads | Mode |
| --- | --- | --- |
| actionlint (with shellcheck) | workflows, including their `run:` blocks | gate |
| shellcheck | shell scripts (`.sh`, or a shell `#!` line) | gate |
| TruffleHog | every commit in the history | gate |
| cfn-lint | CloudFormation templates | gate |
| Bandit | Python | gate |
| zizmor | workflows, actions, Dependabot's config (online, read-only token) | gate |
| exiftool | names and locations in pictures, sound, video and documents, every version in the history | gate |
| Checkov | CloudFormation templates | report |
| Semgrep | JavaScript, Python, shell, HTML, YAML | report |

*Gate* fails on any finding and prints its rule, file and line. *Report*
prints only a count, because Actions logs are as public as the repository;
those tools have existing findings still being triaged, and each moves to
gate in a pull request of its own (TODO.md). In both modes a check fails if
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
  its value.

Every other way the tools offer to silence a finding (inline comments, their
own config files) is refused.

## Moving a pin

Choose a release at least seven days old. Dependabot doesn't move these.

- **Release files** (`tools.env`): set the version and its SHA-256, and check
  the checksum against both GitHub's record of the file
  (`gh api repos/<owner>/<repo>/releases/tags/<tag>`, its `digest`) and the
  project's own published checksums.
- **Python tools** (`requirements/`): change the version in `<tool>.in`, then
  regenerate `<tool>.txt` with every package's hashes, using a date seven days
  back:

  ```bash
  uv pip compile --universal --python-version 3.12 --generate-hashes --no-header --exclude-newer <YYYY-MM-DD>T00:00:00Z .github/scan/requirements/<tool>.in -o .github/scan/requirements/<tool>.txt
  ```

- **Semgrep's rules**: the `ref:` of the semgrep-rules checkout in the
  workflow, a full commit SHA.

A pull request that moves a pin shows the new version's findings in its own
run, so read that run before merging.
