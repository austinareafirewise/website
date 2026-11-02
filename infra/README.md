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

### Board content (stack `aafa-cms`, template [`cms-stack.yaml`](cms-stack.yaml))

| Resource | Identifier |
| --- | --- |
| Cognito user pool | `us-east-2_YHXgXpCPz` (`aafa-board`) — self sign-up off, deletion protection on |
| Board group | `board` — the API refuses writes from anyone not in it |
| App client | `6hm3jsg16bia9r18fu6utv3o7n` (public, PKCE) |
| Sign-in page | `https://austinareafirewise-admin.auth.us-east-2.amazoncognito.com` |
| API | `https://dpnvwt7kp5.execute-api.us-east-2.amazonaws.com` (HTTP API, JWT authorizer) |
| Lambda | `aafa-cms`, Node.js 22, no dependencies — source in [`../lambda/cms/`](../lambda/cms/) |
| Scheduled Lambdas | `aafa-burnban` every 30 minutes (below); `aafa-firedanger` every 3 hours, which reads the Texas A&M Forest Service's daily fire danger ratings for the stations around Travis County and writes the result the home page's sign draws from ([`../lambda/firedanger/`](../lambda/firedanger/)); `aafa-linkcheck` every Sunday, which tries every external link on the Resources page and records what happened ([`../lambda/linkcheck/`](../lambda/linkcheck/)) |
| DynamoDB | `aafa-content`, on-demand, point-in-time recovery on |
| Content bucket | `aafa-site-content` — public read on `content.json` and `images/*` only |
| Artifacts bucket | `aafa-deploy-artifacts-773005956573` — private, holds packaged Lambda zips, 30-day expiry |
| Site rewrite | `/content/<*>` → the content bucket (parameter `ContentBucketDomain` on the site stack) |

Design and the reasoning behind each piece: [`../docs/06-cms-design.md`](../docs/06-cms-design.md).
Board-facing instructions: [`../docs/04-editing-the-site.md`](../docs/04-editing-the-site.md).

#### Deploying a change to the Lambda or the CMS stack

```bash
export AWS_PROFILE=austinareafirewise
aws cloudformation package --region us-east-2 --template-file infra/cms-stack.yaml \
  --s3-bucket aafa-deploy-artifacts-773005956573 --s3-prefix cms \
  --output-template-file /tmp/cms-packaged.yaml
aws cloudformation deploy --region us-east-2 --template-file /tmp/cms-packaged.yaml \
  --stack-name aafa-cms --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset
```

Run from the repository root. `package` uploads each Lambda's code
(`lambda/cms/`, `lambda/burnban/`, `lambda/firedanger/`, and the whole of
`lambda/` for the link check, which shares `lambda/cms/resources.mjs`) and
rewrites their `Code:` references; `deploy` applies it. A code-only change
takes about a minute.

#### Burn ban watch

The same stack carries `aafa-burnban`, a function on a 30-minute EventBridge
schedule that reads the Travis County Fire Marshal's burn ban page and writes
`burnban.json` into the content bucket. The home page renders a notice in the
hero from that file and links back to the county.

It publishes nothing it cannot recognize, so a redesign of the county's page
makes the notice go away rather than go wrong; the notice also hides itself
once the file is more than six hours old. If the notice disappears, look at
`/aws/lambda/aafa-burnban` — the alert text it read is logged on every run,
and the wording it accepts is at the top of `lambda/burnban/index.mjs`.

### Members and communications (stack `aafa-comms`, template [`comms-stack.yaml`](comms-stack.yaml))

| Resource | Identifier |
| --- | --- |
| Tables | `aafa-members`, `aafa-communications`, `aafa-deliveries`, `aafa-groups`, `aafa-board`, `aafa-ratelimit` |
| Send queue | `aafa-send`, with `aafa-send-dlq` after three failures |
| Functions | `aafa-comms-api`, `aafa-comms-sender`, `aafa-comms-events` |
| Email | SES identity `austinareafirewise.org`, configuration set `aafa-comms`, events to SNS `aafa-comms-events` |
| Signing key | Secrets Manager `aafa/comms/signing-key` — rotating it invalidates every outstanding confirm/unsubscribe/manage link |
| SMS | `SmsProvider` parameter: `off` (current), `aws`, or `twilio` |

