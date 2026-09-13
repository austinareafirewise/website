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

export async function sendSms(to, body) {
    if (!smsEnabled()) throw new Error("Text messaging is not switched on yet.");
    return ENV.smsProvider === "twilio" ? sendTwilio(to, body) : sendAws(to, body);
}

/* ---------------- AWS ---------------- */

let aws = null;
async function sendAws(to, body) {
    aws = aws || new PinpointSMSVoiceV2Client({});
    const r = await aws.send(new SendTextMessageCommand({
        DestinationPhoneNumber: to,
        OriginationIdentity: ENV.smsOrigination,
        MessageBody: body,
        MessageType: "TRANSACTIONAL",
    }));
    return { providerId: r.MessageId };
}

/* ---------------- Twilio ---------------- */

async function sendTwilio(to, body) {
    const t = await twilioConfig();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`;
    const form = new URLSearchParams({ To: to, From: t.from, Body: body });
    if (t.statusCallback) form.set("StatusCallback", t.statusCallback);
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": "Basic " + Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${j.message || "send failed"}`);
    return { providerId: j.sid };
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
