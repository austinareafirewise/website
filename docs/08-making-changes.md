# 8 — Making a change: Claude Code, GitHub, AWS

How a change actually gets made and shipped on this site, start to finish.

Three separate things happen, and most confusion here comes from treating them
as one:

| | What it is | Who does it |
| --- | --- | --- |
| **1. Make the change** | Editing files in this folder, with Claude Code or any editor | you |
| **2. Push it** | Committing on a branch, pushing it, and merging a pull request into `main` (§2) | you |
| **3. Deploy it** | Getting it onto AWS | **depends on what changed** — see §3 |

Step 3 is the one that catches people. A change under `src/` deploys itself the
moment it is merged into `main`. A change anywhere else does not deploy at all until
somebody runs a command.

---

## 1 — Making a change with Claude Code

Claude Code is the assistant in the Claude desktop app's **Code** tab, opened
on this folder (`/Users/bob/austinareafirewise-website`). It reads and edits
the files here, runs commands, and can use Git on your behalf.

### 1.1 Open the session

1. Open the Claude desktop app.
2. **Code** tab.
3. Pick the `austinareafirewise-website` session, or start a new one on this
   folder.

Each session keeps its own history. Starting a new one for an unrelated job is
usually better than continuing a long one, because a fresh session is not
carrying three hours of someone else's context.

### 1.2 Get the latest code first

Another person edits this repository. Before any work:

```bash
git pull
```

Or say "pull the latest code" and let the session do it. Doing this *after*
making edits is how merge conflicts are earned.

### 1.3 Ask for the change in plain words

Describe the outcome, not the file. "The burn ban bar at the top is too tall,
make it one line with the date on hover" is a better instruction than "edit
`src/js/content.js`". The session finds the file; you are the only one who
knows what the site is supposed to look like.

Two phrases worth using often:

- **"show me a preview first"** — the change is made and shown to you before
  anything is committed. Good for anything visible.
- **"is everything pushed"** — answers the only question that matters at the
  end of a session.

### 1.4 Look at the change before it goes anywhere

Ask to see the diff, or open the **Changes** pane in the app. Reviewing a diff
is not a formality on this site: every page repeats its own header and footer,
so a one-line change to the header is a twelve-file change, and the diff is
where you find out whether all twelve were touched.

### 1.5 Preview it

Static pages:

```bash
open src/index.html
```

Double-clicking the file in Finder does the same thing, and the whole site
works that way because every internal link is relative. Do **not** use the
desktop app's preview pane for these files — it renders them on a `data:`
origin, so the stylesheet never loads and the page looks broken when it is not.

Anything that reads published content (news, notices, resources, the board
roster, fire danger) needs a real server, because those pages fetch JSON:

```bash
python3 -m http.server 8080 --directory src
```

Then `http://localhost:8080`.

### 1.6 Admin training scripts and narration

If the change touches the admin screens, the training lessons in
`src/admin/training/` describe screens that just moved. Two gates:

```bash
node src/admin/training/check.mjs
```

This proves every lesson still points at something that exists on the page. It
fails the same day a button is renamed, which is the point of keeping the
scripts as text.

```bash
node src/admin/training/generate-audio.mjs --list
node src/admin/training/generate-audio.mjs --lesson edit-the-home-page --go
```

`--list` says what needs re-recording. Nothing is sent or billed without
`--go`. It needs `openai-api-key.local` at the repository root — that file is
gitignored by name and must stay that way.

---

## 2 — Pushing to GitHub

### 2.1 Where it goes

```
origin        https://github.com/austinareafirewise/website.git   ← everything
rpdiscoverer  https://github.com/dweilert/rp-vicki.git            ← unrelated project
```

`origin` is the Alliance's repository. Branch is `main`. Treat it as public
whatever its setting says today: visibility is a switch, and anything in it
could be read by anyone later.
`rpdiscoverer` is a different project that happens to share this checkout's
remote list; nothing from this site is ever pushed there.

Remember too that anything committed by mistake is not gone when the file is
deleted. Git history keeps it. Secrets and
personal data must not be committed in the first place — see §4.

### 2.2 Every change goes through a pull request

