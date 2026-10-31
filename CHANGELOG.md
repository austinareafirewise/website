# Changelog

What has been done, newest first: one entry per merged pull request, naming
any [TODO.md](TODO.md) items it closed. How this file is kept is in
[CLAUDE.md](CLAUDE.md#tracking-work-todomd-and-changelogmd). Work from
before this file started is in the git history.

## 2026-10-31

- **Track the work: TODO.md and CHANGELOG.md**
  ([#6](https://github.com/austinareafirewise/website/pull/6)). TODO.md
  lists every known open item with where it came from, its importance and
  its difficulty, most important and easiest first; this file records what
  was done; CLAUDE.md says how both are kept.
- **How the website is run, and where it stands today**
  ([#5](https://github.com/austinareafirewise/website/pull/5)). CLAUDE.md
  gains the eleven principles the site is run by, with a dated table of
  where the site stands against each, from the live site, `src/` and the
  maintainer's own browser with several blockers on. Reviewers are given
  the principles; testing a check means both its exit code and its output.
- **A CLAUDE.md: how work is done here, and what has been learned**
  ([#4](https://github.com/austinareafirewise/website/pull/4)). The
  standard all work meets, the ground rules (maintainers, pull requests,
  approval and merging, force-pushes, the repository treated as public),
  the review process with its stop conditions, and lessons learned. Also
  corrected which git hooks run when, in `docs/08-making-changes.md`.
- **Check every change for secrets and personal data**
  ([#3](https://github.com/austinareafirewise/website/pull/3)). gitleaks
  rules for personal email addresses and passwords alongside the standard
  ones; refusal of files gitleaks can't read; checks in local hooks, on
  every branch push, and before every deploy, each failing closed.
  `deploy.yml` hardened. The docs describe working through squash-merged
  pull requests.
