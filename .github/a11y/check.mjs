#!/usr/bin/env node
// Check every page under src/ for accessibility, failing closed.
//
//     node .github/a11y/check.mjs
//
// Run from anywhere: it checks the checkout it is in. It needs the pinned
// tools installed (`npm ci` in .github/a11y/) and Playwright's Chromium
// available (the workflow's container has it). It serves src/ itself, on
// 127.0.0.1 only, and blocks every request to any other host, so a page is
// checked as a visitor with every blocker on would see it (principle 11).
// Content the pages fetch (news, notices, fire danger, the board) isn't in the
// repository, so those parts are checked in their empty or no-content
// state only (TODO.md, T76).
//
// Checks, and whether a finding fails the job:
//   gate    axe's WCAG 2.0, 2.1 and 2.2 A and AA rules, in four modes:
//           normal, dark (prefers-color-scheme), a 320-pixel-wide phone,
//           and no JavaScript (the page's scripts removed and its
//           <noscript> content shown, as a visitor with JavaScript off sees
//           it; axe itself still runs).
//   gate    keyboard, at desktop and phone widths: Tab reaches every
//           control (a radio group is one stop), focus never sticks or
//           loops before the end of the page, and focusing a control
//           changes how it looks on screen (a control that takes focus off
//           the screen counts as invisible).
//   report  reflow: nothing scrolls sideways at 320 pixels (WCAG 1.4.10).
//   report  axe's best-practice rules (heading order, landmarks).
//   report  a script error on the page.
//   listed  what axe couldn't decide either way (text over a picture, say),
//           for a person to look at.
// A report finding is printed in full and doesn't fail the job; each moves
// to gate in the pull request that fixes it (TODO.md says which).
// Accessibility gaps aren't secrets: CLAUDE.md's table already lists them.
//
// Before any page, each check runs on known-bad samples made here, and the
// job fails if a check misses one. A sample for a mode fails only in that
// mode, so a mode that isn't applied is caught too. The job also fails if
// no pages are found, a page doesn't load, or axe ran no rules.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const fail = msg => { console.log(`::error title=accessibility::${msg}`); process.exitCode = 1; throw new Error(msg); };

// The checkout this script is in, wherever it is run from.
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
const site = join(root, "src");
const pages = execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "-z", "--", "src"], { cwd: root, encoding: "utf8" })
  .split("\0").filter(f => /\.html?$/i.test(f)).map(f => "/" + f.slice("src/".length));
// Each page's address, with every part of its path encoded, so a name with
// #, % or a space is asked for as itself.
const url = path => path.split("/").map(encodeURIComponent).join("/");
if (!pages.length) fail("no pages to check: git ls-files found no .html under src/");

// Known-bad samples. Each names the check and mode it must fail, and is
// built to pass every other mode, so a finding proves that mode was applied.
const head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sample</title>';
const SAMPLES = {
  // An image with no text alternative: fails in every mode.
  "wcag.html": `${head}</head><body><main><h1>Sample</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>`,
  // Text that is too faint only in dark mode.
  "dark.html": `${head}<style>@media (prefers-color-scheme: dark){body{background:#000}.t{color:#222}}</style></head><body><main><h1>Sample</h1><p class="t">Faint only in the dark.</p></main></body></html>`,
  // Text that is too faint only on a narrow screen.
  "phone.html": `${head}<style>@media (max-width: 400px){.t{color:#ccc;background:#fff}}</style></head><body><main><h1>Sample</h1><p class="t">Faint only on a phone.</p></main></body></html>`,
  // Both halves of no-JavaScript mode: an image with no text alternative
  // that only a visitor without JavaScript sees, and a button that only its
  // script gives a name.
  "noscript.html": `${head}</head><body><main><h1>Sample</h1><noscript><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></noscript><button id="b"></button><script src="sample.js"></script></main></body></html>`,
  "sample.js": `document.getElementById("b").setAttribute("aria-label", "Named by a script");`,
  // A box too wide for a phone.
  "reflow.html": `${head}<style>.w{width:600px}</style></head><body><main><h1>Sample</h1><div class="w">Too wide for a phone.</div></main></body></html>`,
  // A heading that skips a level.
  "practice.html": `${head}</head><body><main><h1>Sample</h1><h3>Skipped a level</h3></main></body></html>`,
  // A last control that keeps the Tab key: a trap at the end of the page.
  "trap.html": `${head}</head><body><main><h1>Sample</h1><a href="#a">One</a> <a href="#b">Two</a> <input aria-label="trap" onkeydown="if (event.key === 'Tab') event.preventDefault()"></main></body></html>`,
  // A control whose focus can't be seen: its outline is transparent.
  "focus.html": `${head}<style>a:focus,a:focus-visible{outline:2px solid transparent}</style></head><body><main><h1>Sample</h1><a href="#x">Focus can't be seen</a></main></body></html>`,
  // A control that takes focus off the screen, as a copied honeypot field
  // without tabindex="-1" would.
  "offscreen.html": `${head}<style>.away{position:absolute;left:-9999px}</style></head><body><main><h1>Sample</h1><a href="#x">Here</a><input class="away" aria-label="away"></main></body></html>`,
  // A script that throws.
  "error.html": `${head}</head><body><main><h1>Sample</h1><script>throw new Error("sample error")</script></main></body></html>`,
};
const sampleDir = mkdtempSync(join(tmpdir(), "a11y-sample-"));
for (const [f, body] of Object.entries(SAMPLES)) writeFileSync(join(sampleDir, f), body);

