# 6 — Content management: design

How board members change parts of the site from a browser, without touching
GitHub, and how that stays safe on a public wildfire-safety site.

Status: **design, revision 2, awaiting approval.** Nothing here exists yet.

---

## What the board gets

Sign in at **www.austinareafirewise.org/admin/** with an email and password.
One screen. Two kinds of item:

| Kind | Where it appears |
| --- | --- |
| **Meeting notice** | A strip on the home page between the header and the headline |
| **News article** | The News page. Optionally, its title in a **News** section on the home page, directly under the headline, to draw attention to it |

Every item has a **status** and a **start** and **stop** date. Nothing is
visible to the public until it is both *published* and inside its window. It
disappears at the stop date on its own.

### Fields

| Field | Notice | Article | Notes |
| --- | --- | --- | --- |
| Title | required | required | ≤ 120 characters |
| Body | required | required | ≤ 6,000 characters; blank lines become paragraphs; plain text only |
| Starts / Stops | required | required | date and time, Central; stop after start |
| **Link + label** | optional | optional | one `https://` address to an outside site — a registration page, a map, an agency notice. Shown as a button on the notice and on the article |
| **Show on home page** | — | yes/no | puts the title in the home News section |
| **Pictures** | — | up to 3 | each cropped, with a credit line and a description |
| Status | draft / published | draft / published | drafts are never public |

### Pictures

Drag a file onto the form, or pick one. JPEG, PNG or WebP, up to 10 MB each.

Each picture is **cropped in the browser** before upload: a fixed 3:2 frame the
editor drags and resizes over the image, so every picture on the site has the
same shape and nothing depends on how the phone held it. What gets stored is
the cropped result at two sizes — 1600px wide for the article, 480px for
lists — re-encoded as JPEG. The original file never leaves the editor's
computer.

That re-encoding has a side effect worth having: **it strips the metadata**
phone cameras embed, including GPS coordinates. A board member's photo of a
chipper day will not publish the location of their driveway.

Each picture carries a **credit line** ("Photo: J. Smith") shown beneath it,
and a **description** for people using screen readers. The description is
required; the credit is optional.

### Preview

Every item has a **Preview** button that opens the real site in a new tab
with that item rendered in place — the actual home page with the notice at
the top, or the actual News page with the article — under a "PREVIEW — not
live" banner. What the board sees is exactly what visitors will see, because
it is the same page and the same code. Previews work for drafts and for
published items alike; visitors cannot trigger one.

### Status and the admin list

| Shown as | Meaning |
| --- | --- |
| **Draft** | Saved, never public. Can be previewed. |
| **Scheduled** | Published, start date in the future. Will appear on its own. |
| **Live** | Published and inside its window. On the site now. |
| **Ended** | Published, stop date passed. Hidden; kept for the record. |

Draft and Ended items sit greyed at the bottom of the list. Anything that is
not Live is unmissably labelled.

---

## How it works

```
 BOARD MEMBER — signed in
 ┌────────────┐   ┌─────────────┐   ┌───────────────┐   ┌──────────┐
 │ /admin/    │──▶│ Cognito     │──▶│ API Gateway   │──▶│ DynamoDB │
 │ one page   │   │ sign-in     │   │ + Lambda      │   │ items    │
 └─────┬──────┘   └─────────────┘   └───────┬───────┘   └──────────┘
       │ cropped pictures,                   │ on every publish
       │ via signed upload URL               ▼
       │                            ┌──────────────────┐
       └───────────────────────────▶│ S3 content bucket │  content.json + images
                                    │ public-read       │  cached 60 s
                                    └────────┬─────────┘
 EVERYONE — no sign-in                       │
 ┌────────────────────────────┐              │
 │ www.austinareafirewise.org │◀─────────────┘  /content/* (Amplify rewrite)
 │ home · news.html           │
 └────────────────────────────┘
```

**The split between writing and reading is the whole design.** Board edits go
through sign-in, an API and a database. The public site reads static files
from one bucket. If the admin side is down, attacked, misconfigured or over
quota, visitors never notice — the site keeps serving whatever was last
published. On a page people may load during an actual fire, the public path
having no moving parts is the property that matters most.

---

## Status, scheduling and what is public

`content.json` is rewritten whenever a **published** item is saved, deleted,
or unpublished. It contains every published item whose stop date has not yet
passed — including ones scheduled for the future. The visitor's browser shows
only those whose window includes *now*. No timer runs; a notice scheduled for
next Tuesday appears next Tuesday because the browser's clock says so.

Drafts are **never** in `content.json`. Draft pictures are uploaded to the
bucket (they have to be, for preview to work) but nothing links to them and
their names are unguessable.

Two consequences, stated plainly:

- **Published-but-not-yet-live items are in the public file.** Anyone who opens
  `content.json` directly can read next week's notice a week early. For public
  event information that is harmless, and it is what makes scheduling work
  without a timer. It would not be acceptable for anything confidential, which
  is why nothing confidential should ever go in this system. If the board wants
  to hold something back, it stays a draft.
- **Ended items stay in the file until the next publish prunes them.** Visitors
  never see them — the browser hides them at the stop time — the file is just
  slightly larger than necessary between edits.

Times are entered in Central time, stored as ISO 8601 with offset, and
compared in the visitor's browser.

---

## Where it shows on the site

**Meeting notice** — the first thing inside `<main>`, before the hero, which
is between the header and the headline as seen. Inside `<main>` rather than
between the two landmarks so that the skip link lands on it and screen readers
find it in the main content, where a meeting notice belongs. Green, not
orange: on this site orange means alert, and a meeting is not one. Several
active notices stack, newest first; the slot renders nothing at all when none
is active.

**Home News section** — directly under the hero. A short heading and the
**titles only** of articles marked *Show on home page*, newest first, each
linking to the article. Its purpose is to draw attention, not to be the news.
Renders nothing when no article is flagged.

**News page** — `news.html`, with a **News** link in the nav on every page.
Without a parameter it lists every live article, newest first: first picture
as a thumbnail, title, date, first paragraph. With `?id=` it shows one
article in full: pictures with credits, body, link. Home titles link to the
single-article form, so an article has a shareable address.

Rendering is by `textContent` only. Body text splits on blank lines into
paragraphs. No markup from the database ever reaches the DOM as markup, so a
compromised editor account cannot inject script into the site — that is the
reason for "plain text, no formatting box".

If content fails to load, every slot stays hidden and the page is otherwise
unaffected. Never an error message in front of visitors.

> **Search engines.** Article text is rendered by JavaScript from a JSON file.
> Google does execute JavaScript and will index it, but less reliably and more
> slowly than static HTML. For a community news page that is an acceptable
> trade for having no build step and no deploy per article. The guidance pages
> — the content that should rank — remain static.

---

## Sign-in

**Amazon Cognito, and we do not build any of it.** Passwords, resets, lockout
and optional MFA are Cognito's problem. Hand-rolled password storage is where
small sites get breached; there is no upside to attempting it.

- **Admin-created users only. Self sign-up is disabled.** A board member exists
  because someone with account access created them. They get an emailed
  temporary password and set their own on first sign-in.
- **A `board` group.** Signing in is not enough; the API refuses writes from
  any account not in the group. Creating a user and adding them to the group
  are separate steps, so an account can be parked without being deleted.
- **MFA optional per user**, authenticator app. Can be made required later
  without rebuilding. Password minimum 12 characters.
- **Hosted sign-in page** at a Cognito domain, so the admin page never handles
  a password. Authorization-code flow with PKCE, public client, no secret —
  about 80 lines of plain JavaScript, no library.
- **Tokens live in `sessionStorage`**, gone when the tab closes. One-hour
  lifetime; after that the admin page asks for sign-in again.

> **The stray pool.** The account already contains a user pool
> (`us-east-2_wjGIEWjBE`, "User pool - i8ixjp") created through the console on
> 2026-09-12 and managed by no stack. It has **self sign-up enabled**, which is
> exactly the setting this design forbids. It is not reused and should be
> deleted once the managed pool exists.

---

## The API

HTTP API (API Gateway v2) behind a JWT authorizer that validates the Cognito
token before the Lambda runs:

| Route | Does |
| --- | --- |
| `GET /items` | every item, for the admin list |
| `GET /items/{id}` | one item — used by preview |
| `PUT /items/{id}` | create or replace; republishes if it is or was published |
| `DELETE /items/{id}` | remove it and its pictures; republish |
| `POST /items/{id}/pictures` | returns a signed upload URL for one picture slot |

The Lambda (Node.js 22, AWS SDK only, no third-party packages):

- rejects any token whose `cognito:groups` claim lacks `board`
- validates every field — lengths, ISO dates, stop after start, link `https://`
  only, at most three pictures, each picture's keys under the item's own prefix
- issues upload URLs only for the item's own prefix, valid for five minutes,
  content-type `image/jpeg`, size-capped
- on save, deletes any object under the item's prefix that the item no longer
  references, so removed pictures do not linger
- stores `createdBy` / `updatedBy` from the token's email, with timestamps
- rewrites `content.json` after any change that affects what is public

CORS allows `https://www.austinareafirewise.org` only. Throttling 10 requests
per second, burst 20.

**Upload URLs are the one part that needs care.** A signed URL is a bearer
capability: whoever holds it can PUT to that key for five minutes. It is
returned only to a signed-in board member, only for a key under an item they
have already saved, and it names the content type and maximum size, so the
worst case is a board member uploading an odd image to their own article.

---

## Data

One DynamoDB table, `aafa-content`, on-demand, partition key `id`.

```
id           ULID
kind         "news" | "notice"
status       "draft" | "published"
title        ≤ 120
body         ≤ 6000
startsAt     ISO 8601 with offset
endsAt       ISO 8601 with offset
link         https URL | absent
linkText     ≤ 60 | absent
showOnHome   boolean            (news only)
pictures     [ { key, thumbKey, width, height, credit ≤ 120, alt ≤ 200 } ]  ≤ 3
createdAt    createdBy (email)
updatedAt    updatedBy (email)
```

No indexes; dozens of items; a scan is the right query.

`content.json` is the public projection: everything above except `status`
(always published there) and the editor emails.

---

## Storage and delivery

A private S3 bucket, `aafa-site-content`, with a bucket policy allowing public
read under two prefixes — `content.json` and `images/*` — and nothing else.
Objects carry `Cache-Control`: 60 seconds for `content.json`, one year for
images, whose names are unique so they never need to change.

Layout:

```
content.json
images/<itemId>/<pictureId>.jpg        1600px wide
images/<itemId>/<pictureId>-thumb.jpg   480px wide
```

The site fetches `/content/...` from its own origin; an Amplify rewrite proxies
that prefix to the bucket — same mechanism the existing 404 rule uses. The
page never references an S3 address, so storage can change later without
touching HTML. That rule is added to the site stack as a parameter, keeping
the template the truth.

---

## Security, in one place

| Concern | Answer |
| --- | --- |
| Password handling | Cognito. We never see, store or transmit one. |
| Who can sign in | Only accounts an admin created. Self sign-up off. |
| Who can write | Only sign-ins in the `board` group, checked server-side. |
| Script injection via content | Impossible by construction: plain text stored, `textContent` rendered. |
| Malicious image file | Re-encoded through a canvas in the browser; only the resulting JPEG is stored. Upload URL is content-type- and size-capped. |
| Location leakage from photos | Re-encoding strips EXIF, including GPS. |
| Compromised editor account | Can post, alter or remove news and notices and their pictures. Cannot touch emergency content, agency links, code, DNS, or the account. Fix: delete the user, re-save affected items. |
| Compromised public path | There is none beyond S3 serving files. |
| Audit | `updatedBy` on every item; CloudWatch logs on every call; CloudTrail on everything. |
| Revoking a person | Delete the Cognito user. Instant. |
| Search engines | `/admin/` is `noindex` and disallowed in `robots.txt`. Hygiene, not security. |
| Browser storage | Tokens in `sessionStorage`; cleared on tab close. |

What this deliberately does **not** protect against: a board member publishing
something wrong. That is an editorial problem, and the answer is the board —
and the Preview button, and the draft status, which exist so that "wrong"
gets caught before "published".

---

## Cost

| | Monthly |
| --- | --- |
| Cognito | free to 50,000 monthly users |
| DynamoDB on-demand, dozens of items | < $0.01 |
| Lambda | free tier |
| API Gateway HTTP API | $1.00 per million requests |
| S3 — a few hundred images over years | pennies |

Effectively zero. The site stack's budget alert covers it.

---

## Operations

**Add a board member** (whoever holds the CLI profile):

```bash
aws cognito-idp admin-create-user --user-pool-id <pool> --username person@example.org \
  --user-attributes Name=email,Value=person@example.org Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id <pool> --username person@example.org --group-name board
```

They receive an email with a temporary password.

**Remove one:** `admin-delete-user`. Then re-save any item they last edited if
you want their name off it.

**Reset a password:** `admin-reset-user-password`, or they use "Forgot
password" on the sign-in page.

The pool id lands in `infra/README.md` once built.

---

## What gets built, in order

1. `infra/cms-stack.yaml` — Cognito pool, group, client and domain; DynamoDB
   table; content bucket and policy; Lambda and role; HTTP API, routes,
   authorizer, CORS, throttling. One stack, deletable as a unit.
2. `lambda/cms/index.mjs` — the function, packaged with the stack.
3. `infra/site-stack.yaml` — optional `ContentBucket` parameter adding the
   `/content/*` rewrite. Existing stack updated in place.
4. `src/admin/` — sign-in, list, edit form, cropper, uploader, preview button.
   Built for people who do not use computers much: one screen, large targets,
   plain words, confirm-before-delete, an unmissable "Saved" and an equally
   unmissable "This is a draft — visitors cannot see it".
5. `src/js/content.js` — fetches content, renders the notice slot, the home
   News section, and the News page; handles `?preview=` for signed-in editors.
6. `src/news.html`, the nav link on every page, `robots.txt` and sitemap.
7. `docs/04-editing-the-site.md` — the board-facing page.
8. First board members created; the stray pool deleted.

Steps 1–3 are AWS and reversible by deleting the stack. Steps 4–6 are a normal
site push. Nothing reaches visitors until step 6 ships.

**The cropper is the largest single piece** — a fixed-aspect drag frame over a
canvas, written in plain JavaScript rather than pulled from a CDN, so the
admin page has no dependency to patch. Everything else is small.