Design and reasoning: [`../docs/07-members-and-communications-design.md`](../docs/07-members-and-communications-design.md).

#### Deploying a change

```bash
export AWS_PROFILE=austinareafirewise
aws cloudformation package --region us-east-2 --template-file infra/comms-stack.yaml \
  --s3-bucket aafa-deploy-artifacts-773005956573 --s3-prefix comms \
  --output-template-file /tmp/comms-packaged.yaml
aws cloudformation deploy --region us-east-2 --template-file /tmp/comms-packaged.yaml \
  --stack-name aafa-comms --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset
```

Parameters already set on the stack persist when not passed again. The ones
that matter:

| Parameter | Current | Note |
| --- | --- | --- |
| `PostalAddress` | P.O. Box 4211-A, Austin, TX 78731 | CAN-SPAM requires it in every email. The sender refuses to broadcast while it is blank. |
| `ReplyTo` | vicki@vickilandon.com | An interim personal address. While blank, every email tells recipients the mailbox is unmonitored; setting it removes that line. Replace when the organization has its own mailbox. |
| `SmsProvider` | set | The sending side is configured: the live API reports texting as switched on. Texts still don't arrive until the toll-free number's carrier registration is approved (below; TODO.md, T34), which is why `src/js/config.js` has a switch of its own saying texts aren't going out yet. This row used to say `off`, from before the provider was set. |

#### Things only a person can do

- **SES production access** — requested. The live API now reports email as
  sendable, which `lambda/comms/email.mjs` reports only when AWS says
  production access is granted and the domain is verified; confirm it in the
  SES console (TODO.md, T33). A sign-up made while email can't be sent is
  stored unconfirmed, and its confirmation goes out once sending works. This
  used to say sign-ups were refused until access was granted; the code was
  changed because refusing turned away people who wanted to be on the list
  (the comment in `lambda/comms/api.mjs` says why).
- **Toll-free number** — `+1 833 408 8708` requested ($2/month), two-way
  wired to the events topic. Carrier verification
  `registration-4ae3068ea8004f68b2e3ce5d34e78bba` submitted; 1-3 weeks.
  Check with:

  ```bash
  aws pinpoint-sms-voice-v2 describe-registrations --region us-east-2 \
    --registration-ids registration-4ae3068ea8004f68b2e3ce5d34e78bba \
    --query 'Registrations[0].RegistrationStatus'
  ```

  Declared as NON_PROFIT, public announcements, digital-form opt-in, 1,000
  messages a month. Numbers are already being collected and held unconfirmed
  in the meantime.

- **Two more SMS gates after that.** The account's SMS tier is SANDBOX
  (texts only reach verified numbers) and the monthly text spend limit is $1,
  about 110 segments. Both are support cases, and both must be lifted before
  a real broadcast can go out.

- **Twilio is wired as an alternative** but its number is not 10DLC
  registered — a live test returned carrier error 30034. Switching is one
  parameter (`SmsProvider=twilio`) once that registration exists.
- **A real mailbox on the domain** — there is no MX record, so mail to
  anything@austinareafirewise.org bounces today. `ReplyTo` points at a personal
  address as a stopgap.

#### Board members

```bash
export AWS_PROFILE=austinareafirewise
P=us-east-2_YHXgXpCPz; U=person@example.org
aws cognito-idp admin-create-user --region us-east-2 --user-pool-id $P --username $U \
  --user-attributes Name=email,Value=$U Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --region us-east-2 --user-pool-id $P --username $U --group-name board
```

They get an emailed temporary password. Remove someone with
`admin-delete-user`; park them without deleting with `admin-remove-user-from-group`.

Cognito's default email sender is limited to 50 messages a day, which is
plenty for a board. The user pool has **deletion protection**: deleting the
`aafa-cms` stack will fail until that is switched off, which is the intended
safeguard against removing every login by accident.

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

## The mailing list

This section used to be "What does not exist yet: the mailing list": the
sign-up form had no backend, and it set out the shape one should take and
the points to settle first (double opt-in, unsubscribe, CORS, abuse
controls, a privacy statement, retention and export). It has since been
built as the members and communications stack, `aafa-comms`, above. Its
design, and how it handles each of those points, is
[`../docs/07-members-and-communications-design.md`](../docs/07-members-and-communications-design.md).
