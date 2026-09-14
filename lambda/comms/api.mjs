/* Members and communications API.
 *
 * Two kinds of route on one function:
 *
 *   Public (no sign-in): the signup form, confirmation, unsubscribe, the
 *   manage-my-subscription page, and the Twilio webhook. These are the only
 *   unauthenticated writes on the site, so each is rate-limited per IP and
 *   can only ever move a record towards "pending" or towards "unsubscribed" —
 *   never towards "confirmed" without the person proving they hold the
 *   address, and never towards a message being sent.
 *
 *   Board (Cognito JWT, board group): members CRUD and the communication
 *   state machine. The one rule the machine enforces that people would
 *   otherwise be trusted to remember: the author of a message cannot approve
 *   it.
 */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import {
    ddb, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand,
    ENV, LIMITS, INTERESTS, METHODS, AUDIENCES, CONSENT, GROUP_STATUSES, BOARD_STATUSES,
    ValidationError, respond, redirect, parseBody, clientIp, editor,
    str, email, phone, zip, isoDate, isId, newId, nowIso, withinTextingHours, smsSegments,
    rateLimit, signToken, verifyToken, newCode, hashCode,
    getMember, findByEmail, findByPhone, allMembers, deriveStatus, publicMember, audienceFor,
    splitName, displayName,
    renderEmail, renderSms, markdownToHtml, twilioConfig, sha1Base64Hmac,
    allGroups, publicGroup, allBoard,
} from "./lib.mjs";
import { sendEmail, sendPlainEmail, emailEnabled } from "./email.mjs";
import { sendSms, smsEnabled, classifyKeyword } from "./sms.mjs";

const sqs = new SQSClient({});

export const handler = async (event) => {
    const route = event.routeKey;
    try {
        // ---- Public ----
        if (route === "GET /signup/options") return respond(200, { sms: smsEnabled(), email: await emailEnabled(), consent: CONSENT });
        if (route === "GET /groups/public") return respond(200, { groups: (await allGroups()).filter((g) => g.status !== "inactive").map(publicGroup) }, { "cache-control": "public, max-age=300" });
        if (route === "POST /signup") return await signup(event);
        if (route === "POST /confirm") return await confirmEmail(event);
        if (route === "POST /confirm-code") return await confirmCode(event);
        if (route === "GET /unsubscribe") return await unsubscribeGet(event);
        if (route === "POST /unsubscribe") return await unsubscribePost(event);
        if (route === "POST /manage/request") return await manageRequest(event);
        if (route === "GET /manage") return await manageGet(event);
        if (route === "POST /manage") return await managePost(event);
        if (route === "POST /hooks/twilio") return await twilioHook(event);

        // ---- Board ----
        const who = editor(event);
        if (!who) return respond(403, { error: "Your account is not on the board list." });
        const id = event.pathParameters?.id;

        if (route === "GET /members") return respond(200, { members: (await allMembers()).map(publicMember) });
        if (route === "GET /members/export") return await exportMembers();
        if (route === "POST /members") return await createMember(parseBody(event), who);
        if (route === "PUT /members/{id}") return await updateMember(id, parseBody(event), who);
        if (route === "DELETE /members/{id}") return await deleteMember(id, who);
        if (route === "POST /members/{id}/unsubscribe") return await boardUnsubscribe(id, who);
        if (route === "POST /members/{id}/resend") return await resendConfirmations(id);

        if (route === "GET /groups") return respond(200, { groups: await allGroups() });
        if (route === "POST /groups") return await saveGroup(null, parseBody(event), who);
        if (route === "PUT /groups/{id}") return await saveGroup(id, parseBody(event), who);
        if (route === "DELETE /groups/{id}") return await deleteGroup(id);

        if (route === "GET /board") return respond(200, { board: await allBoard(), logins: await boardLogins() });
        if (route === "POST /board") return await savePerson(null, parseBody(event), who);
        if (route === "PUT /board/{id}") return await savePerson(id, parseBody(event), who);
        if (route === "DELETE /board/{id}") return await deletePerson(id);

        if (route === "GET /comms") return respond(200, { comms: await allComms() });
        if (route === "POST /comms") return await createComm(parseBody(event), who);
        if (route === "GET /comms/{id}") return await getCommWithCounts(id);
        if (route === "PUT /comms/{id}") return await updateComm(id, parseBody(event), who);
        if (route === "DELETE /comms/{id}") return await deleteComm(id);
        if (route === "POST /comms/{id}/submit") return await transition(id, who, "submit", parseBody(event));
        if (route === "POST /comms/{id}/approve") return await transition(id, who, "approve", parseBody(event));
        if (route === "POST /comms/{id}/reject") return await transition(id, who, "reject", parseBody(event));
        if (route === "POST /comms/{id}/withdraw") return await transition(id, who, "withdraw", parseBody(event));
        if (route === "POST /comms/{id}/test") return await testSend(id, who);
        if (route === "POST /comms/{id}/send") return await broadcast(id, who);
        if (route === "POST /comms/{id}/duplicate") return await duplicateComm(id, who);
        if (route === "GET /comms/{id}/deliveries") return await deliveries(id);

        return respond(404, { error: "Unknown route." });
    } catch (err) {
        if (err instanceof ValidationError) return respond(err.status, { error: err.message });
        console.error(route, err);
        return respond(500, { error: "Something went wrong on the server. Nothing was changed." });
    }
};

/* ================================================================== */
/* Public: signing up                                                   */
/* ================================================================== */

const GENERIC_SIGNUP = "Thanks. If that address is new to us, a confirmation is on its way — " +
    "nothing is sent until you confirm.";

