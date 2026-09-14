# 7 — Members and communications: design

How people sign up for Alliance updates by email or text, how the board keeps
that list, and how the board sends a message to everyone on it — with the
review, approval and test steps that stop a wrong message going to hundreds
of phones.

Status: **design, awaiting approval.** Nothing here exists yet.

Read alongside [06-cms-design.md](06-cms-design.md): this reuses its sign-in,
API and admin page, and adds two new sections to the admin area.

---

## The short version

- The **home page form** gains a phone number and a choice: email, text, or
  both. Submitting actually stores the person (today it stores nothing).
- Nobody is on the list until they **confirm** — a link in an email, a code
  by text. Unconfirmed signups expire after seven days.
- The admin area gets a **Members** section: full list, search, add, edit,
  delete, export, and each person's consent record.
- The admin area gets a **Communications** section: write a message, submit
  it for review, a *different* board member approves it, send a test to
  yourself, then broadcast. Every send is logged per recipient.
- Every email carries an unsubscribe link; every text honours STOP; and a
  **Manage my subscription** page lets anyone switch channel, pause, or remove
  themselves from the website. All of it updates the list automatically,
  without a board member doing anything.
- Email goes through **Amazon SES** from `@austinareafirewise.org`. Text goes
  through **AWS End User Messaging** from a verified toll-free number.

Both channels need one-time registration with AWS that takes days to weeks and
requires information only the organization can supply. That is on the
critical path and is listed at the end.

---

## Why this is more careful than the news feature

News and notices are read by whoever visits the site. A broadcast is pushed
to people's phones and inboxes, and the law treats that differently:

- **Texting** in the US falls under the TCPA. Sending a text someone did not
  clearly agree to receive carries statutory damages per message, and class
  actions over it are routine. The defense is a record of consent: who, when,
  from where, what they were told.
- **Email** falls under CAN-SPAM: a working unsubscribe honoured within ten
  days, an accurate sender, and the sender's **postal address** in every
  message.
- **A wrong broadcast cannot be recalled.** A wrong notice on the site is
  fixed in a minute. A text to 400 people saying the meeting is Tuesday when
  it is Thursday is 400 apologies.

So: double opt-in on both channels, consent recorded, two people between
"written" and "sent", a test message before the real one, and STOP and
unsubscribe handled by machines rather than by remembering.

---

## Signing up (public)

The existing form at the bottom of the home page, extended:

| Field | Required | Notes |
| --- | --- | --- |
| Name | no | |
| Email | if email chosen | |
| Mobile number | if text chosen | US numbers; normalized to +1 format |
| Contact me by | yes | **Email** / **Text** / **Both** |
| Neighborhood or area | no | as today |
| Interested in | no | as today |
| Consent | yes | see below |

**Consent wording is not decorative.** Beside the submit button, in ordinary
type, not a hidden checkbox:

> By signing up you agree to receive occasional messages from the Austin Area
> Firewise Alliance about wildfire preparedness and Alliance activities.
> Message frequency varies. Message and data rates may apply. Reply STOP to
> any text to stop, HELP for help. Unsubscribe from email with the link in any
> message. See our [privacy statement].

That text, the timestamp, the IP address, and the page it came from are
stored with the record. That is the consent record, and it is what the
organization would produce if ever asked.

**What happens on submit:**

1. The browser posts to a **public, unauthenticated** API route — the first
   one on this site. It is rate-limited per IP, the honeypot field is
   checked, and the payload is validated exactly as the admin routes are.
2. The person is stored with status **pending**.
3. If they chose email: a confirmation email with a signed link.
   If text: a text with a six-digit code, and the page asks for it.
   If both: both, and either one confirms the record.
4. On confirmation, status becomes **confirmed**. Only confirmed people are
   ever sent a broadcast.
5. Pending records that never confirm are deleted after seven days.

The form says, after submit, exactly what will happen next and that nothing
is sent until they confirm.

