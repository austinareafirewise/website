# 5 — Runbook

Things that come up after the site is live. Written for whoever is holding the
keys, which in a volunteer organization is eventually someone who was not here
for the setup.

---

## Everyday editing

Edit a file under `src/`, then:

```bash
git pull
```

Make the change, preview it by double-clicking the page (see the main README),
then:

```bash
git add -A
git commit -m "what changed"
git push
```

Live in about a minute. Check the **Actions** tab if it does not appear.

## Publish without changing content

**Actions** → **Deploy to Amplify** → **Run workflow**. Useful after changing
something on the AWS side.

## Roll back a bad change

The previous version is always in Git.

```bash
git log --oneline -10
git revert <the-commit-id>
git push
```

This adds a new commit undoing the old one, and deploys it. It does not erase
history, which is what you want — you can see what happened and why.

## Add a domain, or change one, later

Update the same stack. CloudFormation → your stack → **Update** → **Use
current template** → change the **Domain name** parameter → through to
**Submit**. The hosted zone must already exist in the account (see
[01-prerequisites.md](01-prerequisites.md) §1.7).

## A board member cannot sign in to /admin/

**They should do this themselves first.** On the sign-in page there is a
**Forgot your password?** link under the password box. A six-digit code goes to
the address the account is registered under, and they choose a new password
(twelve characters or more, with an upper-case letter, a lower-case letter and
a number). Nobody with AWS access needs to be involved.

The code comes from an Amazon address rather than from the Alliance, so tell
them to check their spam folder. Cognito sends these itself, which is why this
works even while SES is in the sandbox.

**Only if they can no longer reach that mailbox at all**, someone with AWS
access sets a temporary password. They will be asked to change it at their next
sign-in:

```bash
aws cognito-idp admin-set-user-password \
  --profile austinareafirewise --region us-east-2 \
  --user-pool-id us-east-2_YHXgXpCPz \
  --username them@example.org \
  --password 'a-long-temporary-one' \
  --permanent false
```

Send them the temporary password by some route other than the mailbox they have
lost, and do not reuse it.

If instead their email address has changed, update it and mark it verified —
account recovery only works against a verified address:

```bash
aws cognito-idp admin-update-user-attributes \
  --profile austinareafirewise --region us-east-2 \
  --user-pool-id us-east-2_YHXgXpCPz \
  --username them@example.org \
  --user-attributes Name=email,Value=new@example.org Name=email_verified,Value=true
```

## The sign-in page's appearance

The Cognito hosted sign-in page is branded to match the site. It has no
CloudFormation resource, so it is applied by hand and the styling is kept in
[`infra/cognito-hosted-ui.css`](../infra/cognito-hosted-ui.css). Re-apply it
after any change to that file:

```bash
rsvg-convert -w 520 -o /tmp/hosted-ui-logo.png src/img/aafa-banner.svg
aws cognito-idp set-ui-customization \
  --profile austinareafirewise --region us-east-2 \
  --user-pool-id us-east-2_YHXgXpCPz --client-id ALL \
  --css "$(cat infra/cognito-hosted-ui.css)" \
  --image-file fileb:///tmp/hosted-ui-logo.png
```

Cognito accepts only a fixed set of class names and a fixed set of properties on
each. Anything outside that list is rejected by the API, which is the check that
the file is valid.

## Someone leaves the organization

Do all of these, the same day:

1. **The website admin area** — remove their sign-in. Marking them a past board
   member in the Board section does **not** do this; the two are separate on
   purpose. Removing them from the group is what takes away access:

   ```bash
   aws cognito-idp admin-remove-user-from-group \
     --profile austinareafirewise --region us-east-2 \
     --user-pool-id us-east-2_YHXgXpCPz \
     --username them@example.org --group-name board
   ```

   Their existing sign-in stays valid until it expires, within the hour. To cut
   it off immediately, disable the account as well with
   `admin-disable-user`, same arguments minus `--group-name`.
