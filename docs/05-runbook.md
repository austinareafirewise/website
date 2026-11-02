# 5 — Runbook

Things that come up after the site is live. Written for whoever is holding the
keys, which in a volunteer organization is eventually someone who was not here
for the setup.

---

## Everyday editing

Make the change on a branch, preview it by double-clicking the page (see the
main README), and open a pull request, as in
[08-making-changes.md](08-making-changes.md) §2.3. A change under `src/` is
live about a minute after the pull request is merged; check the **Actions**
tab if it does not appear.

This section used to say to commit and push straight to `main`. Every
change now goes through a pull request instead, because that is where the
secrets check, the security scan and the accessibility check see it before
it can reach the live site, and where the record of why it was made is
kept. Once the GitHub settings in 08 §2.4 are on, GitHub refuses a push to
`main` outright.

## Publish without changing content

**Actions** → **Deploy to Amplify** → **Run workflow**. Useful after changing
something on the AWS side.

## Roll back a bad change

The previous version is always in Git. Revert the bad commit on a branch and
merge it through a pull request, as in
[08-making-changes.md](08-making-changes.md) §2.5. The revert is a new commit
undoing the old one, and it deploys like any other merge. It does not erase
history, which is what you want: you can see what happened and why.

This used to revert and push straight to `main`. It goes through a pull
request now for the same reason as every other change (see "Everyday
editing" above): a rollback is a change to the live site too, and it should
pass the same checks on its way.

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

## After changing the admin page

The training scripts in `src/admin/training/` point at real elements on that
page by selector. Renaming or removing one silently invalidates a script — and
eventually a recorded narration that points at nothing. Run:

```bash
node src/admin/training/check.mjs
```

It proves every target still exists, every section is a real tab, and no lesson
is missing its metadata or has grown too long to speak over one screen. It
exits non-zero and names the file and step when something has moved.

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

Console → **Billing and Cost Management** → **Bills**, which breaks the
month down by service.

Expect a few dollars a month (see "What this costs to run" below): the domain,
its hosted zone, the toll-free number for texts, and the members stack's one
secret are the fixed part, and the rest grows with the email and texts sent.
Amplify hosting, the API, the Lambdas and the tables are pennies or free tier
at this site's size.

If it is materially more than that, something is wrong: an unused resource
left over from an experiment, traffic you did not expect, or messages being
sent that shouldn't be. The budget alert from the site stack should have
emailed you first.

This section used to expect "a few dollars a year, nearly all of it domain
registration". That was written when the site stack was the only one; the
content and members stacks, and texting, came later and cost more.

## Delete everything

If the site is being retired or a practice run needs cleaning up, delete the
three stacks in this order, each from CloudFormation → the stack →
**Delete**. The order matters: `aafa-comms` uses `aafa-cms`'s API, sign-in
and address, and CloudFormation won't delete a stack another one still
uses.

1. **`aafa-comms`**, the members and communications stack. Its five
   tables of members, groups, the board, messages and deliveries are kept
   on purpose when the stack is deleted (`DeletionPolicy: Retain`), because
   they hold people's names, email addresses and phone numbers. Decide what
   happens to that data, then delete those tables by hand in DynamoDB.
2. **`aafa-cms`**, the content stack. First switch off the board sign-in's
   deletion protection (`DeletionProtection` on the user pool in
   `infra/cms-stack.yaml`, `ACTIVE` so that no one removes every board
   member's login by accident), and empty its content bucket: S3 won't delete
   a bucket that still holds files. Either one left as it is stops the
   stack's deletion. Its content table is deleted with the stack.
3. **`aafa-site`**, the site stack. That removes the Amplify app, the role,
   the domain association, and the budget, and also the GitHub identity
   provider if this stack created it (`CreateGitHubOIDCProvider` left at
   `yes`, the default). If another site's deploys use that provider, they
   stop working when it goes. Recreate it by hand afterwards in IAM →
   **Identity providers**, with the same address
   (`https://token.actions.githubusercontent.com`) and audience
   (`sts.amazonaws.com`), and the other site's role trusts it again.
   Changing `CreateGitHubOIDCProvider` to `no` first doesn't keep it: an
   update that turns a resource's condition off deletes the resource
   (TODO.md, T60, is for making the template keep it).

Things none of them remove, on purpose:

- **The Route 53 hosted zone and domain registration** — deleting a hosted zone
  breaks email for that domain too, so AWS makes you do it deliberately
- **The GitHub identity provider**, if it was created outside these stacks
- **The deploy artifacts bucket** that holds the packaged Lambda code
  (`aafa-deploy-artifacts-…`, in [infra/README.md](../infra/README.md)),
  made by hand before the stacks; empty it and delete it in S3
- **The Twilio credentials** stored by hand in SSM Parameter Store
  (`/aafa/comms/twilio`, if they were created), and the Twilio account and
  number itself, which bills until it is closed
- **The toll-free number and its registration**, which were set up by hand
  ([infra/README.md](../infra/README.md)) and are billed monthly until
  released in AWS End User Messaging

This section used to cover only the site stack, from before the content and
members stacks existed; deleting it alone would have left the others
running and billing.

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
| Domain registration | about $15–16 / year (Route 53 → **Registered domains** shows the renewal price) |
| Route 53 hosted zone | $0.50 / month |
| Amplify hosting | Free tier, then pennies |
| Toll-free number for texts | $2 / month ([infra/README.md](../infra/README.md)) |
| Secrets Manager (the members stack's signing secret) | about $0.40 / month |
| Email (SES) | about $0.10 per 1,000 messages |
| Texts | per message, plus carrier fees, once texts are delivered |
| API Gateway, Lambda, DynamoDB, S3, Cognito, SNS, SQS, EventBridge, CloudWatch logs | free tier, then pennies at this size |
| GitHub organization | Free (see TODO.md, T43) |
| CloudFormation | Free |

The fixed part is about $4 a month. Email and texts add to it with every
message sent. This table used to say "under $25 a year", from when the site
stack was the only one.

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
