# 2 — Create the AWS infrastructure

One file creates everything: the web host, the trust between GitHub and AWS,
the permission the workflow uses, the domain, and a cost alert.

The file is [`infra/site-stack.yaml`](../infra/site-stack.yaml). In AWS a file
like this is a **template**, and what it creates is a **stack**.

About 10 minutes of work, plus waiting if you are attaching a domain.

> **A stack is a set, not a pile.** Everything the template creates is tracked
> together, so deleting the stack removes all of it cleanly. That makes a
> practice run genuinely free — if you mistype something, delete the stack and
> do it again. Nothing is left behind to trip you up.

---

## 2.1 Upload the template

1. Sign in as your **admin user** (not root)
2. **Check the region** in the top right — it must be the one you chose in
   step 1.6
3. Search for **CloudFormation** and open it
4. **Create stack** → **With new resources (standard)**
5. Choose **Upload a template file**, then **Choose file**, and select
   `infra/site-stack.yaml` from your copy of the repository
6. **Next**

## 2.2 Fill in the parameters

The form is grouped to match the order below.

**Stack name** — `aafa-site`. This names the stack itself, not the website
and not the repository; it is only how you find this set of resources again.

**Site name** — lowercase, no spaces, e.g. `aafa-site`. Used to name the
Amplify app and the deploy role. It does not have to match the repository
name.

**GitHub organization or username** — just the owner. In
`github.com/austinareafirewise/website`, this is `austinareafirewise`.

**Repository name** — just the repository. In that same example, `website`.

> Getting either of these wrong is the most common mistake, and it fails in a
> confusing way — the stack builds perfectly, and then the first deploy is
> refused with an authorization error. Check the spelling against the address
> bar on GitHub before continuing.

**Branch that publishes the site** — `main` unless you have a reason.

**Domain name** — `austinareafirewise.org`, with no `www` and no `https://`. **Leave it
blank** if you are not attaching a domain yet; the site still works on its free
address and you can add the domain later by updating this same stack.

**Email for cost alerts** — worth filling in. This site should cost a few
dollars a year; an email is how you find out if something is wrong before a
card statement does.

**Alert if the month exceeds** — `10` dollars is a sensible smoke alarm. It
warns. It does not cap or stop anything.

**Create the GitHub identity provider?** — `yes` for a fresh account, `no` if
step 1.9 showed one already exists.

Then **Next**, **Next** again through the options page (nothing to change).

## 2.3 Acknowledge and create

At the bottom of the review page, tick:

> **I acknowledge that AWS CloudFormation might create IAM resources with
> custom names.**

This is asking permission to create the deploy role. It is expected — that role
is much of the point. Then **Submit**.

## 2.4 Wait

The **Events** tab shows progress, newest first. The stack itself finishes
quickly — **under a minute** is normal, with or without a domain.

**The domain keeps working after the stack says CREATE_COMPLETE.** The stack
finishing does not mean the site is reachable at your domain yet: Amplify has
to get a TLS certificate issued and let DNS propagate, which takes roughly
15–45 minutes and happens independently. Do not read a completed stack as a
broken domain, or a slow domain as a hung stack.

Check where the domain has got to:

```bash
aws amplify get-domain-association --profile <your-profile> --region us-east-2 \
  --app-id <AmplifyAppId from Outputs> --domain-name <your domain> \
  --query "domainAssociation.domainStatus"
```

It moves `PENDING_VERIFICATION` → `PENDING_DEPLOYMENT` → `AVAILABLE`.

When the stack shows **CREATE_COMPLETE**, open the **Outputs** tab. Keep it
open — step 3 uses four of those values.

## 2.5 If it fails

Failure is recoverable and the message is usually specific. Find the **first**
red row in **Events** (scroll to the bottom; they are newest-first) and read
its status reason.

| What it says | What happened | Fix |
| --- | --- | --- |
| `provider already exists` / `EntityAlreadyExists` | An identity provider was already there | Delete the stack, re-run with `CreateGitHubOIDCProvider` = `no` |
| `Role with name ... already exists` | A previous attempt left it behind, or the name collides | Delete the stack; if it persists, choose a different Site name |
| Hosted zone / certificate errors | No hosted zone in this account for that domain | Finish step 1.7, or blank the domain and add it later |
| `not authorized to perform iam:CreateRole` | Signed in as a user without admin | Sign in as the admin user from step 1.4 |
| Stack succeeds, but the first deploy is later refused | GitHub owner or repository name does not match | Not a stack failure — see [03-connect-github.md](03-connect-github.md) §3.5 |

After any failure: **Delete** the stack, wait for it to finish deleting, then
create it again. Do not try to repair a failed stack by hand — a half-created
stack is harder to reason about than a fresh one, and deleting costs nothing.

---

## Check it worked

Replace `aafa-site` with your stack name:

```bash
aws cloudformation describe-stacks --stack-name aafa-site --query "Stacks[0].Outputs" --output table
```

You should see `AmplifyAppId`, `DeployRoleArn`, `AwsRegion`, `BranchNameOut`,
`TemporaryUrl`, and `WorkflowEnvBlock`.

Opening `TemporaryUrl` now shows an Amplify placeholder reading **"Welcome —
Your app will appear here once you complete your first deployment."** That is
success, not a fault: the host exists and nothing has been published to it yet.
Seeing the same page on your custom domain also confirms DNS and the
certificate are working. Step 3 publishes the site.

Next: [03-connect-github.md](03-connect-github.md)
