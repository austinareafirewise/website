#!/usr/bin/env node
/* Prove every training script still matches the admin page.
 *
 *   node src/admin/training/check.mjs
 *
 * A video cannot be grepped, so the script it was recorded from has to be.
 * This is the gate: every `target` names something that exists, every
 * `section` is a real tab, every lesson has the metadata the player needs, and
 * no two lessons claim the same id or order. Rename a button and this fails
 * the same day, instead of the narration quietly pointing at nothing until
 * somebody watches the whole recording.
 *
 * Exits non-zero on the first problem found, listing all of them.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "..", "index.html");
const SECTIONS = new Set(["content", "members", "comms", "groups", "board"]);
const SCREENS = new Set(["list", "editor"]);
const REQUIRED_META = ["lesson-id", "sections", "order", "minutes", "description"];

const html = readFileSync(PAGE, "utf8");
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
/* Classes the admin page only ever puts on at runtime -- a member row's
   status, for instance -- exist in the stylesheet rather than the markup. */
const css = readFileSync(join(HERE, "..", "admin.css"), "utf8")
    + readFileSync(join(HERE, "..", "..", "css", "site.css"), "utf8");
const styledClasses = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));

/* The keys the record editor builds its fields from. */
const adminData = readFileSync(join(HERE, "..", "admin-data.js"), "utf8");
const editorFields = new Set([...adminData.matchAll(/\{\s*k:\s*"([A-Za-z][\w]*)"/g)].map((m) => m[1]));

const classes = new Set(
    [...html.matchAll(/\sclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
);

const problems = [];
const seenIds = new Map();
const seenOrder = new Map();
const primaries = new Map();   // section -> the lesson the Training button opens

/* A target is a plain #id or .class. Anything fancier is refused rather than
   half-checked: a selector this cannot verify is a selector that can rot. */
function checkTarget(target, where) {
    // Alternatives, tried in order by the guide. Each has to stand up on its own.
    if (target.includes("|")) {
        for (const one of target.split("|").map((t) => t.trim()).filter(Boolean)) checkTarget(one, where);
        return;
    }
    // A compound like ".item.confirmed" is one class applied to a row the
    // admin draws at runtime, so it is checked against the stylesheet: if the
    // class is styled, it exists.
    if (/^(\.[A-Za-z][\w-]*){2,}$/.test(target)) {
        for (const cls of target.split(".").filter(Boolean)) {
            if (!classes.has(cls) && !styledClasses.has(cls)) {
                problems.push(`${where}: nothing uses or styles the class "${cls}"`);
            }
        }
        return;
    }
    if (/^#[A-Za-z][\w-]*$/.test(target)) {
        const id = target.slice(1);
        // Fields inside the shared record editor are built at runtime, with
        // ids of "f_" plus the field's key. Checked against those keys, so a
        // renamed field still fails here rather than at somebody's screen.
        if (id.startsWith("f_")) {
            if (!editorFields.has(id.slice(2))) {
                problems.push(`${where}: no field named "${id.slice(2)}" in admin-data.js FIELDS`);
            }
            return;
        }
        if (!ids.has(id)) problems.push(`${where}: no element with id "${id}" in admin/index.html`);
        return;
    }
    if (/^\.[A-Za-z][\w-]*$/.test(target)) {
        if (!classes.has(target.slice(1))) problems.push(`${where}: no element with class "${target.slice(1)}" in admin/index.html`);
        return;
    }
    problems.push(`${where}: target "${target}" is not a plain #id or .class, so it cannot be checked`);
}

function parseLesson(file) {
    const text = readFileSync(join(HERE, file), "utf8");
    const meta = Object.fromEntries(
        [...text.matchAll(/<!--\s*([a-z-]+):\s*([^>]*?)\s*-->/g)].map((m) => [m[1], m[2]])
    );

    for (const key of REQUIRED_META) {
        if (!meta[key]) problems.push(`${file}: missing <!-- ${key}: ... -->`);
    }
    if (meta["lesson-id"]) {
        const expected = file.replace(/\.md$/, "");
        if (meta["lesson-id"] !== expected) {
            problems.push(`${file}: lesson-id is "${meta["lesson-id"]}" but the file is named "${expected}.md"`);
        }
        if (seenIds.has(meta["lesson-id"])) {
            problems.push(`${file}: lesson-id "${meta["lesson-id"]}" is already used by ${seenIds.get(meta["lesson-id"])}`);
        }
        seenIds.set(meta["lesson-id"], file);
    }
    if (meta["primary-for"]) {
        for (const name of meta["primary-for"].split(",").map((x) => x.trim()).filter(Boolean)) {
            if (!SECTIONS.has(name)) problems.push(`${file}: primary-for names "${name}", which is not a tab`);
            if (!(meta.sections || "").split(",").map((x) => x.trim()).includes(name)) {
                problems.push(`${file}: primary-for "${name}" is not in its own sections list`);
            }
            if (primaries.has(name)) problems.push(`${file}: ${primaries.get(name)} is already the course for "${name}"`);
            primaries.set(name, file);
        }
    }
    if (meta.sections) {
        for (const name of meta.sections.split(",").map((x) => x.trim()).filter(Boolean)) {
            if (!SECTIONS.has(name)) problems.push(`${file}: sections lists "${name}", which is not a tab`);
        }
    }
    if (meta.order) {
        if (seenOrder.has(meta.order)) problems.push(`${file}: order ${meta.order} is already used by ${seenOrder.get(meta.order)}`);
        seenOrder.set(meta.order, file);
    }

    const steps = text.split(/^## /m).slice(1);
    if (!steps.length) problems.push(`${file}: no steps (a step is a "## " heading)`);

    steps.forEach((chunk, i) => {
        const title = chunk.split("\n")[0].trim();
        const where = `${file} step ${i + 1} ("${title}")`;
        const fields = Object.fromEntries(
            [...chunk.matchAll(/^- ([a-z-]+):\s*(.*)$/gm)].map((m) => [m[1], m[2].trim()])
        );

        if (fields.section && !SECTIONS.has(fields.section)) {
            problems.push(`${where}: section "${fields.section}" is not one of ${[...SECTIONS].join(", ")}`);
        }
        if (fields.screen && !SCREENS.has(fields.screen)) {
            problems.push(`${where}: screen "${fields.screen}" is not list or editor`);
        }
        if (fields.target) checkTarget(fields.target, where);
        if (fields.open) checkTarget(fields.open, `${where} [open]`);
        if (fields.open && fields.screen !== "editor") {
            problems.push(`${where}: has an "open" but is not marked "screen: editor"`);
        }
        if (fields.screen === "editor" && !fields.open) {
            problems.push(`${where}: is on the editor but nothing says how to get there — add "open: <selector>"`);
        }

        // The words. Spoken over a screen, so length is a real constraint.
        const spoken = chunk
            .split("\n").slice(1)
            .filter((l) => !/^- [a-z-]+:/.test(l))
            .join("\n").trim();
        if (!spoken) problems.push(`${where}: nothing to say`);
        else if (spoken.split(/\s+/).length > 130) {
            problems.push(`${where}: ${spoken.split(/\s+/).length} words — too long to speak over one screen (limit 130)`);
        }
    });

    return { file, steps: steps.length, meta };
}

const files = readdirSync(HERE).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
if (!files.length) {
    console.error("No lessons found in", HERE);
    process.exit(1);
}

const lessons = files.map(parseLesson);

for (const l of lessons) {
    console.log(`${l.file.padEnd(32)} ${String(l.steps).padStart(2)} steps   order ${l.meta.order || "?"}   ${l.meta.minutes || "?"} min`);
}

for (const name of SECTIONS) {
    if (!primaries.has(name)) problems.push(`no lesson is marked "primary-for: ${name}", so the Training button on that tab has nothing to open`);
}

if (problems.length) {
    console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
    for (const p of problems) console.error("  " + p);
    process.exit(1);
}
console.log(`\nAll ${lessons.length} lessons check out against admin/index.html.`);
