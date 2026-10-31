# To do

Everything known to need doing in this repository and on the site, so work
can be picked up by anyone — or by a fresh Claude Code session — without
relying on what someone remembers. When an item is done, the pull request
that does it removes it from here and adds it to
[CHANGELOG.md](CHANGELOG.md). How this file is kept is in
[CLAUDE.md](CLAUDE.md#tracking-work-todomd-and-changelogmd).

Some security work is tracked privately with the maintainer until it is
fixed, and appears here only in general terms or not at all: this
repository is treated as public, and an open weakness isn't described in
it.

## How to read it

**Importance**
- **High** — affects visitors' privacy or safety, keeps people from using
  the site, or protects the repository and how changes reach it.
- **Medium** — a real improvement that someone would notice.
- **Low** — tidiness, consistency, or a small risk.

**Difficulty** (a best guess, revised when work starts)
- **Easy** — a small change in this repository, testable before it merges.
- **Medium** — several files, new tooling or tests, or a check across the
  whole site.
- **Hard** — AWS configuration, open questions, or a redesign.

**Needs** — anything beyond a pull request: *AWS access*, an *org owner*
on GitHub, or the *maintainer* (a decision, or a check only they can do).

**From** — where the item came from: a pull request's review, the site
check of 2026-10-31, a website principle in CLAUDE.md that the site doesn't
yet meet (P1–P11), or the maintainer.

Items are listed by importance, then difficulty, so the first rows are the
most worth doing for the least work. IDs are never reused.

## Open

| ID | Item | From | Importance | Difficulty | Needs |
| --- | --- | --- | --- | --- | --- |
| T1 | Serve the fonts from our own site instead of Google Fonts. | P5, P8; site check | High | Easy | — |
| T2 | Stop sending the site's address to other domains with each request, e.g. with a Referrer-Policy. | P6, P11; maintainer's blocker check | High | Easy | — |
| T3 | Apply the GitHub settings in `docs/08-making-changes.md` §2.4: the branch ruleset, squash-only merges, deleting merged branches. | Maintainer (PR #3) | High | Easy | Org owner |
| T4 | Hand over AWS account access to the maintainer. | Handover | High | Easy | Previous maintainer |
| T5 | Make the repository private. | Maintainer decision | High | Easy | Org owner |
| T6 | A full accessibility check: keyboard use and focus, screen readers, dark mode, small screens. | P1 | High | Medium | — |
| T7 | Run the full set of security scanners in GitHub Actions (see notes). | Maintainer | High | Medium | — |
| T8 | Footer headings skip levels (`h4` after an `h2`, or after the `h1`). | P1; site check | Medium | Easy | — |
| T9 | Give each text-size button its own accessible name (all three are "A"). | P1; PR #5 review | Medium | Easy | — |
| T10 | Put the "opens in a new tab" note for screen readers in the markup, so it is there without JavaScript. | P1, P2, P11; PR #5 review | Medium | Easy | — |
| T11 | Say plainly what went wrong when a form can't reach the API, instead of the browser's own error. | P11; PR #5 review | Medium | Easy | — |
| T12 | Say on the privacy page that pages load fonts from Google, until T1 is done. | PR #5 review | Medium | Easy | — |
| T13 | Check the site with each blocker on its own, in a clean browser profile (AdGuard, DuckDuckGo, Firefox's Enhanced Tracking Protection). | P3, P7, P10 | Medium | Easy | Maintainer |
| T14 | A tested script that checks a squash merge's subject and message (see notes). | PR #4 review | Medium | Medium | — |
| T15 | Automate the independent pull request review in GitHub Actions. | Maintainer | Medium | Medium | Maintainer (API key) |
| T16 | Return a real 404 status for a missing page (today it redirects twice and serves the error page with 200), and make `404.html`'s asset paths absolute. | PR #5 review | Medium | Medium | AWS access |
| T17 | Commit the accessibility checks used for CLAUDE.md's table as a tested script. | P1; PR #5 review | Medium | Medium | — |
| T18 | Widen the secrets rules (see notes). | PR #3 reviews | Medium | Medium | — |
| T19 | Check pull request titles and descriptions before merge; today they reach `main` as the squash subject unchecked. | PR #3 review | Medium | Medium | — |
| T20 | Put the API on our own domain (e.g. `api.austinareafirewise.org`), so blockers and NoScript see it as first-party. | P5, P11, P9 | Medium | Hard | AWS access |
| T21 | Find out whether Amplify, API Gateway and the sign-in domain can require TLS 1.3, and set it where they can. | P9 | Medium | Hard | AWS access |
| T22 | Pages and forms that work without JavaScript, where practical (news, board and resources could be published as HTML). | P2 | Medium | Hard | — |
| T23 | Mention the burn ban in the home page's note for visitors without JavaScript. | P2; PR #5 review | Low | Easy | — |
| T24 | Give the training page a skip link and a main landmark. | P1; PR #5 review | Low | Easy | — |
| T25 | Stop publishing the training material's developer scripts and README with the site. | Site check | Low | Easy | — |
| T26 | Docs tidy-up: `docs/08` §2.3's merge command to match CLAUDE.md, and "the first commit's subject" (it is the only commit's); `docs/08` §1.1's personal home path; a name listed twice in `.gitignore`. | PR #4, #5 reviews | Low | Easy | — |
| T27 | Hooks to use `--exit-code 3` like the scan script; the scan script's `for … in $(git rev-list …)` loop. | PR #4 review | Low | Easy | — |
| T28 | Point volunteers to GitHub's private noreply address for commits; commit author addresses aren't checked. | PR #3 review | Low | Easy | — |
| T29 | Redirect the bare domain with a permanent (301) redirect, not a temporary one. | PR #5 review | Low | Medium | AWS access |
| T30 | A `pre-merge-commit` hook, so a local merge with no conflict is checked like a commit. | PR #4 review | Low | Medium | — |
| T31 | Secrets check hardening: warn when a branch changes `.githooks/` or `.github/`, not only the rules; restrict the required check's source to GitHub Actions; consider a tag ruleset (tags aren't scanned). | PR #3 review | Low | Medium | Org owner (ruleset) |
| T32 | The GitHub check and the deploy gate decide "binary" slightly differently (both fail closed). | PR #3 review | Low | Medium | — |

## Notes

**T7 — security scanners.** Semgrep (JavaScript, Python, workflows),
Checkov and cfn-lint (CloudFormation), zizmor and actionlint (workflows),
Bandit (Python), shellcheck (shell), TruffleHog (a second secrets engine)
and exiftool (metadata in added images and media), each pinned by version
and checksum, failing on new findings, with accepted existing findings
written down with a reason.

**T14 — squash-message check.** It must fail closed, use none of gitleaks'
ways of silencing a finding, and be shown to catch samples it must catch.
Each of these must be a test that fails it: no message file or an empty
one; an empty or unknown commit SHA (`git show :path` reads the staged
copy); a rule file that is missing, empty, or has only irrelevant or
switched-off rules; a `gitleaks:allow` marker; a `.gitleaksignore` in the
current directory; a baseline file (`-b`); `--exit-code 0`. Choose samples
with care: an obviously fake key may not match.

**T18 — secrets rules.** More providers (prodigy.net, twc.com, charter.net,
earthlink.net and others); more password flags (`--previous-password`,
`--proposed-password`); addresses written as HTML entities (`jane&#64;…`);
fail if a rules file loads no rules at all; and two false alarms —
`srcset` image lists (`hero@2x.jpg 2x`) read as address lists, and
`x@example.org.dell.com` counts as an example address.