Nothing is committed to `main` directly — not by a volunteer, not by the
webmaster, not for a one-word fix. Each change is made on a branch of its own
and arrives in `main` through a pull request on GitHub, even when the person
who opens it is the only one who reads it. That is the line every change
crosses, and it is where the checks in §4 get to say no before the change is
live.

Name the branch for who, what kind, when and what:

```
<github-username>/<type>/<YYYY-MM-DD>-<short-description>
bknowles/ci/2026-10-30-repo-hardening
```

`<type>` is one of `feat`, `fix`, `docs`, `ci` or `chore`. Keep the
description plain and neutral: on a public repository a branch name is
public the moment it is pushed, so `fix/2026-11-02-signup-limits` rather than
a name that describes a weakness before it is fixed.

### 2.3 The commands

```bash
git switch main
git pull
git switch -c bknowles/fix/2026-11-02-burn-ban-wording
```

Make the change, then:

```bash
git add <the files>
git commit -m "what changed"
git push -u origin HEAD
gh pr create --fill
```

Or tell the session "commit this on a branch and open a pull request". It
writes the message, which should say what changed in plain words — the
commit log is read later by whoever inherits this site.

On the pull request, wait for **Check for secrets** to pass and read the
**Files changed** tab. GitHub doesn't let you approve your own pull request;
merging after reading it is the approval.

Merge with **Squash and merge**: the branch's commits become one commit on
`main`, so `main` reads as one line per change. Check the subject GitHub
proposes before confirming: depending on the repository's settings it is the
pull request's title or the first commit's subject. From the command line, or ask the session to do it:

```bash
gh pr merge <number> --squash --delete-branch
```

A change under `src/` is live about a minute after the merge (§3.1).

Afterwards, back on your computer:

```bash
git switch main
git pull
git branch -D bknowles/fix/2026-11-02-burn-ban-wording
```

`-D`, not `-d`: after a squash merge the branch's own commits aren't in
`main` — the squashed one is — so git can't tell it was merged and `-d`
refuses.

### 2.4 Make GitHub hold the line

The rule is only a habit until GitHub enforces it. An organization owner sets
this once, under the repository's **Settings → Rules → Rulesets → New branch
ruleset**:

- **Target:** the default branch (`main`); enforcement **Active**
- **Restrict deletions** and **Block force pushes**
- **Require a pull request before merging**, with **0** required approvals —
  more would leave a lone maintainer unable to merge anything — and
  **Allowed merge methods** set to **Squash** only
- **Require status checks to pass:** `gitleaks` (the job in **Check for
  secrets**)
- **Bypass list:** empty, so the rule applies to owners too

Also under **Settings → General → Pull Requests**, turn on **Automatically
delete head branches**, so a merged branch doesn't linger on GitHub.

Leave **Block force pushes** off only for the one planned history rewrite,
and turn it straight back on.

### 2.5 Undo a bad change

On a branch, the same way as any other change:

```bash
git revert <the-commit-id>
```

Then push and open a pull request for it. A revert is a new commit that
undoes the old one, and it deploys like any other merge. History is kept on
purpose: you can see what happened and why.

---

## 3 — Deploying to AWS

Everything lives in AWS account **773005956573** (alias `austinareafirewise`),
region **us-east-2**. There are three deploy paths, and which one you need is
decided entirely by which folder you edited.

### 3.1 Anything under `src/` — automatic

Merging a pull request with a change under `src/` into `main` triggers
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which:

1. checks out the repository
2. scans `src/` for secrets and personal data, and stops before anything
   below if it finds any (§4.1)
3. asks GitHub for a short-lived AWS token and assumes
   `role/aafa-site-github-deploy` — **no AWS keys are stored in GitHub**
4. zips the contents of `src/`
5. creates an Amplify deployment, uploads the zip, starts it
6. waits for it to finish, and fails the run if it does not

No build step, because the site is static files served exactly as written.
Takes about a minute.

Watch it:

```bash
gh run watch
```

Or the **Actions** tab on GitHub. To republish the current contents of `main`
without a content change — useful after changing something on the AWS side —
run the **Deploy to Amplify** workflow from the Actions tab, or:

