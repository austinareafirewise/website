/* Austin Area Firewise Alliance — the Resources page's back end.
 *
 * Kept in its own file rather than added to index.mjs, which is already long
 * and is about one thing: the notices and news the board writes. Resources are
 * a different shape — a link out, or a file stored as provided — and share
 * only the table, the bucket and the authorisation.
 *
 * Two record shapes live under reserved keys the item routes cannot reach:
 * every resource is stored with an id prefixed `res_`, and the category list
 * is one record under `__categories`. isId() in index.mjs refuses anything
 * with an underscore, so /items/{id} can never address either by accident.
 */

import { GetCommand, PutCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";

export const CATEGORY_KEY = "__categories";
export const RESOURCE_PREFIX = "res_";

/* Categories the site ships with, so the Resources screen is usable the day
   it arrives rather than starting as five empty boxes. The board renames or
   replaces them; nothing here is special afterwards. */
export const DEFAULT_CATEGORIES = [
    { id: "prepare", name: "Prepare your home", blurb: "What to do to the house and the ground around it, in the order that matters most." },
    { id: "communities", name: "Firewise communities", blurb: "For a neighborhood working towards recognition, or keeping it." },
    { id: "evacuation", name: "Evacuation and alerts", blurb: "Getting warned, and getting out." },
    { id: "insurance", name: "Insurance and funding", blurb: "Paying for the work, and what insurers now look for." },
    { id: "policy", name: "Policy and advocacy", blurb: "The rules as they stand, and what the Alliance argues they should be." },
];

export const RESOURCE_LIMITS = {
    title: 120,
    description: 600,
    url: 500,
    dateLabel: 60,
    notes: 1000,
    categoryName: 60,
    categoryBlurb: 200,
    categories: 12,
    fileBytes: 250 * 1024 * 1024,   // a short video; a PDF is a hundredth of this
};

/* What may be uploaded, and what it is called when served back.
 *
 * An allow-list, not a block-list. A resource file is stored exactly as the
 * board provides it — nothing is re-encoded, unlike a photograph — so this
 * list is the whole safety check. Nothing here is a format a browser will
 * execute: no HTML, no SVG, no scripts. A file served from our own address
 * that the browser runs is a way into the site, and the way to not have that
 * problem is to never accept one.
 */
export const FILE_TYPES = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "video/mp4": ".mp4",
};

class ValidationError extends Error {}
export { ValidationError as ResourceValidationError };

function str(v, label, max, required) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) {
        if (required) throw new ValidationError(`${label} is needed.`);
        return "";
    }
    if (s.length > max) throw new ValidationError(`${label} is too long — at most ${max} characters.`);
    return s;
}

function isoDate(v, label) {
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new ValidationError(`${label} is not a date.`);
    return d.toISOString();
}

function newResourceId() {
    return RESOURCE_PREFIX + Date.now().toString(36) + randomBytes(6).toString("hex");
}

export function isResourceId(id) {
    return typeof id === "string" && /^res_[0-9a-z]{16,32}$/.test(id);
}

/* ------------------------------------------------------------------ */
/* Categories                                                           */
/* ------------------------------------------------------------------ */

export async function getCategories(ddb, TABLE) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id: CATEGORY_KEY } }));
    const stored = res.Item?.categories;
    return Array.isArray(stored) && stored.length ? stored : DEFAULT_CATEGORIES;
}

