# 6 — Content management: design

How board members change parts of the site from a browser, without touching
GitHub, and how that stays safe on a public wildfire-safety site.

Status: **design, awaiting approval.** Nothing here exists yet.

---

## What the board gets

Sign in at **www.austinareafirewise.org/admin/** with an email and password.
One screen. Two kinds of item:

| Kind | Where it appears | Typical use |
| --- | --- | --- |
| **Meeting notice** | A strip at the top of the home page, above the headline | "Quarterly meeting Tuesday 7pm, Northwest Rec Center" |
| **News** | A News page, plus the newest few on the home page | Seminars, chipper days, recognition of a new Firewise site, agency answers |

Every item has a **start** and a **stop** date and time. It appears on the site
at the start, disappears at the stop, and nobody has to remember to take it
down. Saving is live within about a minute.

Fields, all plain text — no formatting box, no HTML:

| Field | Required | Notes |
| --- | --- | --- |
| Kind | yes | News or Meeting notice |
| Title | yes | up to 120 characters |
| Body | yes | up to 4,000 characters; blank lines become paragraphs |
| Starts | yes | date and time, Central |
| Stops | yes | date and time, Central; must be after Starts |
| Link | no | one `https://` address, with its own label |

That is the whole editing surface. Everything else on the site — emergency
strip, burn-ban banner, agency links, the guidance pages — stays in code,
where a well-meaning edit cannot break it.

---

## How it works

```
 BOARD MEMBER — signed in
 ┌────────────┐   ┌─────────────┐   ┌───────────────┐   ┌──────────┐
 │ /admin/    │──▶│ Cognito     │──▶│ API Gateway   │──▶│ DynamoDB │
 │ one page   │   │ sign-in     │   │ + Lambda      │   │ items    │
 └────────────┘   └─────────────┘   └───────┬───────┘   └──────────┘
                                             │ on every save
                                             ▼
                                     ┌──────────────┐
                                     │ content.json │  S3, public-read,
                                     │              │  cached 60 s
                                     └──────┬───────┘
 EVERYONE — no sign-in                      │
 ┌────────────────────────────┐             │
 │ www.austinareafirewise.org │◀────────────┘  /content.json (Amplify rewrite)
 │ home notice · News page    │
 └────────────────────────────┘
```

**The split between writing and reading is the whole design.** Board edits go
through sign-in, an API, and a database. The public site reads exactly one
static file. If the admin side is down, attacked, misconfigured or over quota,
visitors never notice — the site keeps serving whatever `content.json` last
said. On a page people may load during an actual fire, the public path having
no moving parts is the property that matters most.

---

## Scheduling: how start and stop dates work

On every save, the Lambda rewrites `content.json` with every item whose stop
date has not yet passed — including items scheduled for the future. The
visitor's browser then shows only items whose window includes *now*. Nothing
runs on a timer; a notice scheduled for next Tuesday simply appears next
Tuesday because the browser's clock says so.

Two consequences worth stating plainly:

- **Scheduled-but-not-yet-live items are in the public file.** Anyone who opens
  `content.json` directly can read next week's meeting notice a week early.
  For this content — public event information — that is harmless, and it is
  what makes scheduling work with no timer. It would not be acceptable for
  anything confidential, which is a reason never to put confidential things in
  this system.
- **Expired items stay in the file until the next save prunes them.** The
  browser hides them the moment they expire, so visitors never see stale
  content; the file is just slightly larger than it needs to be between edits.
  A scheduled re-publish (EventBridge, every 15 minutes) can be added later if
  the file ever grows large. Not needed for v1.

Times are entered in Central time, stored as ISO 8601 with offset, and
compared in the visitor's browser. Everyone involved is in Texas.

---

## Where it shows on the site

**Meeting notice** — a bordered strip as the first thing inside `<main>`, above
the hero. Green, not orange: on this site orange means "alert", and a meeting
is not an alert. If several notices are active at once they stack, newest
first; the board is expected to keep it to one. When none is active, the slot
renders nothing at all — no empty box.

**News** — a new `news.html` page listing every active item, newest first, and
a **News** link in the nav. The home page gets a compact "Latest" section
showing the three newest active items with a link to the full page. Items with
a link show it as a button.

Rendering is by `textContent` only. Body text is split on blank lines into
paragraphs. No markup from the database ever reaches the DOM as markup, so a
compromised editor account cannot inject script into the site — that is the
reason for "plain text, no formatting box".

If `content.json` fails to load, both slots stay hidden and the page is
otherwise unaffected. Never an error message in front of visitors.

---

## Sign-in

**Amazon Cognito, and we do not build any of it.** Passwords, resets, lockout
and optional MFA are Cognito's problem. Hand-rolled password storage is where
small sites get breached; there is no upside to attempting it.

- **Admin-created users only. Self sign-up is disabled.** A board member exists
  because someone with account access created them. They get an emailed
  temporary password and set their own on first sign-in.
- **A `board` group.** Being able to sign in is not enough; the API refuses
  writes from any account not in the group. Creating a user and adding them to
  the group are two separate steps, so an account can be parked without being
  deleted.
- **MFA optional per user**, TOTP authenticator app. Can be made required
  later without rebuilding anything. Password minimum 12 characters.
- **Hosted sign-in page** (Cognito's managed login) at a Cognito domain, so
  the admin page never handles a password. Authorization-code flow with PKCE,
  public client, no client secret — implemented in about 80 lines of plain
  JavaScript, no library, no dependency to patch.
- **Tokens live in `sessionStorage`**, gone when the tab closes. ID token
  lifetime one hour; after that the admin page asks for sign-in again.

> **The stray pool.** The account already contains a user pool
> (`us-east-2_wjGIEWjBE`, "User pool - i8ixjp") that was created through the
> console on 2026-09-12 and is not managed by any stack. It has **self sign-up
> enabled**, which is exactly the setting this design forbids. It is not reused.
> It should be deleted once the managed pool exists, so nothing can ever be
> pointed at it by mistake.

---

## The API

HTTP API (API Gateway v2), three routes, all behind a JWT authorizer that
validates the Cognito token before the Lambda runs:

| Route | Does |
| --- | --- |
| `GET /items` | every item, for the admin list |
| `PUT /items/{id}` | create or replace one item, then republish `content.json` |
| `DELETE /items/{id}` | remove one item, then republish |

The Lambda (Node.js 22, AWS SDK only, no third-party packages) additionally:

- rejects any token whose `cognito:groups` claim lacks `board`
- validates every field — lengths, ISO dates, stop after start, link must be
  `https://` — and refuses anything else with a plain-language message
- stores `createdBy` / `updatedBy` from the token's email, with timestamps,
  so every item says who last touched it
- rewrites `content.json` after every successful write

CORS allows `https://www.austinareafirewise.org` only. API throttling at 10
requests per second, burst 20 — generous for a board, hostile to a script.

---

## Data

One DynamoDB table, `aafa-content`, on-demand billing, partition key `id`.

```
id          ULID, sorts by creation time
kind        "news" | "notice"
title       string ≤ 120
body        string ≤ 4000
startsAt    ISO 8601 with offset
endsAt      ISO 8601 with offset
link        https URL | absent
linkText    string ≤ 60 | absent
createdAt   createdBy   (email)
updatedAt   updatedBy   (email)
```

No indexes. The table will hold dozens of items; a scan is the right query.

`content.json` is the public projection: `kind`, `title`, `body`, `startsAt`,
`endsAt`, `link`, `linkText`, `id`. Never the editor emails.

---

## Storage and delivery

A private S3 bucket, `aafa-site-content`, with a bucket policy allowing public
read of **one object**, `content.json`. Nothing else in the bucket is
reachable. The object carries `Cache-Control: max-age=60`, so an edit is
visible everywhere within a minute.

The site fetches `/content.json` from its own origin. An Amplify rewrite rule
proxies that path to the S3 object — same mechanism the existing 404 rule uses
— so the page never references an S3 address and the storage can change later
without touching HTML. That rule is added to the existing site stack as a
parameter, keeping the template the truth.

---

## Security, in one place

| Concern | Answer |
| --- | --- |
| Password handling | Cognito. We never see, store or transmit one. |
| Who can sign in | Only accounts an admin created. Self sign-up off. |
| Who can write | Only sign-ins in the `board` group, checked server-side. |
| Script injection via content | Impossible by construction: plain text stored, `textContent` rendered. |
| Compromised editor account | Can post or remove news and notices. Cannot touch emergency content, agency links, code, DNS, or the account. Fix: remove the user, re-save the items. |
| Compromised public path | There is no public path to compromise beyond S3 serving a file. |
| Audit | `updatedBy` on every item; CloudWatch logs on every API call; CloudTrail on everything. |
| Revoking a person | Delete the Cognito user. Instant. |
| Search engines | `/admin/` is `noindex` and disallowed in `robots.txt`. Hygiene, not security. |
| Browser storage | Tokens in `sessionStorage`; cleared on tab close. |

What this deliberately does **not** protect against: a board member posting
something wrong. That is an editorial problem, and the answer is the board.

---

## Cost

| | Monthly |
| --- | --- |
| Cognito | free to 50,000 monthly users |
| DynamoDB on-demand, dozens of items | < $0.01 |
| Lambda | free tier covers ~1M requests |
| API Gateway HTTP API | $1.00 per million requests |
| S3, one small object | < $0.01 |

Effectively zero. The budget alert from the site stack covers this too.

---

## Operations

**Add a board member** (run by whoever holds the CLI profile):

```bash
aws cognito-idp admin-create-user --user-pool-id <pool> --username person@example.org \
  --user-attributes Name=email,Value=person@example.org Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id <pool> --username person@example.org --group-name board
```

They receive an email with a temporary password.

**Remove one:**

```bash
aws cognito-idp admin-delete-user --user-pool-id <pool> --username person@example.org
```

Then re-save any item they last edited, if you want their name off it.

**Reset a password:** `admin-reset-user-password`. Or they use "Forgot
password" on the sign-in page, which emails them.

The exact pool id lands in `infra/README.md` once built.

---

## What gets built, in order

1. `infra/cms-stack.yaml` — Cognito pool, group, app client and domain;
   DynamoDB table; content bucket and policy; Lambda and role; HTTP API,
   routes, authorizer, CORS, throttling. One stack, deletable as a unit.
2. `lambda/cms/index.mjs` — the function. Packaged and deployed with the stack.
3. `infra/site-stack.yaml` — gains an optional `ContentBucketUrl` parameter
   that adds the `/content.json` rewrite. Existing stack updated, not replaced.
4. `src/admin/index.html`, `src/admin/admin.js` — sign-in, list, edit form.
   Built for people who do not use computers much: one screen, large targets,
   plain words, confirm-before-delete, an unmissable "Saved — live within a
   minute".
5. `src/js/content.js` — fetches `content.json`, renders the notice slot and
   the news lists. Included on `index.html` and the new `news.html`.
6. `src/news.html`, nav link on every page, `robots.txt` and sitemap updates.
7. `docs/04-editing-the-site.md` — the board-facing page. Four screenshots
   and two hundred words.
8. First board members created; the stray pool deleted.

Steps 1–3 are AWS and reversible by deleting the stack. Steps 4–6 are a normal
site push. Nothing goes live for visitors until step 6 ships.
