"""Static PNG renders (docs/ANALYSIS.md section 12).

The look of a node is not decided here: see ``nodes.py`` (D-030). This module pools the analysis
grid to the display grid, hands the nodes to the configured style, and writes files.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

from synesthesia.config import Config
from synesthesia.display import pool_colors
from synesthesia.nodes import get_node_style

_PNG_COMPRESS_LEVEL = 6  # fixed so identical pixels give identical bytes


def render_sound_map(
    srgb: npt.NDArray[np.uint8], config: Config, px: int | None = None
) -> Image.Image:
    """Render the signature as drawn nodes (display grid, node style from config).

    Args:
        srgb: ``(K, 3)`` uint8 per-cell colors on the analysis grid, ``i = row * size + col``.
        config: resolved configuration (``render.*``, ``grid.size``).
        px: output side in pixels; defaults to ``render.preview_px``.

    Returns:
        ``px x px`` RGB image.
    """
    side = px or config.render.preview_px
    nodes = pool_colors(srgb, config)
    return get_node_style(config).render_static(nodes, config.render.display_grid, side)


def png_bytes(image: Image.Image, metadata: dict[str, str]) -> bytes:
    """PNG bytes with text chunks and no timestamp (deterministic)."""
    import io

    info = PngInfo()
    for key in sorted(metadata):
        info.add_text(key, metadata[key])
    buf = io.BytesIO()
    image.save(buf, format="PNG", pnginfo=info, compress_level=_PNG_COMPRESS_LEVEL, optimize=False)
    return buf.getvalue()


def save_png(image: Image.Image, path: Path, metadata: dict[str, str]) -> None:
    """Write a PNG with text chunks and no timestamp (deterministic bytes)."""
    info = PngInfo()
    for key in sorted(metadata):
        info.add_text(key, metadata[key])
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", pnginfo=info, compress_level=_PNG_COMPRESS_LEVEL, optimize=False)


def render_svg(srgb: npt.NDArray[np.uint8], config: Config, px: int | None = None) -> str:
    """Vector sound map in the configured node style.

    Args:
        srgb: ``(K, 3)`` uint8 per-cell colors on the analysis grid, ``i = row * size + col``.
        config: resolved configuration (``render.*``, ``grid.size``).
        px: nominal side in pixels (the SVG scales); defaults to ``render.preview_px``.

    Returns:
        SVG document text (deterministic).
    """
    side = px or config.render.preview_px
    nodes = pool_colors(srgb, config)
    return get_node_style(config).svg(nodes, config.render.display_grid, side)


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