const TYPES = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
function serveFrom(dir, rel, res) {
  let name;
  try { name = decodeURIComponent(rel); } catch { res.writeHead(400); return res.end("bad path"); }
  const file = resolve(dir, "." + name);
  if (!(file === dir || file.startsWith(dir + sep)) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream" });
  res.end(readFileSync(file));
}
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path.startsWith("/__sample__/")) return serveFrom(sampleDir, path.slice("/__sample__".length), res);
  return serveFrom(site, path, res);
});
await new Promise(ok => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const DESKTOP = { width: 1280, height: 900 }, PHONE = { width: 320, height: 640 };
const MODES = {
  normal: { viewport: DESKTOP },
  dark: { viewport: DESKTOP, colorScheme: "dark" },
  phone: { viewport: PHONE },
  nojs: { viewport: DESKTOP, noScript: true },
};

// A page as a visitor without JavaScript gets it: its <script> elements
// removed and its <noscript> content shown. axe still needs JavaScript,
// which it brings itself.
function withoutScripts(html) {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<\/?noscript\b[^>]*>/gi, "");
}

const browser = await chromium.launch();
const gate = [], report = [];
async function withPage(mode, path, fn) {
  const { noScript, ...opts } = MODES[mode];
  const ctx = await browser.newContext(opts);
  await ctx.route("**/*", async r => {
    const u = new URL(r.request().url());
    if (u.hostname !== "127.0.0.1") return r.abort();
    if (noScript && /\.m?js$/i.test(u.pathname)) return r.abort();
    if (noScript && r.request().resourceType() === "document") {
      const resp = await r.fetch();
      // The policy also stops inline handlers (onload=, onerror=) and
      // javascript: links, which a visitor without JavaScript doesn't run
      // either. axe, injected by Playwright, isn't affected by it.
      return r.fulfill({ response: resp, body: withoutScripts(await resp.text()),
        headers: { ...resp.headers(), "content-security-policy": "script-src 'none'" } });
    }
    return r.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message).slice(0, 120)));
  try {
    const resp = await page.goto(base + url(path), { waitUntil: "load" });
    if (!resp || resp.status() !== 200) fail(`${path} didn't load (${resp ? resp.status() : "no response"})`);
    await page.waitForLoadState("networkidle").catch(() => {});
    return await fn(page, errors);
  } finally { await ctx.close(); }
}

const needsReview = [];
async function axe(page, path, tags) {
  const r = await new AxeBuilder({ page }).withTags(tags).analyze();
  if (r.passes.length + r.violations.length + r.incomplete.length === 0) fail(`axe ran no rules on ${path}`);
  // What axe couldn't decide (text over a picture or gradient, say) is
  // listed for a person to look at, once per page and rule.
  for (const v of r.incomplete) needsReview.push(`${path}: ${v.id} (${v.nodes.length}) e.g. ${v.nodes[0].target.join(" ")}`);
  return r.violations.map(v => `${v.id} (${v.impact}, ${v.nodes.length}) e.g. ${v.nodes[0].target.join(" ")}`);
}

