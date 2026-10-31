# 3 — Connect GitHub to AWS

After this, saving a change to GitHub publishes the website. That is the whole
workflow from then on.

About 15 minutes.

---

## 3.1 Get the code onto your computer

Install **Git for Windows** (<https://git-scm.com/download/win>) — the default
options are fine. Or **GitHub Desktop** (<https://desktop.github.com/>) if you
would rather not use a terminal.

Then, in Command Prompt, in a folder where you keep projects:

```bash
git clone https://github.com/YOUR-ORG/YOUR-REPO.git
```

If the repository is empty, copy the site files in now — the `src/` folder,
`.github/`, `docs/`, `infra/`, `README.md` and `.gitignore`.

> **Copy the files, not a whole other folder from another machine.** A copied
> folder that still points at someone else's repository will look like it is
> working and silently push to the wrong place.

## 3.2 Fill in the workflow file

Open `.github/workflows/deploy.yml`. Near the top:

```yaml
env:
  AWS_REGION: us-east-2
  AMPLIFY_APP_ID: xxxxxxxxxxxx
  AMPLIFY_BRANCH: main
```

and further down:

```yaml
          role-to-assume: arn:aws:iam::000000000000:role/xxxxx-github-deploy
```

Replace all four with the values from your stack's **Outputs** tab — the
`WorkflowEnvBlock` output lists exactly these four, in this order, so you can
copy them across one at a time.

Nothing else in the file needs changing.

> **No password or key goes in this file, and none should.** The role ARN is
> not a secret — it is the *name* of a permission, and it only works for a
> workflow running in your repository, on your branch. Anyone else who quotes
> it gets refused.

## 3.3 Publish

```bash
git add -A
git commit -m "Initial site"
git push
```

If Git asks you to sign in, a browser window opens — approve it there. That
happens once.

## 3.4 Watch the first deploy

Go to your repository on GitHub → **Actions** tab. A run named **Deploy to
Amplify** starts within a few seconds.

- **Green tick** → open the `TemporaryUrl` from your stack outputs. The site is
  live. If you attached a domain, try that too — if it does not resolve yet,
  DNS is still propagating, which can take up to an hour.
- **Red X** → click into the run, expand the failed step, read on.

---

## 3.5 When the first deploy fails

Almost always one of two things, and the first is the one people lose hours to.

### "Not authorized to perform sts:AssumeRoleWithWebIdentity"

AWS declined to hand credentials to the workflow. The error deliberately does
not say why, so you have to look at what was actually presented.

**First, check the obvious:** the owner and repository names in the stack
parameters must exactly match GitHub, and you must be pushing to the branch
named in `AMPLIFY_BRANCH`. A typo in either produces exactly this error.

**If those are right,** find the real subject claim in CloudTrail. AWS records
every rejected attempt:

```bash
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity --max-results 5 --query "Events[].CloudTrailEvent" --output text
```

In that output, find `"userName"`. It looks like one of these:

```
repo:my-org/my-site:ref:refs/heads/main
repo:my-org@9330587/my-site@1366852467:ref:refs/heads/main
```

The template trusts **both** forms, so if what you see matches neither, the
owner or repository name is wrong — compare it character by character against
the address bar on GitHub.

> This is worth knowing about generally: which of those two forms GitHub sends
> is not something you can determine in advance, and guides that only handle
> the first form fail here with no explanation. If you are adapting these
> instructions for another project, carry both patterns across.

**Also possible:** the workflow is missing its permission to request a token.
The file must contain:

```yaml
permissions:
  id-token: write
  contents: read
```

### "AccessDeniedException" on an Amplify call

The app ID in the workflow does not match the app the role is allowed to touch
— usually a copy-paste that picked up a stray character, or a second stack
created and the wrong output copied. Compare `AMPLIFY_APP_ID` against the
stack's `AmplifyAppId` output.

### The run does not start at all

The workflow only triggers on changes under `src/`. To publish without a
content change, go to **Actions** → **Deploy to Amplify** → **Run workflow**.

---

## 3.6 Decide who can publish

Until a rule says otherwise, anyone who can push to `main` changes the live
site within a minute, with no review and no checks.

The Alliance's rule is that every change goes through a pull request, even a
lone maintainer's, so the secrets check gets its say before anything is
live. Set up the branch ruleset that enforces it as described in
[08-making-changes.md](08-making-changes.md) §2.4.

---

## Check it worked

- [ ] Actions run finished green
- [ ] `TemporaryUrl` shows the site
- [ ] Custom domain shows the site, and `http://` and the bare domain both end
      up at `https://www.`
- [ ] A small edit to a file in `src/`, merged through a pull request, appears
      live within two minutes

Next: [05-runbook.md](05-runbook.md) — the things you will need later.
