# Austin Area Firewise Alliance — website

Source for the Austin Area Firewise Alliance site, served at
`https://www.austinareafirewise.org`.

Wildfire preparedness for neighborhoods across Travis County, Texas. Static
HTML/CSS/JS with no build step — everything under `src/` is served exactly as
written.

## How a change goes live

1. Edit files under `src/`.
2. Commit and push to `main`.
3. `.github/workflows/deploy.yml` zips `src/` and pushes it to AWS Amplify.

That is the whole loop: save to GitHub, the site updates. No local AWS
credentials are needed to publish — the workflow gets short-lived credentials
from GitHub OIDC. To republish without a content change, run the **Deploy to
Amplify** workflow from the Actions tab.

## Pages

| File | Covers |
| --- | --- |
| `index.html` | Home — conditions, quick actions, the five highest-value tasks, live condition feeds, what the Alliance does, signup/contact |
| `prepare-your-home.html` | Ember behavior, defensible space zones 0–5 / 5–30 / 30–100 ft, home hardening, landscaping and brush disposal |
| `firewise-communities.html` | What Firewise USA® is, the six steps to recognition, AFD vs. ESD coverage, keeping a site alive after year one |
| `evacuation.html` | Alerts and STEAR, Ready/Set/Go, go-bag contents, streets with one way out, returning afterward |
| `about.html` | Who the Alliance is, where it works, how to get involved, sources for the guidance |
| `news.html` | Board-published news, rendered from `/content/content.json` by `js/content.js` — list, or one article with `?id=` |
| `admin/` | The board's editing page. Sign-in via Cognito; see `docs/04-editing-the-site.md` |
| `404.html` | Served for unmatched paths |

Shared shell (emergency strip, header, footer) is repeated in each file rather
than templated. That is deliberate for a no-build static site, but it means a
change to the header or footer is a change to **every** page — check them all.

## Previewing locally

**Just open the file.** Double-click any `.html` file in `src/` and it opens in
your browser, fully styled, with working navigation between pages. Edit, save,
refresh. No server, no Python, no tooling.

That works because every internal link is relative (`index.html`, not `/`).
Keep it that way — a single `href="/"` breaks preview-by-double-click for
everyone editing without a web server, and gains nothing on the deployed site.

If you want auto-reload on save, the **Live Server** extension for VS Code does
it in one click (right-click the file → "Open with Live Server"). Optional.

A local web server is also fine if you already have one:

```bash
# macOS / Linux
python3 -m http.server 8080 --directory src
```

```bash
# Windows
python -m http.server 8080 --directory src
```

Then open `http://localhost:8080`.

**Do not use the Claude desktop app's built-in preview pane for this site.** It
renders local HTML as a static snapshot on a `data:` origin, so `site.css`
never loads and the page appears as unstyled raw text. Nothing is wrong with
the file — use a real browser, or check the deployed site.

## Working on this from Windows

Everything needed is in this repository. Do not copy the folder from another
machine; clone it, or the two copies drift apart silently.

One-time setup:

1. Install **Git for Windows** (bundles Git Credential Manager for sign-in), or
   **GitHub Desktop** if you would rather not use a terminal.
2. Install **VS Code**, or any text editor.
3. Get added to the `austinareafirewise` GitHub organization with write access
   to the `website` repository.

```bash
git clone https://github.com/austinareafirewise/website.git
```

Each editing session:

```bash
git pull
```

Edit files under `src/`, preview by double-clicking the page, then:

```bash
git add -A
git commit -m "short description of the change"
git push
```

**A push to `main` publishes to austinareafirewise.org within about a minute.** There
is no staging step and no review gate. Preview locally before pushing, and when
in doubt push to a branch and open a pull request instead.

## Editing rules worth keeping

These are not style preferences; they are why the site is safe to publish.

- **The site speaks as the Alliance, never as an agency.** It is an
  independent volunteer organization, not the City of Austin, AFD, Travis
  County, or an ESD. Every page footer says so. Do not write copy that reads
  as an official notice, and do not reproduce agency branding.