async function signup(event) {
    const ip = clientIp(event);
    await rateLimit(`signup#${ip}`, 5, 60);
    await rateLimit(`signup-day#${ip}`, 30, 86400);

    const b = parseBody(event);
    if (b.company) return respond(200, { message: GENERIC_SIGNUP });          // honeypot

    let method = str(b.method, "Contact method", 10, true);
    if (!METHODS.has(method)) throw new ValidationError("Choose email, text, or both.");
    // Texting is not live until a carrier-verified number exists. Rather than
    // refusing the sign-up, take the number and hold it unconfirmed: the
    // person has given consent, and when the number is approved they get a
    // confirmation code like anyone else. Nothing is ever texted to a number
    // that has not confirmed, so holding it costs them nothing.
    const smsLive = smsEnabled();
    let smsDeferred = false;
    if (!smsLive && (method === "sms" || method === "both")) {
        if (!b.email) throw new ValidationError("Text messages aren't switched on yet, so we need an email address too for now.");
        method = "both";
        smsDeferred = true;
    }
    // Email may not be sendable yet — a new SES account sits in a sandbox
    // until AWS grants production access. Refusing the sign-up was the wrong
    // answer: it turns away people who want to be on the list, and it makes
    // the opt-in described in our SES application look like it does not
    // exist. Accept them, hold the record unconfirmed, and send the
    // confirmation the moment sending works. The tick in events.mjs does
    // that without anyone remembering to.
    const emailSendable = method === "sms" ? true : await emailEnabled();
    if (b.consent !== true && b.consent !== "true" && b.consent !== "on") {
        throw new ValidationError("Please tick the box to agree to receive messages.");
    }

    const wantEmail = method !== "sms", wantSms = method !== "email";
    const e = email(b.email, wantEmail);
    const p = phone(b.phone, wantSms);
    // Both optional, as they were when this was one field. Someone giving
    // only a first name is normal and fine.
    const firstName = str(b.firstName, "First name", LIMITS.firstName);
    const lastName = str(b.lastName, "Last name", LIMITS.lastName);
    const area = str(b.area, "Area", LIMITS.area);
    const zipCode = zip(b.zip, false);
    // The group is optional on purpose: most of the county has no Firewise
    // group yet, and those neighbourhoods are the ones most worth reaching.
    // An unrecognised id is dropped rather than rejected, so a group deleted
    // between page load and submit does not lose the sign-up.
    let groupId = str(b.groupId, "Firewise group", 40);
    if (groupId && !isId(groupId)) groupId = "";
    if (groupId) {
        const g = await ddb.send(new GetCommand({ TableName: ENV.groups, Key: { groupId } }));
        if (!g.Item) groupId = "";
    }
    const interest = str(b.interest, "Interest", 20);
    if (interest && !INTERESTS.has(interest)) throw new ValidationError("Interest is not one of the options.");

    // Existing record on either channel? Reuse it rather than creating a
    // duplicate — and never reveal to the browser which case this was.
    let m = (wantEmail && await findByEmail(e)) || (wantSms && await findByPhone(p)) || null;
    const existed = Boolean(m);
    const now = nowIso();
    const consent = { version: CONSENT.version, text: CONSENT.text, at: now, ip, source: "signup-form", method };

    if (!m) {
        m = {
            memberId: newId(), createdAt: now, createdBy: "form",
        };
    }
    // Channels: only ever set to pending here; confirmation sets confirmed.
    if (wantEmail) { m.email = e; if (m.emailStatus !== "confirmed") m.emailStatus = "pending"; }
    if (wantSms) { m.phone = p; if (m.smsStatus !== "confirmed") m.smsStatus = "pending"; }
    m.method = method;
    if (firstName) m.firstName = firstName;
    if (lastName) m.lastName = lastName;
    if (area) m.area = area;
    if (zipCode) m.zip = zipCode;
    if (groupId) m.groupId = groupId;
    if (interest) m.interest = interest;
    m.consent = consent;
    m.unsubscribedAt = undefined; m.unsubscribedVia = undefined;   // a fresh signup supersedes an old opt-out
    m.updatedAt = now; m.updatedBy = "form";
    // TTL only while nothing is confirmed. A confirmed record must never
    // carry this attribute, or DynamoDB's TTL sweep would delete a member.
    // Set before the expiry is computed and before the record is written:
    // the flag decides how long the record lives, and both have to be in the
    // item that actually goes to the table.
    if (wantEmail && !emailSendable) m.confirmationDeferred = true;
    else delete m.confirmationDeferred;

    if (!m.confirmedAt) {
        // Seven days is right for someone who simply never clicked. A record
        // waiting on us rather than on them gets thirty, so our own delay
        // cannot quietly delete a sign-up.
        const days = m.confirmationDeferred ? 30 : 7;
        m.pendingExpires = Math.floor(Date.now() / 1000) + days * 86400;
    } else delete m.pendingExpires;

    const codeOut = {};
    if (wantSms && !smsDeferred && m.smsStatus !== "confirmed") {
        const code = newCode();
        m.smsCodeHash = await hashCode(code, m.memberId);
        m.smsCodeExp = Math.floor(Date.now() / 1000) + 15 * 60;
        m.smsCodeTries = 0;
        codeOut.code = code;
    }

    const isNewRecord = !existed;
    await ddb.send(new PutCommand({ TableName: ENV.members, Item: m }));

    // Confirmations, after the record exists — the code hash has to be stored
    // before the code is sent, or a fast reply could arrive before we could
    // check it.
    //
    // If sending fails, a brand-new record is removed again rather than left
    // as a sign-up nobody can complete, and the person is told plainly. An
    // existing record is kept, because deleting it would take away a
    // subscription they already had.
    try {
        if (wantEmail && emailSendable && m.emailStatus !== "confirmed") await sendEmailConfirmation(m);
        if (codeOut.code) {
            await sendSms(m.phone, `${ENV.orgName}: your confirmation code is ${codeOut.code}. It expires in 15 minutes. Reply STOP to stop.`, "transactional");
        }
    } catch (err) {
        console.error("confirmation send failed:", err.message);
        if (isNewRecord) await ddb.send(new DeleteCommand({ TableName: ENV.members, Key: { memberId: m.memberId } }));
        throw new ValidationError(
            "We could not send your confirmation just now, so nothing was saved. " +
            "This is our problem, not yours — please try again later.", 503);
    }

    if (wantEmail && !emailSendable) {
        return respond(200, {
            message: "Thanks — you're on the list. Our email sending is still being approved, " +
                "so your confirmation will arrive in a day or two rather than right away. " +
                "Nothing is sent to you until you confirm.",
            ...(codeOut.code ? { memberId: m.memberId, codeSent: true } : {}),
        });
    }

    return respond(200, {
        message: smsDeferred
            ? GENERIC_SIGNUP + " We have your mobile number too — we'll text you to confirm it once our number is approved by the carriers."
            : GENERIC_SIGNUP,
        // The browser needs this to submit the text code; it is an opaque id
        // that grants nothing on its own.
        ...(codeOut.code ? { memberId: m.memberId, codeSent: true } : {}),
    });
}

