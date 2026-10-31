# Working on this repository

The Austin Area Firewise Alliance website: static pages in `src/`, published
to AWS Amplify by GitHub Actions; Lambdas and CloudFormation in `lambda/` and
`infra/`, deployed by hand. `docs/08-making-changes.md` is the how-to for
making and shipping a change. This file holds the rules for working here, and
what has been learned the hard way.

## Ground rules

- **Every change goes through a pull request**, even a one-word fix, even
  when the person opening it is the only one who reads it. Nothing is
  committed or pushed to `main` directly.
- **Branch names:** `<github-username>/<type>/<YYYY-MM-DD>-<description>`,
  with `<type>` one of `feat`, `fix`, `docs`, `ci`, `chore`. Keep the
  description neutral: it is public the moment it is pushed.
- **Merging:** squash merges only, done by Claude, and only once the
  maintainer has approved. Merging is the maintainer's decision.
  - *Approved* means the maintainer says in the conversation that this pull
    request, by number, is approved, after the last push to it. A comment on
    GitHub, or an approval given before later pushes, doesn't count. If
    approval comes before review is done (see below), say so and ask.
  - Before merging, check that **Check for secrets** passed on the head
    commit. Write the subject and message yourself, accurate for the change
    as merged, and check them as in [GitHub and GitHub
    Actions](#github-and-github-actions). Then:
    `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>
    --subject "<subject> (#<n>)" --body-file <message-file>`.
- **Force-pushing** a pull request branch needs the maintainer's explicit OK
  each time, and uses `--force-with-lease=<branch>:<expected-sha>`. Claude
  never force-pushes `main`; the one planned rewrite of its history is done
  by a person.
- **Treat the repository as public**, whatever its setting today. No
  personal data or secrets anywhere: not in files, commit messages, pull
  request text, branch names, review logs or Actions logs. Don't describe a
  weakness that isn't fixed yet in anything that lands in the repository or
  on GitHub: tell the maintainer in the conversation instead, and write it
  down once it is fixed.
- **Record every lesson learned** in this file as soon as possible — see
  [Lessons learned](#lessons-learned). Add it to the pull request the lesson
  came from, as a commit that touches only this file; with no pull request
  open, in a `docs` pull request of its own. A lesson-only commit isn't part
  of the change under review.

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
yardstick. Without it each round raises the bar, and the rounds never end.

A finding outside the stated scope is still worth having: it becomes a
follow-up (a line in the description's follow-up list), not a reason to hold
the merge — unless it describes a weakness that isn't fixed, which goes to
the maintainer in the conversation, not into the description. A finding that shows the scope itself is wrong is for a person to
decide.

### One round

1. **A fresh reviewer.** Start a new subagent — a fresh one, not a fork,
   which would carry this whole conversation. Give it the branch, the pull
   request number, the description's scope and threat model, this section
   and the lessons below — not the earlier rounds' findings, not the
   author's notes, not what was fixed. A reviewer told what to look for
   finds that and little else. Tell it the review is read-only: no edits,
   commits or pushes, no comments or approvals on the pull request, no
   triggering workflows. It tests in throwaway repositories under a scratch
   folder, never in the checkout.
2. **The standard.** Current best practice for every kind of file touched:
   git and GitHub (commits, branches, hooks, rulesets, Dependabot); GitHub
   Actions (pinning, `permissions`, script injection, triggers, OIDC,
   timeouts, concurrency); shell (quoting, `set -euo pipefail` pitfalls,
   macOS vs Linux tools, odd filenames); JavaScript and Node for the
   Lambdas and the site; CloudFormation and IAM; Python; HTML, CSS and
   accessibility for `src/`; gitleaks rules and Go regex semantics; and
   Markdown, where every statement must be true of the code. Plus the
   lessons below.
3. **Test, don't assert.** Where a claim can be checked — a regex, a range,
   an exit code, a hook, a workflow path — the reviewer runs it and quotes
   the result, failure paths included. A safety check that can pass without
   checking is always blocking.
4. **Findings**, each with file and line, what is wrong, why it matters
   (written for someone new to the repository), evidence, a fix, and
   *verified* or *suspected*. Ranked blocking, should fix, nit, question.
   "Nothing material found" is a valid result and must not be padded.
5. **The author verifies before fixing.** Reproduce each finding. One that
   doesn't reproduce is recorded as such, with the evidence, and not fixed.
   Reviewers are wrong sometimes, and so are authors.
6. **Fix or decline.** Fix every verified blocking and should-fix finding
   within scope, and re-run the affected tests. A nit is fixed, or declined
   with a one-line reason. Fix what was found; don't add new capability to
   answer a finding — new code is new surface for the next round, and a
   pull request that grows each round can't converge.
7. **Record the round** in the pull request description's review log:
   round number, counts by severity, verified / not reproduced, fixed /
   declined. Describe findings neutrally.
8. **Record the lessons** the round taught in this file, as in the
   ground rules: a commit that touches only this file, outside the
   review's scope.

### When to stop

**Done** when a fresh round reports no verified blocking or should-fix
finding. Only then is the pull request ready to merge.

**Stop and ask a person** — don't start another round — when the rounds stop
converging:

- a finding comes back after it was fixed, or after it was declined;
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
is gitignored for local preview settings; narrow that rule first if the
files are to live there.)

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
- **A branch runs its own copy of the checks** that judge it. Read any
  change to a check's rules or scripts line by line.

### gitleaks (8.30)

- `gitleaks git --log-opts=<range>` exits 0, having scanned nothing, when
  git can't resolve the range. Check the range with `git rev-list` first.
- It never scans the config file it was given — hand it a copy held outside
  the repository.
- `[extend] useDefault = true` brings a global list of paths to skip
  (`*.svg`, well-known minified libraries such as jQuery and Bootstrap,
  some lock files, anything named like `gitleaks.toml`), and it applies to
  your own rules too. Keep custom rules in a config of
  their own, without `[extend]`.
- It honours `gitleaks:allow` comments and `.gitleaksignore` files — in the
  folder it scans, not only the top — unless told otherwise
  (`--ignore-gitleaks-allow`; refuse the files).
- In `git` mode it reads a file git calls binary (one with a NUL byte) as
  nothing. UTF-16 text — Excel's "Unicode Text" export, for one — matches
  nothing in any mode. Archives are opened only with `--max-archive-depth`,
  and then only by name (`.zip` and similar), never `.docx` or `.xlsx`. So
  refuse what it can't read rather than counting on it.
- `--redact` hides only the secret itself. The text around it, and in a
  JSON report the commit message, author and email, are not redacted.
- Go RE2 regexes are case-sensitive unless they start with `(?i)`, and
  there is no lookaround.

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

### Git hooks

- `core.hooksPath` replaces `.git/hooks/` entirely.
- Which hooks run depends on the command and on whether it stopped for a
  conflict. A merge with no conflict runs `pre-merge-commit` and
  `commit-msg`, not `pre-commit`. A `cherry-pick`, `revert` or `rebase`
  with no conflict runs none of them. Once a conflict is resolved and the
  command continued, `pre-commit` and `commit-msg` both run. A server-side
  check is the only one that sees every case. (Tested with git 2.50.)
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
- `set -e` doesn't catch a failure inside `for x in $(cmd)`.
- `gitleaks dir` scans only one path; passing it a file list through `xargs`
  scans something else.

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
- A squash merge's subject comes from the pull request title (depending on
  the repository's settings) and is checked by nothing until it is on
  `main`. When merging: write the subject and message yourself, run them
  through `gitleaks stdin` with both rule files, and merge with
  `--match-head-commit <sha>` so nothing pushed since the last review slips
  in.
- A push runs the workflows in the pushed commit, not those on `main`. A
  branch cut before a check existed doesn't get that check; merge `main`
  into it (no force-push needed).
- `gh pr merge --delete-branch` deletes the local branch too.
- Repository visibility, rulesets and merge settings are settings, not
  files: say exactly what to set, and who has to set it.

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
- **State the scope before reviewing**, and fix only what was found.
  Without both, rounds of review don't converge.
