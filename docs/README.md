# Deploying a static site: GitHub to AWS

A complete, repeatable setup for hosting a static website on AWS, published
from GitHub, with **no passwords or access keys stored anywhere**.

Written to be followed by someone who is comfortable with a computer but is not
a developer, and to be reusable for other sites and other organizations.

## What you end up with

- A website on AWS Amplify Hosting, on your own domain, with HTTPS
- Editing by saving a file to GitHub — live in about a minute
- No AWS keys in GitHub. The connection is short-lived tokens that expire in
  minutes and only work from your repository, on your branch
- A permission scoped so tightly that the worst a compromised workflow can do
  is publish a bad version of this one site
- Every change recorded, and any change reversible
- A cost alert, because a volunteer organization should hear about a surprise
  bill from an email rather than a card statement

Under **$25 a year**, nearly all of it the domain name.

## The steps

| | | Time |
| --- | --- | --- |
| [01-prerequisites.md](01-prerequisites.md) | AWS account, alias, admin user, CLI, region, domain, GitHub organization | ~90 min |
| [02-deploy-stack.md](02-deploy-stack.md) | Upload one template; it builds the infrastructure | ~10 min + DNS |
| [03-connect-github.md](03-connect-github.md) | Wire the repository to AWS, first publish | ~15 min |
| [04-editing-the-site.md](04-editing-the-site.md) | **For board members** — notices, news, pictures, preview, publish | reference |
| [field-guide.html](field-guide.html) | **For board members** — one page covering what the site does, the editing screen, and what it costs. Open it in a browser | reference |
| [05-runbook.md](05-runbook.md) | Everything afterwards — editing, rollback, removing people, costs | reference |
| [06-cms-design.md](06-cms-design.md) | How the board-editing feature works and why it is built that way | reference |
| [08-making-changes.md](08-making-changes.md) | **For whoever edits the code** — Claude Code, pushing to GitHub, and which of the three deploy paths a change needs | reference |

Do them in order. Step 2 fails in confusing ways if step 1 was not finished.

[`infra/site-stack.yaml`](../infra/site-stack.yaml) is the template. It is
commented throughout, and the comments explain *why*, not just what — it is
meant to be read by whoever inherits this.

## How it fits together

```
  You edit a file  ──push──▶  GitHub  ──▶  GitHub Actions
                                                │
                                   asks GitHub for a short-lived token,
                                   AWS checks it came from your repo
                                                │
                                                ▼
                                        AWS Amplify Hosting
                                                │
                                                ▼
                                        visitors see the site
```

Permission flows one way. GitHub can publish to AWS; AWS has no access to
GitHub. Nothing long-lived is stored at either end.

## Two things worth deciding early

**Who owns the accounts.** Use a GitHub **Organization**, not a personal
account, and give it two owners. Organizations are free — the Free plan covers
unlimited private repositories, unlimited collaborators, and the Actions
minutes that publish the site. The reason to bother is that an organization can
have a second owner and a personal account cannot have any, so a personal
account is one unreachable person away from nobody being able to change the
site.

Register the AWS account to an organization email too, if one exists. If it
does not yet, a personal address works to start — AWS root email can be changed
later — but put it on the list in [05-runbook.md](05-runbook.md) rather than
discovering it at a bad moment.

**Who can publish.** By default, a push to `main` goes live immediately with no
review. That is fine for one or two careful people. For a larger group, or for
a site carrying information people rely on, turn on required pull requests —
[03-connect-github.md](03-connect-github.md) §3.6.

## If you get stuck

Each step ends with a checklist and a table of common failures with their
fixes. The two that account for most lost time:

- **Resources seem to have disappeared** — check the region selector, top
  right of the console
- **Stack finished but the domain doesn't work yet** — expected; the
  certificate and DNS finish separately, 15–45 minutes after the stack
- **First deploy refused with an authorization error** —
  [03-connect-github.md](03-connect-github.md) §3.5, which includes how to read
  what AWS actually saw

## Scope

This covers hosting a static site: HTML, CSS, JavaScript, images. No server, no
database, no build step.

The optional board-editing area — notices and news from a browser, no GitHub —
is [06-cms-design.md](06-cms-design.md) for how it works and
[04-editing-the-site.md](04-editing-the-site.md) for how to use it. It is a
second CloudFormation stack, [`infra/cms-stack.yaml`](../infra/cms-stack.yaml).