async function sendEmailConfirmation(m) {
    const t = await signToken("confirm-email", m.memberId, 7 * 86400);
    const url = `${ENV.siteOrigin}/manage.html?c=${t}`;
    await sendPlainEmail({
        to: m.email,
        subject: `Confirm your ${ENV.orgName} updates`,
        text: `Thanks for signing up for updates from the ${ENV.orgName}.\n\nConfirm your email address by opening this link:\n${url}\n\nIf you did not sign up, ignore this message and nothing will be sent.\n\n${ENV.orgName}, ${ENV.postalAddress}`,
        html: `<p>Thanks for signing up for updates from the ${ENV.orgName}.</p>
<p><a href="${url}" style="display:inline-block;background:#a85512;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Confirm my email</a></p>
<p style="font-size:13px;color:#556;">Or open this link: ${url}</p>
<p style="font-size:13px;color:#556;">If you did not sign up, ignore this message and nothing will be sent.<br>${ENV.orgName}, ${ENV.postalAddress}</p>`,
    });
}

async function confirmEmail(event) {
    await rateLimit(`confirm#${clientIp(event)}`, 20, 60);
    const b = parseBody(event);
    const memberId = await verifyToken(b.t, "confirm-email");
    if (!memberId) return respond(400, { error: "That confirmation link has expired or already been used. Sign up again to get a new one." });
    const m = await getMember(memberId);
    if (!m || !m.email) return respond(400, { error: "That confirmation link is no longer valid." });
    const now = nowIso();
    await ddb.send(new UpdateCommand({
        TableName: ENV.members, Key: { memberId },
        UpdateExpression: "SET emailStatus = :c, confirmedAt = if_not_exists(confirmedAt, :now), updatedAt = :now, updatedBy = :who REMOVE pendingExpires",
        ExpressionAttributeValues: { ":c": "confirmed", ":now": now, ":who": "confirm-link" },
    }));
    const manage = await signToken("manage", memberId, 90 * 86400);
    return respond(200, { message: "Your email is confirmed. You're on the list.", manageToken: manage });
}

async function confirmCode(event) {
    await rateLimit(`code#${clientIp(event)}`, 10, 60);
    const b = parseBody(event);
    if (!isId(b.memberId)) throw new ValidationError("Something is missing. Start the sign-up again.");
    const code = str(b.code, "Code", 10, true).replace(/\D/g, "");
    const m = await getMember(b.memberId);
    if (!m || !m.smsCodeHash) throw new ValidationError("No code is waiting for that sign-up. Start again to get a new one.");
    if (m.smsCodeTries >= 5 || (m.smsCodeExp || 0) < Math.floor(Date.now() / 1000)) {
        throw new ValidationError("That code has expired or was tried too many times. Start the sign-up again for a new one.");
    }
    if ((await hashCode(code, m.memberId)) !== m.smsCodeHash) {
        await ddb.send(new UpdateCommand({
            TableName: ENV.members, Key: { memberId: m.memberId },
            UpdateExpression: "ADD smsCodeTries :one", ExpressionAttributeValues: { ":one": 1 },
        }));
        throw new ValidationError("That code doesn't match. Check the text and try again.");
    }
    const now = nowIso();
    await ddb.send(new UpdateCommand({
        TableName: ENV.members, Key: { memberId: m.memberId },
        UpdateExpression: "SET smsStatus = :c, confirmedAt = if_not_exists(confirmedAt, :now), updatedAt = :now, updatedBy = :who REMOVE smsCodeHash, smsCodeExp, smsCodeTries, pendingExpires",
        ExpressionAttributeValues: { ":c": "confirmed", ":now": now, ":who": "confirm-code" },
    }));
    return respond(200, { message: "Your mobile number is confirmed. You're on the list." });
}

/* ================================================================== */
/* Public: leaving and managing                                          */
/* ================================================================== */

async function applyUnsubscribe(memberId, via, channels) {
    const m = await getMember(memberId);
    if (!m) return null;
    const now = nowIso();
    const names = {}, values = { ":now": now, ":via": via, ":u": "unsubscribed" };
    let set = "SET updatedAt = :now, updatedBy = :via";
    if (channels.includes("email") && m.email) set += ", emailStatus = :u";
    if (channels.includes("sms") && m.phone) set += ", smsStatus = :u";
    const allOff = (!m.email || channels.includes("email") || m.emailStatus !== "confirmed") &&
                   (!m.phone || channels.includes("sms") || m.smsStatus !== "confirmed");
    if (allOff) set += ", unsubscribedAt = :now, unsubscribedVia = :via";
    await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId }, UpdateExpression: set, ExpressionAttributeValues: values }));
    return m;
}

async function unsubscribeGet(event) {
    const t = event.queryStringParameters?.t;
    const memberId = await verifyToken(t, "unsubscribe");
    if (!memberId) return redirect(`${ENV.siteOrigin}/manage.html?expired=1`);
    await applyUnsubscribe(memberId, "link", ["email", "sms"]);
    const manage = await signToken("manage", memberId, 90 * 86400);
    return redirect(`${ENV.siteOrigin}/manage.html?unsubscribed=1&t=${manage}`);
}

/* Reached two ways: the manage page posting the token from the email link,
   and mail clients posting "List-Unsubscribe=One-Click" to the header URL. */
async function unsubscribePost(event) {
    await rateLimit(`unsub#${clientIp(event)}`, 30, 60);
    const b = parseBody(event);
    const t = b.t || event.queryStringParameters?.t;
    const memberId = await verifyToken(t, "unsubscribe");
    if (!memberId) return respond(400, { error: "That unsubscribe link has expired. Use 'Change how we contact you' instead." });
    await applyUnsubscribe(memberId, "link", ["email", "sms"]);
    const manage = await signToken("manage", memberId, 90 * 86400);
    return respond(200, { message: "You are unsubscribed. You will not receive further messages.", manageToken: manage });
}

const GENERIC_MANAGE = "If we have that address, a link to manage your subscription is on its way.";

async function manageRequest(event) {
    const ip = clientIp(event);
    await rateLimit(`manage#${ip}`, 3, 60);
    await rateLimit(`manage-day#${ip}`, 20, 86400);
    const b = parseBody(event);
    const e = b.email ? email(b.email) : "";
    const p = b.phone ? phone(b.phone) : "";
    if (!e && !p) throw new ValidationError("Enter the email address or mobile number you signed up with.");
    const m = e ? await findByEmail(e) : await findByPhone(p);
    if (m) {
        const t = await signToken("manage", m.memberId, 2 * 3600);
        const url = `${ENV.siteOrigin}/manage.html?t=${t}`;
        if (e && m.email) {
            await sendPlainEmail({ to: m.email, subject: `Manage your ${ENV.orgName} updates`,
                text: `Use this link to change how we contact you, or to unsubscribe. It works for two hours.\n${url}\n\nIf you did not ask for this, ignore it.` });
        } else if (p && m.phone && smsEnabled()) {
            await sendSms(m.phone, `${ENV.orgName}: manage your updates here (link works for 2 hours): ${url}`);
        }
    }
    return respond(200, { message: GENERIC_MANAGE });
}