```bash
gh workflow run deploy.yml
```

The workflow only fires on changes under `src/`. A push that touches only
`lambda/`, `infra/` or `docs/` deploys nothing, correctly.

### 3.2 `lambda/` or `infra/` — by hand, from your computer

Lambda code and the infrastructure templates are **not** deployed by the push.
They need the AWS CLI and the `austinareafirewise` profile. Run from the
repository root.

Board content API, burn ban watch and fire danger — stack `aafa-cms`:

```bash
export AWS_PROFILE=austinareafirewise
aws cloudformation package --region us-east-2 --template-file infra/cms-stack.yaml \
  --s3-bucket aafa-deploy-artifacts-773005956573 --s3-prefix cms \
  --output-template-file /tmp/cms-packaged.yaml
aws cloudformation deploy --region us-east-2 --template-file /tmp/cms-packaged.yaml \
  --stack-name aafa-cms --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset
```

Members, email and SMS — stack `aafa-comms`:

```bash
export AWS_PROFILE=austinareafirewise
aws cloudformation package --region us-east-2 --template-file infra/comms-stack.yaml \
  --s3-bucket aafa-deploy-artifacts-773005956573 --s3-prefix comms \
  --output-template-file /tmp/comms-packaged.yaml
aws cloudformation deploy --region us-east-2 --template-file /tmp/comms-packaged.yaml \
  --stack-name aafa-comms --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset
```

Hosting, domain and the deploy role — stack `aafa-site`, template
`infra/site-stack.yaml`. Same shape, and rarely needed; see
[02-deploy-stack.md](02-deploy-stack.md).

`package` uploads the Lambda folders and rewrites their `Code:` references;
`deploy` applies the result. A code-only change takes about a minute.
Parameters already set on a stack persist when they are not passed again.

**Prefer updating the stack over changing anything by hand in the console**, so
the template stays the truth about what exists.

### 3.3 Board-published content — neither of the above

Meeting notices, news articles, resources, the home banner and the board roster
are entered at `https://www.austinareafirewise.org/admin/` and published from
there. No Git, no deploy. The admin page writes to DynamoDB, and publishing
writes JSON and images into the `aafa-site-content` S3 bucket, which the site
reads at `/content/…`.

One trap, and it has bitten twice: **the content bucket's public-read policy
names its keys one at a time.** A newly published file whose key is not in that
policy is served a redirect to `/404.html` instead of the file. If a new
content file 404s, the fix is in `infra/cms-stack.yaml`, followed by §3.2.

### 3.4 Which did I need?

| You edited | Deploys by |
| --- | --- |
| `src/**` (pages, CSS, JS, images, admin screens, training scripts and audio) | merging into `main` — automatic |
| `lambda/**` | §3.2, the stack that owns that function |
| `infra/**` | §3.2, the matching stack |
| `docs/**`, `scripts/**`, `README.md` | nothing to deploy |
| Notices, news, resources, banner, roster | published from `/admin/`, §3.3 |

---

## 4 — Things not to commit

Already gitignored by name, and the rules exist because each of these has been
a real near-miss:

- `openai-api-key.local` — a live API key
- `users.txt` — board email addresses and the temporary password accounts are
  created with
- `*HOAs*.txt`, `* - cleaned.txt` — residents' names, phone numbers and home
  email addresses
- `.twilio`, `.env`, `.secret-*`

Account credentials and one-time passwords belong in a terminal or a password
manager. A private repository is not a safe place for them: everyone in the
organization can read it, history keeps what was removed, and a repository's
visibility is a setting somebody can change later.

### 4.1 The checks on every commit

