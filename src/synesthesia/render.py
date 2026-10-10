"""Static PNG renders (docs/ANALYSIS.md section 12).

M1 provides the sound map (dots, glow, deterministic PNG). SVG export and contact sheets
arrive in M2.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image, ImageDraw, ImageFilter
from PIL.PngImagePlugin import PngInfo

from synesthesia.config import Config

_SUPERSAMPLE = 2  # draw at 2x then downsample with Lanczos (spec)
_PNG_COMPRESS_LEVEL = 6  # fixed so identical pixels give identical bytes
_MAX_8BIT = 255.0


def _parse_hex(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def render_sound_map(
    srgb: npt.NDArray[np.uint8], config: Config, px: int | None = None
) -> Image.Image:
    """Render the dot grid with glow.

    Args:
        srgb: ``(K, 3)`` uint8 per-cell colors, ``i = row * size + col``.
        config: resolved configuration (``render.*``, ``grid.size``).
        px: output side in pixels; defaults to ``render.preview_px``.

    Returns:
        ``px x px`` RGB image.
    """
    rc, size = config.render, config.grid.size
    side = px or rc.preview_px
    bg = _parse_hex(rc.background)
    big = side * _SUPERSAMPLE
    pitch = big / (size + 2.0 * rc.margin_cells)
    radius = rc.dot_radius_ratio * pitch
    canvas = Image.new("RGB", (big, big), bg)
    draw = ImageDraw.Draw(canvas)
    for i in range(size * size):
        r, c = divmod(i, size)
        cx = (rc.margin_cells + c + 0.5) * pitch
        cy = (rc.margin_cells + r + 0.5) * pitch
        draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            fill=tuple(int(v) for v in srgb[i]),
        )
    dots = canvas.resize((side, side), Image.Resampling.LANCZOS)
    glow = dots.filter(ImageFilter.GaussianBlur(rc.glow_sigma_ratio * pitch / _SUPERSAMPLE))
    a = np.asarray(dots, dtype=np.float64) / _MAX_8BIT
    g = np.asarray(glow, dtype=np.float64) / _MAX_8BIT * rc.glow_opacity
    screen = 1.0 - (1.0 - a) * (1.0 - g)
    return Image.fromarray(np.rint(screen * _MAX_8BIT).astype(np.uint8), "RGB")


def save_png(image: Image.Image, path: Path, metadata: dict[str, str]) -> None:
    """Write a PNG with text chunks and no timestamp (deterministic bytes)."""
    info = PngInfo()
    for key in sorted(metadata):
        info.add_text(key, metadata[key])
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", pnginfo=info, compress_level=_PNG_COMPRESS_LEVEL, optimize=False)


_SVG_PRECISION = 3  # decimals for coordinates; fixed so output text is deterministic


def render_svg(srgb: npt.NDArray[np.uint8], config: Config, px: int | None = None) -> str:
    """Vector sound map: 4,096 circles plus an SVG Gaussian blur filter for the glow.

    Args:
        srgb: ``(K, 3)`` uint8 per-cell colors, ``i = row * size + col``.
        config: resolved configuration (``render.*``, ``grid.size``).
        px: nominal side in pixels (the SVG scales); defaults to ``render.preview_px``.

    Returns:
        SVG document text (deterministic).
    """
    rc, size = config.render, config.grid.size
    side = px or rc.preview_px
    pitch = side / (size + 2.0 * rc.margin_cells)
    radius = rc.dot_radius_ratio * pitch
    dots: list[str] = []
    for i in range(size * size):
        r, c = divmod(i, size)
        cx = (rc.margin_cells + c + 0.5) * pitch
        cy = (rc.margin_cells + r + 0.5) * pitch
        fill = "#{:02x}{:02x}{:02x}".format(*(int(v) for v in srgb[i]))
        dots.append(
            f'<circle cx="{cx:.{_SVG_PRECISION}f}" cy="{cy:.{_SVG_PRECISION}f}" '
            f'r="{radius:.{_SVG_PRECISION}f}" fill="{fill}"/>'
        )
    body = "\n".join(dots)
    sigma = rc.glow_sigma_ratio * pitch
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{side}" height="{side}" viewBox="0 0 {side} {side}">\n'
        f'<defs>\n<filter id="glow" x="-5%" y="-5%" width="110%" height="110%">'
        f'<feGaussianBlur stdDeviation="{sigma:.{_SVG_PRECISION}f}"/></filter>\n'
        f'<g id="dots">\n{body}\n</g>\n</defs>\n'
        f'<rect width="{side}" height="{side}" fill="{rc.background}"/>\n'
        f'<use xlink:href="#dots" href="#dots" filter="url(#glow)" opacity="{rc.glow_opacity}" '
        f'style="mix-blend-mode:screen"/>\n'
        f'<use xlink:href="#dots" href="#dots"/>\n</svg>\n'
    )


def contact_sheet(
    tiles: list[tuple[Image.Image, str]], cols: int, tile_px: int, label_px: int = 28
) -> Image.Image:
    """Grid of labeled tiles on a dark ground, for review.

    Args:
        tiles: ``(image, label)`` pairs in reading order.
        cols: columns.
        tile_px: tile side in pixels (images are resized with Lanczos).
        label_px: height of the label strip above each tile.

    Returns:
        RGB image. Uses PIL's built-in bitmap font, so output is deterministic.
    """
    from PIL import ImageFont

    rows = -(-len(tiles) // cols)
    gap = 8
    sheet = Image.new(
        "RGB",
        (cols * (tile_px + gap) + gap, rows * (tile_px + label_px + gap) + gap),
        (24, 24, 24),
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for k, (img, label) in enumerate(tiles):
        r, c = divmod(k, cols)
        x = gap + c * (tile_px + gap)
        y = gap + r * (tile_px + label_px + gap)
        draw.text((x + 2, y + 8), label, fill=(230, 230, 230), font=font)
        sheet.paste(img.resize((tile_px, tile_px), Image.Resampling.LANCZOS), (x, y + label_px))
    return sheet