async function manageGet(event) {
    const memberId = await verifyToken(event.queryStringParameters?.t, "manage");
    if (!memberId) return respond(400, { error: "That link has expired. Request a new one below." });
    const m = await getMember(memberId);
    if (!m) return respond(404, { error: "We no longer have a record for that address." });
    const mask = (s) => s ? s.replace(/^(.{2}).*(@.*)$/, "$1…$2") : "";
    return respond(200, {
        member: {
            name: m.name || "", email: mask(m.email), phone: m.phone ? "…" + m.phone.slice(-4) : "",
            emailStatus: m.emailStatus || null, smsStatus: m.smsStatus || null, status: deriveStatus(m),
            smsAvailable: smsEnabled(),
        },
    });
}

async function managePost(event) {
    await rateLimit(`manage-act#${clientIp(event)}`, 20, 60);
    const b = parseBody(event);
    const memberId = await verifyToken(b.t, "manage");
    if (!memberId) return respond(400, { error: "That link has expired. Request a new one." });
    const m = await getMember(memberId);
    if (!m) return respond(404, { error: "We no longer have a record for that address." });
    const action = str(b.action, "Action", 20, true);
    const now = nowIso();

    if (action === "remove") {
        await ddb.send(new DeleteCommand({ TableName: ENV.members, Key: { memberId } }));
        return respond(200, { message: "Your details have been removed. We hold nothing about you now." });
    }
    if (action === "pause") {
        await applyUnsubscribe(memberId, "manage", ["email", "sms"]);
        return respond(200, { message: "Paused. You will not receive messages until you resume." });
    }
    if (action === "resume") {
        // Resuming only re-enables channels the person confirmed before; a
        // channel never confirmed stays pending and gets a fresh confirmation.
        const set = ["updatedAt = :now", "updatedBy = :who"], vals = { ":now": now, ":who": "manage", ":c": "confirmed" };
        if (m.email && m.emailStatus === "unsubscribed" && m.confirmedAt) set.push("emailStatus = :c");
        if (m.phone && m.smsStatus === "unsubscribed" && m.confirmedAt) set.push("smsStatus = :c");
        await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId },
            UpdateExpression: "SET " + set.join(", ") + " REMOVE unsubscribedAt, unsubscribedVia", ExpressionAttributeValues: vals }));
        return respond(200, { message: "Resumed. You're back on the list." });
    }
    if (action === "switch") {
        const method = str(b.method, "Contact method", 10, true);
        if (!METHODS.has(method)) throw new ValidationError("Choose email, text, or both.");
        if (method !== "email" && !smsEnabled()) throw new ValidationError("Text messages aren't available yet.");
        const set = ["updatedAt = :now", "updatedBy = :who", "#m = :method"], vals = { ":now": now, ":who": "manage", ":method": method, ":u": "unsubscribed", ":p": "pending" };
        let needEmailConfirm = false, needSms = false;
        if (method === "sms") set.push("emailStatus = :u");
        if (method === "email") set.push("smsStatus = :u");
        if (method !== "sms" && m.email && m.emailStatus !== "confirmed") { set.push("emailStatus = :p"); needEmailConfirm = true; }
        if (method !== "email" && m.phone && m.smsStatus !== "confirmed") { set.push("smsStatus = :p"); needSms = true; }
        if (method !== "sms" && !m.email) throw new ValidationError("We don't have an email address for you. Sign up again with one.");
        if (method !== "email" && !m.phone) throw new ValidationError("We don't have a mobile number for you. Sign up again with one.");
        await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId },
            UpdateExpression: "SET " + set.join(", ") + " REMOVE unsubscribedAt, unsubscribedVia",
            ExpressionAttributeNames: { "#m": "method" }, ExpressionAttributeValues: vals }));
        if (needEmailConfirm) await sendEmailConfirmation({ ...m, email: m.email });
        return respond(200, { message: needEmailConfirm || needSms
            ? "Updated. Check for a confirmation on the channel you added." : "Updated." });
    }
    throw new ValidationError("Unknown action.");
}

/* ================================================================== */
/* Public: Twilio webhook (inbound keywords and status callbacks)        */
/* ================================================================== */

async function twilioHook(event) {
    if (ENV.smsProvider !== "twilio") return respond(404, { error: "Not enabled." });
    const t = await twilioConfig();
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
    const params = Object.fromEntries(new URLSearchParams(raw));
    // Twilio signs: full URL + params sorted by key, concatenated key+value.
    const url = `https://${event.requestContext.domainName}${event.rawPath}` + (event.rawQueryString ? `?${event.rawQueryString}` : "");
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const expected = sha1Base64Hmac(t.authToken, data);
    const given = event.headers?.["x-twilio-signature"] || "";
    if (!given || given.length !== expected.length || given !== expected) return respond(403, { error: "Bad signature." });

    if (params.MessageStatus && params.MessageSid) {
        await updateDeliveryByProviderId(params.MessageSid, params.MessageStatus.toLowerCase(), params.ErrorCode);
        return { statusCode: 204, headers: {}, body: "" };
    }
    if (params.From && params.Body) {
        await handleInboundKeyword(params.From, params.Body, "twilio");
    }
    return { statusCode: 200, headers: { "content-type": "text/xml" }, body: "<Response></Response>" };
}

/* Shared with the events function via the same table logic. */
export async function handleInboundKeyword(from, body, via) {
    const kw = classifyKeyword(body);
    if (!kw) return;
    const m = await findByPhone(from);
    if (!m) return;
    if (kw === "stop") {
        await applyUnsubscribe(m.memberId, `stop:${via}`, ["sms"]);
    } else if (kw === "start" && m.confirmedAt) {
        await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId: m.memberId },
            UpdateExpression: "SET smsStatus = :c, updatedAt = :now, updatedBy = :who REMOVE unsubscribedAt, unsubscribedVia",
            ExpressionAttributeValues: { ":c": "confirmed", ":now": nowIso(), ":who": `start:${via}` } }));
    }
}

