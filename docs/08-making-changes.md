# 8 — Making a change: Claude Code, GitHub, AWS

How a change actually gets made and shipped on this site, start to finish.

Three separate things happen, and most confusion here comes from treating them
as one:

| | What it is | Who does it |
| --- | --- | --- |
| **1. Make the change** | Editing files in this folder, with Claude Code or any editor | you |
| **2. Push it** | Committing to Git and pushing to `main` on GitHub | you |
| **3. Deploy it** | Getting it onto AWS | **depends on what changed** — see §3 |

Step 3 is the one that catches people. A change under `src/` deploys itself the
moment it is pushed. A change anywhere else does not deploy at all until
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

`origin` is the Alliance's repository and it is **private**. Branch is `main`.
`rpdiscoverer` is a different project that happens to share this checkout's
remote list; nothing from this site is ever pushed there.

Private matters for one reason worth remembering: anything committed by mistake
is not public, but it is also not gone. Git history keeps it. Secrets and
personal data must not be committed in the first place — see §4.

### 2.2 The three commands

```bash
git add -A
git commit -m "what changed"
git push
```

Or tell the session "commit and push". It writes the message, which should say
what changed in plain words — the commit log is read later by whoever inherits
this site.

### 2.3 Straight to main

There is no required review on this repository today. A push to `main` is live
in about a minute. That is a deliberate choice for a two-person volunteer
board, and it is reversible: turning on required pull requests is
[03-connect-github.md](03-connect-github.md) §3.6.

### 2.4 Confirm it landed

```bash
git status -sb
```

`## main...origin/main` with nothing after it means pushed and in sync. If it
says `ahead 1`, the commit exists only on this computer.

### 2.5 Undo a bad change

```bash
git log --oneline -10
git revert <the-commit-id>
git push
```

A revert is a new commit that undoes the old one, and it deploys like any other
push. History is kept on purpose: you can see what happened and why.

---

## 3 — Deploying to AWS

Everything lives in AWS account **773005956573** (alias `austinareafirewise`),
region **us-east-2**. There are three deploy paths, and which one you need is
decided entirely by which folder you edited.

### 3.1 Anything under `src/` — automatic

Pushing to `main` with a change under `src/` triggers
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which:

1. checks out the repository
2. asks GitHub for a short-lived AWS token and assumes
   `role/aafa-site-github-deploy` — **no AWS keys are stored in GitHub**
3. zips the contents of `src/`
4. creates an Amplify deployment, uploads the zip, starts it
5. waits for it to finish, and fails the run if it does not

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
| `src/**` (pages, CSS, JS, images, admin screens, training scripts and audio) | push to `main` — automatic |
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
organization can read it, and history keeps what was removed.

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
| `git push` rejected | Somebody else pushed first. `git pull`, resolve, push again |
| A page is blank in a browser | JavaScript may be off. Every page now says so rather than showing nothing |

Everything after the site is live — rollback, removing a person, costs,
sign-in trouble — is [05-runbook.md](05-runbook.md).
