# Changelog

What has been done, newest first by the date each entry was written: one entry
per merged pull request (except Dependabot's dependency updates, which the git
history records), naming any [TODO.md](TODO.md) items it closed. How this file
is kept is in [CLAUDE.md](CLAUDE.md#tracking-work-todomd-and-changelogmd).
Work from before this file started is in the git history.

## 2026-11-02

- **Keep the documents in sync, and say why practices changed**
  ([#9](https://github.com/austinareafirewise/website/pull/9)). CLAUDE.md
  gains three rules for every document: when one changes, check every other
  document for what must change with it; when a practice is retired, say
  what it was, what replaced it and why; and no code in documents (the
  existing command blocks move into scripts in T55). The docs are brought in
  line with the security scan (PR #8), with pull requests for every change,
  including rollbacks, with the costs and teardown of all three stacks, and
  with the content and members systems being built and live. Closes T38, T39
  and T40, and the docs parts of T26; rewrites T37 (sign-in on our own
  domain) and adds T55 to T58.

## 2026-11-01

- **Run security scanners on every push**
  ([#8](https://github.com/austinareafirewise/website/pull/8)). A new
  workflow runs nine scanners, each in a job of its own: actionlint,
  shellcheck, TruffleHog, cfn-lint, Bandit, zizmor and exiftool fail on any
  finding; Checkov and Semgrep report only a count until their existing
  findings are triaged (T46, T47). Each is pinned by version and checksum,
  refuses the ways it offers to silence a finding, and must first catch a
  known-bad sample. CLAUDE.md gains "Keeping state on local disk": plans and
  progress are written to local files before each step, by Claude and by
  every agent. Closes T7; adds T46–T54.
- **Close T35, and track the deploy upload's error check**
  ([#7](https://github.com/austinareafirewise/website/pull/7)). Removes
  T35: Dependabot's #2, which moved `aws-actions/configure-aws-credentials`
  in `deploy.yml` from v6.2.4 to v6.3.0, was reviewed in one independent
  round, merged, and confirmed by a deploy run by hand. Adds T45, found in
  that review. Closes T35.

## 2026-10-31

- **Track the work: TODO.md and CHANGELOG.md**
  ([#6](https://github.com/austinareafirewise/website/pull/6)). TODO.md lists
  every open item that can be published, with where it came from, its
  importance, its difficulty, what it needs and what it depends on, most
  important and easiest first; this file records what was done. CLAUDE.md says
  how both are kept: out-of-scope findings become TODO items, an item that
  blocks a more important one takes on its importance, and there is one rule
  for how an unfixed weakness is recorded. `docs/08` tells volunteers a pull
  request updates both files.
- **How the website is run, and where it stands today**
  ([#5](https://github.com/austinareafirewise/website/pull/5)). CLAUDE.md
  gains the eleven principles the site is run by, with a dated table of
  where the site stands against each, from the live site, `src/` and the
  maintainer's own browser with several blockers on. Reviewers are given
  the principles; testing a check means both its exit code and its output.
  New lessons: a pipeline's exit code, how `gh` records a squash message,
  probing old TLS with OpenSSL 3, and the limits of the browser's list of
  what a page loaded.
- **A CLAUDE.md: how work is done here, and what has been learned**
  ([#4](https://github.com/austinareafirewise/website/pull/4)). The
  standard all work meets, the ground rules (maintainers, pull requests,
  approval and merging, force-pushes, the repository treated as public),
  the review process with its stop conditions, and lessons learned. Also
  corrected what testing showed wrong elsewhere: which git hooks run when
  (`docs/08-making-changes.md` and a hook's comment), the cleanup after a
  squash merge, and when gitleaks skips its own config file (comments in
  the rules, the hook and the scan script).
- **Check every change for secrets and personal data**
  ([#3](https://github.com/austinareafirewise/website/pull/3)). gitleaks rules
  for personal email addresses and passwords alongside the standard ones;
  refusal of files gitleaks can't read; checks in opt-in local hooks, on every
  branch push, and before every deploy, each failing closed. `deploy.yml`
  hardened. The docs describe working through squash-merged pull requests.