export async function updateDeliveryByProviderId(providerId, status, error) {
    const r = await ddb.send(new QueryCommand({
        TableName: ENV.deliveries, IndexName: "provider-index",
        KeyConditionExpression: "providerId = :p", ExpressionAttributeValues: { ":p": providerId }, Limit: 1,
    }));
    const d = r.Items?.[0];
    if (!d) return;
    await ddb.send(new UpdateCommand({
        TableName: ENV.deliveries, Key: { commId: d.commId, recipient: d.recipient },
        UpdateExpression: "SET #s = :s, updatedAt = :now" + (error ? ", #e = :e" : ""),
        ExpressionAttributeNames: { "#s": "status", ...(error ? { "#e": "error" } : {}) },
        ExpressionAttributeValues: { ":s": status, ":now": nowIso(), ...(error ? { ":e": String(error) } : {}) },
    }));
}

/* ================================================================== */
/* Board: members                                                        */
/* ================================================================== */

function validateMemberInput(b) {
    const method = str(b.method, "Contact method", 10, true);
    if (!METHODS.has(method)) throw new ValidationError("Choose email, text, or both.");
    const wantEmail = method !== "sms", wantSms = method !== "email";
    const out = {
        method,
        email: email(b.email, wantEmail) || undefined,
        phone: phone(b.phone, wantSms) || undefined,
        firstName: str(b.firstName, "First name", LIMITS.firstName) || undefined,
        lastName: str(b.lastName, "Last name", LIMITS.lastName) || undefined,
        area: str(b.area, "Area", LIMITS.area) || undefined,
        zip: zip(b.zip, false) || undefined,
        groupId: (function () { const g = str(b.groupId, "Firewise group", 40); return g && isId(g) ? g : undefined; })(),
        interest: str(b.interest, "Interest", 20) || undefined,
        notes: str(b.notes, "Notes", LIMITS.notes) || undefined,
    };
    if (out.interest && !INTERESTS.has(out.interest)) throw new ValidationError("Interest is not one of the options.");
    return out;
}

async function createMember(b, who) {
    const v = validateMemberInput(b);
    if (v.email && await findByEmail(v.email)) throw new ValidationError("Someone with that email is already on the list.");
    if (v.phone && await findByPhone(v.phone)) throw new ValidationError("Someone with that mobile number is already on the list.");
    const consentNote = str(b.consentNote, "How consent was obtained", 500, true);
    const now = nowIso();
    const m = {
        memberId: newId(), ...v,
        emailStatus: v.email ? "pending" : undefined, smsStatus: v.phone ? "pending" : undefined,
        consent: { version: CONSENT.version, text: CONSENT.text, at: now, source: `board:${who}`, note: consentNote, method: v.method },
        createdAt: now, createdBy: who, updatedAt: now, updatedBy: who,
        pendingExpires: Math.floor(Date.now() / 1000) + 30 * 86400,
    };
    await ddb.send(new PutCommand({ TableName: ENV.members, Item: m }));
    await sendConfirmationsFor(m);
    return respond(200, { member: publicMember(m) });
}

async function sendConfirmationsFor(m) {
    const sent = [];
    if (m.email && m.emailStatus === "pending") { await sendEmailConfirmation(m); sent.push("email"); }
    if (m.phone && m.smsStatus === "pending" && smsEnabled()) {
        const code = newCode();
        await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId: m.memberId },
            UpdateExpression: "SET smsCodeHash = :h, smsCodeExp = :x, smsCodeTries = :z",
            ExpressionAttributeValues: { ":h": await hashCode(code, m.memberId), ":x": Math.floor(Date.now() / 1000) + 24 * 3600, ":z": 0 } }));
        const t = await signToken("manage", m.memberId, 24 * 3600);
        await sendSms(m.phone, `${ENV.orgName}: confirm your number for updates: ${ENV.siteOrigin}/manage.html?t=${t}&code=${code} (24h). Reply STOP to stop.`);
        sent.push("sms");
    }
    return sent;
}

async function updateMember(id, b, who) {
    const m = await getMember(id);
    if (!m) return respond(404, { error: "That person is no longer on the list." });
    const v = validateMemberInput(b);
    if (v.email && v.email !== m.email) { const o = await findByEmail(v.email); if (o && o.memberId !== id) throw new ValidationError("Someone else already has that email."); }
    if (v.phone && v.phone !== m.phone) { const o = await findByPhone(v.phone); if (o && o.memberId !== id) throw new ValidationError("Someone else already has that mobile number."); }
    const now = nowIso();
    const next = { ...m, ...v, updatedAt: now, updatedBy: who };
    // Saving through the editor settles the split permanently for this person.
    if (v.firstName || v.lastName) delete next.name;
    // A changed address is an unconfirmed address.
    if (v.email !== m.email) next.emailStatus = v.email ? "pending" : undefined;
    if (v.phone !== m.phone) { next.smsStatus = v.phone ? "pending" : undefined; delete next.smsCodeHash; delete next.smsCodeExp; delete next.smsCodeTries; }
    if (!v.email) delete next.email; if (!v.phone) delete next.phone;
    await ddb.send(new PutCommand({ TableName: ENV.members, Item: next }));
    const sent = await sendConfirmationsFor(next);
    return respond(200, { member: publicMember(next), confirmationsSent: sent });
}

async function deleteMember(id, who) {
    const m = await getMember(id);
    if (!m) return respond(404, { error: "That person is no longer on the list." });
    await ddb.send(new DeleteCommand({ TableName: ENV.members, Key: { memberId: id } }));
    console.log(JSON.stringify({ audit: "member-deleted", memberId: id, by: who }));
    return respond(200, { deleted: id });
}

async function boardUnsubscribe(id, who) {
    const m = await applyUnsubscribe(id, `board:${who}`, ["email", "sms"]);
    if (!m) return respond(404, { error: "That person is no longer on the list." });
    return respond(200, { member: publicMember(await getMember(id)) });
}

async function resendConfirmations(id) {
    const m = await getMember(id);
    if (!m) return respond(404, { error: "That person is no longer on the list." });
    const sent = await sendConfirmationsFor(m);
    return respond(200, { sent, message: sent.length ? `Confirmation sent by ${sent.join(" and ")}.` : "Nothing to confirm — both channels are already confirmed or absent." });
}

async function exportMembers() {
    // Resolve group ids to names: a CSV full of opaque ids helps nobody.
    const groups = Object.fromEntries((await allGroups()).map((g) => [g.groupId, g.name]));
    const rows = (await allMembers()).map(publicMember).map((m) => ({ ...m, groupName: m.groupId ? groups[m.groupId] || "(deleted group)" : "" }));
    const cols = ["firstName", "lastName", "name", "email", "phone", "method", "status", "emailStatus", "smsStatus", "area", "zip", "groupName", "interest", "createdAt", "confirmedAt", "unsubscribedAt", "unsubscribedVia", "notes"];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(","))).join("\r\n");
    return { statusCode: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store", "access-control-allow-origin": ENV.siteOrigin }, body: csv };
}