2. **GitHub** — organization **Settings** → **People** → remove them. If they
   were an Owner, confirm another Owner remains first, or you will lock
   yourself out of your own organization.
3. **AWS console** — IAM → Users → delete their user, or at minimum delete
   their access keys and console password.
4. **Access keys** — if they ever had keys on a shared machine, delete those
   keys in IAM. Deleting a key is instant and total; changing a password is
   not, because a key works without one.
5. **Root email and password** — if they had access to the root account,
   change the password, and change the email if it was theirs.

Removing someone from GitHub does not remove their AWS access, and vice versa.
They are separate systems that happen to trust each other for one narrow
purpose.

## Move the AWS account to an organization email

Worth doing as soon as the organization has a usable address, if it was set up
on a personal one.

AWS console → account name (top right) → **Account** → **Contact
Information** / root user email → **Edit**. AWS sends a confirmation to both
the old and new addresses, so do this **while the old mailbox still works** —
after it stops working this becomes a support case.

## Check the organization still has two owners

Worth glancing at once a year, and whenever someone joins or leaves.

GitHub → organization **Settings** → **People** → filter by role **Owner**. If
there is only one name there, the organization has quietly become a personal
account with extra steps. Promote a second person.

## Check what the site is costing

Console → **Billing and Cost Management** → **Bills**.

Expect a few dollars a year, nearly all of it domain registration. Amplify
hosting for a site this size is usually pennies or free tier.

If it is materially more than that, something is wrong — an unused resource
left over from an experiment, or traffic you did not expect. The budget alert
from the template should have emailed you first.

## Delete everything

If the site is being retired or a practice run needs cleaning up:

CloudFormation → the stack → **Delete**. That removes the Amplify app, the
role, the domain association, and the budget.

Two things it does **not** remove, on purpose:

- **The Route 53 hosted zone and domain registration** — deleting a hosted zone
  breaks email for that domain too, so AWS makes you do it deliberately
- **The GitHub identity provider**, if another site is using it

---

## Known quirks

Things that look like faults and are not.

**A missing page redirects instead of returning a true 404.** Amplify
implements a custom 404 rule as a redirect, so a bad URL answers `302` and then
`200` on `/404.html`. No rule can change it. The `404.html` page carries
`<meta name="robots" content="noindex">` so search engines do not index the
soft 404. The alternative is deleting the rule and accepting an unbranded page
that does return a true 404.

**Resources appear to have vanished.** Check the region selector, top right.
Resources exist in one region and the console shows an empty list rather than
telling you that you are looking in the wrong place. This is the most common
confusion in AWS.

**The first deploy fails with an authorization error.** See
[03-connect-github.md](03-connect-github.md) §3.5. Usually a name mismatch;
occasionally GitHub's ID-suffixed subject format, which the template already
handles.

**A push does not trigger a deploy.** The workflow only watches `src/`. Changes
to docs or infrastructure files deliberately do not republish the site. Use
**Run workflow** if you need one.

**A domain sits in `CREATE_IN_PROGRESS` for half an hour.** Normal. The
certificate has to be issued and DNS has to propagate.

---

## What this costs to run

| | Typical |
| --- | --- |
| Domain registration | $13–15 / year |
| Route 53 hosted zone | $0.50 / month |
| Amplify hosting | Free tier, then pennies |
| GitHub organization | Free |
| CloudFormation | Free |

Under $25 a year for a site of this size.

---

## Reusing this for another site

The template is not specific to any one organization. For a second site:

1. Same AWS account: create another stack with a different **Stack name** and
   **Site name**, and answer **no** to `CreateGitHubOIDCProvider` — an account
   can only hold one
2. Different AWS account: run the whole sequence from step 1, answering
   **yes**
3. Copy `.github/workflows/deploy.yml` into the new repository and fill in the
   four values from the new stack's outputs

The one thing worth carrying across deliberately is the pair of subject
patterns in the role's trust policy. Most published guides list only one, and
the failure mode is an authorization error with nothing on screen explaining
it.
