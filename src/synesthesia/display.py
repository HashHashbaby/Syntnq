"""Display grid: the analysis grid pooled to the drawn grid (D-030).

The analysis (SOM, calibration, fingerprint, companion maps) always runs on ``grid.size`` cells.
What is *drawn* is ``render.display_grid`` nodes per side, each the mean of a ``block x block``
square of analysis cells (block = grid.size / display_grid). Colours are pooled in OKLab so a node
is the perceptual average of its cells. With ``display_grid == grid.size`` pooling is the identity.

Node index is ``row * n + col`` on the display grid, row 0 at the top.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from synesthesia.color import (
    linear_srgb_to_oklab,
    linear_to_srgb8,
    oklab_to_linear_srgb,
    srgb8_to_linear,
)
from synesthesia.config import Config

Array = npt.NDArray[np.float64]


def display_block(config: Config) -> int:
    """Analysis cells per display node side (``grid.size / render.display_grid``)."""
    size, n = config.grid.size, config.render.display_grid
    if n < 1 or size % n != 0:
        raise ValueError(f"render.display_grid {n} must divide grid.size {size}")
    return size // n


def _block_mean(values: Array, config: Config) -> Array:
    """``(K, C)`` per analysis cell -> ``(n*n, C)`` per display node (mean over each block)."""
    n, b = config.render.display_grid, display_block(config)
    grid = values.reshape(n, b, n, b, -1)
    pooled: Array = grid.mean(axis=(1, 3)).reshape(n * n, -1)
    return pooled


def pool_colors(srgb: npt.NDArray[np.uint8], config: Config) -> npt.NDArray[np.uint8]:
    """Pool ``(K, 3)`` uint8 sRGB cell colours to ``(n*n, 3)`` node colours (mean in OKLab)."""
    if display_block(config) == 1:
        return srgb
    lab = linear_srgb_to_oklab(srgb8_to_linear(srgb))
    return linear_to_srgb8(oklab_to_linear_srgb(_block_mean(lab, config)))


def pool_values(values: Array, config: Config) -> Array:
    """Pool a per-cell scalar ``(K,)`` to ``(n*n,)`` (mean over each block)."""
    return _block_mean(values.reshape(-1, 1), config)[:, 0]


def pool_trail(trail: Array, config: Config) -> Array:
    """Map ``(M, 3)`` trail rows ``(x_cell, y_cell, age)`` to display-node coordinates."""
    b = display_block(config)
    out = trail.copy()
    out[:, :2] = (trail[:, :2] + 0.5) / b - 0.5  # cell centres sit at +0.5 in cell units
    return out


@dataclass(frozen=True)
class DisplayFrame:
    """One drawn frame on the display grid.

    Attributes:
        srgb: ``(n*n, 3)`` uint8 node colours.
        radius_scale: ``(n*n,)`` node radius multiplier (1.0 = static radius).
        trail: ``(M, 3)`` rows ``(x_node, y_node, age_fraction)``, display-node units.
    """

    srgb: npt.NDArray[np.uint8]
    radius_scale: Array
    trail: Array


@dataclass(frozen=True)
class Raster:
    """Precomputed pixel -> node geometry for one output size."""

    px: int
    pitch: float
    cell: npt.NDArray[np.int32]  # (px, px) node index
    dist: Array  # (px, px) distance to the node center, in pixels
    valid: npt.NDArray[np.bool_]  # (px, px) inside the grid


def make_raster(px: int, config: Config) -> Raster:
    """Pixel-to-node maps for a ``px x px`` frame (same geometry as the static render)."""
    size, margin = config.render.display_grid, config.render.margin_cells
    pitch = px / (size + 2.0 * margin)
    coords = (np.arange(px) + 0.5) / pitch - margin  # node units, node c spans [c, c+1)
    col = np.floor(coords).astype(np.int64)
    inside = (col >= 0) & (col < size)
    colc = np.clip(col, 0, size - 1)
    cell = (colc[:, None] * size + colc[None, :]).astype(np.int32)
    valid = inside[:, None] & inside[None, :]
    cx = (colc + 0.5 + margin) * pitch
    dist = np.hypot(
        (np.arange(px) + 0.5)[:, None] - cx[:, None], (np.arange(px) + 0.5)[None, :] - cx[None, :]
    )
    return Raster(px=px, pitch=pitch, cell=cell, dist=dist, valid=valid)


def to_display(
    srgb: npt.NDArray[np.uint8], radius_scale: Array, trail: Array, config: Config
) -> DisplayFrame:
    """Pool one analysis-grid frame to the display grid."""
    return DisplayFrame(
        srgb=pool_colors(srgb, config),
        radius_scale=pool_values(radius_scale, config),
        trail=pool_trail(trail, config),
    )
