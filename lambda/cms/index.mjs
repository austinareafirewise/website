/* Austin Area Firewise Alliance — content API.
 *
 * One function behind an HTTP API with a Cognito JWT authorizer. By the time
 * this runs, API Gateway has already verified the token's signature, issuer,
 * audience and expiry. What remains here is authorisation (is this person on
 * the board?), validation (is this a well-formed item?), storage, and
 * publishing the public projection to S3.
 *
 * No third-party packages. Everything imported below ships inside the Lambda
 * Node.js runtime, so there is nothing here to patch.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
    S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";

const TABLE = process.env.TABLE_NAME;
const BUCKET = process.env.CONTENT_BUCKET;
const ALLOWED_GROUP = process.env.ALLOWED_GROUP || "board";
const SITE_ORIGIN = process.env.SITE_ORIGIN;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

/* ------------------------------------------------------------------ */
/* Limits. Mirrored in the admin form so the editor hears about a       */
/* problem before submitting, but this is the copy that is enforced.    */
/* ------------------------------------------------------------------ */

const LIMITS = {
    title: 120,
    body: 6000,
    linkText: 60,
    credit: 120,
    alt: 200,
    pictures: 3,
    pictureBytes: 5 * 1024 * 1024,
};

const KINDS = new Set(["news", "notice"]);
const STATUSES = new Set(["draft", "published"]);
const BODY_FORMATS = new Set(["plain", "markdown"]);

/* Where a picture sits in the article. "full" is the whole column width;
   "right" and "left" are about a third of it with the text wrapping round.
   The site drops the wrap on a narrow screen, where there is no room for a
   picture and a line of text side by side. */
const PICTURE_LAYOUTS = new Set(["full", "right", "left"]);

/* What a meeting notice is about. The board picks the kind, not a color:
   the site maps each to one of its own palette colors and a word. Picking a
   color directly would let an editor produce unreadable text, and would break
   the one signal this site has -- orange means alert here -- on a site about
   fire. Every tone shows its label, so color never carries the meaning on its
   own. */
const NOTICE_TONES = new Set(["meeting", "event", "urgent", "recognition"]);

/* A notice may carry one small picture; an article may carry three. */
const NOTICE_PICTURES = 1;

/* ------------------------------------------------------------------ */
/* Entry point                                                          */
/* ------------------------------------------------------------------ */

export const handler = async (event) => {
    try {
        const who = editor(event);
        if (!who) {
            return respond(403, { error: "Your account is not on the board list. Ask whoever manages the site to add you." });
        }

        const route = event.routeKey;
        const id = event.pathParameters?.id;

        if (route === "GET /items") return respond(200, { items: await listItems() });
        if (route === "GET /items/{id}") {
            const item = await getItem(id);
            return item ? respond(200, { item }) : respond(404, { error: "That item no longer exists." });
        }
        if (route === "PUT /items/{id}") return await putItem(id, parseBody(event), who);
        if (route === "DELETE /items/{id}") return await deleteItem(id);
        if (route === "POST /items/{id}/pictures") return await pictureUploadUrl(id, parseBody(event));

        return respond(404, { error: "Unknown route." });
    } catch (err) {
        if (err instanceof ValidationError) {
            return respond(400, { error: err.message });
        }
        console.error(err);
        return respond(500, { error: "Something went wrong on the server. Nothing was changed." });
    }
};

/* ------------------------------------------------------------------ */
/* Who is asking                                                        */
/* ------------------------------------------------------------------ */

function editor(event) {
    const claims = event.requestContext?.authorizer?.jwt?.claims || {};
    // HTTP API stringifies array claims as "[a b]"; tolerate both shapes.
    const raw = claims["cognito:groups"];
    const groups = Array.isArray(raw)
        ? raw
        : String(raw || "").replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
    if (!groups.includes(ALLOWED_GROUP)) return null;
    return claims.email || claims["cognito:username"] || "unknown";
}

/* ------------------------------------------------------------------ */
/* Items                                                                */
/* ------------------------------------------------------------------ */

