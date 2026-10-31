# Changelog

What has been done, newest first by the date each entry was written: one entry
per merged pull request (except Dependabot's dependency updates, which the git
history records), naming any [TODO.md](TODO.md) items it closed. How this file
is kept is in [CLAUDE.md](CLAUDE.md#tracking-work-todomd-and-changelogmd).
Work from before this file started is in the git history.

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