async function reflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= w + 1) return [];
    // The outermost element that is too wide is the one to fix.
    const wide = [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > w + 1
      && !(e.parentElement && e.parentElement !== document.body && e.parentElement.getBoundingClientRect().right > w + 1));
    const e = wide[0];
    return [`scrolls sideways: ${document.documentElement.scrollWidth}px on a ${w}px screen` +
      (e ? `, e.g. ${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className ? "." + String(e.className).split(" ")[0] : ""} (${Math.round(e.getBoundingClientRect().width)}px wide)` : "")];
  });
}

const FOCUSABLE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,audio[controls],video[controls],iframe,[contenteditable]:not([contenteditable=false]),[tabindex]';
async function keyboard(page) {
  // No blinking caret, transitions or animations, so a screenshot shows only
  // what focus itself changes.
  await page.addStyleTag({ content: "*,*::before,*::after{caret-color:transparent!important;transition:none!important;animation:none!important}" });
  // Every control a keyboard user should reach: a radio group counts once,
  // and anything taken out of the tab order on purpose (tabindex -1) is left out.
  const total = await page.evaluate(sel => {
    const els = [...document.querySelectorAll(sel)]
      .filter(e => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden"
        && !e.closest("[inert]"));
    const groups = new Set();
    let n = 0;
    for (const e of els) {
      if (e.type === "radio" && e.name) { if (groups.has(e.name)) continue; groups.add(e.name); }
      const id = String(++n);
      if (e.type === "radio" && e.name) document.querySelectorAll(`input[type=radio][name="${CSS.escape(e.name)}"]`).forEach(r => { r.dataset.a11yWant = id; });
      else e.dataset.a11yWant = id;
    }
    return n;
  }, FOCUSABLE);
  const order = [], invisible = [], out = [];
  // The walk ends when focus comes back to the first control after leaving
  // the page (past the last control, to the browser). Coming back without
  // leaving, or landing again on any other control, is a loop: a trap.
  let first = null, stuck = null, wrapped = false, leftPage = false;
  for (let i = 0; i < total + 10 && !wrapped && !stuck; i++) {
    await page.keyboard.press("Tab");
    const [want, onBody] = await page.evaluate(() => {
      const e = document.activeElement;
      return [e && e !== document.body && e.dataset.a11yWant ? e.dataset.a11yWant : null,
              !e || e === document.body || !document.hasFocus()];
    });
    if (!want) { if (first !== null && onBody) leftPage = true; continue; }
    if (first === null) first = want;
    else if (want === first && leftPage) { wrapped = true; break; }
    if (order.includes(want)) {
      const label = await page.evaluate(() => { const e = document.activeElement; return `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)}"`; });
      stuck = label; break;
    }
    order.push(want);
    // Visible focus: the control's box, with a margin for an outline or
    // glow, must look different focused and not.
    const handle = await page.evaluateHandle(() => document.activeElement);
    await handle.scrollIntoViewIfNeeded().catch(() => {});
    const box = await handle.boundingBox();
    const vp = page.viewportSize();
    const x = Math.max(0, (box?.x ?? 0) - 6), y = Math.max(0, (box?.y ?? 0) - 6);
    const clip = box && { x, y, width: Math.min(vp.width, box.x + box.width + 6) - x, height: Math.min(vp.height, box.y + box.height + 6) - y };
    const name = () => page.evaluate(e => `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)}"`, handle);
    // A control that has focus but can't be brought onto the screen (moved
    // off it, or with no box at all) is focus nobody can see. Judged by the
    // control's own box, without the margin, which could otherwise reach
    // back onto the screen and catch the edge of its outline.
    const onScreen = box && Math.min(vp.width, box.x + box.width) - Math.max(0, box.x) > 0
      && Math.min(vp.height, box.y + box.height) - Math.max(0, box.y) > 0;
    if (!onScreen || !clip || clip.width <= 0 || clip.height <= 0) invisible.push(`${await name()} (off screen)`);
    else {
      const focused = await page.screenshot({ clip, animations: "disabled" });
      await page.evaluate(e => e.blur(), handle);
      const plain = await page.screenshot({ clip, animations: "disabled" });
      await page.evaluate(e => e.focus({ focusVisible: true }), handle);
      if (focused.equals(plain)) invisible.push(await name());
    }
    await handle.dispose();
  }
  if (stuck) out.push(`focus sticks or loops at ${stuck} instead of moving on (a keyboard trap)`);
  else if (!wrapped && order.length) out.push(`focus never got back to the start after ${total + 10} presses of Tab (a keyboard trap)`);
  if (order.length < total) out.push(`Tab reaches ${order.length} of ${total} controls`);
  if (invisible.length) out.push(`no visible focus on ${invisible.length}, e.g. ${invisible.slice(0, 2).join("; ")}`);
  return out;
}

