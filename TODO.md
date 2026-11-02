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
- **High** — affects anyone's privacy or safety (visitors, members,
  volunteers), keeps people from using the site or getting its alerts, or
  is the only safeguard on how changes reach the site.
- **Medium** — a real improvement that someone would notice.
- **Low** — tidiness, consistency, or a small risk.

**Difficulty** — the effort, as a best guess revised when work starts.
Access is separate (see Needs).
- **Easy** — a small change, or a setting someone with access changes.
- **Medium** — several files, new tooling or tests, or a check across the
  whole site.
- **Hard** — open questions, or a redesign.

**Needs** — anything beyond a pull request: *AWS access*, an *org owner* on
GitHub, the *maintainer* (a decision, or something only they can check), the
*board* (a decision that is the organization's, such as spending), or the
*previous maintainer*; a short note in brackets says what for.

**Depends on** — items that must be done first. An item that blocks a more
important one takes on that importance, and says so in its text ("High:
T33 and T34 depend on it"), so the order below reflects what is really
holding work up.

**From** — where the item came from: a pull request's review, the site
check of 2026-10-31, a website principle in CLAUDE.md that the site doesn't
yet meet, or hasn't confirmed (P1–P11), `infra/README.md`'s list of things only a person can do,
an open pull request, the handover, or the maintainer.

Items are listed by importance, then difficulty, then ID, so the first rows
are the most worth doing for the least work. IDs are never reused.

## Open

| ID | Item | From | Importance | Difficulty | Needs | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| T3 | Apply the GitHub settings in `docs/08-making-changes.md` §2.4: the branch ruleset, squash-only merges, deleting merged branches. Decide how pull requests from forks are checked. On GitHub's Free plan the ruleset is available only while the repository is public, so once it is private it needs a paid plan (T43). | Maintainer (PR #3) | High | Easy | Org owner | — |
| T4 | Complete the AWS account handover to the maintainer (`docs/05-runbook.md`: "Someone leaves the organization" steps 3–5, "Move the AWS account to an organization email", and "Check the organization still has two owners"), apart from what needs an organization mailbox (T42). *(High: T2, T33, T34, T36 and T42, all High, depend on it, as do five others.)* | Handover | High | Easy | Previous maintainer | — |
| T5 | Make the repository private, while it still holds a person's contact details (see T36). The rules in CLAUDE.md that treat it as public stay as they are. On GitHub's Free plan a private repository can't have T3's ruleset, so the move to a paid plan (T43) comes first. | Maintainer | High | Easy | Org owner | T43 |
| T12 | The privacy page says "We collect nothing about you personally", while every page loads fonts from Google: say so there until T1 is done. | PR #5, #6 reviews | High | Easy | — | — (unneeded once T1 is done) |
| T33 | Email sign-ups: SES production access was requested. The live API now reports email as sendable, which suggests access was granted: `lambda/comms/email.mjs` reports that when production access is granted and the domain verified, and also when its check fails. Confirm it in the SES console, then close this. | `infra/README.md`; PR #9 | High | Easy | AWS access | T4 |
| T42 | Finish the AWS account handover steps in `docs/05-runbook.md` that need an organization mailbox. | Handover; PR #6 review | High | Easy | Previous maintainer | T4, T36 |
| T43 | Move the GitHub organization to a paid plan (Team), so T3's ruleset still applies once the repository is private. *(High: T5 depends on it.)* | Maintainer; PR #6 review | High | Easy | Org owner; board (approval, and who pays: see T44) | — |
| T57 | Text sign-ups while the toll-free number awaits approval: with the stack's text provider set, a sign-up for texts (or texts and email) sends its confirmation code straight away, and if that send fails, the new sign-up is removed and the person told nothing was saved. Confirm with a test sign-up of your own; then set `SmsProvider` back to `off` until the number is approved, so numbers are held unconfirmed as before. | PR #9 review | High | Easy | AWS access; maintainer (a test sign-up) | T4 |
| T1 | Serve the fonts from our own site instead of Google Fonts (every page, the font files and their licence). | P5, P8; site check | High | Medium | — | — |
| T2 | Stop sending the site's address to other domains with each request: a referrer policy in every page, or as a response header. | P6, P11; maintainer | High | Medium | AWS access (for a header) | T4 (for a header) |
| T6 | A full accessibility check, including the admin pages: keyboard use and focus, screen readers, dark mode, small screens. | P1 | High | Medium | — | — |
| T34 | Text alerts: carrier verification of the toll-free number (submitted), then lifting the SMS sandbox and the monthly spend limit (support cases); or Twilio with 10DLC registration instead. The stack's provider setting is already set (the live API reports texting switched on; `infra/README.md`; see T57); once texts arrive, turn off the "coming soon" note for texts in `src/js/config.js`. | `infra/README.md` | High | Medium | AWS access | T4 |
| T36 | A real mailbox on our own domain (there is no MX record), replacing the interim personal Reply-To on Alliance email, and then the contact address on the site; then remove the interim address from the docs, its exception in `.gitleaks.toml`, and the GitHub organization's contact email. *(High in its own right; T42 also depends on it.)* | `infra/README.md`; maintainer | High | Medium | AWS access; maintainer | T4 |
| T46 | Triage the Checkov findings the security scan reports in `infra/` with the maintainer: fix what needs fixing, each in a pull request of its own; write down the rest with a reason; then move Checkov from report to gate. | PR #8 | High | Medium | Maintainer (triage); AWS access (to deploy fixes) | T4 (to deploy fixes) |
| T47 | Triage the Semgrep findings the security scan reports, and the files it can't parse (`src/admin/training/check.mjs`, whose `#!` line its parser rejects; `.github/scripts/security-scan.sh`, which its bash parser can't read at all; and the usage message's `<tool>` in `.github/scripts/install-scanner.sh`, which it reads only in part), all valid code, with the maintainer: fix what needs fixing, each in a pull request of its own; write down the rest with a reason; then move Semgrep from report to gate. | PR #8 | High | Medium | Maintainer (triage) | — |
| T44 | Have the Alliance itself pay for the services the site runs on: the AWS account after its first year, which is covered for now on the organization's behalf, and any paid GitHub plan (T43). | Maintainer | High | Hard | Board | — |
| T13 | Check the site with each blocker on its own, in a clean browser profile: AdGuard, the DuckDuckGo extension, Firefox's Enhanced Tracking Protection, and NoScript (whether it stops the API requests). | P3, P7, P10, P11 | Medium | Easy | Maintainer | — |
| T41 | Confirm the GitHub organization has two owners, as `docs/05-runbook.md` asks, so access doesn't rest on one person. | PR #6 review | Medium | Easy | Org owner | — |
| T8 | Footer headings skip levels (`h4` after an `h2`, or after the `h1`) on most pages. | P1; site check | Medium | Medium | — | — |
| T9 | Give each text-size button its own accessible name (all three are "A"), on every page. | P1; PR #5 review | Medium | Medium | — | — |
| T10 | Put the "opens in a new tab" note for screen readers in the markup of every external link, so it is there without JavaScript. | P1, P2, P11; PR #5 review | Medium | Medium | — | — |
| T11 | Say plainly what went wrong when the API can't be reached: the sign-up and manage forms show the browser's own error, and the board page stays on its "on its way" text. | P11; PR #5 review | Medium | Medium | — | — |
| T14 | A tested script that checks the squash merge's subject and message Claude writes (see notes). | PR #4 review | Medium | Medium | — | — |
| T17 | Commit the accessibility checks used for CLAUDE.md's table as a tested script. | P1; PR #5 review | Medium | Medium | — | — |
| T18 | Widen the secrets rules' coverage and harden how they fail (the cases are in PR #3's description, under "Follow-ups"). | PR #3 reviews | Medium | Medium | — | — |
| T19 | Check pull request titles and descriptions as they are written: a description is public as soon as it is posted, and a title becomes the squash subject of a pull request with several commits merged on GitHub. (T14 covers the message Claude writes when it merges.) | PR #3 review | Medium | Medium | — | — |
| T37 | Put the admin pages' sign-in on our own domain (a Cognito custom domain such as `login.austinareafirewise.org`: a certificate in us-east-1, a DNS record, and the app's callback and sign-out addresses), so NoScript and other blockers see it as first-party. Then check whether the sign-in page's own styles, script and image come from our domain too, and whether uploads can go through our domain rather than the content bucket's AWS address. Best done with T20, which needs the same certificate and DNS work. | P5, P11; maintainer | Medium | Medium | AWS access | T4 |
| T50 | Keep the scanners' pins current (`.github/scan/`): Dependabot isn't set up to move them (it can't read `tools.env`; the hash-locked requirements might suit its pip support, untested), so they stay at the versions of 2026-11-01 until someone does. A scheduled reminder, or a check that says when a pin is far behind. | PR #8 | Medium | Medium | — | — |
| T53 | exiftool doesn't read pictures inside Office and OpenDocument files (a phone photo pasted into slides keeps its location), nor XMP sidecar files (`.xmp`). Open those files' media and scan it, or refuse documents that contain pictures. Such documents already need an entry in `allowed-documents.txt`. | PR #8 review | Medium | Medium | — | — |
| T55 | Move the commands out of the documents into scripts the documents name (CLAUDE.md, "Keeping the documents right"): the command blocks among the 57 fenced blocks (the rest are diagrams and data layouts) across `docs/` 01–08, `docs/README.md`, `README.md`, `infra/README.md`, `.github/scan/README.md` (moving a pin) and `src/admin/training/README.md`. A pull request of its own, with tests for each script. | Maintainer; PR #9 | Medium | Medium | — | — |
| T56 | `docs/06-cms-design.md` and `docs/07-members-and-communications-design.md` were written as designs before the systems were built, and still read that way in places. Check each against the code and correct it, saying where the design changed and why. | PR #9 | Medium | Medium | — | — |
| T15 | Automate the independent pull request review in GitHub Actions (open questions: keeping the API key safe, pull requests from forks, text in a pull request steering the reviewer). | Maintainer | Medium | Hard | Maintainer (API key) | T3 (how forks are checked) |
| T16 | Return a real 404 status for a missing page. Amplify answers with one or two redirects (sometimes a trailing slash, then `404.html`) and then 200, and `infra/site-stack.yaml` notes that no rule can change that, so this needs another approach. Also make `404.html`'s asset paths absolute, and update `docs/05-runbook.md` and `infra/README.md`, which describe today's behaviour. | PR #5 review | Medium | Hard | AWS access | T4 |
| T20 | Put the API on our own domain (e.g. `api.austinareafirewise.org`), so blockers and NoScript see it as first-party. | P5, P9, P11 | Medium | Hard | AWS access | T4 |
| T21 | Find out whether Amplify, API Gateway, the sign-in domain and the content bucket's upload address can require TLS 1.3 with AES-GCM ciphers only, and set it where they can. | P9 | Medium | Hard | AWS access | T4; T20 (for the API, probably) |
| T22 | Pages and forms that work without JavaScript, where practical (news, board and resources could be published as HTML). | P2 | Medium | Hard | — | — |
| T23 | Mention the burn ban in the home page's note for visitors without JavaScript. | P2; PR #5 review | Low | Easy | — | — |
| T24 | Give the training page a skip link and a main landmark. | P1; PR #5 review | Low | Easy | — | — |
| T25 | Stop publishing the training material's developer scripts and README with the site. | Site check | Low | Easy | — | — |
| T26 | Tidy-up outside the docs: a personal home path in `docs/AAFA-website-overview.deck.py`'s output file, and a name listed twice in `.gitignore`. (Its docs parts were done in PR #9.) | PR #4, #5 reviews | Low | Easy | — | — |
| T27 | Hooks to use `--exit-code 3` like the scan script; the scan script's `for … in $(git rev-list …)` loop. | PR #4 review | Low | Easy | — | — |
| T28 | Point volunteers to GitHub's private noreply address for commits; commit author addresses aren't checked. | PR #3 review | Low | Easy | — | — |
| T29 | Redirect the bare domain with a permanent (301) redirect, not a temporary one (`infra/site-stack.yaml`, and the description in `infra/README.md`). | PR #5 review | Low | Easy | AWS access | T4 |
| T45 | The deploy's upload step (`.github/workflows/deploy.yml`) runs `curl` without `--fail-with-body`, so an upload the server rejects shows as a passed step, and the deploy fails later, less clearly. | PR #2 review | Low | Easy | — | — |
| T48 | Switch `uses: ./…` to GitHub's `uses: $/…` form and turn zizmor's `self-repository` audit back on, once actionlint accepts that form (1.7.12 doesn't). | PR #8 | Low | Easy | — | — |
| T49 | Regenerate `docs/AAFA-website-overview.pptx` without the python-pptx template's author in its metadata, then remove its entry in `.github/scan/exiftool-allowed.txt`. | PR #8 | Low | Easy | — | — |
| T51 | `scripts/clean-hoa-export.ps1` is read by no code scanner (none of them reads PowerShell; the secrets scanners do read it): add a PowerShell check such as PSScriptAnalyzer, or say in `.github/scan/README.md` that it goes unscanned. | PR #8 review | Low | Easy | — | — |
| T52 | The shell in the composite action's `run:` steps (`.github/actions/install-gitleaks/action.yml`) is read by no scanner: actionlint lints workflows only. Lint it (shellcheck on the extracted steps, or move them into a script). | PR #8 review | Low | Easy | — | — |
| T54 | exiftool's field list misses IPTC location fields such as `Province-State`, `Country-PrimaryLocationName`, `Country-PrimaryLocationCode` and `ContentLocationName` (the XMP copies of State and Country are read). Add them to the tags in `.github/scripts/security-scan.sh`. | PR #8 review | Low | Easy | — | — |
| T58 | The site stack's budget (`MonthlyBudgetUSD`, $10, warning at 80%) was set for the site alone. With the other stacks' fixed costs and texting, normal months will come close to it: raise it to fit `docs/05-runbook.md`'s costs, so the alert still means something is wrong. | PR #9 review | Low | Easy | AWS access | T4 |
| T30 | A `pre-merge-commit` hook, so a local merge with no conflict is checked like a commit. | PR #4 review | Low | Medium | — | — |
| T31 | Harden the secrets check against changes made on a branch, and decide about tags (the cases are in PR #3's description, under "Follow-ups"). Follows T3. | PR #3 review | Low | Medium | Org owner (ruleset) | T3 |
| T32 | The GitHub check and the deploy gate decide "binary" slightly differently (both fail closed). | PR #3 review | Low | Medium | — | — |

## Notes

**T14 — squash-message check.** It must fail closed, use none of gitleaks'
ways of silencing a finding, and be shown to catch samples it must catch.
Each of these must be a test that fails it: no message file or an empty
one; an empty or unknown commit SHA (`git show :path` reads the staged
copy); a rule file that is missing, empty, or has only irrelevant or
switched-off rules; a `gitleaks:allow` marker; a `.gitleaksignore` in the
current directory; a baseline file (`-b`); `--exit-code 0`. Choose samples
with care: an obviously fake key may not match.
