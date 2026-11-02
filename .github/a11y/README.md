# Accessibility check

`.github/workflows/accessibility.yml` runs `check.mjs` on every push. It
serves `src/` on 127.0.0.1, blocks every request to another host (so pages
are checked as a visitor with every blocker on sees them), and checks each
page in a real browser.

| Check | Mode | Fails the job? |
| --- | --- | --- |
| axe's WCAG 2.0, 2.1 and 2.2 A and AA rules | normal, dark, a 320-pixel phone, and no JavaScript (the page's scripts removed and its `<noscript>` content shown) | yes |
| Keyboard: Tab reaches every control (a radio group is one stop), focus never sticks or loops before it leaves the page, and focusing a control changes how it looks on screen, compared by screenshot (a control that takes focus off the screen counts as invisible) | desktop and phone widths | yes |
| Reflow: nothing scrolls sideways on a 320-pixel screen (WCAG 1.4.10) | phone | not yet (TODO.md, T73) |
| axe's best-practice rules: heading order, landmarks | normal | not yet (TODO.md, T8, T24, T74) |
| Script errors on a page | normal | no: listed so they're seen |
| What axe couldn't decide (text over a picture or gradient) | normal and the other axe modes | no: listed for a person to look at |

Before any page, each check is run on a known-bad sample page made by the
script, and the job fails if a check misses it. A mode's sample fails only in
that mode (and the script confirms it passes in normal mode), so a mode that
isn't applied is caught too. It also fails if git finds no pages, a page
doesn't load, axe runs no rules, or a page shows nothing in an axe mode (axe
looks only at what is shown, so content hidden by mistake would otherwise
pass unexamined). A check that only reports moves to failing the job in the
pull request that fixes what it finds.

What this doesn't check yet: what the pages fetch when they open (news,
notices, the fire danger sign, the burn ban, resources, the board). That
content isn't in the repository and other hosts are blocked, so those parts
are checked only as they look with nothing loaded (TODO.md, T76). What
automation can't check, and TODO.md T6 keeps: using the site with a real
screen reader, and the admin pages behind sign-in (their sign-in screen is
checked).

It takes about 17 seconds a page, so the job's 15-minute limit allows about
50 pages; raise `timeout-minutes` in the workflow as the site grows.

## Pins

- `package.json` names exact versions, and `package-lock.json` pins every
  package by integrity hash; the workflow installs with `npm ci`, which
  refuses anything else. Dependabot proposes updates monthly, at least seven
  days after a release.
- The browser comes from Microsoft's Playwright container image, pinned by
  digest in the workflow. Its version must match Playwright's in
  `package-lock.json`, so a pull request that moves one moves the other.
  Dependabot's monthly update moves `package.json` and `package-lock.json`
  but not the image digest: when it moves Playwright, the job fails to start
  the browser (it fails closed), and the digest is moved by hand in the same
  pull request: look up the new image's digest in Microsoft's container
  registry (`mcr.microsoft.com/playwright`, the `v<version>-noble` tag) and
  check it against a second request before pinning it.

## Running it on your own computer

With Node.js installed, run `.github/a11y/run-local.sh`. It installs the
pinned tools, downloads the browser they expect, and runs the check. It
checks only pages git knows about, so `git add` a new page first.

On a Mac the first run may ask whether Node can "find devices on your local
network": the check only listens on this computer (127.0.0.1), so "Don't
Allow" is fine. The browser it downloads is pinned by Playwright's version
only, not by a checksum; the workflow uses the container image, which is
pinned by digest.
