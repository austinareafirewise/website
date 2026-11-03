# Working on this repository

The Austin Area Firewise Alliance website: static pages in `src/`, published
to AWS Amplify by GitHub Actions; Lambdas and CloudFormation in `lambda/` and
`infra/`, deployed by hand. `docs/08-making-changes.md` is the how-to for
making and shipping a change. This file holds the standard all work meets,
the principles the website is run by, the rules for working here, and what
has been learned the hard way.

## The standard

Everything in this repository — code, scripts, workflows, infrastructure,
pages and docs — is done to current best practice, as senior developers
would do it to show junior developers the right way. Not "good enough for a
volunteer site": the way you'd want it copied. Every rule below serves
that.

It applies to the whole repository at all times, not only to what a pull
request changes. A review looks at the diff; the standard doesn't stop at the
diff. When you notice something below it elsewhere — in a file you're reading,
or a pattern you're about to copy — don't copy it, and don't pass it by in
silence: add it to TODO.md (for a weakness that isn't fixed, as [Tracking
work](#tracking-work-todomd-and-changelogmd) says) and propose a pull request
of its own for it. Don't fold it into an unrelated pull request; that hides it
from the review it needs.

The standard and a pull request's scope (see [Reviewing a pull
request](#reviewing-a-pull-request)) answer different questions. The
standard says *how well* everything is done: every line a pull request
changes must meet it. The scope says *what problem* the pull request takes
on — which cases a safety check must handle, say — and so where its review
stops. Neither lowers the other.

## How the website is run

These are the principles the site is held to. Where it falls short of one
today, the principle still stands: the gap is work to do, not an exception.
Every change moves toward them, none moves away, and each gap is closed in a
pull request of its own.

1. **Accessible.** WCAG best practice, as far as it can be followed.
2. **JavaScript only where it earns its place** — where a page can't work
   without it, or where it makes a large difference to how well the page
   works. Pages that need it say so to visitors who have it switched off.
3. **No ads.** None of our own, and nothing loaded from ad sources, so an
   ad blocker (AdGuard and the like) finds nothing to block.
4. **No trackers** of our own.
5. **Nothing loaded from anyone else's servers.** Fonts and everything else
   the pages need come from our own site. Privacy Badger should find nothing
   to block.
6. **No tracking headers**, so Privacy Possum finds nothing to block.
7. **No tracking requests**, so the DuckDuckGo extension finds nothing to
   block.
8. **Nothing from `googleapis.com` or `gstatic.com`.** uBlock Origin should
   have nothing to unblock.
9. **TLS 1.3 only, with AES-GCM ciphers.**
10. **Nothing that Firefox's Enhanced Tracking Protection would act on.**
11. **Friendly to visitors who block a lot.** Someone running several
    blockers at once — and NoScript — should find the site works, looks
    right, and asks nothing of them: everything first-party, nothing sent
    across sites that a blocker would strip, and pages that still work, or
    say clearly what doesn't, when scripts or requests are blocked.

### Where the site stands

Checked against the live site and `src/` on 2026-10-31, and with the
maintainer's own browser (Firefox) running several blockers at once — so a
blocker that "found nothing" may only mean another got there first. Update
this table when a gap closes, and re-check it when a change could affect it.
*Meets*: checked and true. *Believed met*: true as far as checked, but not
yet confirmed the way the principle names. *Not yet checked*: no evidence
either way. *Falls short*: a gap, described in its row.

| # | Status | As found |
| --- | --- | --- |
| 1 | Falls short | Checked on every push since 2026-11-01 (`.github/a11y/`, docs/08 §4.4): axe's WCAG 2.2 A and AA rules pass on all 14 pages in normal and dark mode, on a 320-pixel phone, and without JavaScript, and Tab reaches every control at desktop and phone widths without a trap, with focus visible; content the pages fetch is checked only in its empty state so far. Short of the principle: four pages (about, evacuation, Firewise communities, prepare your home) scroll sideways on a phone (WCAG 1.4.10); on most pages the footer's headings skip levels; the emergency banner sits outside every landmark; the training page has no main landmark; and the three text-size buttons are each named only "A". Not yet checked: a real screen reader, and the admin pages behind sign-in. |
| 2 | Falls short | The information pages work without JavaScript, and the pages that need it say so (though the home page's note leaves out the burn ban). News, the board, resources, and the home page's news headlines, notices, fire danger and burn ban need it, though they could be published as HTML; the sign-up and manage forms need it too. |
| 3 | Believed met | No ad code and no ad hosts in `src/`. AdBlock found nothing to block, with a system-wide ad blocker also running; not yet checked with AdGuard on its own. |
| 4 | Meets | No analytics or tracking code, and no cookies on the public pages. Local storage holds only the text-size choice, once a visitor makes one, and it never leaves the browser. The admin pages keep their own state in session storage. |
| 5 | Falls short | Fonts come from Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) on every page; Privacy Badger flags `fonts.gstatic.com` and strips its cookies (yellow): it lets the requests through, but treats the domain as one that can track. The API is on its own domain (see 11). On the admin pages, the page calls the sign-in domain directly, the sign-in page loads its styles, a script and an image from AWS's servers, and uploads go straight to the content bucket's AWS address. |
| 6 | Falls short | Privacy Possum reported blocking Referer headers from 12 sources (it gives no detail). Most likely these are the pages' requests to `fonts.googleapis.com` and to our API on its own domain, which carry the site's address in a Referer header. No Referrer-Policy is set, so the browser's default decides what is sent. The public pages set no cookies; the ETags are each file's MD5 hash, the same for every visitor. |
| 7 | Believed met | The DuckDuckGo extension blocked nothing, with other blockers running first. On the public pages, the only requests to other domains are Google Fonts (5) and our own API (11). |
| 8 | Falls short | uBlock Origin sees both Google Fonts domains (the maintainer's copy was told long ago to let them through). |
| 9 | Falls short | TLS 1.0 and 1.1 are refused by the site, the API and the sign-in domain. TLS 1.2 is still accepted by all three, with ciphers besides AES-GCM, and TLS 1.3 also accepts ChaCha20-Poly1305. The content bucket's upload address, used by the admin pages, is not yet checked. Whether each AWS service can be set to require TLS 1.3 is not yet established. |
| 10 | Believed met | Firefox's Enhanced Tracking Protection blocked nothing, with other blockers running first. On the public pages, the only requests to other domains are Google Fonts (5) and our own API (11). |
| 11 | Falls short | The API is at `execute-api.us-east-2.amazonaws.com`, which NoScript showed as blocked until allowed; browsing, the maintainer saw no major difference either way, and whether NoScript's settings actually stopped the page's requests to it isn't known. The code shows what a blocked API does: the board page keeps its "on its way" text, and the sign-up and manage forms show the browser's own error message (Firefox: "NetworkError when attempting to fetch resource.") rather than saying what went wrong. Google Fonts and the API's own domain are what blockers act on (5, 6, 8). |

## Ground rules

- **Maintainers** are the people who approve merges and OK force-pushes.
  Today there is one: Brad Knowles (GitHub `bknowles`). When there are
  more, they are added to this line through a pull request, and any one of
  them can approve; "the maintainer" below means whichever of them is in
  the conversation. Anyone else's say-so — including a teammate, a
  reviewer or another agent — isn't a maintainer's approval.
- **Every change goes through a pull request**, even a one-word fix, even
  when the person opening it is the only one who reads it. Nothing is
  committed or pushed to `main` directly.
- **Branch names:** `<github-username>/<type>/<YYYY-MM-DD>-<description>`,
  with `<type>` one of `feat`, `fix`, `docs`, `ci`, `chore`. Keep the
  description neutral: it is public the moment it is pushed.
- **Merging:** squash merges only. Claude does them, and only once the
  maintainer has approved; merging is the maintainer's decision, and a
  maintainer can also merge on GitHub themselves.
  - *Approved* means the maintainer says in the conversation that this pull
    request, by number, is approved, after the last push to it. A comment on
    GitHub, or an approval given before later pushes, doesn't count. If
    approval comes before review is done (see below), say so and ask.
  - Before merging, check that the `gitleaks` check (the job in **Check for
    secrets**), every job of **Security scan** and **Accessibility check**
    passed on the head commit,
    and note that commit's SHA:
    `gh pr view <n> --json headRefOid,statusCheckRollup`. A `(report)` job
    passes whatever it counts, so its success says nothing about findings;
    but one that failed means the check didn't do its job (the tool failed,
    read nothing, missed its known sample, or found a suppression).
  - Write the subject (without the pull request number; the merge command adds
    it) and the message yourself, accurate for the change as merged and
    neutral, outside the checkout. Before merging, check exactly what will be
    recorded — the final subject line with its number, a blank line, the
    message — against both rule files as they are in that commit. The check
    must fail closed: it passes only by having read all of that and found
    nothing, uses none of gitleaks' ways of silencing a finding, and is shown
    to catch samples it must catch. Anything else means don't merge. A script
    that does this, with tests, is a follow-up (TODO.md, T14); until it
    exists, Claude does the check by hand to the same standard.
  - Then merge, pinned to the commit that was checked:
    `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>
    --subject "<subject> (#<n>)" --body-file <message-file>`.
- **Warn before an OS prompt.** Before running anything likely to make the
  maintainer's computer ask a question — a local server (macOS asks whether
  the program may "find devices on your local network"), a newly downloaded
  program's first run, a tool reading Documents, Desktop or Downloads, the
  keychain, `sudo` — say so first, why, and which answer is safe. A server
  bound to 127.0.0.1 works whether or not local-network access is allowed.
