# Infrastructure — austinareafirewise.org

Everything lives in AWS account **773005956573** (alias `austinareafirewise`),
region **us-east-2**. Locally that account is the `austinareafirewise` CLI
profile.

Created by the CloudFormation template in [`site-stack.yaml`](site-stack.yaml) —
see [`../docs/02-deploy-stack.md`](../docs/02-deploy-stack.md). Prefer updating
the stack over changing things by hand, so the template stays the truth.

## What exists

| Resource | Identifier |
| --- | --- |
| Amplify app | `aafa-site` — app id `d3h7wst551po3s` |
| Amplify branch | `main`, stage `PRODUCTION`, auto-build **off** (manual zip deploys) |
| Default Amplify URL | `https://main.d3h7wst551po3s.amplifyapp.com` |
| Custom domain | `austinareafirewise.org` and `www.austinareafirewise.org` |
| Route 53 hosted zone | `Z0540104368ZGSJLBEXWY` (`austinareafirewise.org.`) |
| Domain registration | Route 53 Domains, auto-renew on, expires 2027-09-12 |
| GitHub OIDC deploy role | `arn:aws:iam::773005956573:role/aafa-site-github-deploy` |

### Custom rules on the app

1. `https://austinareafirewise.org` → `https://www.austinareafirewise.org` (302). The
   `www` host is canonical; the apex redirects to it.
2. `/<*>` → `/404.html` (404). Unmatched paths land on the branded 404 page
   instead of the SPA rewrite (`404-200` → `/index.html`) that Amplify offers
   by default — this is a multi-page static site, and a missing page should
   say so rather than silently serving the home page.

   **Caveat on the status code.** Amplify implements a `404` custom rule as a
   *redirect* to the target, so a missing path answers `302` and then `200` on
   `/404.html`; it does not serve the 404 body under a 404 status. That is
   Amplify's behavior, not something the rule can express differently. The
   alternative is deleting the rule and accepting CloudFront's unbranded
   default page, which does return a true 404. The branded page won, and
   `404.html` carries `<meta name="robots" content="noindex">` so the
   soft-404 never enters an index.

## Deploy path

Push to `main` touching `src/**` → GitHub Actions → assume
`aafa-site-github-deploy` via OIDC → `amplify create-deployment`, upload the
zip to the presigned URL, `amplify start-deployment`, poll `get-job` until it
succeeds.

The role is scoped two ways, and both matter:

- **Trust policy**: `sts:AssumeRoleWithWebIdentity` only for
  `repo:austinareafirewise/website:ref:refs/heads/main`. A fork, a pull request, or
  another branch cannot assume it.
- **Permissions**: `amplify:CreateDeployment`, `StartDeployment`, `GetApp`,
  `GetBranch`, `GetJob`, `ListJobs` — on app `d3h7wst551po3s` only. The role
  cannot touch Route 53, IAM, or anything else in the account.

No AWS access keys exist in this repository or in GitHub secrets.

## DNS and certificates

Amplify manages both. Because the hosted zone is in the same account, Amplify
writes the ACM validation CNAME and the host records into
`Z0540104368ZGSJLBEXWY` itself. Certificate issuance plus propagation usually
takes 15–45 minutes on a first association; the domain shows `PENDING_VERIFICATION`
→ `PENDING_DEPLOYMENT` → `AVAILABLE` along the way.

Check status:

```bash
AWS_PROFILE=austinareafirewise aws amplify get-domain-association \
  --region us-east-2 --app-id d3h7wst551po3s --domain-name austinareafirewise.org \
  --query 'domainAssociation.{status:domainStatus,reason:statusReason,subs:subDomains[].{dns:dnsRecord,verified:verified}}'
```

## Manual deploy from a workstation

Only needed if GitHub Actions is unavailable. Requires the
`austinareafirewise` profile.

```bash
cd src && zip -r -q ../site.zip . -x "*.zip" && cd ..
AWS_PROFILE=austinareafirewise aws amplify create-deployment \
  --region us-east-2 --app-id d3h7wst551po3s --branch-name main > deployment.json
curl -sS -X PUT "$(node -pe "require('./deployment.json').zipUploadUrl")" --upload-file site.zip
AWS_PROFILE=austinareafirewise aws amplify start-deployment \
  --region us-east-2 --app-id d3h7wst551po3s --branch-name main \
  --job-id "$(node -pe "require('./deployment.json').jobId")"
```

## What does not exist yet: the mailing list

The signup form on the home page has no backend. Nothing is stored, and the
form tells the visitor so. The intended shape when it is built:

```
POST /signup  ->  API Gateway (HTTP API)
                    -> Lambda (validate, rate-limit, dedupe)
                      -> DynamoDB table (partition key: email)
                      -> SES confirmation mail (double opt-in)
```

Points worth settling before it handles a real address, because they are far
harder to retrofit than to build in:

- **Double opt-in.** Store the address as unconfirmed, mail a confirmation
  link, and only mark it subscribed when the link is followed. This is what
  keeps a list from filling with addresses their owners never entered.
- **Unsubscribe.** A one-click link with a signed token in every mail sent.
  Required in practice by CAN-SPAM and by every mailbox provider's filters.
- **CORS.** The API must accept `https://www.austinareafirewise.org` only.
- **Abuse controls.** The form's honeypot field stops naive bots and nothing
  else; real protection is per-IP rate limiting at the API.
- **Privacy statement.** A page saying what is collected, why, how long it is
  kept, and how to have it deleted — and a link to it beside the form.
- **Retention and export.** Decide up front how an address gets deleted on
  request, and how the list gets exported if it moves to a mail provider.

When the endpoint exists, uncomment and set `window.AAFA_SIGNUP_ENDPOINT` in
`src/js/config.js`. Nothing else in the site changes.
