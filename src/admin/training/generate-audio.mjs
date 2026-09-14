#!/usr/bin/env node
/* Generate the spoken narration for the training lessons.
 *
 *   node src/admin/training/generate-audio.mjs --list
 *   node src/admin/training/generate-audio.mjs --lesson post-a-meeting-notice
 *   node src/admin/training/generate-audio.mjs --lesson post-a-meeting-notice --go
 *   node src/admin/training/generate-audio.mjs --all --go
 *   node src/admin/training/generate-audio.mjs --restamp          # spends nothing
 *
 * Adapted from rp-desktop's scripts/generate-lesson-audio.ts. The scars in
 * that script were earned there and are kept here rather than re-learned:
 *
 *   - DRY RUN BY DEFAULT. Nothing is sent, and nothing is billed, until --go.
 *   - ffmpeg IS CHECKED BEFORE THE FIRST REQUEST, including on a dry run.
 *     Finding out it is missing after paying for thirty clips leaves you with
 *     files you cannot ship and a bill you cannot undo.
 *   - RE-ENCODED TO 64 kbps MONO. OpenAI returns 128 kbps stereo. These clips
 *     are committed and served from the site, and audio in git history cannot
 *     be taken back out.
 *   - ORPHANS ARE PRUNED. Regenerating a step points its lesson at a NEW
 *     filename; without this the old clip stays in the repo forever,
 *     referenced by nothing.
 *   - A FINGERPRINT IS STORED. audio-hash is the hash of the exact words,
 *     voice and delivery the clip was read from, so a step whose wording has
 *     changed can be spotted rather than quietly kept.
 *
 * SECURITY. Reads the key from openai-api-key.local at the repository root
 * and uses it as a bearer token. It is never logged, echoed, copied or
 * included in an error message — failures print the response body only, never
 * the request. That file is gitignored by name. The mp3s and the edits to the
 * lesson files are not, deliberately: every change lands in `git diff` before
 * anybody commits it.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(HERE, "audio");
const ROOT = join(HERE, "..", "..", "..");
const KEY_FILE = join(ROOT, "openai-api-key.local");

const MODEL = "gpt-4o-mini-tts";
const VOICE = "marin";
const INSTRUCTIONS =
    "Speak in a calm, warm, plain-spoken instructional voice, as though showing a " +
    "neighbor how something works. Moderate pace. Pause naturally between " +
    "paragraphs. Do not sound promotional or breathless.";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const GO = has("--go");
const RESTAMP = has("--restamp");

/* ------------------------------------------------------------------ */
/* Lessons                                                             */
/* ------------------------------------------------------------------ */

function lessonFiles() {
    return readdirSync(HERE).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
}

function stepsOf(text) {
    return text.split(/^## /m).slice(1).map((chunk) => {
        const lines = chunk.split("\n");
        const fields = {};
        const words = [];
        for (const line of lines.slice(1)) {
            const f = /^- ([a-z-]+):\s*(.*)$/.exec(line);
            if (f) { fields[f[1]] = f[2].trim(); continue; }
            words.push(line);
        }
        return { title: lines[0].trim(), fields, spoken: words.join("\n").trim() };
    });
}

/* The words as they will be read: paragraphs kept, line wrapping removed. A
   clip is tied to this exact string, not to the file's layout, so re-wrapping
   a paragraph does not mark every clip stale. */
function spokenText(step) {
    return step.spoken.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n\n");
}

