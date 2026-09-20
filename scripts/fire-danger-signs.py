#!/usr/bin/env python3
"""Draw the five fire danger signs.

    python3 scripts/fire-danger-signs.py

Writes src/img/fire-danger-<level>.svg and a PNG beside each one, plus a
-on-dark pair of each for a dark page or slide.

The familiar roadside sign is a five-segment gauge with a pointer. This is our
own drawing of that idea: no mascot, no agency marks, nothing lifted from
anybody's artwork -- shapes and text we generate here.

The background is transparent. The sign has to sit on a web page, a slide and
a printed flyer, and a tan disc behind it only ever matches one of them.

Transparency has a cost: the words that sit on it take the color of whatever
is behind them, and near-black names vanish on a dark slide. So each sign is
drawn twice. The light version is for white and the site's cream; the -on-dark
version turns the outlines, the level names and the title light instead. The
banner keeps its own fill in both, because it brings its own background with
it.

The colors are the National Fire Danger Rating System's own, and they are in
the order the public already reads them. Color is never the only thing saying
which level it is: the pointer, the word in the banner and the title attribute
each say it on their own, so the sign still works in gray scale and for
somebody who cannot tell green from red.
"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "img"

# NFDRS order and colors, lowest first.
LEVELS = [
    ("low", "LOW", "#3f9c35", "#ffffff"),
    ("moderate", "MODERATE", "#2e9bd6", "#ffffff"),
    ("high", "HIGH", "#f7e017", "#1a1a1a"),
    ("very-high", "VERY HIGH", "#f18a21", "#1a1a1a"),
    ("extreme", "EXTREME", "#c8202f", "#ffffff"),
]

W, H = 900, 800
CX, CY = 450, 400          # center of the gauge
R_ARC = 300                # outside of the colored gauge
R_LABEL = 342              # where the words around the arc sit
BANNER_TOP = 432

FONT = "Oswald, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"

# What changes between the two versions: the outlines and the two runs of
# text that sit on the transparent background. Nothing else.
THEMES = {
    "": {"line": "#1a1a1a", "label": "#1a1a1a", "title": "#8f1d1d"},
    "-on-dark": {"line": "#f2f2f2", "label": "#ffffff", "title": "#ff9d90"},
}


def polar(r, deg):
    from math import cos, sin, radians
    return CX + r * cos(radians(deg)), CY + r * sin(radians(deg))


def wedge(i):
    """One fifth of the upper half circle, left to right."""
    a0, a1 = 180 + 36 * i, 180 + 36 * (i + 1)
    x0, y0 = polar(R_ARC, a0)
    x1, y1 = polar(R_ARC, a1)
    return f"M {CX:.1f} {CY:.1f} L {x0:.1f} {y0:.1f} A {R_ARC} {R_ARC} 0 0 1 {x1:.1f} {y1:.1f} Z"


def sign(slug, label, color, ink, index, theme, suffix):
    line, label_ink, title_ink = theme["line"], theme["label"], theme["title"]
    mid = 180 + 36 * index + 18          # the middle of this level's wedge
    turn = mid - 270                     # the pointer is drawn upright, then turned

    wedges = "\n".join(
        f'        <path d="{wedge(i)}" fill="{LEVELS[i][2]}" '
        f'stroke="{line}" stroke-width="{4 if i == index else 3}" />'
        for i in range(5)
    )

    # The words around the arc. Each is set on its own turned baseline rather
    # than on a path, so it stays legible at the ends instead of standing on
    # its head.
    names = []
    for i, (_, name, _, _) in enumerate(LEVELS):
        a = 180 + 36 * i + 18
        x, y = polar(R_LABEL, a)
        weight = "700"
        fill = label_ink
        names.append(
            f'        <text x="{x:.1f}" y="{y:.1f}" transform="rotate({a + 90:.1f} {x:.1f} {y:.1f})" '
            f'text-anchor="middle" dominant-baseline="middle" font-family="{FONT}" '
            f'font-size="38" font-weight="{weight}" fill="{fill}" letter-spacing="1">{name}</text>'
        )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"
     role="img" aria-labelledby="t-{slug}{suffix}">
    <title id="t-{slug}{suffix}">Today's fire danger: {label}</title>

    <!-- The gauge. Every level is drawn; the one in force is the one at full
         strength, so the sign reads at a glance and still lists the scale. -->
{wedges}
    <line x1="{CX - R_ARC}" y1="{CY}" x2="{CX + R_ARC}" y2="{CY}" stroke="{line}" stroke-width="5" />
{chr(10).join(names)}

    <!-- The pointer -->
    <g transform="rotate({turn:.1f} {CX} {CY})">
        <path d="M {CX} {CY - R_ARC + 16}
                 L {CX + 58} {CY - R_ARC + 112}
                 L {CX + 24} {CY - R_ARC + 112}
                 L {CX + 24} {CY}
                 L {CX - 24} {CY}
                 L {CX - 24} {CY - R_ARC + 112}
                 L {CX - 58} {CY - R_ARC + 112} Z"
              fill="{color}" stroke="{line}" stroke-width="5" stroke-linejoin="round" />
    </g>
    <circle cx="{CX}" cy="{CY}" r="16" fill="{line}" />

    <!-- The word, which is what somebody actually reads -->
    <rect x="{CX - 296}" y="{BANNER_TOP}" width="592" height="132" rx="8"
          fill="{color}" stroke="{line}" stroke-width="5" />
    <text x="{CX}" y="{BANNER_TOP + 70}" text-anchor="middle" dominant-baseline="middle"
          font-family="{FONT}" font-size="{96 if len(label) < 8 else 74}" font-weight="700" fill="{ink}"
          stroke="{'#1a1a1a' if ink == '#ffffff' else 'none'}" stroke-width="{4 if ink == '#ffffff' else 0}"
          paint-order="stroke" letter-spacing="2">{label}</text>

    <text x="{CX}" y="{BANNER_TOP + 224}" text-anchor="middle" font-family="{FONT}"
          font-size="84" font-weight="700" fill="{title_ink}" letter-spacing="2">TODAY&#8217;S FIRE</text>
    <text x="{CX}" y="{BANNER_TOP + 312}" text-anchor="middle" font-family="{FONT}"
          font-size="84" font-weight="700" fill="{title_ink}" letter-spacing="2">DANGER</text>
</svg>
'''


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (slug, label, color, ink) in enumerate(LEVELS):
        for suffix, theme in THEMES.items():
            svg = OUT / f"fire-danger-{slug}{suffix}.svg"
            svg.write_text(sign(slug, label, color, ink, i, theme, suffix), encoding="utf-8")
            png = OUT / f"fire-danger-{slug}{suffix}.png"
            subprocess.run(
                ["rsvg-convert", "-w", "900", "-o", str(png), str(svg)],
                check=True,
            )
            print(f"{svg.relative_to(ROOT)}  +  {png.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
