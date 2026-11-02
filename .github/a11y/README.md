# Accessibility check

`.github/workflows/accessibility.yml` runs `check.mjs` on every push. It
serves `src/` on 127.0.0.1, blocks every request to another host (so pages
are checked as a visitor with every blocker on sees them), and checks each
page in a real browser.

| Check | Mode | Fails the job? |
| --- | --- | --- |
| axe's WCAG 2.0, 2.1 and 2.2 A and AA rules | normal, dark, a 320-pixel phone, the site's own scripts blocked | yes |
| Keyboard: Tab reaches every control (a radio group is one stop), and focus is visible | normal | yes |
| Reflow: nothing scrolls sideways on a 320-pixel screen (WCAG 1.4.10) | phone | not yet (TODO.md, T73) |
| axe's best-practice rules: heading order, landmarks | normal | not yet (TODO.md, T8, T24, T74) |

Before any page, each check is run on a known-bad sample page made by the
script, and the job fails if a check misses it. It also fails if git finds
no pages, a page doesn't load, or axe runs no rules. A check that only
reports moves to failing the job in the pull request that fixes what it
finds.

What this can't check, and TODO.md T6 keeps: using the site with a real
screen reader, and the admin pages behind sign-in (their sign-in screen is
checked).

## Pins

- `package.json` names exact versions, and `package-lock.json` pins every
  package by integrity hash; the workflow installs with `npm ci`, which
  refuses anything else. Dependabot proposes updates monthly, at least seven
  days after a release.
- The browser comes from Microsoft's Playwright container image, pinned by
  digest in the workflow. Its version must match Playwright's in
  `package-lock.json`, so a pull request that moves one moves the other:
  look up the new image's digest in Microsoft's container registry
  (`mcr.microsoft.com/playwright`, the `v<version>-noble` tag) and check it
  against a second request before pinning it.

## Running it on your own computer

With Node.js installed, run `.github/a11y/run-local.sh`. It installs the
pinned tools, downloads the browser they expect, and runs the check. On a Mac
the first run may ask whether Node can "find devices on your local network":
the check only listens on this computer (127.0.0.1), so "Don't Allow" is
fine.