**Privacy statement.** A new page, `privacy.html`, plain language: what is
collected, why, how long it is kept, who can see it, how to be removed. It is
linked from the form. This is required for the toll-free registration below
and is the right thing to have anyway.

---

## Leaving the list (member)

A person must be able to stop the messages without asking anyone, and the
board must never have to act for it to take effect. Four routes, all leading
to the same record update:

| Route | How it works |
| --- | --- |
| **Link in any email** | Every email ends with "Unsubscribe" — a signed, single-purpose link. One click, no login, no confirmation dialog. It lands on a page that says "You are unsubscribed" and offers to undo it. |
| **Reply STOP to any text** | Handled by the carrier keyword on the toll-free number. AWS acknowledges automatically, the system marks the record, and the number cannot be texted again until they text START. This is required by carriers and works even if our system is down. |
| **From the website** | A **Manage my subscription** page, linked from the privacy statement and the footer. Enter the email or phone; a signed link or code arrives on that channel; the page then lets them **switch method** (email → text, both → email only), **pause**, or **remove themselves entirely**. Nobody can change a subscription they do not hold, because the link goes to the address on file. |
| **Ask a board member** | For someone who phones or emails instead. A board member unsubscribes them from the Members section, and the record shows which board member did it and when. |

What each does to the record:

- **Unsubscribe** — status becomes *unsubscribed*, with `unsubscribedVia`
  recording the route. The record is kept as a suppression: if the same
  address is submitted on the form again it is treated as a fresh signup
  requiring confirmation, not silently re-enabled.
- **Remove me entirely** — the record is deleted. Offered on the manage page
  and honoured by the board on request; the privacy page says so.
- **Switch method** — the channel they are leaving is marked unsubscribed,
  the other stays confirmed. Nothing is sent to a channel they did not confirm.

Every outgoing message is generated with the recipient's own link, so there is
no way to send a message without a way out attached. The compose screen shows
the footer but cannot remove it.

## Members (admin)

A new **Members** section in the admin area, separate from News and Notices.

**List.** Every record, searchable by name, email, phone, or area. Columns:
name, email, phone, method, status, joined, last message. Filters for status
and method. Counts at the top: confirmed by email, confirmed by text,
pending, unsubscribed.

**Statuses:**

| Status | Meaning |
| --- | --- |
| **Pending** | Signed up, not yet confirmed. Never messaged. |
| **Confirmed** | On the list. |
| **Unsubscribed** | Asked to stop, by link, STOP, or a board member. Kept as a record so they are not re-added by mistake; never messaged. |
| **Bounced** | Email hard-bounced or number is unreachable. Not messaged until a board member fixes the address. |