async function listItems() {
    const out = [];
    let ExclusiveStartKey;
    do {
        const page = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
        out.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}

async function getItem(id) {
    if (!isId(id)) return null;
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
    return res.Item || null;
}

async function putItem(id, input, who) {
    if (!isId(id)) throw new ValidationError("That item id is not valid.");
    const existing = await getItem(id);
    const now = new Date().toISOString();

    const item = validateItem(input, id);
    item.createdAt = existing?.createdAt || now;
    item.createdBy = existing?.createdBy || who;
    item.updatedAt = now;
    item.updatedBy = who;

    // Pictures must already be in the bucket, under this item's own prefix,
    // and within the size cap. An editor cannot reference someone else's
    // picture or a path outside their item.
    for (const p of item.pictures) {
        for (const key of [p.key, p.thumbKey]) {
            if (!key.startsWith(`images/${id}/`)) throw new ValidationError("A picture does not belong to this item.");
            let head;
            try {
                head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
            } catch {
                throw new ValidationError("A picture has not finished uploading. Try again in a moment.");
            }
            if ((head.ContentLength || 0) > LIMITS.pictureBytes) throw new ValidationError("A picture is too large.");
        }
    }

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    await pruneOrphans(id, item.pictures);

    if (item.status === "published" || existing?.status === "published") {
        await publish();
    }
    return respond(200, { item });
}

async function deleteItem(id) {
    if (!isId(id)) throw new ValidationError("That item id is not valid.");
    const existing = await getItem(id);
    if (!existing) return respond(404, { error: "That item no longer exists." });

    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
    await pruneOrphans(id, []);
    if (existing.status === "published") await publish();
    return respond(200, { deleted: id });
}

/* ------------------------------------------------------------------ */
/* Pictures                                                             */
/* ------------------------------------------------------------------ */

async function pictureUploadUrl(id, input) {
    if (!isId(id)) throw new ValidationError("That item id is not valid.");
    const existing = await getItem(id);
    if (!existing) throw new ValidationError("Save the item once before adding pictures.");
    const cap = existing.kind === "notice" ? NOTICE_PICTURES : LIMITS.pictures;
    if ((existing.pictures || []).length >= cap) {
        throw new ValidationError(cap === 1 ? "A notice can carry one picture." : `At most ${cap} pictures per article.`);
    }

    const pictureId = newId();
    const key = `images/${id}/${pictureId}.jpg`;
    const thumbKey = `images/${id}/${pictureId}-thumb.jpg`;

    const sign = (Key) => getSignedUrl(s3, new PutObjectCommand({
        Bucket: BUCKET,
        Key,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
    }), { expiresIn: 300 });

    return respond(200, {
        key, thumbKey,
        uploadUrl: await sign(key),
        thumbUploadUrl: await sign(thumbKey),
        // Headers the browser must send exactly, because they are signed.
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
    });
}

/* Remove any object under the item's prefix that the item no longer
   references — a picture the editor removed, or one they uploaded and never
   attached. Deleting the item removes everything under it. */
async function pruneOrphans(id, pictures) {
    const keep = new Set(pictures.flatMap((p) => [p.key, p.thumbKey]));
    const prefix = `images/${id}/`;
    let ContinuationToken;
    do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken }));
        const stale = (page.Contents || []).map((o) => o.Key).filter((k) => !keep.has(k));
        if (stale.length) {
            await s3.send(new DeleteObjectsCommand({
                Bucket: BUCKET,
                Delete: { Objects: stale.map((Key) => ({ Key })), Quiet: true },
            }));
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
}

/* ------------------------------------------------------------------ */
/* Publishing                                                           */
/* ------------------------------------------------------------------ */

/* The public projection. Published items only, not yet ended, with the
   editor emails left out. The visitor's browser applies the start date. */
async function publish() {
    const all = await listItems();
    const cutoff = Date.now() - 24 * 3600 * 1000; // keep a day of slack for clock skew
    const pub = all
        .filter((i) => i.status === "published" && Date.parse(i.endsAt) >= cutoff)
        .map((i) => ({
            id: i.id, kind: i.kind, title: i.title, body: i.body,
            startsAt: i.startsAt, endsAt: i.endsAt,
            link: i.link, linkText: i.linkText,
            showOnHome: i.showOnHome || false,
            bodyFormat: i.bodyFormat || "plain",
            pictures: i.pictures || [],
            updatedAt: i.updatedAt,
        }));

    const doc = {
        generatedAt: new Date().toISOString(),
        notices: pub.filter((i) => i.kind === "notice"),
        news: pub.filter((i) => i.kind === "news"),
    };

    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: "content.json",
        Body: JSON.stringify(doc),
        ContentType: "application/json; charset=utf-8",
        CacheControl: "public, max-age=60",
    }));
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

class ValidationError extends Error {}

/* Pictures are checked the same way whoever is carrying them; only how many
   are allowed differs. */
function validatePictures(input, max) {
    const pics = Array.isArray(input.pictures) ? input.pictures : [];
    if (pics.length > max) {
        throw new ValidationError(max === 1 ? "A notice can carry one picture." : `At most ${max} pictures per article.`);
    }
    return pics.map((p, i) => {
        if (!p || typeof p !== "object") throw new ValidationError(`Picture ${i + 1} is malformed.`);
        const key = str(p.key, "Picture", 200, true);
        const thumbKey = str(p.thumbKey, "Picture thumbnail", 200, true);
        if (!/^images\/[A-Za-z0-9]+\/[A-Za-z0-9]+\.jpg$/.test(key) || !/^images\/[A-Za-z0-9]+\/[A-Za-z0-9]+-thumb\.jpg$/.test(thumbKey)) {
            throw new ValidationError(`Picture ${i + 1} has an invalid location.`);
        }
        const alt = str(p.alt, `Picture ${i + 1} description`, LIMITS.alt, true);
        const credit = str(p.credit, `Picture ${i + 1} credit`, LIMITS.credit);
        const width = int(p.width), height = int(p.height);
        if (!width || !height) throw new ValidationError(`Picture ${i + 1} is missing its size.`);
        const layout = str(p.layout, `Picture ${i + 1} layout`, 10) || "full";
        if (!PICTURE_LAYOUTS.has(layout)) throw new ValidationError(`Picture ${i + 1} has a layout the site does not have.`);
        return { key, thumbKey, width, height, alt, credit, layout };
    });
}