A name in `.gitignore` only protects a file by that name. The same addresses
pasted into `notes.txt` would go straight in. So commits are also checked by
[gitleaks](https://github.com/gitleaks/gitleaks), which looks at what is being
committed rather than at file names. It runs with two sets of rules:
`.gitleaks.toml`, this repository's own — a password on a command line, a
home (Gmail, Road Runner, …) email address, an address on a board member's
own domain, and a list of email addresses — and `.gitleaks-standard.toml`,
gitleaks' standard set for keys and tokens. They are separate files because
the standard set skips some paths (images, minified libraries), and the
repository's own rules must not.

gitleaks reads text only, so every file is either read by it or refused.
Spreadsheets, Word files, PDFs, slide decks and archives are refused by
type, and so is anything else git stores as binary other than pictures,
sound and fonts — a roster saved as a spreadsheet, or as the "Unicode text"
Excel writes, would pass gitleaks unread. A file that belongs in the
repository is listed by path in `.githooks/allowed-documents.txt` — open it
and check it first.

The checks run in three places:

| Where | When | Checks |
| --- | --- | --- |
| Your computer (`.githooks/`) | each `git commit`, once turned on | staged files, documents, the commit message |
| GitHub (**Check for secrets**) | each push of any branch | the pushed commits including merges, their messages, documents |
| The deploy (**Deploy to Amplify**) | before every publish of the site | everything under `src/`, as it is about to go live |

The GitHub check is the one a pull request must pass (§2.4), and it runs
whether or not anyone turned the hooks on. The hooks add catching a mistake
before it leaves your computer at all. For `git merge`, `cherry-pick` and
`rebase` only the commit-message hook runs, not the one that checks files;
the GitHub check covers those. To turn
them on, once per checkout:

```bash
brew install gitleaks
git config core.hooksPath .githooks
```

That setting *replaces* `.git/hooks/` for this checkout: any hook you already
had there stops running. Copy it into `.githooks/` if you still want it.

A finding names the file and line (or the commit, for a message). Take the
secret out and commit again. If the check is certain and wrong, add an
allowlist entry to `.gitleaks.toml`, so the exception is written down and
reviewed. That is the only place for one: the checks ignore `gitleaks:allow`
comments and refuse a `.gitleaksignore` file.

A pull request runs with its *own* copy of the rules, the document list
and the workflows, so a change to any of them can loosen the check that
judges it. The GitHub check rescans with `main`'s rules when a branch changes
them and warns if those find more — but read any change to the
`.gitleaks*.toml` files, `.githooks/` or `.github/` line by line regardless.

### 4.2 Updating gitleaks in the GitHub checks

Dependabot keeps the pinned *actions* current, but the GitHub checks download
gitleaks themselves, pinned by version and checksum in
[`.github/actions/install-gitleaks/action.yml`](../.github/actions/install-gitleaks/action.yml),
and nothing updates that. Every few months, or when a gitleaks release adds
rules worth having:

1. Pick the release at <https://github.com/gitleaks/gitleaks/releases>.
2. From its `gitleaks_<version>_checksums.txt`, copy the line for
   `linux_x64.tar.gz`.
3. Change `GITLEAKS_VERSION` and `GITLEAKS_SHA256` together, in one pull
   request.

Update your own copy at the same time (`brew upgrade gitleaks`), so the
hooks and the checks agree.

---

## 5 — When it does not work

| What you see | Usually |
| --- | --- |
| Push succeeded, site unchanged | The change was not under `src/`. §3.1 — nothing deployed, by design |
| Actions run failed at "Configure AWS credentials" | The OIDC trust or role; [03-connect-github.md](03-connect-github.md) §3.5 |
| Page looks unstyled while previewing | The desktop app's preview pane on a `data:` origin. Open it in a real browser |
| News, notices or resources missing locally | Those pages fetch JSON; needs a real server, §1.5 |
| A new content file returns the 404 page | Bucket policy names keys individually, §3.3 |
| API change had no effect | Lambda deploys by hand, §3.2 |
| `git push` to `main` rejected | Working through pull requests is enforced (§2.4). Move the commit to a branch: `git switch -c <branch>`, push that |
| `git push` of a branch rejected | Somebody else pushed to it first. `git pull`, resolve, push again |
| **Check for secrets** failed | Its log names the rule, file and line, or the commit. Fix it on the branch and push again (§4.1) |
| Deploy stopped at "Check the site" | Something under `src/` looks like a secret or personal data, and nothing was published. Its log says what |
| A page is blank in a browser | JavaScript may be off. Every page now says so rather than showing nothing |

Everything after the site is live — rollback, removing a person, costs,
sign-in trouble — is [05-runbook.md](05-runbook.md).