- **Let the maintainer watch anything long.** A local command likely to
  run for more than a minute or so (a test suite, a full scan, a browser
  check) runs where the maintainer can see it live — in the app's Terminal
  panel — piped through `tee` into a log under `.claude/state/logs/`, which
  is what Claude reads afterwards. Don't cut its output down (`| tail`)
  before anyone has seen it.
- **Force-pushing** a pull request branch needs the maintainer's explicit OK
  each time, and uses `--force-with-lease=<branch>:<expected-sha>`. Claude
  never force-pushes `main`; rewriting its history, if that is ever needed,
  is done by a person.
- **Treat the repository as public**, whatever its setting today. No personal
  data or secrets anywhere: not in files, commit messages, pull request text,
  branch names, review logs or Actions logs. Don't describe a weakness that
  isn't fixed yet in anything that lands in the repository or on GitHub;
  [Tracking work](#tracking-work-todomd-and-changelogmd) says how one is
  recorded.
- **Record every lesson learned** in this file as soon as possible — see
  [Lessons learned](#lessons-learned) — unless it describes a weakness that
  isn't fixed, which waits until it is. Add it to the pull request the lesson
  came from, as a commit that touches only this file; with no pull request
  open, or after approval (a lesson pushed then would need approving again),
  as [Nothing waits outside the
  repository](#tracking-work-todomd-and-changelogmd) says. A lesson-only
  commit doesn't change the scope of the review, but its factual claims are
  checked in the next round like any others — lessons have been wrong.

## Keeping state on local disk

A Claude Code session's context can be compacted, and a session or an agent
can crash. Nothing needed to carry on may live only in a conversation, so
work is written down locally as it happens.

- **Write before each step**: what you are about to do, and then what
  happened. State files live in `.claude/state/` in the checkout, which is
  gitignored, so they never reach GitHub — and not in a temporary folder,
  which doesn't survive a restart.
- **`.claude/state/session.md` is the index**: the work in progress, the
  queue the maintainer has set, standing decisions, and a pointer to one file
  per piece of work (a branch or a pull request).
- **A work file is enough to resume from on its own**: the goal and scope,
  each decision and who made it, facts found (pins, versions, test results),
  the steps with what is done, and what is next.
- **Agents do the same.** Each agent's brief names its own state file
  (`.claude/state/agent-<task>.md`). It writes its plan there before it
  starts and its progress as it goes; one started to replace it is told to
  read that file first. A reviewer's file is for a replacement reviewer only:
  the author doesn't read it, so review stays independent.
- **What the work runs on lives there too**, not only notes about it:
  scripts the process depends on (a merge check, a test harness, in
  `.claude/tools/` or the work's own folder), drafts of text that will be
  published (a pull request description, a squash message), and briefs
  reused for agents. A temporary folder is only for what can be rebuilt,
  and `session.md` says how to rebuild it.
- **Before a compaction, check nothing needed is only in the
  conversation**: a decision, a reason, a file in a temporary folder.
- **After a compaction or crash**, read `session.md` and the files it points
  to before doing anything else.
- State files may hold what can't go in the repository, such as details of a
  weakness that isn't fixed, because they stay local. Never secrets.

## Tracking work: TODO.md and CHANGELOG.md

[TODO.md](TODO.md) is the one list of what still needs doing, kept in the
repository so work can be picked up without relying on anyone's memory —
or on a Claude Code session's. [CHANGELOG.md](CHANGELOG.md) records what
was done.

- **Add an item as soon as it is known**, whatever it came from: a finding
  outside a pull request's scope, something below the standard noticed
  elsewhere, a principle the site doesn't meet, a maintainer's request.
  Give it the next unused ID, where it came from, its importance, its
  difficulty, and anything it needs beyond a pull request, using the
  scales at the top of TODO.md, and keep the table sorted by importance,
  then by how many items depend on it directly (more first), then
  difficulty, then ID.
- **Record what each item depends on**, because work that unblocks other
  work is worth doing first. An item that blocks a more important one takes
  on that importance. Within the same importance, an item that others
  depend on comes before those that don't, whatever its difficulty, and the
  more it unblocks, the earlier it comes. Either way, its text says which
  items depend on it. Re-check this whenever an item's importance or
  dependencies change, so the order shows what is really holding work up.
- **Update an item when what is known about it changes** — a new finding,
  a revised difficulty, a decision.
- **Where the change goes:** in the pull request the item came from, as a
  commit that touches only TODO.md — outside the review's scope like a lesson
  commit, and like one, its factual claims are checked in the next round. With
  no pull request it came from, or after approval, as **Nothing waits
  outside the repository** below says. A pull request that changes only
  TODO.md and its changelog entry needs just the check of factual claims
  described under [When to stop](#when-to-stop), not review rounds.
- **When an item is done**, the pull request that does it removes its row from
  TODO.md. Every pull request adds an entry to CHANGELOG.md before it is
  approved: under the date it is written, in the maintainer's own time zone
  as the commits record it (not moved later, which would need
  approving again), its title (the squash subject it will merge with) and
  number, what changed, and the IDs it closed. It is complete and accurate
  when it merges, so nothing about that merge is left to record later.
  Dependabot's dependency updates are the exception: the git history records
  them, and a row such a merge closes is removed as the next bullet says.
- **Nothing waits outside the repository.** Anything that couldn't go into the
  pull request it belongs to — a TODO.md item finished without a pull request
  of ours (a setting changed, a Dependabot merge), an item or lesson learned
  after approval or in the final check of facts, a correction to an earlier
  changelog entry — is noted in `.claude/state/session.md` straight away, and
  goes in as the **first commit of the next pull request we open**, whatever
  that pull request is for: a commit touching only TODO.md, CHANGELOG.md and
  this file's lessons, whose claims that pull request's review checks like any
  lesson commit's, and whose changelog entry names any item closed that way.
  Only the record goes in early; the fix for something found below the
  standard still gets a pull request of its own, as [the
  standard](#the-standard) says. So every pull request starts by checking
  which TODO.md items are now done and what is waiting. The one thing that
  does wait is the detail of a weakness that isn't fixed, which stays out of
  the repository until it is (next bullet). Until 2026-11-02 such changes
  waited instead for a `docs` pull request of their own (or, for a Dependabot
  merge, the next one to touch TODO.md); that left them recorded only on one
  computer, sometimes across several merges, and a changelog entry known to be
  wrong stayed wrong on `main` in the meantime.
- **A weakness that isn't fixed** goes into TODO.md only in general terms —
  naming the area that needs work, not what is wrong or how it could be
  used — or not at all. Its details go to the maintainer in the
  conversation, and into the changelog once it is fixed. This is the one
  rule for such findings; the other sections point here.
- **To choose what to do next**, start at the top of TODO.md: high
  importance first, then what unblocks the most, then low difficulty.

## Keeping the documents right

Every document in the repository — every `.md` file wherever it is (the
ones at the top, the guides in `docs/`, the READMEs, the board's training
pages in `src/admin/training/`), the other pages written for people (such
as `docs/field-guide.html`), and comments anywhere — follows three rules.

- **Change one, check them all.** When a change touches a document, or
  changes anything a document describes, search the whole repository for
  every other place that says the same thing, and update each of them in
  the same pull request. Documents that disagree with each other are as
  wrong as documents that disagree with the code.
- **When a practice is retired, say so, and say why.** Don't just delete the
  old text. Say what we used to do, what we do now, and above all why it
  changed: the history shows what changed, but only the documents can say
  why.
- **No code in documents.** A procedure of more than one command, and
  anything the repository depends on, lives in a script; the document names
  the script, says when to run it and what a pass means, so the two can't
  drift apart. A single command may stay in the text: one that only runs one
  of our scripts, or one standard command such as `git clone <url>`, `gh
  auth login` or `gh pr merge <n> --squash`. Two or more commands that must
  run together are a procedure, and belong in a script. Data a script reads
  from a document, such as the `- target:` lines in the board's training
  lessons, is data rather than code, and may stay. A comment in code
  describes the code next to it rather than giving steps to follow, so the
  first two rules apply to it and this one doesn't. Documents written before
  this rule still hold command blocks; moving them into scripts is TODO.md,
  T55.

## Reviewing a pull request

Before a pull request is merged, it goes through rounds of independent
review until a round finds nothing material — or until the rounds stop
converging, and a person decides.

### Before the first round: scope and threat model

The pull request description says what the change is for, what it guards
against, and what it deliberately doesn't. For a safety check that means its
threat model — for example "honest mistakes by one or two trusted
maintainers, not a determined insider". Every round's reviewer gets this
statement along with the code. It isn't a hint about findings; it is the
yardstick for what the pull request must cover. Without it each round
raises the bar, and the rounds never end. (How well it is done is
[the standard](#the-standard), which every changed line must meet.)

A finding outside the stated scope is still worth having: it becomes a
follow-up — an item in TODO.md, and its ID in the description's follow-up list
— not a reason to hold the merge. One that describes a weakness that isn't
fixed is recorded as [Tracking work](#tracking-work-todomd-and-changelogmd)
says, and stays out of the description. A finding that shows the scope itself
is wrong is for a person to decide.

### One round

1. **A fresh reviewer.** Start a new subagent — a fresh one, not a fork, which
   would carry this whole conversation. Give it the branch, the pull request
   number, the description's scope and threat model and its follow-up list,
   TODO.md, [the standard](#the-standard), [How the website is
   run](#how-the-website-is-run) with its table, this section and the lessons
   below — not the review log, not the earlier rounds' findings, not the
   author's notes, not what was fixed. Tell it not to read the pull request's
   description or comments: what it needs from them is in its brief, and the
   review log is in the description. A reviewer told what to look for finds
   that and little else. Tell it the review is read-only: no edits, commits or
   pushes, no comments or approvals on the pull request, no triggering
   workflows. It tests in throwaway repositories under a scratch folder, never
   in the checkout.

   Two more things go in every brief, because rounds without them don't
   converge:
   - **What the maintainer saw for themself is given.** Something a
     maintainer observed that the reviewer can't repeat — a test sign-up on
     the live site, say — is stated as fact in the brief, and the reviewer
     checks the rest against it rather than re-deriving or doubting it.
   - **How to judge a finding against the scope.** Spell out the bar (step
     4 below), in the brief's own terms for this pull request.
2. **The standard** is [the one above](#the-standard): current best practice,
   applied to every line the pull request changes. Anything below it that the
   reviewer sees in code the pull request doesn't touch goes in a separate
   "elsewhere in the repository" list. Those are handled like out-of-scope
   findings — an item in TODO.md, recorded as [Tracking
   work](#tracking-work-todomd-and-changelogmd) says if it is an unfixed
   weakness — and proposed as pull requests of their own; they don't hold this
   merge and don't count toward the rounds. For every kind of file touched,
   that means: git and GitHub (commits, branches, hooks, rulesets,
   Dependabot); GitHub Actions (pinning, `permissions`, script injection,
   triggers, OIDC, timeouts, concurrency); shell (quoting, `set -euo pipefail`
   pitfalls, macOS vs Linux tools, odd filenames); JavaScript and Node for the
   Lambdas and the site; CloudFormation and IAM; Python; HTML, CSS and
   accessibility for `src/`, measured against the website's principles;
   gitleaks rules and Go regex semantics; and Markdown, where every statement
   must be true of the code and follow [Keeping the documents
   right](#keeping-the-documents-right). Plus the lessons below.
3. **Test, don't assert.** Where a claim can be checked — a regex, a range, an
   exit code, a hook, a workflow path — the reviewer runs it and quotes the
   result, failure paths included, and for anything that is run, both its exit
   code and its output. A safety check in the changed code that can pass
   without checking, on any input within the stated scope, is always
   blocking.
4. **Findings**, each with file and line, what is wrong, why it matters
   (written for someone new to the repository), evidence, a fix, and
   *verified* or *suspected*. Ranked blocking, should fix, nit, question.
   "Nothing material found" is a valid result and must not be padded.
   Judged against the pull request's stated scope:
   - **Blocking** or **should fix** needs a realistic problem: an honest
     mistake a maintainer or volunteer could make, a check that can pass
     without having looked, a statement that is false or misleading — or
     missing — where a reader would act on it, or a breach of a rule in this
     file.
   - **Nit** or **question**: a case only a deliberate attacker would set
     up, when the stated threat model leaves deliberate attackers out (a
     pull request whose threat model is abuse, such as a public form's
     abuse controls, judges those cases as real); a widening of what the
     change claims to cover; and wording, placement or completeness that
     wouldn't mislead anyone. A widening
     worth doing becomes a TODO.md item, not a reason to hold the merge.
5. **The author verifies before fixing.** Reproduce each finding. One that
   doesn't reproduce is recorded as such, with the evidence, and not fixed.
   Reviewers are wrong sometimes, and so are authors.
6. **Fix or decline.** Fix every verified blocking and should-fix finding that
   is within scope, or on a changed line below the standard, and re-run the
   affected tests — checking both the exit code and the output of each. A nit
   is fixed, or declined with a one-line reason. Fix what was found; don't add
   new capability to answer a finding — new code is new surface for the next
   round, and a pull request that grows each round can't converge.
7. **Record the round** in the pull request description's review log:
   round number, counts by severity, verified / not reproduced, fixed /
   declined. Describe findings neutrally.
8. **Record the lessons** the round taught in this file, as in the
   ground rules: a commit that touches only this file. The next round checks
   its claims.

### When to stop

**Done** when a fresh round reports no blocking or should-fix finding that the
author, in step 5, can reproduce. Only then is the pull request ready to
merge.

Lessons, TODO.md updates and nit fixes pushed after that round get a check of
their own before the merge: a fresh reviewer verifies only the factual claims
in those commits. It doesn't restart the count. A claim it finds wrong is
fixed and checked again; one that can't be settled is taken out, and it and
any lessons that check itself teaches go into the next pull request, as
[Nothing waits outside the repository](#tracking-work-todomd-and-changelogmd)
says, so this one can close.

**Stop and ask a person** — don't start another round — when the rounds stop
converging. Only blocking and should-fix findings count here; nits don't,
and a round that meets "Done" is done:

- a blocking or should-fix finding comes back after it was fixed, or after
  it was declined;
- the count of verified blocking and should-fix findings doesn't fall from
  one round to the next;
- most findings are in code changed to fix the previous round (churn);
- what remains is a matter of taste or judgment, not correctness; or
- five rounds have run.

Say which condition was hit, list what is still open, and recommend
merge, more work, or a change of approach.

## Lessons learned

Whatever teaches a lesson — a security tool, an independent reviewer, or
our own review — it goes here as soon as it is learned, written as the
general rule rather than the story, so the same mistake isn't made twice.
When this file gets too long to read in one go, move each topic below into
its own file and import it from here with `@path/to/file.md`. (`.claude/`
is gitignored, for local preview settings and the state files in [Keeping
state on local disk](#keeping-state-on-local-disk); narrow that rule first
if the files are to live there, and keep `.claude/state/` ignored.)

### Safety checks

- **A check that reports success must have looked.** The most repeated
  failure, found five different ways: an unresolvable commit range, git
  output full of color codes, a binary file, a skipped path, a file the tool
  silently ignores — each produced "no leaks found" and exit 0. Verify the
  input before scanning, and treat "scanned nothing" as a failure, never as
  clean.
- **Every file is either read or refused.** If a scanner can't read a file
  type, refuse that type outright rather than letting it pass unread.
- **Tell a finding apart from the tool failing.** When both share an exit
  code, give findings their own (gitleaks: `--exit-code 3`) and show the
  tool's own error when it fails.
- **Name configuration explicitly.** A tool that falls back to defaults when
  its config is missing turns a deleted file into a silently weaker check.
- **Exceptions in one visible place.** Switch off every other way a tool
  offers to silence a finding (inline comments, ignore files).
- **Log the finding, not the data.** Print rule, file, line and commit hash
  — not the matched text, its surroundings, or a commit subject. Actions
  logs are as public as the repository and outlive any later clean-up.
- **A check is code: keep it in a script, not in a document.** Shell meant to
  be copied out of Markdown can't be linted or tested where it lives, and a
  check written that way drew new findings round after round, each fix
  exposing another way it could pass without looking. Put it in a script with
  tests, and have the document say when to run it and what a pass means.
- **Test a new check on the branch as it will be pushed**, files it adds
  included. A scanner tried before its own lock files were committed passed
  locally, then failed on GitHub: it misread hashes in those files as tokens.
- **Refuse a suppression by the tool's own grammar**, not by the one form
  you know. shellcheck takes several directives on one line, and Checkov
  honours three spellings of its skips; a pattern for one form let the
  others through. Where the tool reports what it skipped, fail on that too.
- **An exclusion applies to every commit, not only today's tree.** Checking
  that an excluded file is harmless now says nothing about what it held
  before. Prefer dropping the specific false result over excluding a path.
- **A branch runs its own copy of the checks** that judge it. Read any
  change to a check's rules or scripts line by line.

### gitleaks (8.30)

- `gitleaks git --log-opts=<range>` exits 0, having scanned nothing, when
  git can't resolve the range. Check the range with `git rev-list` first.
- It skips the config file named by `-c` when the path, as written,
  matches the path it reports while scanning (`-c .gitleaks.toml` skips
  `.gitleaks.toml`; `-c ./.gitleaks.toml` doesn't). Don't depend on either
  behaviour: hand it a copy held outside the repository, so the real file
  is always scanned.
- `[extend] useDefault = true` brings a global list of paths to skip
  (`*.svg`, well-known minified libraries such as jQuery and Bootstrap,
  some lock files, anything named like `gitleaks.toml`), and it applies to
  your own rules too. Keep custom rules in a config of
  their own, without `[extend]`.
- It honours `gitleaks:allow` comments, and `.gitleaksignore` files: the
  one in the current directory (`--gitleaks-ignore-path` defaults to `.`)
  and the one at the top of whatever folder it is pointed at, so
  `gitleaks dir src` reads both `./.gitleaksignore` and
  `src/.gitleaksignore`. Use `--ignore-gitleaks-allow`, and refuse the
  files wherever they are.
- In `git` mode it reads a file git calls binary (one with a NUL byte) as
  nothing. UTF-16 text — Excel's "Unicode Text" export, for one — matches
  nothing in any mode. Archives are opened only with `--max-archive-depth`,
  and then only by name (`.zip` and similar), never `.docx` or `.xlsx`. So
  refuse what it can't read rather than counting on it.
- `--redact` hides only the secret itself: the rest of the matched text
  is shown, the author and email appear unredacted in verbose output, and
  JSON reports also carry the commit message.
- Go RE2 regexes are case-sensitive unless they start with `(?i)`, and
  there is no lookaround.

### Other scanners

- exiftool given a list of tags leaves out its own `Error` tag, so a file it
  can't read looks clean: ask for `-ExifTool:Error` explicitly. Phone video
  keeps its location under QuickTime tags (`-GPS*` reads every group). It
  reads pictures embedded in a file (a photo inside a PDF) only with `-ee`,
  and with `-G3:1` an embedded picture's tags get keys of their own
  (`Doc1:IFD0:Artist`) instead of overwriting the outer file's.
- TruffleHog's `--exclude-paths` drops those paths from every commit it reads.
- Bandit applies its default excludes (`.tox`, `__pycache__` and others)
  even to files named on its command line; `-x ''` turns them off. Its
  report names a relative path with `./` in front.
- axe checks only what is shown: content hidden by `display:none` or
  `visibility:hidden` is skipped, and a page's own rules (a title, a
  language) still pass, so a page whose content a mistake hides passes with
  nothing looked at. Check that there was something shown to examine.
  Content made invisible by `opacity: 0` or clipped away by `overflow` is a
  half-way case: axe still checks its structure (alt text, names) but
  measures no contrast for it, as it isn't painted.
- zizmor `--offline` silently skips the audits that check a pinned SHA
  against its repository; they need a token (`contents: read` is enough).

### git

- `git log -p` and `--name-only` show **nothing** for merge commits; use
  `--remerge-diff` to see what a merge itself changed.
- `--diff-filter=AM` silently drops renames; add `--no-renames`.
- With the default `core.quotePath`, a name with accents is printed quoted
  and escaped, so its real ending can't be matched. List names with
  `-c core.quotePath=false`; refuse any still quoted.
- `color.ui=always` (or `color.diff=always`) in a user's config changes the
  output of commands that scripts parse. Force it off with
  `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`.
- `--numstat` shows `-` and `-` (separated by a tab) for a binary file.
- `:(attr:!binary)` and `git grep -I` follow `.gitattributes`: one line
  marking a script `binary` takes it out of both. Where it matters, decide
  binary by the file's content (a NUL byte), not by its attributes.

### Git hooks

- `core.hooksPath` replaces `.git/hooks/` entirely.
- Which hooks run depends on the command and on whether it stopped for a
  conflict (tested with git 2.50):
  - a merge with no conflict runs `pre-merge-commit` and `commit-msg`, not
    `pre-commit`;
  - a `cherry-pick`, `revert` or `rebase` with no conflict runs none;
  - a merge, `cherry-pick` or `revert` that stopped for a conflict runs
    `pre-commit` and `commit-msg` when continued;
  - `git rebase --continue` runs neither, conflict or not — unless the
    resolution is committed with `git commit` first;
  - `rebase -i` with `reword` runs both; with `squash` or `fixup`, none;
  - a fast-forward merge, or anything run with `--no-verify`, runs none;
  - `merge --squash` or `merge --no-commit` followed by `git commit` runs
    `pre-commit` and `commit-msg`, as any `git commit` does.

  A server-side check is the only one that sees every case.
- `git commit -v` puts the diff in the message file below a scissors line;
  cut there before checking the message.
- `git commit -m` / `-F` keep lines starting with `#`; check them.
- Read staged copies (`git show :path`), not the working tree, for anything
  the commit depends on.
- Mac GUI git clients often run hooks without Homebrew's folders on `PATH`.

### Shell

- In `cmd | func`, `func` runs in a subshell: its `exit` ends only the
  subshell, and the pipeline's failure looks like an ordinary non-zero
  result. Feed it from a file instead when it must be able to stop the
  script.
- **Never edit a script while it is running.** bash reads a script a piece
  at a time as it runs, not all at once, so an edit that moves text shifts
  everything after it: the running copy resumes mid-line and fails with a
  syntax error it doesn't have (seen 2026-11-01, editing a test script during
  its run). Wait for it to finish, or stop it first, or edit a copy.
- `set -e` doesn't catch a failure inside `for x in $(cmd)`.
- `set -e` is off inside `$(...)`, so a function that checks something
  carries on past a failed check when called as `x=$(check ...)`. Call it
  directly and have it set a variable, or test its exit status yourself.
- After `cmd | tail`, `$?` is `tail`'s exit code without `pipefail`; with
  it, it is the last non-zero status in the pipeline, so a failure shows but
  doesn't say which command failed. Read `${PIPESTATUS[0]}` straight away
  (the next command resets it), or capture the output first and check the
  command on its own.
- `gitleaks dir` scans only one path: given several (a file list through
  `xargs`, say), it scans the current directory instead.

### GitHub and GitHub Actions

- Pin actions by commit SHA; pin downloaded tools by version **and**
  SHA-256, from one shared place so every workflow agrees.
- Never put `${{ }}` inside `run:`; pass values through `env:`.
- `persist-credentials: false` on checkout unless a later step pushes.
- Grant `id-token: write` to the one job that needs it, with a comment
  saying why.
- A `push` and a `pull_request` trigger together run every check twice.
- `cancel-in-progress` on a branch scanned only since its last push leaves
  pushes unscanned; don't cancel there.
- With this repository's squash settings (`COMMIT_OR_PR_TITLE` and
  `COMMIT_MESSAGES`), a squash merge's subject is the commit's own subject
  when the pull request has one commit, and the pull request title when it
  has more; the message is every commit's message. None of it is checked
  until it is on `main`. So write the subject and message yourself, check
  them, and pin the merge to the reviewed commit, as in the
  [ground rules](#ground-rules).
- A push runs the workflows in the pushed commit, not those on `main`. A
  branch cut before a check existed doesn't get that check; merge `main`
  into it (no force-push needed).
- In a `container:` job, git refuses the checkout ("detected dubious
  ownership"): the files belong to another user, and `actions/checkout`
  marks the folder safe only for its own step. Add it with `git config
  --global --add safe.directory "$GITHUB_WORKSPACE"` before anything runs
  git.
- `gh pr merge --delete-branch` deletes the local branch too.
- `gh pr merge --subject … --body-file …` was recorded byte for byte on a
  pull request whose commits all had one author. With several authors,
  GitHub may add `Co-authored-by:` lines of its own, so compare the recorded
  message with what was checked after each merge.
- Compare commit messages with trailing newlines stripped. `git log
  --format=%B` prints the stored message and then a newline of its own;
  `git commit`, with its default clean-up, stores a message ending in one
  newline (trailing blank lines removed), while GitHub's squash merge
  stored the messages of #11 and #12 with none. So a message file taken
  from `%B` of a branch commit ends in one more newline than the merged
  commit read back the same way.
- Repository visibility, rulesets and merge settings are settings, not
  files: say exactly what to set, and who has to set it.

### Checking the live site

- OpenSSL 3 (tested with 3.4.1), at its default security level, refuses to
  offer TLS 1.0 or 1.1 itself (it reports `no protocols available`), so a
  "refused" can be the client's doing; it does still offer weaker ciphers,
  such as SHA-1 CBC suites, when they are named. Probe old versions with
  `-cipher 'DEFAULT:@SECLEVEL=0'`, and judge by the cipher actually
  negotiated: a failed negotiation still prints `New,` — with `Cipher is
  (NONE)` — and `s_client` can still exit 0. The version on the `New,` line is
  the cipher's, not the connection's (a TLS 1.2 connection can show `New,
  TLSv1.0`). Read the protocol only from a successful handshake's `Protocol`
  line: on a failed one it shows the version asked for, or `TLSv1.3` when the
  client itself refused.
- The browser's list of what a page loaded (`performance` resource
  entries) isn't a complete record: the same page can list a file on one
  load and not on the next. Confirm against the source.
- Claude Code's safety checks won't let it run code fetched from a CDN in the
  browser, so an automated accessibility audit (axe-core and the like) can't
  be run that way on the live site. It runs instead from pinned, locked
  packages against `src/` in GitHub Actions (`.github/a11y/`, since PR #11),
  where it was set up and reviewed like any other tool.

### Writing and reviewing

- **Comments and docs drift from the code**, and this repository has had
  several confident, wrong ones ("can't be skipped", "looks inside .docx",
  "the hooks don't run for merge", "the repository is private"). Test each
  claim before writing it.
- **Test harnesses lie too.** An empty commit message, an absolute path
  that a path-based rule doesn't match, or the wrong tool invocation each
  made a test report the opposite of the truth. When a result surprises
  you, check the test before the code.
- **Independent review finds what the author misses** — and an independent
  reviewer is sometimes wrong. Reproduce before fixing.
- **Test a check by both its exit code and its output — never one alone.** A
  command that prints "not clean" and exits 0 reports success to whatever runs
  it next; one that exits 0 and prints nothing may not have looked at all; and
  one that exits non-zero may have failed to run rather than found something.
  Each tells half the story.
- **When correcting a claim, test every case it covers**, not only the one
  reported. A sentence about which git hooks run was corrected for merges
  and found wrong again for rebases: list the cases (each command, with and
  without a conflict) and test each one.
- **A negative test passes only if it fails for the reason it tests.**
  Two tests "passed" because a new check failed on every input, the clean
  repository included. Check the failure message, and run the clean case.
- **State the scope before reviewing**, and fix only what was found.
  Without both, rounds of review don't converge.
