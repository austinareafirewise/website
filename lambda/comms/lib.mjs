/* Shared pieces for the members-and-communications functions: storage
 * clients, signed tokens, validation, the email renderer, and configuration.
 *
 * No third-party packages. Everything imported ships in the Lambda runtime.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
    QueryCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});
export { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand };

export const ENV = {
    members: process.env.MEMBERS_TABLE,
    comms: process.env.COMMS_TABLE,
    deliveries: process.env.DELIVERIES_TABLE,
    ratelimit: process.env.RATELIMIT_TABLE,
    siteOrigin: process.env.SITE_ORIGIN,
    apiUrl: (process.env.API_URL || "").replace(/\/$/, ""),
    orgName: process.env.ORG_NAME || "Austin Area Firewise Alliance",
    postalAddress: process.env.POSTAL_ADDRESS || "",
    fromAddress: process.env.FROM_ADDRESS,
    replyTo: process.env.REPLY_TO || "",
    sesConfigSet: process.env.SES_CONFIG_SET,
    signingSecretArn: process.env.SIGNING_SECRET_ARN,
    smsProvider: (process.env.SMS_PROVIDER || "off").toLowerCase(),   // off | aws | twilio
    smsOrigination: process.env.SMS_ORIGINATION || "",
    twilioParam: process.env.TWILIO_PARAM || "",
    queueUrl: process.env.SEND_QUEUE_URL,
};

/* ------------------------------------------------------------------ */
/* Limits, enforced here and mirrored in the admin page.               */
/* ------------------------------------------------------------------ */

export const LIMITS = {
    name: 120, area: 120, notes: 1000,
    commName: 120, subject: 150, emailBody: 20000, smsBody: 480,
    smsSegmentChars: 160, smsMaxSegments: 3,
};

export const INTERESTS = new Set(["updates", "firewise", "presentation", "evacuation", "volunteer", "other"]);
export const METHODS = new Set(["email", "sms", "both"]);
export const AUDIENCES = new Set(["all", "email", "sms"]);

/* Consent wording shown beside the signup button. Stored verbatim with each
   record so the organisation can show exactly what a person agreed to. If
   this text changes, the version bumps and old records keep the old text. */
export const CONSENT = {
    version: 1,
    text: "By signing up you agree to receive occasional messages from the Austin Area " +
        "Firewise Alliance about wildfire preparedness and Alliance activities. Message " +
        "frequency varies. Message and data rates may apply. Reply STOP to any text to stop, " +
        "HELP for help. Unsubscribe from email with the link in any message.",
};

/* ------------------------------------------------------------------ */
/* Errors and responses                                                */
/* ------------------------------------------------------------------ */

export class ValidationError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

export function respond(statusCode, body, extraHeaders) {
    return {
        statusCode,
        headers: Object.assign({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        }, ENV.siteOrigin ? { "access-control-allow-origin": ENV.siteOrigin } : {}, extraHeaders || {}),
        body: JSON.stringify(body),
    };
}

export function redirect(location) {
    return { statusCode: 302, headers: { location, "cache-control": "no-store" }, body: "" };
}

export function parseBody(event) {
    if (!event.body) return {};
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    const ct = (event.headers?.["content-type"] || "").toLowerCase();
    if (ct.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(raw));
    }
    try { return JSON.parse(raw); } catch { throw new ValidationError("The request was not valid JSON."); }
}

export function clientIp(event) {
    return event.requestContext?.http?.sourceIp || "0.0.0.0";
}

export function editor(event) {
    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    const raw = claims["cognito:groups"];
    const groups = Array.isArray(raw) ? raw
        : String(raw || "").replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
    if (!groups.includes("board")) return null;
    return (claims.email || claims["cognito:username"] || "unknown").toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

// Control characters other than tab and newline, built without escape
// sequences in the source (see the CMS function for why).
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) +
    String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) + "-" +
    String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");

export function str(v, label, max, required = false) {
    if (v == null) v = "";
    if (typeof v !== "string") throw new ValidationError(`${label} must be text.`);
    v = v.replace(CONTROL, "").trim();
    if (required && !v) throw new ValidationError(`${label} is required.`);
    if (v.length > max) throw new ValidationError(`${label} is too long (limit ${max} characters).`);
    return v;
}

