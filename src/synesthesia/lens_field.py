"""Colour field under the glass lenses: Catmull-Rom interpolation in OKLab plus a swirl warp.

Display layout (docs/ANALYSIS.md section 12, D-027): the analysis grid stays ``size x size``
(64 x 64); the display is ``size / display_block`` lenses per side (32 x 32), each covering a
``display_block x display_block`` block of analysis cells. Coordinates below are in *lens units*
unless stated: one lens pitch = 1, lens centre at the origin, cell pitch = ``1 / display_block``.

The shader implements exactly these functions; this module is the reference used by the tests
(mean-colour and half-preservation invariants).
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

Array = npt.NDArray[np.float64]


def catmull_rom_weights(t: Array) -> Array:
    """Catmull-Rom (tension 0.5) weights for the 4 taps around ``t`` in [0, 1): ``(..., 4)``."""
    t2, t3 = t * t, t * t * t
    return np.stack(
        [
            -0.5 * t3 + t2 - 0.5 * t,
            1.5 * t3 - 2.5 * t2 + 1.0,
            -1.5 * t3 + 2.0 * t2 + 0.5 * t,
            0.5 * t3 - 0.5 * t2,
        ],
        axis=-1,
    )


def sample_field(grid: Array, x: Array, y: Array) -> Array:
    """Bicubic Catmull-Rom sample of a ``(H, W, C)`` grid at cell coordinates.

    Args:
        grid: ``(H, W, C)`` values at the cell centres (OKLab for colours).
        x, y: sample positions in cell units; cell ``(i, j)`` is centred at ``(j + 0.5, i + 0.5)``.

    Returns:
        ``(..., C)`` interpolated values; edges clamp. The spline passes through the cell centres.
    """
    h, w, _ = grid.shape
    gx, gy = np.asarray(x) - 0.5, np.asarray(y) - 0.5
    x0, y0 = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
    wx, wy = catmull_rom_weights(gx - x0), catmull_rom_weights(gy - y0)
    out = np.zeros(np.shape(gx) + (grid.shape[2],))
    for dj in range(4):
        xi = np.clip(x0 + dj - 1, 0, w - 1)
        for di in range(4):
            yi = np.clip(y0 + di - 1, 0, h - 1)
            out += (wx[..., dj] * wy[..., di])[..., None] * grid[yi, xi]
    return out


def swirl_angle(r: Array, radius: float, peak_rad: float, power: float) -> Array:
    """Rotation angle (radians) at distance ``r`` from the lens centre: ``peak * (1 - s)^power``."""
    s = np.clip(np.asarray(r) / radius, 0.0, 1.0)
    return np.asarray(peak_rad * (1.0 - s) ** power)


def swirl_warp(
    qx: Array, qy: Array, radius: float, peak_rad: float, power: float
) -> tuple[Array, Array]:
    """Rotate lens-space points by the ring-dependent swirl angle (area preserving).

    Each ring ``r = const`` is rotated rigidly, so the mean over any disc about the centre is
    unchanged, and points outside ``radius`` do not move.
    """
    r = np.hypot(qx, qy)
    a = swirl_angle(r, radius, peak_rad, power)
    c, s = np.cos(a), np.sin(a)
    return qx * c - qy * s, qx * s + qy * c


def lens_color(
    grid_lab: Array,
    lens_row: int,
    lens_col: int,
    qx: Array,
    qy: Array,
    *,
    block: int,
    radius: float,
    peak_rad: float,
    power: float,
) -> Array:
    """Colour field value (OKLab) at lens-space offsets ``(qx, qy)`` of lens ``(row, col)``.

    The swirl is applied to the sample position, then the continuous field is read.
    """
    wx, wy = swirl_warp(qx, qy, radius, peak_rad, power)
    cx, cy = (lens_col + 0.5) * block, (lens_row + 0.5) * block  # lens centre in cell units
    return sample_field(grid_lab, cx + wx * block, cy + wy * block)


_FLOW_SMOOTH_CELLS = 1.2  # smoothing of the response field before taking its gradient


def flow_field(activation: Array, size: int) -> npt.NDArray[np.float32]:
    """Flow texture from the per-cell live activation ``clamp(A + ring)``.

    Returns:
        ``(size, size, 3)`` float32 with channels ``(d/dx, d/dy, value)`` of the lightly smoothed
        field, in cell units; it tilts the lens surface and drives the swirl in live mode.
    """
    from scipy.ndimage import gaussian_filter

    field = gaussian_filter(activation.reshape(size, size).astype(np.float32), _FLOW_SMOOTH_CELLS)
    gy, gx = np.gradient(field)
    return np.stack([gx, gy, field], axis=-1).astype(np.float32)
