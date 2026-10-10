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