/* ================================================================== */
/* Board: Firewise groups                                                */
/* ================================================================== */

function validateGroup(b) {
    const status = str(b.status, "Status", 20, true);
    if (!GROUP_STATUSES.has(status)) throw new ValidationError("Status must be prospective, in progress, recognized, lapsed or inactive.");
    const out = {
        name: str(b.name, "Group name", LIMITS.groupName, true),
        status,
        area: str(b.area, "Area it covers", LIMITS.groupArea) || undefined,
        about: str(b.about, "About", LIMITS.groupAbout) || undefined,
        zips: (Array.isArray(b.zips) ? b.zips : String(b.zips || "").split(","))
            .map((z) => { const t = String(z).trim(); return t ? zip(t, false) : ""; }).filter(Boolean).slice(0, 20),
        households: b.households === "" || b.households == null ? undefined : Number(b.households),
        recognizedYear: b.recognizedYear === "" || b.recognizedYear == null ? undefined : Number(b.recognizedYear),
        renewalDue: b.renewalDue ? isoDate(b.renewalDue, "Renewal due") : undefined,
        website: str(b.website, "Website", 300) || undefined,
        notes: str(b.notes, "Notes", LIMITS.notes) || undefined,
        leaders: (Array.isArray(b.leaders) ? b.leaders : []).slice(0, 10).map((l, i) => {
            const firstName = str(l?.firstName, `Leader ${i + 1} first name`, LIMITS.firstName);
            const lastName = str(l?.lastName, `Leader ${i + 1} last name`, LIMITS.lastName);
            if (!firstName && !lastName) throw new ValidationError(`Leader ${i + 1} needs a name.`);
            return {
                firstName: firstName || undefined,
                lastName: lastName || undefined,
                name: [firstName, lastName].filter(Boolean).join(" "),
                role: str(l?.role, `Leader ${i + 1} role`, LIMITS.role) || undefined,
                email: l?.email ? email(l.email) : undefined,
                phone: l?.phone ? phone(l.phone) : undefined,
            };
        }),
    };
    if (out.website && !/^https:\/\/\S+$/.test(out.website)) throw new ValidationError("The website must start with https://");
    if (out.households !== undefined && (!Number.isInteger(out.households) || out.households < 0 || out.households > 100000)) {
        throw new ValidationError("Households must be a whole number.");
    }
    if (out.recognizedYear !== undefined && (!Number.isInteger(out.recognizedYear) || out.recognizedYear < 2000 || out.recognizedYear > 2100)) {
        throw new ValidationError("Recognized year must be a four-digit year.");
    }
    if (out.status === "recognized" && out.recognizedYear === undefined) {
        throw new ValidationError("A recognized group needs the year it was recognized.");
    }
    return out;
}

async function saveGroup(id, b, who) {
    const v = validateGroup(b);
    const now = nowIso();
    let existing = null;
    if (id) {
        if (!isId(id)) return respond(404, { error: "That group no longer exists." });
        existing = (await ddb.send(new GetCommand({ TableName: ENV.groups, Key: { groupId: id } }))).Item;
        if (!existing) return respond(404, { error: "That group no longer exists." });
    }
    const g = {
        groupId: id || newId(), ...v,
        createdAt: existing?.createdAt || now, createdBy: existing?.createdBy || who,
        updatedAt: now, updatedBy: who,
    };
    for (const k of Object.keys(g)) if (g[k] === undefined) delete g[k];
    await ddb.send(new PutCommand({ TableName: ENV.groups, Item: g }));
    return respond(200, { group: g });
}

/* Deleting a group would orphan the members who chose it, so the members
   are cleaned up first — the group reference goes, the person stays. */
async function deleteGroup(id) {
    if (!isId(id)) return respond(404, { error: "That group no longer exists." });
    const g = (await ddb.send(new GetCommand({ TableName: ENV.groups, Key: { groupId: id } }))).Item;
    if (!g) return respond(404, { error: "That group no longer exists." });
    const affected = (await allMembers()).filter((m) => m.groupId === id);
    for (const m of affected) {
        await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId: m.memberId },
            UpdateExpression: "REMOVE groupId SET updatedAt = :now", ExpressionAttributeValues: { ":now": nowIso() } }));
    }
    await ddb.send(new DeleteCommand({ TableName: ENV.groups, Key: { groupId: id } }));
    return respond(200, { deleted: id, membersUpdated: affected.length });
}

/* ================================================================== */
/* Board: Alliance board members                                         */
/* ================================================================== */

/* Which Cognito accounts can actually sign in, so the board list can show
   who has website access and who does not. Read-only; adding and removing
   logins stays a deliberate command-line act. */
async function boardLogins() {
    if (!ENV.userPoolId) return [];
    try {
        const { CognitoIdentityProviderClient, ListUsersInGroupCommand } = await import("@aws-sdk/client-cognito-identity-provider");
        const c = new CognitoIdentityProviderClient({});
        const r = await c.send(new ListUsersInGroupCommand({ UserPoolId: ENV.userPoolId, GroupName: "board", Limit: 60 }));
        return (r.Users || []).map((u) => (u.Attributes || []).find((a) => a.Name === "email")?.Value).filter(Boolean).map((e) => e.toLowerCase());
    } catch (e) {
        console.error("could not list logins:", e.message);
        return [];
    }
}

function validatePerson(b) {
    const status = str(b.status, "Status", 20, true);
    if (!BOARD_STATUSES.has(status)) throw new ValidationError("Status must be current or past.");
    // First and last name, the same as a member. A board member is a person on
    // the same list of people; there is no reason for their name to be shaped
    // differently. Older records hold one "name" and are split on read.
    const firstName = str(b.firstName, "First name", LIMITS.firstName);
    const lastName = str(b.lastName, "Last name", LIMITS.lastName);
    if (!firstName && !lastName) throw new ValidationError("A board member needs a name.");
    const out = {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        name: [firstName, lastName].filter(Boolean).join(" "),
        role: str(b.role, "Role", LIMITS.role) || undefined,
        status,
        email: b.email ? email(b.email) : undefined,
        phone: b.phone ? phone(b.phone) : undefined,
        groupId: (function () { const g = str(b.groupId, "Firewise group", 40); return g && isId(g) ? g : undefined; })(),
        termStart: b.termStart ? isoDate(b.termStart, "Term start") : undefined,
        termEnd: b.termEnd ? isoDate(b.termEnd, "Term end") : undefined,
        notes: str(b.notes, "Notes", LIMITS.notes) || undefined,
    };
    if (out.termStart && out.termEnd && Date.parse(out.termEnd) <= Date.parse(out.termStart)) {
        throw new ValidationError("Term end must be after term start.");
    }
    if (out.status === "past" && !out.termEnd) throw new ValidationError("A past board member needs a term end date.");
    return out;
}

