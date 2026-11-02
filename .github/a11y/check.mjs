#!/usr/bin/env node
// Check every page under src/ for accessibility, failing closed.
//
//     node .github/a11y/check.mjs
//
// Run from anywhere in the checkout, with the pinned tools installed
// (`npm ci` in .github/a11y/) and Playwright's Chromium available (the
// workflow's container has it). It serves src/ itself, on 127.0.0.1 only,
// and blocks every request to any other host, so a page is checked as a
// visitor with every blocker on would see it (principle 11).
//
// Checks, and whether a finding fails the job:
//   gate    axe's WCAG 2.0, 2.1 and 2.2 A and AA rules, in four modes:
//           normal, dark (prefers-color-scheme), a 320-pixel-wide phone,
//           and the site's own scripts blocked (a stand-in for JavaScript
//           off: axe itself needs JavaScript to run).
//   gate    keyboard: Tab reaches every control (a radio group is one
//           stop), and focusing one visibly changes how it looks.
//   report  reflow: nothing scrolls sideways at 320 pixels (WCAG 1.4.10).
//           Four pages do today; TODO.md says which item fixes them.
//   report  axe's best-practice rules (heading order, landmarks). TODO.md
//           says which items fix them.
// A report finding is printed in full and doesn't fail the job; each moves
// to gate in the pull request that fixes it. Accessibility gaps aren't
// secrets: CLAUDE.md's table already lists them.
//
// Before any page, each check runs on a known-bad sample page made here,
// and the job fails if a check misses it. It also fails if no pages are
// found, a page doesn't load, or axe ran no rules.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const fail = msg => { console.log(`::error title=accessibility::${msg}`); process.exitCode = 1; throw new Error(msg); };

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const site = join(root, "src");
const pages = execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "-z", "--", "src"], { cwd: root, encoding: "utf8" })
  .split("\0").filter(f => f.endsWith(".html")).map(f => "/" + f.slice("src/".length));
if (!pages.length) fail("no pages to check: git ls-files found no .html under src/");

// The known-bad sample: an image with no text alternative, text too faint
// to read, a heading that skips a level, a box too wide for a phone, a
// button whose focus can't be seen, and a field that traps the Tab key.
const sampleDir = mkdtempSync(join(tmpdir(), "a11y-sample-"));
writeFileSync(join(sampleDir, "sample.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Known-bad sample</title>
<style>.faint{color:#ccc;background:#fff}.wide{width:600px}button.nofocus:focus{outline:none;box-shadow:none}</style></head>
<body><main><h1>Sample</h1><h3>Skipped a level</h3>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<p class="faint">Too faint to read.</p><div class="wide">Too wide for a phone.</div>
<button class="nofocus">No visible focus</button>
<input aria-label="trap" onkeydown="if (event.key === 'Tab') event.preventDefault()">
<a href="#end">Never reached</a></main></body></html>`);

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
function serveFrom(dir, rel, res) {
  const file = resolve(dir, "." + decodeURIComponent(rel));
  if (!(file === dir || file.startsWith(dir + sep)) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path.startsWith("/__sample__/")) return serveFrom(sampleDir, path.slice("/__sample__".length), res);
  return serveFrom(site, path, res);
});
await new Promise(ok => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const MODES = {
  normal: { viewport: { width: 1280, height: 900 } },
  dark: { viewport: { width: 1280, height: 900 }, colorScheme: "dark" },
  phone: { viewport: { width: 320, height: 640 } },
  noscript: { viewport: { width: 1280, height: 900 }, blockSiteScripts: true },
};

const browser = await chromium.launch();
const gate = [], report = [];
async function withPage(mode, path, fn) {
  const { blockSiteScripts, ...opts } = MODES[mode];
  const ctx = await browser.newContext(opts);
  await ctx.route("**/*", r => {
    const u = new URL(r.request().url());
    if (u.hostname !== "127.0.0.1") return r.abort();
    if (blockSiteScripts && !u.pathname.startsWith("/__sample__/") && /\.m?js$/.test(u.pathname)) return r.abort();
    return r.continue();
  });
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(base + path, { waitUntil: "load" });
    if (!resp || resp.status() !== 200) fail(`${path} didn't load (${resp ? resp.status() : "no response"})`);
    await page.waitForTimeout(250);   // let the site's own scripts settle
    return await fn(page);
  } finally { await ctx.close(); }
}

async function axe(page, path, tags) {
  const r = await new AxeBuilder({ page }).withTags(tags).analyze();
  if (r.passes.length + r.violations.length + r.incomplete.length === 0) fail(`axe ran no rules on ${path}`);
  return r.violations.map(v => `${v.id} (${v.impact}, ${v.nodes.length}) e.g. ${v.nodes[0].target.join(" ")}`);
}

async function reflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= w + 1) return [];
    const wide = [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > w + 1
      && ![...e.children].some(c => c.getBoundingClientRect().right > w + 1));
    const e = wide[0];
    return [`scrolls sideways: ${document.documentElement.scrollWidth}px on a ${w}px screen` +
      (e ? `, e.g. ${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className ? "." + String(e.className).split(" ")[0] : ""}` : "")];
  });
}

