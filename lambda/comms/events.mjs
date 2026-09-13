/* Events from outside: SES bounces, complaints and deliveries; inbound text
 * keywords from AWS End User Messaging; and the five-minute tick that starts
 * scheduled sends and expires unconfirmed signups.
 *
 * A bounce or complaint marks the member so they are never sent to again.
 * Sending to addresses that bounced is what gets a domain blacklisted, so
 * this is not optional bookkeeping.
 */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { ddb, UpdateCommand, ScanCommand, DeleteCommand, ENV, findByEmail, nowIso, signToken } from "./lib.mjs";
import { sendPlainEmail, emailEnabled } from "./email.mjs";
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
    // People who signed up while email could not be sent. Once SES is out of
    // the sandbox this clears itself; until then it costs one cheap check
    // every five minutes.
    if (await emailEnabled()) {
        const waiting = await ddb.send(new ScanCommand({ TableName: ENV.members,
            FilterExpression: "confirmationDeferred = :t AND attribute_exists(email)",
            ExpressionAttributeValues: { ":t": true } }));
        for (const m of waiting.Items || []) {
            try {
                const t = await signToken("confirm-email", m.memberId, 7 * 86400);
                const url = `${ENV.siteOrigin}/manage.html?c=${t}`;
                await sendPlainEmail({
                    to: m.email,
                    subject: `Confirm your ${ENV.orgName} updates`,
                    text: `Thanks for signing up for updates from the ${ENV.orgName}. Sorry for the delay — our email setup has just been approved.\n\nConfirm your email address by opening this link:\n${url}\n\nIf you did not sign up, ignore this message and nothing will be sent.\n\n${ENV.orgName}, ${ENV.postalAddress}`,
                });
                await ddb.send(new UpdateCommand({ TableName: ENV.members, Key: { memberId: m.memberId },
                    UpdateExpression: "REMOVE confirmationDeferred SET pendingExpires = :p, updatedAt = :now",
                    ExpressionAttributeValues: { ":p": Math.floor(Date.now() / 1000) + 7 * 86400, ":now": nowIso() } }));
                console.log("sent deferred confirmation to", m.memberId);
            } catch (e) {
                console.error("deferred confirmation failed for", m.memberId, e.message);
            }
        }
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