const CHECKS = [
  { name: "WCAG A and AA (normal)", kind: gate, mode: "normal", run: (p, path) => axe(p, path, WCAG), sample: "wcag.html" },
  { name: "WCAG A and AA (dark)", kind: gate, mode: "dark", run: (p, path) => axe(p, path, WCAG), sample: "dark.html", onlyHere: true },
  { name: "WCAG A and AA (phone)", kind: gate, mode: "phone", run: (p, path) => axe(p, path, WCAG), sample: "phone.html", onlyHere: true },
  { name: "WCAG A and AA (no JavaScript)", kind: gate, mode: "nojs", run: (p, path) => axe(p, path, WCAG), sample: "noscript.html", onlyHere: true, expect: ["image-alt", "button-name"] },
  { name: "keyboard (desktop): traps", kind: gate, mode: "normal", run: p => keyboard(p), sample: "trap.html", expect: "keyboard trap" },
  { name: "keyboard (desktop): visible focus", kind: gate, mode: "normal", run: p => keyboard(p), sample: "focus.html", expect: "no visible focus", noPages: true },
  { name: "keyboard (desktop): focus off screen", kind: gate, mode: "normal", run: p => keyboard(p), sample: "offscreen.html", expect: "off screen", noPages: true },
  { name: "keyboard (phone)", kind: gate, mode: "phone", run: p => keyboard(p), sample: "trap.html", expect: "keyboard trap" },
  { name: "reflow at 320px", kind: report, mode: "phone", run: p => reflow(p), sample: "reflow.html" },
  { name: "axe best practice", kind: report, mode: "normal", run: (p, path) => axe(p, path, ["best-practice"]), sample: "practice.html" },
  { name: "script errors", kind: report, mode: "normal", run: (p, path, errors) => errors.map(e => `uncaught: ${e}`), sample: "error.html" },
];

try {
  for (const c of CHECKS) {
    const path = "/__sample__/" + c.sample;
    const found = await withPage(c.mode, path, (p, errors) => c.run(p, path, errors));
    // Every finding a sample is built to give must be there.
    if (!found.length || ![].concat(c.expect ?? []).every(e => found.some(f => f.includes(e))))
      fail(`${c.name} didn't catch its known-bad sample (${c.sample}): the check isn't working`);
    // A mode's sample must pass in normal mode, or its finding doesn't
    // prove the mode was applied.
    if (c.onlyHere && (await withPage("normal", path, (p, errors) => c.run(p, path, errors))).length)
      fail(`${c.name}'s sample (${c.sample}) also fails in normal mode, so it doesn't prove the mode works`);
    console.log(`ok   ${c.name} catches its known-bad sample (${found.length} finding(s))`);
  }
  needsReview.length = 0;   // only the site's own pages from here on
  // The keyboard check runs once per width on the site's pages; its sample
  // entries above exist to prove each half works.
  const run = CHECKS.filter(c => !c.noPages);
  for (const path of pages) for (const c of run) {
    for (const f of await withPage(c.mode, path, (p, errors) => c.run(p, path, errors))) c.kind.push(`${c.name.replace(": traps", "")}: ${path}: ${f}`);
  }
} finally {
  await browser.close(); server.close(); rmSync(sampleDir, { recursive: true, force: true });
}

console.log(`\nchecked ${pages.length} page(s); ${gate.length} gate finding(s), ${report.length} report finding(s)`);
for (const f of report) console.log(`::warning title=accessibility (report)::${f}`);
for (const f of [...new Set(needsReview)]) console.log(`needs a person to look: ${f}`);
for (const f of gate) console.log(`::error title=accessibility::${f}`);
if (gate.length) { process.exitCode = 1; console.log(`FAIL: ${gate.length} finding(s) to fix`); }
else console.log("PASS: no gate findings");
