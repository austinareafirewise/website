# Changelog

What has been done, newest first by the date each entry was written: one entry
per merged pull request (except Dependabot's dependency updates, which the git
history records), naming any [TODO.md](TODO.md) items it closed. How this file
is kept is in [CLAUDE.md](CLAUDE.md#tracking-work-todomd-and-changelogmd).
Work from before this file started is in the git history.

## 2026-11-02

- **Fail the security scan on any new Semgrep finding**
  ([#14](https://github.com/austinareafirewise/website/pull/14)). Semgrep's
  64 findings and the 3 files it can't parse were triaged with the
  maintainer: none is a security problem. The ones judged harmless are
  listed in `.github/scan/semgrep-allowed.txt`, each by rule, file and the
  SHA-256 of the lines it covers, with its reason, and Semgrep moves from
  report to gate: any finding, unparsed file or time-out not listed fails
  the job, and so does any entry that no longer matches. A gate's
  findings, unparsed files and stale entries are all printed before the
  job fails. Two small items it found become T80 (an unused option that
  sets `innerHTML` in the admin page) and T81 (escaping settings and links
  in two emails, for consistency).
  Closes T47; docs/08 and the scan README say what changed.

- **Put work that unblocks other work first in TODO.md**
  ([#13](https://github.com/austinareafirewise/website/pull/13)). At the
  maintainer's request, an item that others depend on now comes before the
  rest of its importance level, whatever its difficulty, and the more it
  unblocks, the earlier it comes; CLAUDE.md and TODO.md's notes say so, and
  why. The table is re-sorted to match. New dependencies: T66 and T71 on T55,
  and T19 on T14. Items that block others now all say so in their text (T3,
  T6, T14, T20, T55, T63 and T64 gain a note; T36's names T65 too, and T4's
  names all sixteen). CLAUDE.md also gains a rule that nothing waits outside
  the repository: a change that couldn't go into the pull request it belongs
  to (a TODO.md item finished without a pull request of ours, an item or
  lesson learned after approval, a correction to an earlier entry) goes in
  as the first commit of the next pull request we open, rather than waiting
  for a docs pull request of its own; docs/08 says the same. And a lesson
  about comparing a recorded commit message.

- **Track crediting other sources' information on the site**
  ([#12](https://github.com/austinareafirewise/website/pull/12)). TODO.md
  gains T75, at the maintainer's request after looking at the home page's
  fire danger sign: wherever the site shows another source's information
  (the fire danger rating, the burn-ban status), say whose it is, how
  current it is, that our copy is for information only, and where the
  official source is. T59 now also asks that links to an official source
  say so. The entry for #11 below now lists T71, which it updated.

## 2026-11-01

- **Check every page for accessibility on every push**
  ([#11](https://github.com/austinareafirewise/website/pull/11)). A new
  workflow opens every page under `src/` in a real browser, with requests to
  other sites blocked, and fails on axe's WCAG 2.2 A and AA rules in four
  modes (normal, dark, a 320-pixel phone, no JavaScript) and on a keyboard
  check at desktop and phone widths (Tab reaches every control without a
  trap, focus visible on screen). Reflow on a
  phone and axe's best-practice rules are reported until T73, T74, T8 and T24
  are done. Pinned by an npm lock file and a container image digest, and
  each check must first catch a known-bad sample; a page that shows nothing
  to check fails too. Closes T17; updates T6, T43 and T71; adds T73,
  T74, T76, T77, T78 and T79.

- **Track the GitHub community-profile items**
  ([#10](https://github.com/austinareafirewise/website/pull/10)). TODO.md
  gains T64 to T72, at the maintainer's request after reading the
  repository's community profile: a security policy with private reporting,
  a code of conduct, a contributing guide, a licence, issue and pull request
  templates, an accessibility statement and guide, and content reports, each
  with what it should hold.

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
  domain); updates T4, T33, T34, T47 and T49; and adds T55 to T63. T33, T57 and
  T61 record what test sign-ups on the live site showed. CLAUDE.md also now
  asks for every security scan job, not only gitleaks, to pass before a merge;
  dates changelog entries in the maintainer's own time zone; and has every
  reviewer's brief state the maintainer's own observations as given and the
  bar for each rank of finding.

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