function fingerprint(text) {
    return createHash("sha256").update(`${text.trim()}\0${VOICE}\0${INSTRUCTIONS.trim()}`).digest("hex").slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Rewriting a lesson's audio lines                                    */
/* ------------------------------------------------------------------ */

/* Replace or insert "- audio:" and "- audio-hash:" in one step's header,
   leaving every other line in place and in order. */
function withAudioLines(chunk, filename, hash) {
    const lines = chunk.split("\n");
    let last = 0;
    for (let i = 1; i < lines.length; i++) {
        if (/^- [\w-]+:/.test(lines[i])) last = i;
        else if (lines[i].trim() === "") break;
    }
    const kept = lines.filter((l, i) => !(i > 0 && i <= last && /^- audio(-hash)?:/.test(l)));
    let insertAt = 0;
    for (let i = 1; i < kept.length; i++) {
        if (/^- [\w-]+:/.test(kept[i])) insertAt = i;
        else if (kept[i].trim() === "") break;
    }
    kept.splice(insertAt + 1, 0, `- audio: ${filename}`, `- audio-hash: ${hash}`);
    return kept.join("\n");
}

function rewrite(file, updates) {
    const path = join(HERE, file);
    const text = readFileSync(path, "utf8");
    const head = text.split(/^## /m)[0];
    const chunks = text.split(/^## /m).slice(1);
    const out = chunks.map((chunk, i) => {
        const u = updates[i];
        return u ? withAudioLines(chunk, u.filename, u.hash) : chunk;
    });
    writeFileSync(path, head + out.map((c) => "## " + c).join(""), "utf8");
}

/* ------------------------------------------------------------------ */
/* Speech                                                              */
/* ------------------------------------------------------------------ */

function apiKey() {
    if (!existsSync(KEY_FILE)) {
        console.error(`No OpenAI key at ${KEY_FILE}.`);
        console.error("Put the key in that file as its only contents. It is gitignored by name.");
        process.exit(1);
    }
    const key = readFileSync(KEY_FILE, "utf8").trim();
    if (!key) { console.error(`${KEY_FILE} is empty.`); process.exit(1); }
    return key;
}

async function speak(text, key) {
    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions: INSTRUCTIONS }),
    });
    if (!resp.ok) {
        // The response body only. The request carries the key in a header.
        throw new Error(`OpenAI returned ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    }
    return Buffer.from(await resp.arrayBuffer());
}

function requireFfmpeg() {
    try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); }
    catch {
        console.error("ffmpeg is not on PATH. Install it before generating audio —");
        console.error("clips come back at 128 kbps and have to be re-encoded before they are committed.");
        process.exit(1);
    }
}

function downsample(buf, out) {
    const raw = out + ".raw.mp3";
    writeFileSync(raw, buf);
    execFileSync("ffmpeg", ["-y", "-i", raw, "-ac", "1", "-b:a", "64k", out], { stdio: "ignore" });
    unlinkSync(raw);
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const files = lessonFiles();
const wanted = valueOf("--lesson");
const targets = has("--all") || RESTAMP ? files
    : wanted ? files.filter((f) => f === `${wanted}.md`)
    : [];

if (has("--list") || (!targets.length && !has("--all"))) {
    console.log("Lessons:\n");
    for (const f of files) {
        const steps = stepsOf(readFileSync(join(HERE, f), "utf8"));
        const missing = steps.filter((s) => !s.fields.audio).length;
        const stale = steps.filter((s) => s.fields.audio && s.fields["audio-hash"] !== fingerprint(spokenText(s))).length;
        console.log(`  ${f.replace(/\.md$/, "").padEnd(32)} ${steps.length} steps   ${missing} without audio   ${stale} stale`);
    }
    console.log("\n  --lesson <name> [--go]     one lesson (dry run without --go)");
    console.log("  --all --go                 everything that needs it");
    console.log("  --restamp                  refresh hashes only, spends nothing");
    process.exit(0);
}

requireFfmpeg();          // before a single request, even on a dry run
if (!existsSync(AUDIO)) mkdirSync(AUDIO, { recursive: true });

const key = GO && !RESTAMP ? apiKey() : null;
let spent = 0;

for (const file of targets) {
    const text = readFileSync(join(HERE, file), "utf8");
    const steps = stepsOf(text);
    const updates = [];
    let touched = false;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const words = spokenText(step);
        const hash = fingerprint(words);
        const current = step.fields["audio-hash"];
        const fresh = step.fields.audio && current === hash;

        if (fresh) { updates[i] = null; continue; }

        if (RESTAMP) {
            if (step.fields.audio) { updates[i] = { filename: step.fields.audio, hash }; touched = true; }
            continue;
        }
        if (!GO) {
            console.log(`  would record  ${file} step ${i + 1}  "${step.title}"  (${words.split(/\s+/).length} words)`);
            spent++;
            continue;
        }

        const filename = `${file.replace(/\.md$/, "")}-${String(i + 1).padStart(2, "0")}-${randomBytes(3).toString("hex")}.mp3`;
        process.stdout.write(`  recording ${file} step ${i + 1} "${step.title}" … `);
        const buf = await speak(words, key);
        downsample(buf, join(AUDIO, filename));
        console.log("done");
        updates[i] = { filename, hash };
        touched = true;
        spent++;
    }

    if (touched) rewrite(file, updates);
}

/* Anything no lesson points at any more. */
if (GO || RESTAMP) {
    const referenced = new Set();
    for (const f of lessonFiles()) {
        for (const s of stepsOf(readFileSync(join(HERE, f), "utf8"))) {
            if (s.fields.audio) referenced.add(s.fields.audio);
        }
    }
    let pruned = 0;
    for (const f of readdirSync(AUDIO).filter((f) => f.endsWith(".mp3"))) {
        if (!referenced.has(f)) { unlinkSync(join(AUDIO, f)); pruned++; }
    }
    if (pruned) console.log(`\nPruned ${pruned} clip${pruned === 1 ? "" : "s"} nothing points at.`);
}

console.log(
    RESTAMP ? "\nHashes refreshed. Nothing was sent."
    : GO ? `\n${spent} clip${spent === 1 ? "" : "s"} recorded. Check 'git diff' before committing.`
    : `\n${spent} clip${spent === 1 ? "" : "s"} would be recorded. Add --go to actually do it.`
);