**Add.** A board member can add someone directly — a neighbor who asked at a
chipper day. The record still goes through confirmation: it is stored as
pending and the person gets the confirmation email or text. A board member
cannot mark someone confirmed by hand, because that would be manufacturing a
consent record. The one exception is a written note field where the board
member records how consent was obtained ("signed up on paper at the 14 Oct
meeting"), which is stored with the record.

**Edit.** Name, email, phone, method, area, notes. Changing an email or phone
puts that channel back to pending and sends a fresh confirmation.

**Delete.** Removes the record entirely. Confirm-before-delete. Used for
mistakes and for people who ask to be forgotten — different from unsubscribe,
which keeps a suppression record.

**Export.** CSV of the current filter. For a board that moves to a mailing
service later, or for a paper list at a meeting.

**Audit.** Every change shows who made it and when. Unsubscribes record how:
link, STOP keyword, or which board member.

---

## Communications (admin)

A new **Communications** section. A communication is a message to the list,
and it moves through states that no single person can skip:

```
  Draft  ──▶  In review  ──▶  Approved  ──▶  Sent
    ▲             │                │
    └─────────────┴── Changes requested / Rejected
```

**Compose.** Fields:

| Field | Notes |
| --- | --- |
| Internal name | "October meeting reminder" — for the list, not sent |
| Audience | Everyone · Email only · Text only |
| Email subject | if email |
| Email body | if email; same Markdown subset as news; unsubscribe link and postal address are appended automatically and cannot be removed |
| Text body | if text; a live counter shows characters and how many **segments** it will send as, because a 161-character text costs and arrives as two; "Reply STOP to stop" is appended automatically |
| Send when | Now, or a date and time — never outside 8am–9pm Central for texts |

**Preview.** Shows the email as it will render and the text as it will
appear on a phone, with the automatic footers included and a real member's
name substituted, so nobody is surprised by the length.

**Submit for review.** Locks the message. Every board member sees it in a
"waiting for review" list and gets an email saying so.

**Approve / Request changes.** Any board member **other than the author**
can approve. The author cannot approve their own message, and the system
enforces that rather than asking people to remember it. Requesting changes
unlocks it and returns it to draft with a note.

**Send a test.** Available to the author and the approver at any stage: the
message goes to *their own* confirmed email and phone only. The button says
which address and number it will go to. A test is logged like any send.

**Broadcast.** Only an approved message, only by the approver or the author
once approved, and only after a confirmation dialog that states the count:
"Send to 212 people by email and 148 by text?" Then it goes.

**After sending.** The communication shows a per-recipient log: delivered,
bounced, failed, unsubscribed-since. Totals at the top. Bounces and
complaints update the member records automatically.

**Nothing is ever deleted from the sent list.** A sent communication is a
record of what the organization told people. It can be duplicated into a new
draft.

---

## How email and text are sent — recommendation

### Email: Amazon SES

The obvious choice given everything else lives in this account, and it is the
cheapest option by a wide margin: $0.10 per thousand messages.

- Messages come from **`updates@austinareafirewise.org`** (or similar), which
  requires verifying the domain in SES. That is three DNS records in the
  Route 53 zone already in this account — I can add them.
- New SES accounts are in a **sandbox** that only sends to verified addresses.
  A request to leave it is a short form (use case, how you handle bounces and
  unsubscribes) and is usually granted in under a day.
- Bounces and complaints are delivered to the system through SNS and update
  the member record. Sending to an address that bounced is what gets a sender
  blacklisted, so this is not optional.
- SES adds `List-Unsubscribe` headers so Gmail and Outlook show their own
  unsubscribe button too.

### Text: AWS End User Messaging SMS, from a verified toll-free number

US carriers block application-to-person texts from unregistered senders. There
are two ways to be registered:

| | Toll-free number (recommended) | 10DLC (standard local number) |
| --- | --- | --- |
| Number | 1-8XX, about $2/month | local Austin number, about $1/month |
| Registration | Toll-free verification: one form, 1–3 weeks | Brand + campaign registration via The Campaign Registry: two fees, 1–3 weeks, more paperwork |
| Throughput | 3 messages/second — a 500-person list in 3 minutes | higher, irrelevant here |
| Per message | about $0.0083 per segment | about $0.0083 per segment |
| Suits | organizations sending occasional informational texts | high-volume marketing |

**Toll-free.** For a volunteer organization sending a few messages a month it
is the same cost, less paperwork, and one form instead of two registrations.

- STOP, HELP, and START keywords are handled by AWS automatically on a
  toll-free number with two-way messaging on. A STOP reply reaches the system
  through SNS and marks the member unsubscribed. A board member never has to
  see it.
- The verification form asks for: organization name and website, the **opt-in
  page** (our form, with the consent wording above, hence the wording), a
  **privacy policy URL** (hence the page), sample messages, expected monthly
  volume, and a contact. Until it is approved the number cannot send at all.
- Quiet hours: the system refuses to schedule a text outside 8am–9pm Central,
  because the TCPA does.

**Cost, realistically.** 300 people on the text list, two messages a month,
each one segment: about $5 a month plus the number. Email is effectively
free. The budget alert on the account covers it.

### What I recommend against

**Twilio, Mailchimp, or a similar outside service.** Both are good products.
The reasons not to: a third vendor account for the board to own and pay for,
a second place member data lives, and a second set of credentials to manage
— for a capability AWS already provides in the account the site runs in. The
one thing an outside service would give is a polished email template editor,
and the board's messages are two paragraphs and a date.

**Sending from a board member's personal phone or Gmail.** Tempting for a
small list. It is exactly what the TCPA and CAN-SPAM records are for, and
personal accounts cannot handle STOP or unsubscribe automatically.

---

## How it fits together

```
 PUBLIC
 ┌──────────────┐  POST /signup   ┌──────────────┐    pending    ┌──────────┐
 │ home page    │───────────────▶ │ API (public, │──────────────▶│ DynamoDB │
 │ signup form  │                 │ rate-limited)│               │ members  │
 └──────────────┘                 └──────┬───────┘               └────┬─────┘
                                         │ confirmation                │
                                         ▼                             │
                                   SES email / SMS code                │
                                         │ confirm link/code           │
                                         └────────────────────────────▶│ confirmed

 BOARD — signed in
 ┌──────────────┐  /members       ┌──────────────┐               ┌──────────┐
 │ /admin/      │  /comms         │ API (JWT,    │──────────────▶│ DynamoDB │
 │              │───────────────▶ │  board group)│               │ comms    │
 └──────────────┘                 └──────┬───────┘               └──────────┘
                                         │ approved + broadcast
                                         ▼
                                   ┌──────────────┐   per recipient   ┌────────────┐
                                   │ Sender Lambda│─────────────────▶ │ SES / SMS  │
                                   │ (queue-fed)  │                    └─────┬──────┘
                                   └──────────────┘                          │
                                         ▲     bounces, complaints, STOP      │
                                         └────────────── SNS ◀───────────────┘
```

**Broadcasts do not run inside the API call.** Pressing Send writes the job
and returns. A queue feeds a separate sender Lambda that works through the
recipients at the channel's rate, records each result, and retries transient
failures. If a board member closes the tab, the send continues. If AWS
throttles, it slows down rather than dropping people.

**The public site is still untouched by all of this** except the form. News
and notices keep coming from `content.json` as before.

---

## Data

Two new tables.

**`aafa-members`**, partition key `memberId`:

```
memberId       ULID
name           ≤ 120 | absent
email          lowercased | absent
phone          E.164 (+15125551234) | absent
method         "email" | "sms" | "both"
status         "pending" | "confirmed" | "unsubscribed" | "bounced"
emailStatus    "pending" | "confirmed" | "bounced" | "unsubscribed" | absent
smsStatus      same, or absent
area           ≤ 120 | absent
interest       one of the form's options | absent
notes          ≤ 1000 | absent          (board-only)
consent        { text, at, ip, source, method }   the record
confirmedAt    ISO | absent
unsubscribedAt ISO | absent
unsubscribedVia "link" | "stop" | "board:<email>" | absent
createdAt / createdBy      (createdBy is "form" or a board email)
updatedAt / updatedBy
```

Indexes on `email` and `phone` so a STOP or a bounce finds its record in one
read, and so the form can refuse a duplicate politely.

**`aafa-communications`**, partition key `commId`:

```
commId         ULID
name           internal
audience       "all" | "email" | "sms"
emailSubject / emailBody / smsBody
status         "draft" | "review" | "approved" | "scheduled" | "sending" | "sent" | "rejected"
author, submittedAt, approver, approvedAt, decisionNote
sendAt         ISO | absent
counts         { email, sms, delivered, bounced, failed }
recipients     stored in a third table, aafa-deliveries, one row per person per send:
               commId, memberId, channel, status, at, providerId, error
```

Point-in-time recovery on all three. A members list is the one thing in this
whole system that cannot be recreated from a git history.

---

## Security and privacy, in one place

| Concern | Answer |
| --- | --- |
| The public signup route | The first unauthenticated write on the site. Rate-limited per IP at the API, honeypot, strict validation, and it can only ever create a *pending* record — nothing it does reaches a phone until the person confirms. |
| Enumeration | The form never says "that email is already signed up." It says "check your inbox" either way. |
| Who can see member data | Board group only, same JWT check as everything else. Member data never enters `content.json` or any public file. |
| Who can send | Author writes; a *different* board member approves; the API enforces author ≠ approver from the token's email. |
| Test before broadcast | Test sends go only to the requesting board member's own confirmed contacts, and the button names them. |
| Wrong-list protection | The broadcast confirmation states the recipient count. Pending, unsubscribed and bounced records are excluded by the query, not by the board remembering. |
| STOP and unsubscribe | Handled by AWS keywords and signed links, delivered to the system via SNS, applied without human involvement. Signed unsubscribe tokens expire in 90 days and are single-purpose. |
| Consent evidence | Wording, timestamp, IP, source page, and confirmation timestamp stored per record. Exportable. |
| Quiet hours | Texts cannot be scheduled outside 8am–9pm Central. |
| Deletion on request | Board can delete a record outright; the privacy page says how to ask. |
| Data leaving the account | Never, except to SES and the SMS service to deliver a message. No third-party list service. |
| Audit | Every member edit and every communication state change records who and when. CloudWatch logs on every API call. |

---

## What it costs

| | Monthly, ~300 members |
| --- | --- |
| SES | pennies |
| Toll-free number | ~$2 |
| SMS, 2 sends/month, 1 segment | ~$5 |
| DynamoDB, Lambda, SQS | free tier |
| **Total** | **under $10** |

Every additional text segment is about a cent. A three-segment message to 300
people is $7.50, which is why the compose screen shows the segment count.

---

## What only the organization can do

These are on the critical path and cannot be scripted. The text channel in
particular is **weeks**, not hours.

1. **A postal address** for the email footer. CAN-SPAM requires one; a PO box
   is fine.
2. **SES production access** — I submit the request; AWS usually answers
   within a day. Until then email only goes to verified addresses.
3. **Toll-free number verification** — I request the number and submit the
   form, but it asks for the organization's legal name, address, a contact
   person, the privacy page, and the opt-in page. AWS and the carriers review
   it: **1–3 weeks**. Until approved, no text can be sent at all, including
   confirmation codes. Signup by text is therefore hidden on the form until
   the number is live.
4. **Whether the Alliance is a registered nonprofit.** It is asked on the
   verification form, and it changes what the carriers will accept.

---

## Decisions before building

1. **Toll-free number via AWS**, as recommended — or 10DLC, or an outside
   service?
2. **Approval model:** any other board member can approve, as designed — or a
   named approver group?
3. **Postal address** for the email footer.
4. **Is the Alliance a 501(c)(3)?**
5. **Build order.** I would build email end to end first — signup, confirm,
   members, communications, broadcast — because SES is a one-day wait, and add
   the text channel when the number is approved. The board gets a working
   email list in the first week rather than waiting three for both.

---

## What gets built, in order

1. `infra/comms-stack.yaml` — members, communications and deliveries tables;
   SQS queue; sender Lambda; SNS topics for SES events and SMS keywords; SES
   identity for the domain; the toll-free number request. Adds the public
   `/signup` and `/confirm` routes and the admin `/members` and `/comms`
   routes to the existing API.
2. Lambda: signup and confirmation; members CRUD; communications state
   machine with the author ≠ approver rule; the sender; the SNS event handler.
3. `privacy.html`, and the signup form with phone, method, consent wording.
4. Admin: **Members** and **Communications** sections, review queue, preview,
   test send, broadcast confirmation, delivery log.
5. Board-facing instructions added to [04-editing-the-site.md](04-editing-the-site.md).
6. SES verification and production request; toll-free number request.
7. Text channel switched on when the number is approved.