export function email(v, required) {
    v = str(v, "Email", 254, required).toLowerCase();
    if (!v) return "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw new ValidationError("That email address doesn't look right.");
    return v;
}

/* US numbers only for now, normalised to E.164. Accepts the ways people
   actually type them: (512) 555-1234, 512.555.1234, +1 512 555 1234. */
export function phone(v, required) {
    v = str(v, "Mobile number", 30, required);
    if (!v) return "";
    const digits = v.replace(/\D/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length !== 10 || /^[01]/.test(ten) || /^[01]/.test(ten.slice(3))) {
        throw new ValidationError("That mobile number doesn't look like a US number.");
    }
    return "+1" + ten;
}

export function isoDate(v, label) {
    if (typeof v !== "string" || Number.isNaN(Date.parse(v)) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([+-]\d{2}:\d{2}|Z)$/.test(v)) {
        throw new ValidationError(`${label} needs a valid date and time.`);
    }
    return new Date(v).toISOString();
}

export function isId(id) { return typeof id === "string" && /^[0-9a-z]{16,32}$/.test(id); }

export function newId() {
    return Date.now().toString(36).padStart(9, "0") + randomBytes(9).toString("hex").slice(0, 14);
}

export function nowIso() { return new Date().toISOString(); }

/* Hour of day in Central time, for the texting quiet-hours rule. */
export function centralHour(date) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false })
        .formatToParts(date);
    return Number(parts.find((p) => p.type === "hour").value) % 24;
}
export function withinTextingHours(date) { const h = centralHour(date); return h >= 8 && h < 21; }

/* SMS segment count. GSM-7 alphabet fits 160 per single segment, 153 each
   when concatenated; anything outside it (curly quotes, emoji) forces UCS-2
   at 70 / 67. Shown to the editor so a two-segment message is a choice. */
const GSM7 = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/;
export function smsSegments(text) {
    const s = String(text || "");
    if (!s) return { chars: 0, segments: 0, encoding: "GSM-7" };
    const gsm = GSM7.test(s);
    const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    const chars = s.length;
    const segments = chars <= single ? 1 : Math.ceil(chars / multi);
    return { chars, segments, encoding: gsm ? "GSM-7" : "UCS-2" };
}

/* ------------------------------------------------------------------ */
/* Rate limiting: a counter per key per window, in DynamoDB, with TTL.  */
/* ------------------------------------------------------------------ */

export async function rateLimit(key, limit, windowSeconds) {
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const pk = `${key}#${window}`;
    const res = await ddb.send(new UpdateCommand({
        TableName: ENV.ratelimit,
        Key: { pk },
        UpdateExpression: "ADD #c :one SET #ttl = if_not_exists(#ttl, :ttl)",
        ExpressionAttributeNames: { "#c": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":ttl": (window + 2) * windowSeconds },
        ReturnValues: "UPDATED_NEW",
    }));
    if ((res.Attributes?.count || 0) > limit) {
        throw new ValidationError("Too many attempts. Please wait a few minutes and try again.", 429);
    }
}

/* ------------------------------------------------------------------ */
/* Signed tokens and codes                                             */
/* ------------------------------------------------------------------ */

let signingKey = null;
export async function key() {
    if (signingKey) return signingKey;
    const sm = new SecretsManagerClient({});
    const res = await sm.send(new GetSecretValueCommand({ SecretId: ENV.signingSecretArn }));
    signingKey = Buffer.from(res.SecretString, "utf8");
    return signingKey;
}

const b64u = (b) => Buffer.from(b).toString("base64url");

