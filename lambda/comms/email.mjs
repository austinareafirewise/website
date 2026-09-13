/* Email sending through Amazon SES v2.
 *
 * Every message goes out under the configuration set so bounces, complaints
 * and deliveries come back as events to the events function. The
 * List-Unsubscribe headers let Gmail and Outlook show their own unsubscribe
 * button, which posts to /unsubscribe with no page load — that is what
 * "one-click" means in the header value.
 */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { ENV } from "./lib.mjs";

let ses = null;

export async function sendEmail({ to, subject, html, text, unsubUrl, unsubApi, tags }) {
    ses = ses || new SESv2Client({});
    const headers = [
        { Name: "List-Unsubscribe", Value: `<${unsubApi || unsubUrl}>` },
        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ];
    const r = await ses.send(new SendEmailCommand({
        FromEmailAddress: `${ENV.orgName} <${ENV.fromAddress}>`,
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: ENV.replyTo ? [ENV.replyTo] : undefined,
        ConfigurationSetName: ENV.sesConfigSet,
        EmailTags: tags,
        Content: {
            Simple: {
                Subject: { Data: subject, Charset: "UTF-8" },
                Body: {
                    Html: { Data: html, Charset: "UTF-8" },
                    Text: { Data: text, Charset: "UTF-8" },
                },
                Headers: headers,
            },
        },
    }));
    return { providerId: r.MessageId };
}

/* Short transactional messages — confirmation, manage-link — with no
   Markdown and no unsubscribe footer, because the person has not joined
   anything yet. */
export async function sendPlainEmail({ to, subject, text, html }) {
    ses = ses || new SESv2Client({});
    const r = await ses.send(new SendEmailCommand({
        FromEmailAddress: `${ENV.orgName} <${ENV.fromAddress}>`,
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: ENV.replyTo ? [ENV.replyTo] : undefined,
        ConfigurationSetName: ENV.sesConfigSet,
        Content: { Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Text: { Data: text, Charset: "UTF-8" }, ...(html ? { Html: { Data: html, Charset: "UTF-8" } } : {}) },
        } },
    }));
    return { providerId: r.MessageId };
}
