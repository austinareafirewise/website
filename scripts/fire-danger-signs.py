#!/usr/bin/env python3
"""Draw the five fire danger signs.

    python3 scripts/fire-danger-signs.py

Writes src/img/fire-danger-<level>.svg and a PNG beside each one.

The familiar roadside sign is a wood round with a five-segment gauge and a
pointer. This is our own drawing of that idea: no mascot, no agency marks,
nothing lifted from anybody's artwork -- shapes and text we generate here.

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

W, H = 900, 860
CX, CY = 450, 392          # center of the gauge, and of the wood round
R_BARK = 424               # outside of the bark
R_WOOD = 392               # the cut face
R_ARC = 296                # outside of the colored gauge
R_LABEL = 336              # where the words around the arc sit
BANNER_TOP = 424

FONT = "Oswald, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"


def polar(r, deg):
    from math import cos, sin, radians
    return CX + r * cos(radians(deg)), CY + r * sin(radians(deg))


def wedge(i):
    """One fifth of the upper half circle, left to right."""
    a0, a1 = 180 + 36 * i, 180 + 36 * (i + 1)
    x0, y0 = polar(R_ARC, a0)
    x1, y1 = polar(R_ARC, a1)
    return f"M {CX:.1f} {CY:.1f} L {x0:.1f} {y0:.1f} A {R_ARC} {R_ARC} 0 0 1 {x1:.1f} {y1:.1f} Z"


def bark_ring():
    """A sawn edge: the bark drawn as a ring of shallow teeth."""
    from math import cos, sin, radians
    teeth, pts = 84, []
    for t in range(teeth * 2):
        deg = 360 * t / (teeth * 2)
        r = R_BARK if t % 2 == 0 else R_BARK - 16
        pts.append(f"{CX + r * cos(radians(deg)):.1f},{CY + r * sin(radians(deg)):.1f}")
    return " ".join(pts)


def sign(slug, label, color, ink, index):
    mid = 180 + 36 * index + 18          # the middle of this level's wedge
    turn = mid - 270                     # the pointer is drawn upright, then turned

    wedges = "\n".join(
        f'        <path d="{wedge(i)}" fill="{LEVELS[i][2]}" '
        f'stroke="#1a1a1a" stroke-width="{4 if i == index else 3}" />'
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
        fill = "#1a1a1a"
        names.append(
            f'        <text x="{x:.1f}" y="{y:.1f}" transform="rotate({a + 90:.1f} {x:.1f} {y:.1f})" '
            f'text-anchor="middle" dominant-baseline="middle" font-family="{FONT}" '
            f'font-size="38" font-weight="{weight}" fill="{fill}" letter-spacing="1">{name}</text>'
        )

    # Grain: a few arcs across the cut face, ended before the gauge so they
    # read as wood rather than as more dials.
    grain = "\n".join(
        f'        <circle cx="{CX}" cy="{CY}" r="{r}" fill="none" stroke="#e0c08d" '
        f'stroke-width="2" opacity=".55" />'
        for r in range(R_ARC + 26, R_WOOD, 22)
    )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"
     role="img" aria-labelledby="t-{slug}">
    <title id="t-{slug}">Today's fire danger: {label}</title>

    <!-- The round -->
    <polygon points="{bark_ring()}" fill="#9c6b3a" />
    <circle cx="{CX}" cy="{CY}" r="{R_BARK - 18}" fill="#c08b52" />
    <circle cx="{CX}" cy="{CY}" r="{R_WOOD}" fill="#f5e1bb" stroke="#b98c56" stroke-width="6" />
{grain}

    <!-- The gauge. Every level is drawn; the one in force is the one at full
         strength, so the sign reads at a glance and still lists the scale. -->
{wedges}
    <line x1="{CX - R_ARC}" y1="{CY}" x2="{CX + R_ARC}" y2="{CY}" stroke="#1a1a1a" stroke-width="5" />
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
              fill="{color}" stroke="#1a1a1a" stroke-width="5" stroke-linejoin="round" />
    </g>
    <circle cx="{CX}" cy="{CY}" r="16" fill="#1a1a1a" />

    <!-- The word, which is what somebody actually reads -->
    <rect x="{CX - 296}" y="{BANNER_TOP}" width="592" height="132" rx="8"
          fill="{color}" stroke="#1a1a1a" stroke-width="5" />
    <text x="{CX}" y="{BANNER_TOP + 70}" text-anchor="middle" dominant-baseline="middle"
          font-family="{FONT}" font-size="{96 if len(label) < 8 else 74}" font-weight="700" fill="{ink}"
          stroke="{'#1a1a1a' if ink == '#ffffff' else 'none'}" stroke-width="{4 if ink == '#ffffff' else 0}"
          paint-order="stroke" letter-spacing="2">{label}</text>

    <text x="{CX}" y="{BANNER_TOP + 198}" text-anchor="middle" font-family="{FONT}"
          font-size="54" font-weight="700" fill="#8f1d1d" letter-spacing="2">TODAY&#8217;S FIRE</text>
    <text x="{CX}" y="{BANNER_TOP + 254}" text-anchor="middle" font-family="{FONT}"
          font-size="54" font-weight="700" fill="#8f1d1d" letter-spacing="2">DANGER</text>
</svg>
'''


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (slug, label, color, ink) in enumerate(LEVELS):
        svg = OUT / f"fire-danger-{slug}.svg"
        svg.write_text(sign(slug, label, color, ink, i), encoding="utf-8")
        png = OUT / f"fire-danger-{slug}.png"
        subprocess.run(
            ["rsvg-convert", "-w", "900", "-o", str(png), str(svg)],
            check=True,
        )
        print(f"{svg.relative_to(ROOT)}  +  {png.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
