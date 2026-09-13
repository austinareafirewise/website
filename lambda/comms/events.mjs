/* Events from outside: SES bounces, complaints and deliveries; inbound text
 * keywords from AWS End User Messaging; and the five-minute tick that starts
 * scheduled sends and expires unconfirmed signups.
 *
 * A bounce or complaint marks the member so they are never sent to again.
 * Sending to addresses that bounced is what gets a domain blacklisted, so
 * this is not optional bookkeeping.
 */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { ddb, UpdateCommand, ScanCommand, DeleteCommand, ENV, findByEmail, nowIso } from "./lib.mjs";
import { handleInboundKeyword, updateDeliveryByProviderId } from "./api.mjs";

const sqs = new SQSClient({});

export const handler = async (event) => {
    if (event.tick) { await tick(); return; }
    for (const rec of event.Records || []) {
        if (rec.EventSource !== "aws:sns") continue;
        let msg;
        try { msg = JSON.parse(rec.Sns.Message); } catch { continue; }
        if (msg.eventType || msg.notificationType) await sesEvent(msg);
        else if (msg.originationNumber && msg.messageBody !== undefined) await smsInbound(msg);
        else if (msg.messageId && msg.eventType === undefined && msg.destinationPhoneNumber) await smsStatus(msg);
    }
};

/* SES event publishing (configuration set -> SNS). */
async function sesEvent(msg) {
    const type = (msg.eventType || msg.notificationType || "").toLowerCase();
    const mail = msg.mail || {};
    const providerId = mail.messageId;

    if (type === "bounce") {
        const hard = (msg.bounce?.bounceType || "").toLowerCase() === "permanent";
        for (const r of msg.bounce?.bouncedRecipients || []) {
            await markEmail(r.emailAddress, hard ? "bounced" : null, `bounce:${msg.bounce?.bounceSubType || ""}`);
        }
        if (providerId) await updateDeliveryByProviderId(providerId, hard ? "bounced" : "soft-bounce", msg.bounce?.bounceSubType);
    } else if (type === "complaint") {
        for (const r of msg.complaint?.complainedRecipients || []) {
            await markEmail(r.emailAddress, "unsubscribed", "complaint");
        }
        if (providerId) await updateDeliveryByProviderId(providerId, "complained", msg.complaint?.complaintFeedbackType);
    } else if (type === "delivery") {
        if (providerId) await updateDeliveryByProviderId(providerId, "delivered");
    } else if (type === "reject" || type === "renderingfailure") {
        if (providerId) await updateDeliveryByProviderId(providerId, "failed", type);
    }
}

async function markEmail(address, emailStatus, via) {
    const m = await findByEmail(String(address || "").toLowerCase());
    if (!m || !emailStatus) return;
    const now = nowIso();
    const isUnsub = emailStatus === "unsubscribed";
    await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId: m.memberId },
        UpdateExpression: "SET emailStatus = :s, updatedAt = :now, updatedBy = :via" + (isUnsub ? ", unsubscribedAt = :now, unsubscribedVia = :via" : ""),
        ExpressionAttributeValues: { ":s": emailStatus, ":now": now, ":via": via } }));
}

/* AWS End User Messaging two-way: inbound message to the toll-free number. */
async function smsInbound(msg) {
    await handleInboundKeyword(msg.originationNumber, msg.messageBody, "aws");
}

/* AWS SMS delivery events, if event publishing is configured on the number. */
async function smsStatus(msg) {
    const st = (msg.eventType || msg.messageStatus || "").toLowerCase();
    if (msg.messageId) await updateDeliveryByProviderId(msg.messageId, st || "unknown");
}

/* Every five minutes. */
async function tick() {
    const now = Date.now();
    // Scheduled communications whose time has come.
    const page = await ddb.send(new ScanCommand({ TableName: ENV.comms,
        FilterExpression: "#s = :sch AND sendAt <= :now", ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":sch": "scheduled", ":now": new Date(now).toISOString() } }));
    for (const c of page.Items || []) {
        try {
            await ddb.send(new UpdateCommand({ TableName: ENV.comms, Key: { commId: c.commId },
                ConditionExpression: "#s = :sch", UpdateExpression: "SET #s = :sending, updatedAt = :now",
                ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":sch": "scheduled", ":sending": "sending", ":now": nowIso() } }));
            await sqs.send(new SendMessageCommand({ QueueUrl: ENV.queueUrl, MessageBody: JSON.stringify({ commId: c.commId }) }));
        } catch (e) { if (e.name !== "ConditionalCheckFailedException") throw e; }
    }
    // Signups that never confirmed. DynamoDB TTL also does this, lazily; the
    // sweep keeps the members list honest between TTL passes.
    const stale = await ddb.send(new ScanCommand({ TableName: ENV.members,
        FilterExpression: "pendingExpires < :t AND attribute_not_exists(confirmedAt)",
        ExpressionAttributeValues: { ":t": Math.floor(now / 1000) }, ProjectionExpression: "memberId" }));
    for (const m of stale.Items || []) {
        await ddb.send(new DeleteCommand({ TableName: ENV.members, Key: { memberId: m.memberId } }));
    }
}