export async function putCategories(ddb, TABLE, input, who) {
    const raw = Array.isArray(input.categories) ? input.categories : [];
    if (!raw.length) throw new ValidationError("There has to be at least one category.");
    if (raw.length > RESOURCE_LIMITS.categories) {
        throw new ValidationError(`At most ${RESOURCE_LIMITS.categories} categories. A page with more headings than items stops being a page anybody reads.`);
    }

    const seen = new Set();
    const categories = raw.map((c, i) => {
        const id = str(c?.id, `Category ${i + 1} id`, 40, true);
        if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new ValidationError(`Category ${i + 1} has an id that is not usable.`);
        if (seen.has(id)) throw new ValidationError("Two categories cannot share an id.");
        seen.add(id);
        return {
            id,
            name: str(c?.name, `Category ${i + 1} name`, RESOURCE_LIMITS.categoryName, true),
            blurb: str(c?.blurb, `Category ${i + 1} description`, RESOURCE_LIMITS.categoryBlurb) || undefined,
        };
    });

    // A category with resources filed in it cannot be removed. Doing so would
    // leave them orphaned and invisible, which reads to the board like the
    // resources were deleted.
    const existing = await listResources(ddb, TABLE);
    const orphaned = existing.filter((r) => r.category && !seen.has(r.category));
    if (orphaned.length) {
        const names = orphaned.slice(0, 3).map((r) => r.title).join(", ");
        throw new ValidationError(
            `${orphaned.length} resource${orphaned.length === 1 ? " is" : "s are"} still filed under a category being removed (${names}). ` +
            "Move them first, then remove the category."
        );
    }

    await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { id: CATEGORY_KEY, categories, updatedAt: new Date().toISOString(), updatedBy: who },
    }));
    return categories;
}

/* ------------------------------------------------------------------ */
/* Resources                                                            */
/* ------------------------------------------------------------------ */

export async function listResources(ddb, TABLE) {
    const out = [];
    let ExclusiveStartKey;
    do {
        const page = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
        out.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out
        .filter((i) => isResourceId(i.id))
        .map((i) => ({ ...i, resourceId: i.id }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.title || "").localeCompare(b.title || ""));
}

export async function getResource(ddb, TABLE, id) {
    if (!isResourceId(id)) return null;
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
    return res.Item ? { ...res.Item, resourceId: res.Item.id } : null;
}

export function validateResource(input, categories) {
    const kind = str(input.kind, "Kind", 10, true);
    if (kind !== "link" && kind !== "file") throw new ValidationError("A resource is either a link or a file.");

    const category = str(input.category, "Category", 40, true);
    if (!categories.some((c) => c.id === category)) throw new ValidationError("That category no longer exists.");

    const out = {
        kind,
        category,
        title: str(input.title, "Title", RESOURCE_LIMITS.title, true),
        description: str(input.description, "Description", RESOURCE_LIMITS.description, true),
        dateLabel: str(input.dateLabel, "Date shown to readers", RESOURCE_LIMITS.dateLabel) || undefined,
        notes: str(input.notes, "Notes", RESOURCE_LIMITS.notes) || undefined,
        status: input.status === "published" ? "published" : "draft",
        order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
        startsAt: input.startsAt ? isoDate(input.startsAt, "Show from") : undefined,
        endsAt: input.endsAt ? isoDate(input.endsAt, "Show until") : undefined,
    };

    if (out.startsAt && out.endsAt && Date.parse(out.endsAt) <= Date.parse(out.startsAt)) {
        throw new ValidationError("Show until has to be after Show from.");
    }

    if (kind === "link") {
        const url = str(input.url, "Web address", RESOURCE_LIMITS.url, true);
        if (!/^https:\/\/\S+$/.test(url)) throw new ValidationError("The web address has to start with https://");
        out.url = url;
    } else {
        out.file = str(input.file, "File", 300, true);
        out.fileName = str(input.fileName, "File name", 200, true);
        out.fileType = str(input.fileType, "File type", 120, true);
        if (!FILE_TYPES[out.fileType]) throw new ValidationError("That kind of file cannot be published here.");
        out.fileSize = Number(input.fileSize) || 0;
    }

    return out;
}

export async function putResource(ddb, TABLE, id, input, who, categories) {
    const isNew = !id;
    const resourceId = isNew ? newResourceId() : id;
    if (!isResourceId(resourceId)) throw new ValidationError("That resource id is not valid.");

    const existing = isNew ? null : await getResource(ddb, TABLE, resourceId);
    if (!isNew && !existing) throw new ValidationError("That resource no longer exists.");

    const now = new Date().toISOString();
    const item = validateResource(input, categories);

    item.id = resourceId;
    item.createdAt = existing?.createdAt || now;
    item.createdBy = existing?.createdBy || who;
    item.updatedAt = now;
    item.updatedBy = who;

    // The link checker's own state belongs to the checker, not the editor.
    // Changing the address clears it: a new address has not failed anything.
    const addressChanged = existing && existing.url !== item.url;
    if (existing && !addressChanged) {
        item.linkCheckedAt = existing.linkCheckedAt;
        item.linkStatus = existing.linkStatus;
        item.linkFailures = existing.linkFailures;
        item.autoDisabled = existing.autoDisabled;
    }

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return { ...item, resourceId };
}

export async function deleteResource(ddb, s3, TABLE, BUCKET, id) {
    const existing = await getResource(ddb, TABLE, id);
    if (existing?.file) {
        // The file goes with the record. Leaving it in the bucket costs money
        // forever and leaves a document downloadable by anyone who kept the
        // address, which is not what "deleted" means to a board member.
        await s3.send(new DeleteObjectsCommand({
            Bucket: BUCKET, Delete: { Objects: [{ Key: existing.file }], Quiet: true },
        })).catch(() => { /* the record still goes */ });
    }
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
}

/* ------------------------------------------------------------------ */
/* Upload                                                               */
/* ------------------------------------------------------------------ */

export async function fileUploadUrl(s3, BUCKET, input) {
    const fileType = str(input.fileType, "File type", 120, true);
    const ext = FILE_TYPES[fileType];
    if (!ext) {
        throw new ValidationError(
            "That kind of file cannot be published here. PDFs, Word documents, spreadsheets, plain text and MP4 video are accepted."
        );
    }
    const size = Number(input.fileSize) || 0;
    if (size > RESOURCE_LIMITS.fileBytes) {
        throw new ValidationError(`That file is larger than ${Math.round(RESOURCE_LIMITS.fileBytes / (1024 * 1024))} MB.`);
    }

    const key = `files/${Date.now().toString(36)}${randomBytes(6).toString("hex")}${ext}`;
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: fileType,
        // Long, because the key is unique per upload: replacing a document
        // produces a new key rather than overwriting one, so nothing a reader
        // has cached is ever wrong.
        CacheControl: "public, max-age=31536000, immutable",
    }), { expiresIn: 600 });

    return { key, uploadUrl };
}

