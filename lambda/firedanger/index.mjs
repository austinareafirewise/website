/* Today's fire danger rating for the Austin area, republished for the hero.
 *
 * Texas A&M Forest Service and the Texas Weather Connection run the National
 * Fire Danger Rating System for Texas every day and publish the result as a
 * plain CSV, one row per weather station, with the adjective rating -- Low,
 * Moderate, High, Very High, Extreme -- in the last column. This reads that
 * file, takes the stations in and around Travis County, and writes a small
 * JSON file next to the board's published content. The home page draws the
 * sign from it.
 *
 * We are not the authority. The rating is theirs, the sign says so, and the
 * alt text credits them by name.
 *
 * THE HIGHEST OF THE STATIONS WINS. They disagree on any given day -- East
 * Austin reading High while Balcones Canyonlands reads Moderate is ordinary.
 * Reporting the highest is what the fire departments here do on their own
 * roadside signs, and it is the error worth making: a neighbor who is told
 * High on a Moderate day loses nothing.
 *
 * FAIL CLOSED, the same way the burn ban does:
 *
 *   - A rating is published only when the row is for today and the adjective
 *     is one of the five. An unfamiliar code is ignored rather than guessed.
 *   - If no file can be read, nothing is written. The old file stays, its
 *     checkedAt stops advancing, and the page drops the sign once it goes
 *     stale rather than showing yesterday's danger as today's.
 *
 * Two files carry the same format. The observed file for a date appears
 * during that day; until it does, the previous day's forecast file holds the
 * row for today. Observed is preferred when it is there.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const BUCKET = process.env.CONTENT_BUCKET;
const KEY = process.env.CONTENT_KEY || "firedanger.json";
const BASE = process.env.SOURCE_BASE || "https://twc.tamu.edu/weather_images";
const SOURCE_PAGE = process.env.SOURCE_URL || "https://twc.tamu.edu/tfd";
const CONTACT = process.env.CONTACT_URL || "https://www.austinareafirewise.org/";

/* The stations in Travis County and on its edge. Bastrop is the next county
   over and is included deliberately: the fuels there are what the eastern
   edge of the Alliance's area looks like on a bad day. */
const STATIONS = new Map([
    ["417904", "East Austin"],
    ["417905", "South Austin"],
    ["417902", "Balcones Canyonlands"],
    ["417903", "Balcones Flying X"],
    ["415501", "Bastrop"],
]);

/* The file's codes, lowest first. Order is the whole point: the index is what
   decides which station is reported. */
const RATINGS = [
    { code: "L", state: "low", label: "Low" },
    { code: "M", state: "moderate", label: "Moderate" },
    { code: "H", state: "high", label: "High" },
    { code: "VH", state: "very-high", label: "Very High" },
    { code: "E", state: "extreme", label: "Extreme" },
];
const BY_CODE = new Map(RATINGS.map((r, i) => [r.code, { ...r, rank: i }]));

export const handler = async () => {
    const today = centralDate(new Date());

    // Today's observed file first; yesterday's forecast carries today's row
    // until it appears.
    const yesterday = centralDate(new Date(Date.now() - 24 * 3600 * 1000));
    const sources = [
        { url: `${BASE}/tx_nfdr_obs/tx_nfdr_obs${compact(today)}.csv`, kind: "observed" },
        { url: `${BASE}/tx_nfdr_fcst/tx_nfdr_fcst${compact(yesterday)}.csv`, kind: "forecast" },
    ];

    for (const { url, kind } of sources) {
        let rows;
        try {
            rows = parse(await fetchCsv(url));
        } catch (e) {
            console.log(`${kind} file unavailable (${url}): ${e.message}`);
            continue;
        }

        const readings = [];
        for (const row of rows) {
            if (!STATIONS.has(row.sta_id)) continue;
            if (row.nfdr_dt !== today) continue;            // not today's row
            const rating = BY_CODE.get((row.adj_ec || "").toUpperCase());
            if (!rating) {
                console.log(`station ${row.sta_id}: unrecognized rating ${JSON.stringify(row.adj_ec)}`);
                continue;
            }
            readings.push({
                station: STATIONS.get(row.sta_id),
                state: rating.state,
                label: rating.label,
                rank: rating.rank,
                kbdi: num(row.kbdi),
                burningIndex: num(row.bi),
            });
        }

        if (!readings.length) {
            console.log(`${kind} file had no usable row for ${today}`);
            continue;
        }

        const worst = readings.reduce((a, b) => (b.rank > a.rank ? b : a));
        const status = {
            state: worst.state,
            label: worst.label,
            station: worst.station,
            basis: kind,                       // observed, or a forecast for today
            ratedFor: today,
            source: SOURCE_PAGE,
            credit: "Texas A&M Forest Service, Texas Fire Danger",
            stations: readings
                .sort((a, b) => b.rank - a.rank)
                .map(({ rank, ...rest }) => rest),
            checkedAt: new Date().toISOString(),
        };

        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: KEY,
            Body: JSON.stringify(status),
            ContentType: "application/json",
            CacheControl: "public, max-age=900",
        }));
        console.log(`published ${status.label} (${kind}, highest of ${readings.length}: ${worst.station})`);
        return { published: true, state: status.state, basis: kind };
    }

    console.log("no usable rating found; nothing published");
    return { published: false, reason: "no-usable-row" };
};

async function fetchCsv(url) {
    const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: {
            // Say who we are. A university server should be able to see who is
            // reading it a few times a day and how to reach us about it.
            "User-Agent": `AustinAreaFirewiseAlliance-FireDangerCheck/1.0 (+${CONTACT})`,
            // "*/*" deliberately. The host answers 406 to a specific Accept
            // for a file it serves happily to a browser, so asking politely
            // for the type we want is the one way to be refused it.
            "Accept": "*/*",
        },
    });
    if (!res.ok) throw new Error(`returned ${res.status}`);
    const body = await res.text();
    // A missing file is served as a styled 404 page with a 200 in front of it
    // on this host, so the content decides, not the status line.
    if (/^\s*</.test(body)) throw new Error("not a CSV");
    return body;
}

/* Plain split. The file has no quoted fields, and inventing a CSV parser for
   a file that does not need one is how a parser acquires bugs. */
function parse(text) {
    const lines = text.trim().split(/\r?\n/);
    const head = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const cells = line.split(",");
        const row = {};
        head.forEach((h, i) => { row[h] = (cells[i] || "").trim(); });
        return row;
    });
}

/* The rating is for a Texas day, so "today" is today in Texas -- not in UTC,
   where it is already tomorrow for the last six hours of every evening. */
function centralDate(d) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
}

function compact(isoDate) { return isoDate.replace(/-/g, ""); }

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