async function savePerson(id, b, who) {
    const v = validatePerson(b);
    const now = nowIso();
    let existing = null;
    if (id) {
        if (!isId(id)) return respond(404, { error: "That person is no longer on the board list." });
        existing = (await ddb.send(new GetCommand({ TableName: ENV.board, Key: { personId: id } }))).Item;
        if (!existing) return respond(404, { error: "That person is no longer on the board list." });
    }
    const p = {
        personId: id || newId(), ...v,
        createdAt: existing?.createdAt || now, createdBy: existing?.createdBy || who,
        updatedAt: now, updatedBy: who,
    };
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    await ddb.send(new PutCommand({ TableName: ENV.board, Item: p }));
    return respond(200, { person: p });
}

/* Removing a board record does not touch their website login — those are
   separate on purpose, and revoking access is a Cognito action. The
   response says so, so nobody assumes deleting here locked someone out. */
async function deletePerson(id) {
    if (!isId(id)) return respond(404, { error: "That person is no longer on the board list." });
    const p = (await ddb.send(new GetCommand({ TableName: ENV.board, Key: { personId: id } }))).Item;
    if (!p) return respond(404, { error: "That person is no longer on the board list." });
    await ddb.send(new DeleteCommand({ TableName: ENV.board, Key: { personId: id } }));
    const logins = await boardLogins();
    const stillHasLogin = p.email && logins.includes(p.email);
    return respond(200, { deleted: id, stillHasLogin,
        message: stillHasLogin
            ? "Removed from the board list. They can still sign in to edit the site — removing that is a separate step."
            : "Removed from the board list." });
}

/* ================================================================== */
/* Board: communications                                                 */
/* ================================================================== */

