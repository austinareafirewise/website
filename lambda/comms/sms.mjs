/* Text-message sending behind one interface, with two providers.
 *
 *   aws     — AWS End User Messaging SMS (Pinpoint SMS v2). Primary. Needs a
 *             verified toll-free number in SMS_ORIGINATION. STOP/START come
 *             back through SNS to the events function.
 *   twilio  — Secondary. Credentials in an SSM SecureString the organisation
 *             creates; never in code or the template. STOP/START and delivery
 *             status come back through the /hooks/twilio webhook.
 *   off     — Default until a number exists. Sending throws a clear error and
 *             the API refuses to accept text audiences.
 *
 * Both providers return { providerId } for the delivery log.
 */

import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { ENV, twilioConfig } from "./lib.mjs";

export function smsEnabled() {
    return ENV.smsProvider === "aws" ? Boolean(ENV.smsOrigination)
         : ENV.smsProvider === "twilio" ? Boolean(ENV.twilioParam)
         : false;
}

export function smsProviderName() { return ENV.smsProvider; }

/* kind: "transactional" for a confirmation code someone is waiting for,
   "promotional" for a board broadcast. This is a declaration to the
   carriers about what the message is, not a routing preference — telling
   them a newsletter is transactional to get better handling is the kind of
   misdeclaration that costs a sender its number. It also matches what we
   told SES about the email side. */
export async function sendSms(to, body, kind) {
    if (!smsEnabled()) throw new Error("Text messaging is not switched on yet.");
    const messageType = kind === "promotional" ? "PROMOTIONAL" : "TRANSACTIONAL";
    return ENV.smsProvider === "twilio" ? sendTwilio(to, body) : sendAws(to, body, messageType);
}

/* ---------------- AWS ---------------- */

let aws = null;
async function sendAws(to, body, messageType) {
    aws = aws || new PinpointSMSVoiceV2Client({});
    const r = await aws.send(new SendTextMessageCommand({
        DestinationPhoneNumber: to,
        OriginationIdentity: ENV.smsOrigination,
        MessageBody: body,
        MessageType: messageType || "TRANSACTIONAL",
    }));
    return { providerId: r.MessageId };
}

/* ---------------- Twilio ---------------- */

async function sendTwilio(to, body) {
    const t = await twilioConfig();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`;
    const form = new URLSearchParams({ To: to, Body: body });

    // A Messaging Service is Twilio's preferred sender: it carries the 10DLC
    // campaign registration, handles STOP/START/HELP itself, and can hold
    // several numbers. Fall back to a bare From number when none is given.
    if (t.messagingServiceSid) form.set("MessagingServiceSid", t.messagingServiceSid);
    else form.set("From", t.from);

    if (t.statusCallback) form.set("StatusCallback", t.statusCallback);

    // An API key can be revoked on its own; the account auth token cannot be
    // revoked without breaking everything that uses it. Prefer a key for
    // sending when one is supplied. The auth token is still needed for
    // webhook signature checking, which Twilio always signs with it.
    const user = t.keySid || t.accountSid;
    const pass = t.keySid ? t.keySecret : t.authToken;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${j.message || "send failed"}`);

    /* Twilio accepts a message and then fails it asynchronously, so a 201
       here does not mean anyone received anything. The failure that matters
       most is 30034 — the number is not attached to an approved A2P 10DLC
       campaign — because the caller would otherwise tell someone to "enter
       the code we texted you" when the carrier had already rejected it.
       Silent is worse than late, so surface it. */
    if (j.status === "failed" || j.status === "undelivered" || j.error_code) {
        throw new Error(`Twilio could not deliver the message (${j.error_code || j.status}).`);
    }
    return { providerId: j.sid, status: j.status };
}

/* Inbound keyword handling is shared: both providers deliver the sender's
   number and the message text, by different roads. */
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START = new Set(["START", "YES", "UNSTOP"]);

export function classifyKeyword(text) {
    const w = String(text || "").trim().toUpperCase().split(/\s+/)[0] || "";
    if (STOP.has(w)) return "stop";
    if (START.has(w)) return "start";
    if (w === "HELP") return "help";
    return null;
}
