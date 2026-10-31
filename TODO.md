# To do

Everything known to need doing in this repository and on the site, so work
can be picked up by anyone — or by a fresh Claude Code session — without
relying on what someone remembers. When an item is done, the pull request
that does it removes it from here and adds it to
[CHANGELOG.md](CHANGELOG.md). How this file is kept is in
[CLAUDE.md](CLAUDE.md#tracking-work-todomd-and-changelogmd).

This repository is treated as public. An item that touches on a weakness
that isn't fixed is written in general terms, and some security work is
tracked privately with the maintainer until it is done.

## How to read it

**Importance**
- **High** — affects visitors' privacy or safety, keeps people from using
  the site or getting its alerts, or is the only safeguard on how changes
  reach the site.
- **Medium** — a real improvement that someone would notice.
- **Low** — tidiness, consistency, or a small risk.

**Difficulty** — the effort, as a best guess revised when work starts.
Access is separate (see Needs).
- **Easy** — a small change, or a setting someone with access changes.
- **Medium** — several files, new tooling or tests, or a check across the
  whole site.
- **Hard** — open questions, or a redesign.

**Needs** — anything beyond a pull request: *AWS access*, an *org owner* on
GitHub, the *maintainer* (a decision, or something only they can check), or
the *previous maintainer*; a short note in brackets says what for.

**From** — where the item came from: a pull request's review, the site
check of 2026-10-31, a website principle in CLAUDE.md that the site doesn't
yet meet (P1–P11), `infra/README.md`'s list of things only a person can do,
the handover, or the maintainer.

Items are listed by importance, then difficulty, so the first rows are the
most worth doing for the least work. IDs are never reused, so they aren't
in order.

## Open

| ID | Item | From | Importance | Difficulty | Needs |
| --- | --- | --- | --- | --- | --- |
| T3 | Apply the GitHub settings in `docs/08-making-changes.md` §2.4: the branch ruleset, squash-only merges, deleting merged branches. Decide how pull requests from forks are checked, since the secrets check runs on pushes. | Maintainer (PR #3) | High | Easy | Org owner |
| T4 | Hand over AWS account access to the maintainer. | Handover | High | Easy | Previous maintainer |
| T5 | Make the repository private. The rules in CLAUDE.md that treat it as public stay as they are. | Maintainer | High | Easy | Org owner |
| T33 | Email sign-ups: SES production access is requested and pending; follow it up until granted. | `infra/README.md` | High | Easy | AWS access |
| T34 | Text alerts: carrier verification of the toll-free number (submitted), then lifting the SMS sandbox and the monthly spend limit (support cases); or Twilio with 10DLC registration instead. | `infra/README.md` | High | Medium | AWS access |
| T1 | Serve the fonts from our own site instead of Google Fonts (every page, the font files and their licence). | P5, P8; site check | High | Medium | — |
| T2 | Stop sending the site's address to other domains with each request: a referrer policy in every page, or as a response header. | P6, P11; maintainer's blocker check | High | Medium | AWS access (for a header) |
| T6 | A full accessibility check: keyboard use and focus, screen readers, dark mode, small screens. | P1 | High | Medium | — |
| T7 | Run the full set of security scanners in GitHub Actions (see notes). | Maintainer | High | Medium | — |
| T35 | Review and merge Dependabot's PR #2 (configure-aws-credentials 6.2.4 → 6.3.0), then confirm a deploy works. | Open pull request | Medium | Easy | Maintainer (approval, deploy) |
| T11 | Say plainly what went wrong when the API can't be reached: the sign-up and manage forms show the browser's own error, and the board page stays on its "on its way" text. | P11; PR #5 review | Medium | Easy | — |
| T12 | Say on the privacy page that pages load fonts from Google, until T1 is done. | PR #5 review | Medium | Easy | — |
| T13 | Check the site with each blocker on its own, in a clean browser profile: AdGuard, the DuckDuckGo extension, Firefox's Enhanced Tracking Protection, and NoScript (whether it stops the API requests). | P3, P7, P10, P11 | Medium | Easy | Maintainer |
| T8 | Footer headings skip levels (`h4` after an `h2`, or after the `h1`) on most pages. | P1; site check | Medium | Medium | — |
| T9 | Give each text-size button its own accessible name (all three are "A"), on every page. | P1; PR #5 review | Medium | Medium | — |
| T10 | Put the "opens in a new tab" note for screen readers in the markup of every external link, so it is there without JavaScript. | P1, P2, P11; PR #5 review | Medium | Medium | — |
| T14 | A tested script that checks the squash merge's subject and message Claude writes (see notes). | PR #4 review | Medium | Medium | — |
| T15 | Automate the independent pull request review in GitHub Actions. | Maintainer | Medium | Medium | Maintainer (API key) |
| T17 | Commit the accessibility checks used for CLAUDE.md's table as a tested script. | P1; PR #5 review | Medium | Medium | — |
| T18 | Widen the secrets rules' coverage and harden how they fail (the cases are in PR #3's review). | PR #3 reviews | Medium | Medium | — |
| T19 | Check pull request titles and descriptions as they are written: a description is public as soon as it is posted, and a title becomes the squash subject of a pull request with several commits merged on GitHub. (T14 covers the message Claude writes when it merges.) | PR #3 review | Medium | Medium | — |
| T36 | A real mailbox on our own domain (there is no MX record), replacing the interim personal Reply-To on Alliance email, and then the contact address on the site. | `infra/README.md`; maintainer | Medium | Medium | AWS access; maintainer |
| T16 | Return a real 404 status for a missing page. Amplify answers with a redirect to `404.html` and then 200, and `infra/site-stack.yaml` notes that no rule can change that, so this needs another approach. Also make `404.html`'s asset paths absolute. | PR #5 review | Medium | Hard | AWS access |
| T20 | Put the API on our own domain (e.g. `api.austinareafirewise.org`), so blockers and NoScript see it as first-party. | P5, P9, P11 | Medium | Hard | AWS access |
| T21 | Find out whether Amplify, API Gateway, the sign-in domain and the content bucket's upload address can require TLS 1.3, and set it where they can. | P9 | Medium | Hard | AWS access |
| T22 | Pages and forms that work without JavaScript, where practical (news, board and resources could be published as HTML). | P2 | Medium | Hard | — |
| T23 | Mention the burn ban in the home page's note for visitors without JavaScript. | P2; PR #5 review | Low | Easy | — |
| T24 | Give the training page a skip link and a main landmark. | P1; PR #5 review | Low | Easy | — |
| T25 | Stop publishing the training material's developer scripts and README with the site. | Site check | Low | Easy | — |
| T26 | Docs tidy-up: `docs/08` §2.3's merge command to match CLAUDE.md, and "the first commit's subject" (it is the only commit's); `docs/08` §1.1's personal home path; a name listed twice in `.gitignore`. | PR #4, #5 reviews | Low | Easy | — |
| T27 | Hooks to use `--exit-code 3` like the scan script; the scan script's `for … in $(git rev-list …)` loop. | PR #4 review | Low | Easy | — |
| T28 | Point volunteers to GitHub's private noreply address for commits; commit author addresses aren't checked. | PR #3 review | Low | Easy | — |
| T38 | `README.md` and `infra/README.md` describe an `AAFA_SIGNUP_ENDPOINT` setting that no longer exists; the form now posts to the members API. | PR #6 review | Low | Easy | — |
| T29 | Redirect the bare domain with a permanent (301) redirect, not a temporary one (`infra/site-stack.yaml`). | PR #5 review | Low | Easy | AWS access |
| T30 | A `pre-merge-commit` hook, so a local merge with no conflict is checked like a commit. | PR #4 review | Low | Medium | — |
| T31 | Harden the secrets check against changes made on a branch, and decide about tags (the cases are in PR #3's review). Follows T3. | PR #3 review | Low | Medium | Org owner (ruleset) |
| T32 | The GitHub check and the deploy gate decide "binary" slightly differently (both fail closed). | PR #3 review | Low | Medium | — |
| T37 | The admin sign-in page loads its styles, a script and an image from AWS's servers, and uploads go to the content bucket's AWS address: find whether either can be served from our own domain. | P5 | Low | Hard | AWS access |

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
