# ruff: noqa: E501
"""Draw the app icon (an original design: a small glowing dot grid on black) for the PWA.

Writes ``web/public/icons/icon.svg`` and PNGs at 180, 192 and 512 px. No third-party artwork.
"""

from __future__ import annotations

import math

from _corpus import ROOT
from PIL import Image, ImageDraw, ImageFilter

OUT = ROOT / "web" / "public" / "icons"
N = 5
SIZES = (180, 192, 512)


def color(i: int, j: int) -> tuple[int, int, int]:
    """A blue-to-orange sweep with a bright centre, echoing the signature palette."""
    t = (i + j) / (2 * (N - 1))
    r = int(60 + 190 * t)
    g = int(110 + 60 * math.sin(math.pi * t))
    b = int(255 - 200 * t)
    return r, g, b


def draw(size: int) -> Image.Image:
    s = size * 2
    img = Image.new("RGB", (s, s), (0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = s * 0.2
    pitch = (s - 2 * pad) / (N - 1)
    r = pitch * 0.30
    for i in range(N):
        for j in range(N):
            cx, cy = pad + j * pitch, pad + i * pitch
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color(i, j))
    glow = img.filter(ImageFilter.GaussianBlur(pitch * 0.35))
    img = Image.blend(img, Image.composite(glow, img, Image.new("L", (s, s), 255)), 0.35)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def svg() -> str:
    pad, span = 20, 60
    pitch = span / (N - 1)
    dots = []
    for i in range(N):
        for j in range(N):
            c = "#{:02x}{:02x}{:02x}".format(*color(i, j))
            dots.append(
                f'<circle cx="{pad + j * pitch:.2f}" cy="{pad + i * pitch:.2f}" r="{pitch * 0.30:.2f}" fill="{c}"/>'
            )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" fill="#000"/>' + "".join(dots) + "</svg>\n"
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon.svg").write_text(svg(), encoding="utf-8")
    for size in SIZES:
        draw(size).save(OUT / f"icon-{size}.png", optimize=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