async function allComms() {
    const out = [];
    let ExclusiveStartKey;
    do {
        const page = await ddb.send(new ScanCommand({ TableName: ENV.comms, ExclusiveStartKey }));
        out.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out.sort((a, b) => (a.commId < b.commId ? 1 : -1));
}

async function getComm(id) {
    if (!isId(id)) return null;
    const r = await ddb.send(new GetCommand({ TableName: ENV.comms, Key: { commId: id } }));
    return r.Item || null;
}

function validateCommInput(b) {
    const audience = str(b.audience, "Audience", 10, true);
    if (!AUDIENCES.has(audience)) throw new ValidationError("Audience must be everyone, email only, or text only.");
    const wantEmail = audience !== "sms", wantSms = audience !== "email";
    if (wantSms && !smsEnabled()) throw new ValidationError("Text messaging isn't switched on yet. Choose 'email only'.");
    const out = {
        name: str(b.name, "Name", LIMITS.commName, true),
        audience,
        emailSubject: wantEmail ? str(b.emailSubject, "Email subject", LIMITS.subject, true) : undefined,
        emailBody: wantEmail ? str(b.emailBody, "Email text", LIMITS.emailBody, true) : undefined,
        smsBody: wantSms ? str(b.smsBody, "Text message", LIMITS.smsBody, true) : undefined,
        sendAt: b.sendAt ? isoDate(b.sendAt, "Send when") : undefined,
    };
    if (out.smsBody) {
        const seg = smsSegments(renderSms({ smsBody: out.smsBody }));
        if (seg.segments > LIMITS.smsMaxSegments) throw new ValidationError(`That text would send as ${seg.segments} messages. Keep it under ${LIMITS.smsMaxSegments}.`);
    }
    if (out.sendAt && Date.parse(out.sendAt) < Date.now() - 60000) throw new ValidationError("'Send when' is in the past.");
    if (wantSms && !withinTextingHours(out.sendAt ? new Date(out.sendAt) : new Date())) {
        throw new ValidationError("Texts can only go out between 8am and 9pm Central. Pick a time in that window.");
    }
    return out;
}

async function createComm(b, who) {
    const v = validateCommInput(b);
    const now = nowIso();
    const c = { commId: newId(), ...v, status: "draft", author: who, createdAt: now, updatedAt: now, updatedBy: who, history: [{ at: now, by: who, event: "created" }] };
    await ddb.send(new PutCommand({ TableName: ENV.comms, Item: c }));
    return respond(200, { comm: c });
}

async function updateComm(id, b, who) {
    const c = await getComm(id);
    if (!c) return respond(404, { error: "That message no longer exists." });
    if (!["draft", "rejected"].includes(c.status)) throw new ValidationError("Only a draft can be edited. Withdraw it from review first.");
    const v = validateCommInput(b);
    const now = nowIso();
    const next = { ...c, ...v, status: "draft", updatedAt: now, updatedBy: who, history: [...(c.history || []), { at: now, by: who, event: "edited" }] };
    for (const k of ["emailSubject", "emailBody", "smsBody", "sendAt"]) if (v[k] === undefined) delete next[k];
    await ddb.send(new PutCommand({ TableName: ENV.comms, Item: next }));
    return respond(200, { comm: next });
}

async function deleteComm(id) {
    const c = await getComm(id);
    if (!c) return respond(404, { error: "That message no longer exists." });
    if (!["draft", "rejected"].includes(c.status)) throw new ValidationError("Sent and in-review messages are kept as a record and cannot be deleted.");
    await ddb.send(new DeleteCommand({ TableName: ENV.comms, Key: { commId: id } }));
    return respond(200, { deleted: id });
}

async function duplicateComm(id, who) {
    const c = await getComm(id);
    if (!c) return respond(404, { error: "That message no longer exists." });
    const now = nowIso();
    const copy = { commId: newId(), name: `Copy of ${c.name}`.slice(0, LIMITS.commName), audience: c.audience,
        emailSubject: c.emailSubject, emailBody: c.emailBody, smsBody: c.smsBody,
        status: "draft", author: who, createdAt: now, updatedAt: now, updatedBy: who, history: [{ at: now, by: who, event: `duplicated from ${c.commId}` }] };
    await ddb.send(new PutCommand({ TableName: ENV.comms, Item: copy }));
    return respond(200, { comm: copy });
}

async function getCommWithCounts(id) {
    const c = await getComm(id);
    if (!c) return respond(404, { error: "That message no longer exists." });
    const aud = audienceFor(await allMembers(), c.audience);
    const counts = { email: aud.filter((a) => a.channel === "email").length, sms: aud.filter((a) => a.channel === "sms").length };
    const preview = {
        emailHtml: c.emailBody ? markdownToHtml(c.emailBody) : "",
        sms: c.smsBody ? renderSms(c) : "",
        smsSegments: c.smsBody ? smsSegments(renderSms(c)) : null,
        footer: { orgName: ENV.orgName, postalAddress: ENV.postalAddress, repliesRead: Boolean(ENV.replyTo) },
    };
    return respond(200, { comm: c, audienceCounts: counts, preview });
}

/* The state machine. Every transition records who and when, and the one
   rule people would otherwise be trusted to remember is checked here: the
   author cannot approve their own message. */
async function transition(id, who, action, b) {
    const c = await getComm(id);
    if (!c) return respond(404, { error: "That message no longer exists." });
    const now = nowIso();
    const note = str(b?.note, "Note", 500);
    let next;

    if (action === "submit") {
        if (!["draft", "rejected"].includes(c.status)) throw new ValidationError("Only a draft can be submitted.");
        if (!ENV.postalAddress) throw new ValidationError("The organisation's postal address is not configured. Email cannot be sent without it.");
        validateCommInput(c);   // re-check quiet hours and sms availability at submit time
        next = { ...c, status: "review", submittedAt: now, submittedBy: who, approver: undefined, approvedAt: undefined, decisionNote: undefined };
    } else if (action === "withdraw") {
        if (c.status !== "review") throw new ValidationError("Only a message waiting for review can be withdrawn.");
        next = { ...c, status: "draft" };
    } else if (action === "approve") {
        if (c.status !== "review") throw new ValidationError("This message is not waiting for review.");
        if (who === c.author || who === c.submittedBy) {
            throw new ValidationError("You wrote this message, so someone else on the board has to approve it.");
        }
        validateCommInput(c);
        next = { ...c, status: "approved", approver: who, approvedAt: now, decisionNote: note || undefined };
    } else if (action === "reject") {
        if (c.status !== "review") throw new ValidationError("This message is not waiting for review.");
        if (!note) throw new ValidationError("Say what needs to change, so the author knows.");
        next = { ...c, status: "rejected", approver: who, decisionNote: note };
    } else {
        throw new ValidationError("Unknown action.");
    }
    next.updatedAt = now; next.updatedBy = who;
    next.history = [...(c.history || []), { at: now, by: who, event: action, note: note || undefined }];
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await ddb.send(new PutCommand({ TableName: ENV.comms, Item: next }));
    return respond(200, { comm: next });
}

/* A test goes to the requesting board member only: their sign-in email
   always, and their own confirmed mobile if they are on the list. Never to
   anyone else, whatever the audience says. */
async function testSend(id, who) {
    const c = await getComm(id);
    if (!c) return respond(404, { error: "That message no longer exists." });
    if (c.status === "sent" || c.status === "sending") throw new ValidationError("This message has already been sent.");
    const me = await findByEmail(who);
    const fake = { memberId: me?.memberId || newId(), email: who, name: me?.name || "Board member" };
    const sent = [];
    if (c.emailBody) {
        const r = await renderEmail({ ...c, emailBody: c.emailBody }, fake);
        await sendEmail({ to: who, subject: `[TEST] ${c.emailSubject}`, html: r.html, text: r.text, unsubUrl: r.unsubUrl, unsubApi: r.unsubApi, tags: [{ Name: "kind", Value: "test" }] });
        sent.push(`email to ${who}`);
    }
    if (c.smsBody) {
        if (!me?.phone || me.smsStatus !== "confirmed") {
            throw new ValidationError("To test the text message, add yourself as a member with your mobile number and confirm it first." + (sent.length ? " (The email test was sent.)" : ""));
        }
        await sendSms(me.phone, `[TEST] ${renderSms(c)}`);
        sent.push(`text to …${me.phone.slice(-4)}`);
    }
    const now = nowIso();
    await ddb.send(new UpdateCommand({ TableName: ENV.comms, Key: { commId: id },
        UpdateExpression: "SET history = list_append(if_not_exists(history, :empty), :h), updatedAt = :now",
        ExpressionAttributeValues: { ":h": [{ at: now, by: who, event: "test", note: sent.join("; ") }], ":empty": [], ":now": now } }));
    return respond(200, { sent, message: `Test sent: ${sent.join("; ")}.` });
}

/* Broadcasting hands the job to the queue and returns. The sender function
   works through recipients at the channel's rate and writes the log. */
async function broadcast(id, who) {
    const c = await getComm(id);
    if (!c) return respond(404, { error: "That message no longer exists." });
    if (c.status !== "approved") throw new ValidationError("Only an approved message can be sent.");
    if (who !== c.author && who !== c.approver) throw new ValidationError("Only the author or the approver can send this message.");
    if (!ENV.postalAddress) throw new ValidationError("The organisation's postal address is not configured. Email cannot be sent without it.");
    const now = nowIso();
    const future = c.sendAt && Date.parse(c.sendAt) > Date.now() + 60000;
    const status = future ? "scheduled" : "sending";
    await ddb.send(new UpdateCommand({ TableName: ENV.comms, Key: { commId: id },
        ConditionExpression: "#s = :approved",
        UpdateExpression: "SET #s = :st, sendRequestedAt = :now, sendRequestedBy = :who, updatedAt = :now, history = list_append(if_not_exists(history, :empty), :h)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":approved": "approved", ":st": status, ":now": now, ":who": who, ":empty": [], ":h": [{ at: now, by: who, event: future ? "scheduled" : "send" }] } }));
    if (!future) await sqs.send(new SendMessageCommand({ QueueUrl: ENV.queueUrl, MessageBody: JSON.stringify({ commId: id }) }));
    return respond(200, { status, message: future ? `Scheduled for ${c.sendAt}.` : "Sending has started. The log below fills in as messages go out." });
}

async function deliveries(id) {
    if (!isId(id)) return respond(404, { error: "Unknown message." });
    const out = [];
    let ExclusiveStartKey;
    do {
        const page = await ddb.send(new QueryCommand({ TableName: ENV.deliveries, KeyConditionExpression: "commId = :c", ExpressionAttributeValues: { ":c": id }, ExclusiveStartKey }));
        out.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const totals = {};
    for (const d of out) totals[d.status] = (totals[d.status] || 0) + 1;
    return respond(200, { deliveries: out, totals });
}
