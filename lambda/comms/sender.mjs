/* The sender. Fed by the queue, one communication per message.
 *
 * Works through every confirmed recipient for the audience, sends, and
 * writes one delivery row per person per channel. The row is written with a
 * condition that it does not already exist, so if this function is retried
 * — a timeout, a throttle, a crash halfway — nobody receives the message
 * twice. That is the property that matters most in here.
 */

import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
    ddb, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ENV,
    allMembers, audienceFor, renderEmail, renderSms, nowIso, withinTextingHours,
} from "./lib.mjs";
import { sendEmail } from "./email.mjs";
import { sendSms, smsEnabled } from "./sms.mjs";

const sqs = new SQSClient({});

export const handler = async (event) => {
    for (const record of event.Records || []) {
        const { commId } = JSON.parse(record.body);
        await sendOne(commId);
    }
};

async function sendOne(commId) {
    const c = (await ddb.send(new GetCommand({ TableName: ENV.comms, Key: { commId } }))).Item;
    if (!c) { console.error("comm missing", commId); return; }
    if (!["sending", "scheduled"].includes(c.status)) { console.log("skip, status", c.status, commId); return; }
    if (!ENV.postalAddress) { await fail(c, "postal address not configured"); return; }

    await ddb.send(new UpdateCommand({ TableName: ENV.comms, Key: { commId },
        UpdateExpression: "SET #s = :s, startedAt = if_not_exists(startedAt, :now)",
        ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":s": "sending", ":now": nowIso() } }));

    const recipients = audienceFor(await allMembers(), c.audience);
    const counts = { email: 0, sms: 0, sent: 0, failed: 0, skipped: 0, deferredSms: 0 };
    const smsOk = smsEnabled() && withinTextingHours(new Date());

    for (const r of recipients) {
        const key = { commId, recipient: `${r.member.memberId}#${r.channel}` };
        // Claim the row first. If it exists, a previous attempt handled it.
        try {
            await ddb.send(new PutCommand({ TableName: ENV.deliveries,
                Item: { ...key, memberId: r.member.memberId, channel: r.channel, to: r.to, status: "queued", at: nowIso() },
                ConditionExpression: "attribute_not_exists(commId)" }));
        } catch (e) {
            if (e.name === "ConditionalCheckFailedException") { counts.skipped++; continue; }
            throw e;
        }

        try {
            if (r.channel === "email") {
                const body = await renderEmail(c, r.member);
                const res = await sendEmail({ to: r.to, subject: c.emailSubject, html: body.html, text: body.text, unsubUrl: body.unsubUrl, unsubApi: body.unsubApi,
                    tags: [{ Name: "comm", Value: commId }] });
                await mark(key, "sent", res.providerId);
                counts.email++; counts.sent++;
            } else {
                if (!smsOk) {
                    // Release the claim so the next pass, inside the window, sends it.
                    await ddb.send(new DeleteCommand({ TableName: ENV.deliveries, Key: key }));
                    counts.deferredSms++; continue;
                }
                const res = await sendSms(r.to, renderSms(c), "promotional");
                await mark(key, "sent", res.providerId);
                counts.sms++; counts.sent++;
            }
        } catch (e) {
            console.error("send failed", r.channel, r.to, e.message);
            await mark(key, "failed", null, e.message);
            counts.failed++;
        }
    }

    const done = counts.deferredSms === 0;
    await ddb.send(new UpdateCommand({ TableName: ENV.comms, Key: { commId },
        UpdateExpression: "SET #s = :s, counts = :c, " + (done ? "sentAt = :now, " : "") + "updatedAt = :now",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": done ? "sent" : "sending", ":c": counts, ":now": nowIso() } }));

    // Texts outside the window: re-queue for the next 8am Central. The
    // deferred rows are deleted so the next pass can claim them again.
    if (!done) {
        const delay = Math.min(900, secondsUntilTextingHours());
        await sqs.send(new SendMessageCommand({ QueueUrl: ENV.queueUrl, MessageBody: JSON.stringify({ commId }), DelaySeconds: delay }));
    }
}

async function mark(key, status, providerId, error) {
    await ddb.send(new UpdateCommand({ TableName: ENV.deliveries, Key: key,
        UpdateExpression: "SET #s = :s, updatedAt = :now" + (providerId ? ", providerId = :p" : "") + (error ? ", #e = :e" : ""),
        ExpressionAttributeNames: { "#s": "status", ...(error ? { "#e": "error" } : {}) },
        ExpressionAttributeValues: { ":s": status, ":now": nowIso(), ...(providerId ? { ":p": providerId } : {}), ...(error ? { ":e": String(error).slice(0, 500) } : {}) } }));
}

async function fail(c, reason) {
    await ddb.send(new UpdateCommand({ TableName: ENV.comms, Key: { commId: c.commId },
        UpdateExpression: "SET #s = :s, lastError = :e, updatedAt = :now",
        ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":s": "approved", ":e": reason, ":now": nowIso() } }));
}

function secondsUntilTextingHours() {
    // Coarse: the queue caps delay at 15 minutes anyway; the message just
    // re-checks each time until the window opens.
    return 900;
}