/* token = base64url(purpose.memberId.expiresEpoch).signature */
export async function signToken(purpose, memberId, ttlSeconds) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${purpose}.${memberId}.${exp}`;
    const sig = createHmac("sha256", await key()).update(payload).digest("base64url");
    return `${b64u(payload)}.${sig}`;
}

export async function verifyToken(token, purpose) {
    if (typeof token !== "string" || token.length > 300) return null;
    const [p, sig] = token.split(".");
    if (!p || !sig) return null;
    let payload;
    try { payload = Buffer.from(p, "base64url").toString("utf8"); } catch { return null; }
    const expected = createHmac("sha256", await key()).update(payload).digest("base64url");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [pur, memberId, exp] = payload.split(".");
    if (pur !== purpose || !isId(memberId) || Number(exp) < Math.floor(Date.now() / 1000)) return null;
    return memberId;
}

export function newCode() { return String(randomInt(100000, 1000000)); }
export async function hashCode(code, memberId) {
    return createHmac("sha256", await key()).update(`${memberId}:${code}`).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

export async function getMember(id) {
    if (!isId(id)) return null;
    const r = await ddb.send(new GetCommand({ TableName: ENV.members, Key: { memberId: id } }));
    return r.Item || null;
}

export async function findByEmail(e) {
    if (!e) return null;
    const r = await ddb.send(new QueryCommand({
        TableName: ENV.members, IndexName: "email-index",
        KeyConditionExpression: "email = :e", ExpressionAttributeValues: { ":e": e }, Limit: 1,
    }));
    return r.Items?.[0] || null;
}

export async function findByPhone(p) {
    if (!p) return null;
    const r = await ddb.send(new QueryCommand({
        TableName: ENV.members, IndexName: "phone-index",
        KeyConditionExpression: "phone = :p", ExpressionAttributeValues: { ":p": p }, Limit: 1,
    }));
    return r.Items?.[0] || null;
}

export async function allMembers() {
    const out = [];
    let ExclusiveStartKey;
    do {
        const page = await ddb.send(new ScanCommand({ TableName: ENV.members, ExclusiveStartKey }));
        out.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
}

/* Overall status derived from the two channels. A person is "confirmed" if
   any channel is; "unsubscribed" only if they asked to stop everything. */
export function deriveStatus(m) {
    if (m.unsubscribedAt && !m.emailStatus?.startsWith("confirmed") && !m.smsStatus?.startsWith("confirmed")) return "unsubscribed";
    if (m.emailStatus === "confirmed" || m.smsStatus === "confirmed") return "confirmed";
    if (m.emailStatus === "bounced" || m.smsStatus === "bounced") return "bounced";
    return "pending";
}

/* What the admin page and the sender may see; the confirmation code hash
   and similar internals never leave the function. */
export function publicMember(m) {
    const { smsCodeHash, smsCodeExp, smsCodeTries, ...rest } = m;
    return { ...rest, status: deriveStatus(m) };
}

/* Who gets a given communication. Excludes anything not positively
   confirmed on that channel — pending, bounced, unsubscribed — by the query,
   not by anyone remembering. */
export function audienceFor(members, audience) {
    const wantEmail = audience === "all" || audience === "email";
    const wantSms = audience === "all" || audience === "sms";
    const out = [];
    for (const m of members) {
        if (wantEmail && m.email && m.emailStatus === "confirmed") out.push({ member: m, channel: "email", to: m.email });
        if (wantSms && m.phone && m.smsStatus === "confirmed") out.push({ member: m, channel: "sms", to: m.phone });
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Email rendering                                                     */
/* ------------------------------------------------------------------ */

export function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineHtml(text) {
    // **bold**, *italic*, [label](https://…); everything else escaped text.
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(text)) !== null) {
        out += escapeHtml(text.slice(last, m.index));
        if (m[1] != null) out += `<strong>${escapeHtml(m[1])}</strong>`;
        else if (m[2] != null) out += `<em>${escapeHtml(m[2])}</em>`;
        else out += `<a href="${escapeHtml(m[4])}">${escapeHtml(m[3])}</a>`;
        last = re.lastIndex;
    }
    return out + escapeHtml(text.slice(last));
}

/* The same restricted Markdown subset the site renders, producing escaped
   HTML for email. Raw HTML in the source shows as literal characters. */
export function markdownToHtml(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    let html = "", i = 0;
    const isBlock = (l) => /^(#{2,3})\s+/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) || /^\s*>\s?/.test(l);
    while (i < lines.length) {
        const line = lines[i];
        const h = /^(#{2,3})\s+(.*)$/.exec(line);
        if (h) { html += `<h${h[1].length}>${inlineHtml(h[2].trim())}</h${h[1].length}>`; i++; continue; }
        if (/^\s*[-*]\s+/.test(line)) {
            html += "<ul>";
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { html += `<li>${inlineHtml(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`; i++; }
            html += "</ul>"; continue;
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
            html += "<ol>";
            while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { html += `<li>${inlineHtml(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`; i++; }
            html += "</ol>"; continue;
        }
        if (/^\s*>\s?/.test(line)) {
            const q = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
            html += `<blockquote><p>${inlineHtml(q.join(" ").trim())}</p></blockquote>`; continue;
        }
        if (line.trim() === "") { i++; continue; }
        const buf = [];
        while (i < lines.length && lines[i].trim() !== "" && !isBlock(lines[i])) { buf.push(lines[i]); i++; }
        html += `<p>${inlineHtml(buf.join(" ").trim())}</p>`;
    }
    return html;
}

/* Plain-text twin of the Markdown, for the text/plain part and previews. */
export function markdownToText(text) {
    return String(text || "").replace(/\r\n?/g, "\n")
        .replace(/^#{2,3}\s+/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1")
        .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, "$1 ($2)").replace(/^\s*>\s?/gm, "");
}

/* The whole email for one recipient: their own unsubscribe and manage
   links, the postal address CAN-SPAM requires, and a note that replies are
   not read if no reply-to mailbox exists. Returns {html, text}. */
export async function renderEmail(comm, member) {
    const unsub = await signToken("unsubscribe", member.memberId, 90 * 86400);
    const manage = await signToken("manage", member.memberId, 90 * 86400);
    const unsubUrl = `${ENV.siteOrigin}/manage.html?u=${unsub}`;
    const unsubApi = `${ENV.apiUrl}/unsubscribe?t=${unsub}`;   // for the List-Unsubscribe header
    const manageUrl = `${ENV.siteOrigin}/manage.html?t=${manage}`;
    const bodyHtml = markdownToHtml(comm.emailBody);
    const bodyText = markdownToText(comm.emailBody);
    const replies = ENV.replyTo ? "" : " This mailbox is not monitored; please do not reply to this message.";

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:Helvetica,Arial,sans-serif;color:#1d2a21;">
<div style="max-width:620px;margin:0 auto;padding:24px 20px;">
<div style="background:#fff;border:1px solid #e2e0d8;border-radius:10px;padding:26px;font-size:16px;line-height:1.55;">
<p style="margin:0 0 18px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#4c784b;font-weight:bold;">${escapeHtml(ENV.orgName)}</p>
${bodyHtml}
</div>
<p style="font-size:12px;color:#556;line-height:1.5;margin:18px 4px 0;">
You are receiving this because you signed up for updates from the ${escapeHtml(ENV.orgName)}.${escapeHtml(replies)}<br>
<a href="${unsubUrl}" style="color:#265438;">Unsubscribe</a> &nbsp;·&nbsp; <a href="${manageUrl}" style="color:#265438;">Change how we contact you</a><br>
${escapeHtml(ENV.orgName)}, ${escapeHtml(ENV.postalAddress)}
</p></div></body></html>`;

    const text = `${bodyText}

--
You are receiving this because you signed up for updates from the ${ENV.orgName}.${replies}
Unsubscribe: ${unsubUrl}
Change how we contact you: ${manageUrl}
${ENV.orgName}, ${ENV.postalAddress}
`;
    return { html, text, unsubUrl, unsubApi };
}

/* The text message: the body plus the opt-out line carriers require. */
export function renderSms(comm) {
    const body = String(comm.smsBody || "").trim();
    return `${body}\nReply STOP to stop`;
}

/* ------------------------------------------------------------------ */
/* Twilio credentials, if that provider is selected                    */
/* ------------------------------------------------------------------ */

let twilio = null;
export async function twilioConfig() {
    if (twilio) return twilio;
    if (!ENV.twilioParam) throw new Error("Twilio is selected but TWILIO_PARAM is not set.");
    const ssm = new SSMClient({});
    const r = await ssm.send(new GetParameterCommand({ Name: ENV.twilioParam, WithDecryption: true }));
    twilio = JSON.parse(r.Parameter.Value);   // { accountSid, authToken, from }
    if (!twilio.accountSid || !twilio.authToken || !twilio.from) throw new Error("Twilio parameter is incomplete.");
    return twilio;
}

export function sha1Base64Hmac(keyStr, data) {
    return createHmac("sha1", keyStr).update(data).digest("base64");
}

export function sha256Hex(s) { return createHash("sha256").update(s).digest("hex"); }