/* ------------------------------------------------------------------ */
/* The public projection                                                */
/* ------------------------------------------------------------------ */

export async function publishResources(ddb, s3, TABLE, BUCKET) {
    const [all, categories] = await Promise.all([
        listResources(ddb, TABLE),
        getCategories(ddb, TABLE),
    ]);
    const now = Date.now();

    const live = all.filter((r) => {
        if (r.status !== "published") return false;
        if (r.autoDisabled) return false;
        if (r.startsAt && Date.parse(r.startsAt) > now) return false;
        if (r.endsAt && Date.parse(r.endsAt) < now) return false;
        return true;
    });

    const doc = {
        generatedAt: new Date().toISOString(),
        categories: categories.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb })),
        // Only what a visitor needs. The board's notes, who wrote it and what
        // the link checker thinks are not a visitor's business and are not
        // published where anybody can read them.
        resources: live.map((r) => ({
            id: r.id,
            category: r.category,
            kind: r.kind,
            title: r.title,
            description: r.description,
            dateLabel: r.dateLabel,
            url: r.url,
            file: r.file,
            fileName: r.fileName,
            fileType: r.fileType,
            fileSize: r.fileSize,
        })),
    };

    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: "resources.json",
        Body: JSON.stringify(doc),
        ContentType: "application/json; charset=utf-8",
        CacheControl: "public, max-age=60",
    }));
}
