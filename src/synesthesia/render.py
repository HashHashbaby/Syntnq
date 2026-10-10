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


def render_chip_svg(
    lab_grid: npt.NDArray[np.float64], config: Config, px: int | None = None
) -> str:
    """Vector approximation of the glass-chip look (circles, gradients, opacity).

    Each chip is a circle filled with a radial gradient (lighter centre, denser and more saturated
    edge) in the chip's mean colour, with the four sub-cell colours as semi-transparent blobs
    clipped to the chip (the swirl approximated by a quarter-turn-free quadrant blend) and one
    neutral rim-sliver glint. Textures, wave motion and bloom are not representable.

    Args:
        lab_grid: ``(size, size, 3)`` OKLab per analysis cell.
        config: resolved configuration (``render.glass``).
        px: nominal side in pixels; defaults to ``render.preview_px``.

    Returns:
        Deterministic SVG text.
    """
    from synesthesia.color import linear_to_srgb8, oklab_to_linear_srgb

    g = config.render.glass
    size, block = lab_grid.shape[0], g.display_block
    n = size // block
    side = px or config.render.preview_px
    margin = 0.6
    pitch = side / (n + 2.0 * margin)
    radius = g.chip_radius * pitch

    def hexrgb(lab: npt.NDArray[np.float64]) -> str:
        r, gg, b = linear_to_srgb8(oklab_to_linear_srgb(lab.reshape(1, 3)))[0]
        return f"#{int(r):02x}{int(gg):02x}{int(b):02x}"

    defs: list[str] = []
    body: list[str] = []
    lx, ly = g.light_dir[0], g.light_dir[1]
    ll = float(np.hypot(lx, ly))
    gx, gy = lx / ll, ly / ll
    r0, r1 = radius * 0.90, radius * 0.45
    sliver = (
        f"M {gx * r0 - gy * r1:.2f} {gy * r0 + gx * r1:.2f} "
        f"A {r0:.2f} {r0:.2f} 0 0 0 {gx * r0 + gy * r1:.2f} {gy * r0 - gx * r1:.2f}"
    )
    for i in range(n):
        for j in range(n):
            cell = lab_grid[i * block : (i + 1) * block, j * block : (j + 1) * block].reshape(-1, 3)
            mean = cell.mean(axis=0)
            centre = mean.copy()
            centre[0] = min(centre[0] * (1.0 + 0.5 * g.absorb_edge_dark), 1.0)
            edge = mean.copy()
            edge[0] *= 1.0 - g.edge_ring_dark
            edge[1:] *= 1.0 + g.edge_ring_sat
            cid = f"c{i}_{j}"
            defs.append(
                f'<radialGradient id="{cid}"><stop offset="0" stop-color="{hexrgb(centre)}"/>'
                f'<stop offset="{g.edge_ring_start:.2f}" stop-color="{hexrgb(mean)}"/>'
                f'<stop offset="1" stop-color="{hexrgb(edge)}"/></radialGradient>'
            )
            defs.append(f'<clipPath id="k{i}_{j}"><circle r="{radius:.2f}"/></clipPath>')
            cx = (margin + j + 0.5) * pitch
            cy = (margin + i + 0.5) * pitch
            blobs = []
            for k in range(block * block):
                sx = (k % block) - (block - 1) / 2.0
                sy = (k // block) - (block - 1) / 2.0
                blobs.append(
                    f'<circle cx="{sx * radius * 0.62:.2f}" cy="{sy * radius * 0.62:.2f}" '
                    f'r="{radius * 0.62:.2f}" fill="{hexrgb(cell[k])}" fill-opacity="0.55"/>'
                )
            body.append(
                f'<g transform="translate({cx:.2f} {cy:.2f})">'
                f'<circle r="{radius:.2f}" fill="url(#{cid})"/>'
                f'<g clip-path="url(#k{i}_{j})">{"".join(blobs)}</g>'
                f'<path d="{sliver}" fill="none" stroke="#ffffff" '
                f'stroke-opacity="{g.glint_strength:.2f}" '
                f'stroke-width="{radius * 0.10:.2f}" stroke-linecap="round"/></g>'
            )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side}" '
        f'viewBox="0 0 {side} {side}">\n<defs>\n' + "\n".join(defs) + "\n</defs>\n"
        f'<rect width="{side}" height="{side}" fill="{config.render.background}"/>\n'
        + "\n".join(body)
        + "\n</svg>\n"
    )