function validateItem(input, id) {
    if (!input || typeof input !== "object") throw new ValidationError("Nothing was sent.");

    const kind = str(input.kind, "Kind", 10);
    if (!KINDS.has(kind)) throw new ValidationError("Kind must be a news article or a meeting notice.");

    const status = str(input.status, "Status", 10);
    if (!STATUSES.has(status)) throw new ValidationError("Status must be draft or published.");

    /* A draft is scratch paper. It may be missing its title, its text or its
       dates, so an editor can start with a picture, or save what they have
       and come back to it. Everything below is required to publish, and
       publishing is the only way anything reaches a visitor. */
    const draft = status === "draft";

    const title = str(input.title, "Title", LIMITS.title, !draft);
    const body = str(input.body, "Body", LIMITS.body, !draft).replace(/\r\n?/g, "\n");

    const startsAt = draft && !input.startsAt ? "" : isoDate(input.startsAt, "Starts");
    const endsAt = draft && !input.endsAt ? "" : isoDate(input.endsAt, "Stops");
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
        throw new ValidationError("Stops must be after Starts.");
    }

    const item = { id, kind, status, title, body, startsAt, endsAt, pictures: [] };

    if (kind === "notice") {
        const tone = str(input.tone, "Notice kind", 20) || "meeting";
        if (!NOTICE_TONES.has(tone)) throw new ValidationError("That is not one of the notice kinds.");
        item.tone = tone;
        // One picture, and the site always draws it small and to the side: a
        // notice sits above the headline and the burn ban, so a large image
        // there pushes the whole page down.
        item.pictures = validatePictures(input, NOTICE_PICTURES);
    }

    const link = str(input.link, "Link", 500);
    if (link) {
        let u;
        try { u = new URL(link); } catch { throw new ValidationError("The link is not a valid web address."); }
        if (u.protocol !== "https:") throw new ValidationError("The link must start with https://");
        item.link = u.toString();
        item.linkText = str(input.linkText, "Link label", LIMITS.linkText) || "More information";
    }

    if (kind === "news") {
        item.showOnHome = input.showOnHome === true;
        // Markdown is opt-in per article and rendered by the site's own
        // restricted renderer, which builds DOM nodes and never interprets
        // raw HTML. The flag only tells the site which renderer to use; the
        // body is stored as text either way.
        const fmt = str(input.bodyFormat, "Body format", 10) || "plain";
        if (!BODY_FORMATS.has(fmt)) throw new ValidationError("Body format must be plain or markdown.");
        item.bodyFormat = fmt;
        item.pictures = validatePictures(input, LIMITS.pictures);
    }

    return item;
}

function str(v, label, max, required = false) {
    if (v == null) v = "";
    if (typeof v !== "string") throw new ValidationError(`${label} must be text.`);
    // Strip control characters other than newline and tab.
    v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    if (required && !v) throw new ValidationError(`${label} is required.`);
    if (v.length > max) throw new ValidationError(`${label} is too long (limit ${max} characters).`);
    return v;
}

function int(v) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n < 20000 ? n : 0;
}

/* The fractional-seconds group is not optional decoration: the admin page
   sends Date.prototype.toISOString(), which always emits milliseconds
   ("2026-10-15T00:00:00.000Z"). An earlier version of this pattern omitted
   it, so every date the browser produced was rejected as invalid while
   hand-written test payloads passed.

   The digit count is deliberately loose. ISO 8601 allows any number of
   fractional digits, and other clients emit more than three — Python's
   isoformat() gives six. Being strict about the count buys nothing: the
   Date.parse check below is what actually decides whether this is a real
   instant, and it is what rejects things like 2026-13-45T99:99:99.000Z
   that match these characters but are not dates. */
function isoDate(v, label) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([+-]\d{2}:\d{2}|Z)$/.test(v) || Number.isNaN(Date.parse(v))) {
        throw new ValidationError(`${label} needs a valid date and time.`);
    }
    return new Date(v).toISOString();
}

function isId(id) {
    return typeof id === "string" && /^[0-9a-z]{16,32}$/.test(id);
}

/* Time-prefixed so ids sort by creation; random tail so they are unguessable. */
function newId() {
    return Date.now().toString(36).padStart(9, "0") + randomBytes(9).toString("hex").slice(0, 14);
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                        */
/* ------------------------------------------------------------------ */

function parseBody(event) {
    if (!event.body) return {};
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    try { return JSON.parse(raw); } catch { throw new ValidationError("The request was not valid JSON."); }
}

function respond(statusCode, body) {
    return {
        statusCode,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...(SITE_ORIGIN ? { "access-control-allow-origin": SITE_ORIGIN } : {}),
        },
        body: JSON.stringify(body),
    };
}
