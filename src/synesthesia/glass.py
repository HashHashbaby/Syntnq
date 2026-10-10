"""Analytic "liquid glass" dot shading (look development, docs/ANALYSIS.md section 12).

One per-pixel model, written so every line has a direct fragment-shader equivalent:

- inputs: a ``(size, size, 3)`` sRGB cell-color grid (one texel per cell) and the pixel position;
- own cell by integer division, dot as an analytic signed-distance disc, a fake sphere normal
  from the in-cell position, one blurred-grid tap for cheap refraction;
- no per-cell textures, no ray tracing, no loops over cells.

Specular, rim, sweep and edge terms are constant neutral white (never tinted by data). The data
color keeps its hue, chroma and lightness: bead shading is centered so the cell mean is unchanged.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
from scipy.ndimage import gaussian_filter

from synesthesia.config import Config

F32 = npt.NDArray[np.float32]

_BLUR_SIGMA_CELLS = 0.7  # blurred copy of the cell grid used for refraction and frost
_AA_FLOOR = 1e-4
_TWO_PI = 2.0 * np.pi


def _smoothstep(e0: F32 | float, e1: F32 | float, x: F32) -> F32:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0).astype(np.float32)
    return np.asarray(t * t * (3.0 - 2.0 * t), dtype=np.float32)


def _bilinear(grid: F32, u: F32, v: F32) -> F32:
    """Linear texture fetch of a ``(h, w, 3)`` grid at cell coordinates (texel centers at +0.5)."""
    h, w, _ = grid.shape
    gu = np.clip(u - 0.5, 0.0, w - 1.0)
    gv = np.clip(v - 0.5, 0.0, h - 1.0)
    u0, v0 = np.floor(gu).astype(np.int32), np.floor(gv).astype(np.int32)
    u1, v1 = np.minimum(u0 + 1, w - 1), np.minimum(v0 + 1, h - 1)
    fu, fv = (gu - u0)[..., None], (gv - v0)[..., None]
    top = grid[v0, u0] * (1 - fu) + grid[v0, u1] * fu
    bot = grid[v1, u0] * (1 - fu) + grid[v1, u1] * fu
    return np.asarray(top * (1 - fv) + bot * fv, dtype=np.float32)


def _normalize3(x: F32, y: F32, z: F32) -> tuple[F32, F32, F32]:
    n = np.sqrt(x * x + y * y + z * z) + _AA_FLOOR
    return x / n, y / n, z / n


def shade(
    xs: F32,
    ys: F32,
    grid: F32,
    config: Config,
    variant: str,
    side_px: float,
    *,
    strength_scale: float = 1.0,
) -> F32:
    """Shade pixels of a ``side_px`` frame.

    Args:
        xs, ys: ``(H, W)`` pixel coordinates in frame pixels (pixel centers at +0.5).
        grid: ``(size, size, 3)`` float32 sRGB in [0, 1], one texel per cell.
        config: resolved configuration (``render.glass``, ``render.*``, ``grid.size``).
        variant: ``flat``, ``beads``, ``sheet`` or ``combo``.
        side_px: frame side in pixels the coordinates refer to.
        strength_scale: extra multiplier on all decoration (used by ``combo``).

    Returns:
        ``(H, W, 3)`` float32 sRGB in [0, 1] before bloom.
    """
    rc, g = config.render, config.render.glass
    size = grid.shape[0]
    pitch = side_px / (size + 2.0 * rc.margin_cells)
    strength = g.strength * strength_scale
    radius = rc.dot_radius_ratio
    aa = 1.0 / pitch

    u = xs / pitch - rc.margin_cells
    v = ys / pitch - rc.margin_cells
    blurred = np.asarray(
        gaussian_filter(grid, sigma=(_BLUR_SIGMA_CELLS, _BLUR_SIGMA_CELLS, 0), mode="nearest"),
        dtype=np.float32,
    )

    if variant == "sheet":
        # slow warp of the dots under the pane (a refractive sheet), plus a frost mix
        wl = g.sheet.warp_wavelength_cells
        wu = g.sheet.warp_amp * np.sin(_TWO_PI * (0.83 * u + 0.37 * v) / wl + 0.6)
        wv = g.sheet.warp_amp * np.sin(_TWO_PI * (0.29 * u - 0.91 * v) / wl + 2.1)
        u, v = u + wu * strength, v + wv * strength

    col = np.clip(np.floor(u), 0, size - 1).astype(np.int32)
    row = np.clip(np.floor(v), 0, size - 1).astype(np.int32)
    inside = (u >= 0) & (u < size) & (v >= 0) & (v < size)
    px = (u - col - 0.5).astype(np.float32)
    py = (v - row - 0.5).astype(np.float32)
    r = np.hypot(px, py)
    cover = np.clip((radius - r) / aa + 0.5, 0.0, 1.0) * inside
    data = grid[row, col]  # (H, W, 3) the cell's data color

    if variant in ("flat", "sheet"):
        body = data
        if variant == "sheet":
            frosted = _bilinear(blurred, u, v)
            body = data * (1.0 - g.sheet.frost * strength) + frosted * (g.sheet.frost * strength)
        out = body * cover[..., None]
    else:
        # --- bead: fake sphere normal from the in-cell position -----------------------------
        rr = np.minimum(r / radius, 1.0)
        h = np.sqrt(np.maximum(1.0 - rr * rr, 0.0))
        nx, ny, nz = px / radius * (rr < 1.0), py / radius * (rr < 1.0), h
        ld = np.asarray(g.light_dir, dtype=np.float32)
        ld = ld / np.linalg.norm(ld)
        lx, ly, lz = (np.float32(c) for c in ld)
        ndl = nx * lx + ny * ly + nz * lz
        n0 = lz  # the center-normal reference keeps the mean lightness of the data
        shade_rel = 1.0 + strength * g.shade_strength * (ndl - n0)
        glow = 1.0 + strength * g.inner_glow * (h - 0.6)
        body = data * (shade_rel * glow)[..., None]

        # cheap refraction: one tap of the blurred grid, offset by the normal, rim-weighted
        off = g.refraction * strength
        refr = _bilinear(blurred, u - nx * off, v - ny * off)
        mix = (g.refraction_mix * strength * (1.0 - h))[..., None]
        body = body * (1.0 - mix) + refr * mix

        # neutral white decoration: Blinn-Phong specular + thin Fresnel rim
        hv = np.array([lx, ly, lz + 1.0], dtype=np.float32)
        hv = hv / np.linalg.norm(hv)
        hx, hy, hz = (np.float32(c) for c in hv)
        spec = np.maximum(nx * hx + ny * hy + nz * hz, 0.0) ** g.spec_power
        spec = spec * g.spec_strength * strength
        rim_t = _smoothstep(radius - g.rim_width, radius - 0.5 * aa, r)
        lit_side = 0.65 + 0.35 * np.clip(-(px * lx + py * ly) / (r + _AA_FLOOR), -1.0, 1.0)
        rim = rim_t * g.rim_strength * strength * lit_side
        white = np.clip(spec + rim, 0.0, 1.0)[..., None]
        out = np.clip(body, 0.0, 1.0) * cover[..., None]
        out = out + white * cover[..., None] * (1.0 - out)  # screen toward neutral white

        # data-colored caustic on the ground, opposite the light
        ox, oy = (
            -lx / np.hypot(lx, ly) * g.caustic_offset,
            -ly / np.hypot(lx, ly) * g.caustic_offset,
        )
        d2 = (px - ox) ** 2 + (py - oy) ** 2
        window = 1.0 - _smoothstep(0.36, 0.5, np.maximum(np.abs(px), np.abs(py)))
        blob = np.exp(-d2 / (2.0 * g.caustic_sigma**2)) * g.caustic_strength * strength * window
        out = out + data * (blob * (1.0 - cover) * inside)[..., None]

    if variant in ("sheet", "combo"):
        sc = strength_scale if variant == "combo" else 1.0
        sh = g.sheet
        t = (xs / side_px) * 0.78 + (ys / side_px) * 0.62  # diagonal, top-left -> bottom-right
        sweep = np.exp(-(((t - sh.sweep_pos) / sh.sweep_width) ** 2))
        sweep2 = 0.45 * np.exp(-(((t - (sh.sweep_pos + 0.42)) / (1.6 * sh.sweep_width)) ** 2))
        glare = (sweep + sweep2) * sh.sweep_strength * g.strength * sc
        e = np.minimum.reduce([xs, ys, side_px - xs, side_px - ys]) / side_px
        edge_line = np.exp(-(((e - 1.5 * sh.edge_width) / sh.edge_width) ** 2))
        top_left = 0.55 + 0.45 * np.clip(1.0 - (xs + ys) / side_px, 0.0, 1.0)
        edge = edge_line * sh.edge_strength * g.strength * sc * top_left
        white2 = np.clip(glare + edge, 0.0, 1.0)[..., None]
        out = out + white2 * (1.0 - out)

    return np.asarray(np.clip(out, 0.0, 1.0), dtype=np.float32)


def bloom(img: F32, config: Config, side_px: float) -> F32:
    """Screen-blended Gaussian glow, same as the flat renderer (``render.glow_*``)."""
    rc = config.render
    pitch = side_px / (config.grid.size + 2.0 * rc.margin_cells)
    sigma = rc.glow_sigma_ratio * pitch
    glow = np.asarray(
        gaussian_filter(img, sigma=(sigma, sigma, 0), mode="constant"), dtype=np.float32
    )
    return np.asarray(1.0 - (1.0 - img) * (1.0 - glow * rc.glow_opacity), dtype=np.float32)


def render_variant(
    srgb: npt.NDArray[np.uint8],
    config: Config,
    variant: str,
    px: int,
    *,
    window: tuple[int, int, int, int] | None = None,
    zoom: int = 1,
    pad: int = 0,
) -> npt.NDArray[np.uint8]:
    """Render a frame or a zoomed window of it.

    Args:
        srgb: ``(K, 3)`` uint8 cell colors.
        config: resolved configuration.
        variant: ``flat``, ``beads``, ``sheet`` or ``combo``.
        px: nominal frame side in pixels.
        window: ``(x0, y0, x1, y1)`` in nominal pixels, or ``None`` for the whole frame.
        zoom: output pixels per nominal pixel inside the window.
        pad: nominal pixels of context rendered around the window for the bloom, then trimmed.

    Returns:
        ``(H, W, 3)`` uint8.
    """
    size = config.grid.size
    grid = (srgb.reshape(size, size, 3).astype(np.float32)) / 255.0
    x0, y0, x1, y1 = window if window is not None else (0, 0, px, px)
    wx0, wy0, wx1, wy1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    xs_1d = (wx0 + (np.arange((wx1 - wx0) * zoom, dtype=np.float32) + 0.5) / zoom).astype(
        np.float32
    )
    ys_1d = (wy0 + (np.arange((wy1 - wy0) * zoom, dtype=np.float32) + 0.5) / zoom).astype(
        np.float32
    )
    xs, ys = np.meshgrid(xs_1d, ys_1d)
    scale = config.render.glass.combo_scale if variant == "combo" else 1.0
    img = shade(xs, ys, grid, config, variant, float(px), strength_scale=scale)
    # bloom radius is in nominal pixels; at zoom it grows with the zoom
    img = bloom(img, config, float(px) * zoom)
    if pad:
        p = pad * zoom
        img = img[p:-p, p:-p]
    return np.asarray(np.rint(img * 255.0), dtype=np.uint8)