async function keyboard(page) {
  // Every control a keyboard user should reach: a radio group counts once,
  // and anything taken out of the tab order on purpose (tabindex -1) is left out.
  const total = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]')]
      .filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden"
        && !e.closest("[inert]"));
    const groups = new Set();
    let n = 0;
    for (const e of els) {
      if (e.type === "radio" && e.name) { if (groups.has(e.name)) continue; groups.add(e.name); }
      e.dataset.a11yWant = String(++n);
      if (e.type === "radio" && e.name) document.querySelectorAll(`input[type=radio][name="${CSS.escape(e.name)}"]`)
        .forEach(r => { r.dataset.a11yWant = e.dataset.a11yWant; });
    }
    return n;
  });
  const reached = new Set(), invisible = [];
  for (let i = 0; i < total + 10; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body || !e.dataset.a11yWant) return null;
      const look = () => { const s = getComputedStyle(e); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.textDecorationLine].join("|"); };
      const focused = look(); e.blur(); const plain = look(); e.focus();
      return { want: e.dataset.a11yWant, visible: focused !== plain, label: `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)}"` };
    });
    if (!r) continue;
    if (reached.has(r.want)) break;
    reached.add(r.want);
    if (!r.visible) invisible.push(r.label);
  }
  const out = [];
  if (reached.size < total) out.push(`Tab reaches ${reached.size} of ${total} controls`);
  if (invisible.length) out.push(`no visible focus on ${invisible.length}, e.g. ${invisible.slice(0, 2).join("; ")}`);
  return out;
}

const CHECKS = [
  { name: "WCAG A and AA (normal)", kind: gate, mode: "normal", run: (p, path) => axe(p, path, WCAG) },
  { name: "WCAG A and AA (dark)", kind: gate, mode: "dark", run: (p, path) => axe(p, path, WCAG) },
  { name: "WCAG A and AA (phone)", kind: gate, mode: "phone", run: (p, path) => axe(p, path, WCAG) },
  { name: "WCAG A and AA (site scripts blocked)", kind: gate, mode: "noscript", run: (p, path) => axe(p, path, WCAG) },
  { name: "keyboard", kind: gate, mode: "normal", run: p => keyboard(p) },
  { name: "reflow at 320px", kind: report, mode: "phone", run: p => reflow(p) },
  { name: "axe best practice", kind: report, mode: "normal", run: (p, path) => axe(p, path, ["best-practice"]) },
];

try {
  for (const c of CHECKS) {
    const found = await withPage(c.mode, "/__sample__/sample.html", p => c.run(p, "the sample"));
    if (!found.length) fail(`${c.name} didn't catch its known-bad sample: the check isn't working`);
    console.log(`ok   ${c.name} catches its known-bad sample (${found.length} finding(s))`);
  }
  for (const path of pages) for (const c of CHECKS) {
    for (const f of await withPage(c.mode, path, p => c.run(p, path))) c.kind.push(`${c.name}: ${path}: ${f}`);
  }
} finally {
  await browser.close(); server.close(); rmSync(sampleDir, { recursive: true, force: true });
}

console.log(`\nchecked ${pages.length} page(s) with ${CHECKS.length} checks; ${gate.length} gate finding(s), ${report.length} report finding(s)`);
for (const f of report) console.log(`::warning title=accessibility (report)::${f}`);
for (const f of gate) console.log(`::error title=accessibility::${f}`);
if (gate.length) { process.exitCode = 1; console.log(`FAIL: ${gate.length} finding(s) to fix`); }
else console.log("PASS: no gate findings");
