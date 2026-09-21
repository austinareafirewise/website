/* Austin Area Firewise Alliance — the weekly link check.
 *
 * Once a week, tries every external link on the Resources page and records
 * what happened. Modelled on lambda/burnban: a timeout, an identifying
 * User-Agent with a contact address, and a refusal to act on one bad answer.
 *
 * WHY IT DOES NOT HIDE A LINK THE FIRST TIME IT FAILS
 *
 * The organizations worth linking to are exactly the ones that refuse
 * automated requests. Measured on the Alliance's own list before this was
 * written: FEMA returned 403 to a scripted request for a document that is
 * plainly there, and warncentraltexas.org — the most important outbound link
 * on the site — did the same. Two false failures in eighteen URLs, on the
 * first attempt.
 *
 * Hiding a resource on one bad morning is worse than leaving a dead link up
 * for a week, because nobody notices a thing that quietly stopped existing.
 * So a failure is recorded and shown to the board, and only three consecutive
 * weekly failures — three weeks of the same answer — take a link down.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import * as R from "../cms/resources.mjs";

const TABLE = process.env.TABLE_NAME;
const BUCKET = process.env.CONTENT_BUCKET;
const CONTACT = process.env.CONTACT_URL || "https://www.austinareafirewise.org/";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

const STRIKES = 3;
const TIMEOUT_MS = 20000;

/* GET with a one-byte Range rather than HEAD.
 *
 * A surprising number of sites reject HEAD outright, or answer it differently
 * from the GET a reader would make — so HEAD manufactures failures for links
 * that work perfectly. The Range header asks for the first byte only, so this
 * costs the other organization nothing even when the target is a large PDF.
 *
 * The User-Agent names the Alliance and carries a contact address, so anybody
 * reading their logs can see who this is and ask us to stop. A checker that
 * hides what it is deserves the blocking it gets. */
async function check(url) {
    const controller = AbortSignal.timeout(TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: controller,
            headers: {
                "User-Agent": `AustinAreaFirewiseAlliance-LinkCheck/1.0 (+${CONTACT})`,
                "Accept": "*/*",
                "Range": "bytes=0-0",
            },
        });
        // 2xx and 3xx are fine. So is 405 and 416: the server is plainly there
        // and simply dislikes the shape of the question, which is not the
        // reader's problem.
        const ok = res.status < 400 || res.status === 405 || res.status === 416;
        return { ok, status: res.status };
    } catch (e) {
        return { ok: false, status: 0, error: String(e?.name || e) };
    }
}

export const handler = async () => {
    const all = await R.listResources(ddb, TABLE);
    const now = new Date();
    const nowIso = now.toISOString();

    // Only published links, and only ones whose window is open. A resource
    // scheduled for next month has not failed anything, and one that has
    // already ended is nobody's problem.
    const due = all.filter((r) => {
        if (r.kind !== "link" || !r.url) return false;
        if (r.status !== "published") return false;
        if (r.startsAt && Date.parse(r.startsAt) > now.getTime()) return false;
        if (r.endsAt && Date.parse(r.endsAt) < now.getTime()) return false;
        return true;
    });

    let changed = false;
    const log = [];

    for (const r of due) {
        const result = await check(r.url);
        const failures = result.ok ? 0 : (Number(r.linkFailures) || 0) + 1;
        const disable = !result.ok && failures >= STRIKES;

        // Recovering clears everything, including a link this took down. A
        // page that comes back should come back on the site without anybody
        // having to notice it had gone.
        const update = {
            linkCheckedAt: nowIso,
            linkStatus: result.ok ? "ok" : `failed (${result.status || result.error})`,
            linkFailures: failures,
            autoDisabled: disable ? true : false,
        };

        const wasDisabled = !!r.autoDisabled;
        if (wasDisabled !== update.autoDisabled) changed = true;

        await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { id: r.id },
            UpdateExpression: "SET linkCheckedAt = :c, linkStatus = :s, linkFailures = :f, autoDisabled = :d",
            ExpressionAttributeValues: {
                ":c": update.linkCheckedAt, ":s": update.linkStatus,
                ":f": update.linkFailures, ":d": update.autoDisabled,
            },
        }));

        log.push(`${result.ok ? "ok  " : "FAIL"} ${String(result.status).padStart(3)} strikes=${failures}${disable ? " TAKEN DOWN" : ""}  ${r.title}`);
    }

    // The published file only needs rewriting when something appeared or
    // disappeared. A failure that has not yet reached three strikes changes
    // nothing a visitor can see.
    if (changed) await R.publishResources(ddb, s3, TABLE, BUCKET);

    console.log(`checked ${due.length} link${due.length === 1 ? "" : "s"}${changed ? ", republished" : ""}\n` + log.join("\n"));
    return { checked: due.length, republished: changed };
};
