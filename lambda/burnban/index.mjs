/* Travis County burn-ban status, republished for the home page.
 *
 * Every half hour this reads the Fire Marshal's burn ban page and writes a
 * small JSON file next to the board's published content. The home page shows
 * a notice in the hero from that file and links back to the county. We are
 * not the authority here; the county is, which is why the notice always
 * carries the county's own wording, the time we read it, and a link.
 *
 * FAIL CLOSED. Telling somebody there is no burn ban when there is one is the
 * failure that starts a fire, so it is the one this function must never make:
 *
 *   - The page is only read inside the county's alert box. The body text
 *     below it explains what a ban means -- "all outdoor burning is
 *     prohibited in Travis County" -- and is there whether or not a ban is
 *     on. Reading the whole page would report a permanent ban.
 *   - A state is only reported when the wording matches a known phrase. A
 *     redesign that this parser does not recognise yields "unknown".
 *   - Nothing is written unless a state was recognised. The old file stays,
 *     its checkedAt stops advancing, and the page hides the notice once it
 *     goes stale. A parser that breaks goes quiet instead of going wrong.
 *
 * The alert text is logged on every run, so when the county lifts the ban the
 * exact "lifted" wording is in CloudWatch and can be added to LIFTED below.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const BUCKET = process.env.CONTENT_BUCKET;
const KEY = process.env.CONTENT_KEY || "burnban.json";
const PAGE = process.env.SOURCE_URL || "https://www.traviscountytx.gov/fire-marshal/burn-ban";
const CONTACT = process.env.CONTACT_URL || "https://www.austinareafirewise.org/";

/* Phrases the county has actually used, plus the obvious variants. A page
   matching both lists, or neither, is "unknown" and is not published. */
const IN_EFFECT = [
    /burn\s*ban\s+(is\s+)?in\s+effect/i,
    /outdoor\s+burning\s+is\s+prohibited/i,
    /burn\s*ban\s+(has\s+been\s+)?(issued|enacted|reinstated|extended)/i,
];
const LIFTED = [
    /no\s+(active|current)?\s*burn\s*ban/i,
    /burn\s*ban\s+(has\s+been\s+|is\s+|was\s+)?(lifted|rescinded|expired|ended)/i,
    /outdoor\s+burning\s+is\s+(currently\s+)?(allowed|permitted)/i,
    /there\s+is\s+not?\s+burn\s*ban/i,
];

export const handler = async () => {
    const html = await fetchPage();
    const alert = alertBox(html);
    if (!alert) {
        console.log("no alert box found on the page; nothing published");
        return { published: false, reason: "no-alert-box" };
    }
    console.log("alert text:", JSON.stringify(alert.text));

    const state = classify(alert.text);
    if (!state) {
        console.log("alert wording not recognised; nothing published");
        return { published: false, reason: "unrecognised" };
    }

    const status = {
        state,                                   // "ban" or "none"
        headline: alert.headline || (state === "ban" ? "Burn ban in effect" : "No burn ban"),
        detail: alert.detail,
        source: PAGE,
        orderUrl: alert.orderUrl || null,
        checkedAt: new Date().toISOString(),
    };

    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: KEY,
        Body: JSON.stringify(status),
        ContentType: "application/json",
        // Short, because the hero notice is the thing people act on. The
        // function only runs every 30 minutes, so this is not a stampede.
        CacheControl: "public, max-age=300",
    }));
    console.log("published", state, "checkedAt", status.checkedAt);
    return { published: true, state };
};

async function fetchPage() {
    const res = await fetch(PAGE, {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: {
            // Identify ourselves. A county server should be able to see who is
            // reading it every half hour and how to reach us about it.
            "User-Agent": `AustinAreaFirewiseAlliance-BurnBanCheck/1.0 (+${CONTACT})`,
            "Accept": "text/html",
        },
    });
    if (!res.ok) throw new Error(`county page returned ${res.status}`);
    return await res.text();
}

/* The county's page is Joomla with the SP Page Builder "alert" addon, whose
   banner is <div class="sppb-alert sppb-alert-danger ...">. Find that div and
   take its contents by balancing tags, so a future nested element inside the
   banner does not truncate the text. */
function alertBox(html) {
    const open = /<div\b[^>]*class="[^"]*\bsppb-alert\b[^"]*"[^>]*>/i.exec(html);
    if (!open) return null;

    let i = open.index + open[0].length;
    let depth = 1;
    const tag = /<(\/?)div\b[^>]*>/gi;
    tag.lastIndex = i;
    let m;
    while ((m = tag.exec(html)) !== null) {
        depth += m[1] ? -1 : 1;
        if (depth === 0) break;
    }
    if (depth !== 0) return null;
    const inner = html.slice(i, m.index);

    const h = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(inner);
    const link = /<a\b[^>]*href="([^"]+)"/i.exec(inner);
    const body = inner.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/i, " ");

    // The first paragraph is the county's statement; the ones after it are
    // usually "visit the clerk for the official order", which the notice
    // links to separately rather than repeating.
    let detail = "";
    for (const p of body.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []) {
        detail = text(p);
        if (detail) break;
    }

    return {
        text: text(inner),
        headline: h ? text(h[1]) : "",
        detail: (detail || text(body)).slice(0, 300),
        orderUrl: link && /^https?:\/\//i.test(link[1]) ? link[1] : null,
    };
}

/* Tags out, entities in, whitespace collapsed. Nothing from here is ever put
   into a page as HTML -- the site builds the notice with textContent -- so
   this is for readability, not for safety. */
function text(s) {
    return s
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function classify(s) {
    const on = IN_EFFECT.some((r) => r.test(s));
    const off = LIFTED.some((r) => r.test(s));
    if (on && !off) return "ban";
    if (off && !on) return "none";
    return null;
}