- **Emergency instructions belong to the agencies.** The 911 line is first in
  the DOM on every page. Links to Warn Central Texas, the Fire Marshal, TDEM,
  and the Forest Service go to those agencies directly, marked with `.ext`.
- **Don't publish perishable facts.** The conditions banner deliberately says
  "burn ban status changes — check the county's current order" rather than
  asserting a status, because a stale "no burn ban in effect" on a wildfire
  site is worse than no banner. Same reasoning for incident news.
- **The contact form is not an emergency channel** and says so above the
  fields. Do not soften that.
- **Guidance follows NFPA / Firewise USA® and state practice.** If you change
  a number — zone distances, vent mesh size, branch clearance — check it
  against the source first.

## Accessibility

The audience skews toward older homeowners, so this is a functional
requirement here, not a checkbox.

What the site does:

- **Text size control** in the header — 100% / 115% / 130%, labelled
  "Text size" on desktop and three sized A's on mobile. Sets
  `--text-scale` on `<html>`; the stylesheet multiplies the root font size by
  it. The choice is stored in `localStorage` and re-applied by a small inline
  script in each page's `<head>`, so pages paint at the reader's size instead
  of flashing at 100%.
- **Skip link** to `#main` on every page, so keyboard and screen-reader users
  can bypass the emergency strip, banner, brand, and nav.
- **Visible focus ring** via `:focus-visible` — global, so new links inherit it.
- **The 911 line first in the DOM** on every page, ahead of the branding.
- Labelled form fields, `alt` on images, `lang`, ordered headings,
  `aria-current` on the active nav item, `prefers-reduced-motion` respected.

### Sizing rules that keep the text size control working

**Size text in `rem`, never `px`.** A `px` font size ignores `--text-scale`
entirely, so the text size buttons appear to do nothing to that element. Padding,
borders, and fixed image dimensions in `px` are fine — only type matters.

For `clamp()` headings, the middle term needs a `rem` component
(`clamp(2.1rem, 1.2rem + 2.6vw, 3.2rem)`). A pure `vw` middle term scales with
the window and ignores the reader's setting.

### Color rules

There are **two oranges**, and the distinction is load-bearing:

- `--orange` `#da7b37` — the logo tone. Decoration only: dots, rules, card
  top-borders. White text on it is 3.06:1, which fails WCAG AA.
- `--orange-dark` `#a85512` — anything containing words. 5.29:1 with white,
  5.06:1 as text on the page background.

Same split for sage: `--sage` is decorative (2.6:1), `--sage-text` is for text
(4.97:1). The logo image itself is untouched and keeps the true flame color —
logos are exempt from contrast rules, interface text is not.

If you add a color, check it before shipping. Target 4.5:1 for normal text,
3:1 for text at or above 24px (or 18.66px bold).

## Board-published content

Meeting notices and news articles are not in this repository. Board members
publish them at `/admin/`, they are stored in AWS, and `js/content.js` renders
them into the notice slot and home News section on `index.html` and onto
`news.html`. The site works exactly as before if that content is unavailable —
the slots stay hidden.

Design: `docs/06-cms-design.md`. Using it: `docs/04-editing-the-site.md`.
Deploying changes to it: `infra/README.md`.

## Contact address and mailing list

Both are switched on in `src/js/config.js`, and both are off right now.

- `window.AAFA_CONTACT_EMAIL` is `null`, so the site renders **no** mailto
  links. Set it to the Alliance's real address once a mailbox exists.
- `window.AAFA_SIGNUP_ENDPOINT` is unset, so the form stores nothing and says
  so plainly, pointing at official channels instead.

See `infra/README.md` for the planned collection path and what it needs —
double opt-in, unsubscribe, CORS, rate limiting, a privacy statement — before
it handles a real address.

## Brand assets

`src/img/` holds the Alliance logo and wordmark, copied from `~/firewise/`.
The logo is the favicon and the header mark.

## Trademark

Firewise USA® is a registered program of the National Fire Protection
Association. The site describes the program and links to NFPA; it does not
claim to speak for it.
