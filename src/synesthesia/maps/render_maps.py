"""Renders of the companion maps with captions and axes (docs/ANALYSIS.md sections 8, 11).

Every function takes the stored arrays (as read from ``arrays.npz``) so the same code serves
``syn analyze`` and ``syn render``. Feature grids are drawn with the configured node style, like
the hero image; the time-based maps are plain raster images with labelled axes.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import numpy.typing as npt
from PIL import Image, ImageDraw, ImageFont

from synesthesia.color import gamut_map, linear_to_srgb8, oklab_to_linear_srgb, oklch_to_oklab
from synesthesia.config import Config
from synesthesia.display import pool_colors
from synesthesia.nodes import get_node_style

Array = npt.NDArray[np.float64]

_BG = (0, 0, 0)
_FG = (225, 225, 225)
_DIM = (130, 130, 130)
_GRID = (60, 60, 60)
_ACCENT = (120, 200, 255)
_MARGIN_L, _MARGIN_R, _MARGIN_T, _MARGIN_B = 84, 24, 64, 56
_CAPTION_PX = 22
_TICK_PX = 14
_STRUCTURE_HUE_DEG = 250.0  # fixed sequential ramp of the structure and rhythm maps
_RHYTHM_HUE_DEG = 30.0
_BPM_TICKS = (60, 90, 120, 180, 240)
_LEGEND_STEPS = 64
_SECONDS_PER_MINUTE = 60.0


def _font(px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=px)


def ramp_srgb(values: Array, hue_deg: float, config: Config) -> npt.NDArray[np.uint8]:
    """Map values in [0, 1] to a dark -> light single-hue ramp.

    Args:
        values: array of any shape with values in [0, 1].
        hue_deg: OKLCH hue of the ramp.
        config: resolved configuration (``maps.ramp``).

    Returns:
        uint8 sRGB array with a trailing axis of 3.
    """
    rs = config.maps.ramp
    t = np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0)
    light = rs.lightness[0] + (rs.lightness[1] - rs.lightness[0]) * t
    lch = np.stack([light, np.full_like(t, rs.chroma), np.full_like(t, hue_deg)], axis=-1)
    lch = gamut_map(lch.reshape(-1, 3)).reshape(lch.shape)
    return linear_to_srgb8(oklab_to_linear_srgb(oklch_to_oklab(lch)))


def _frame(
    inner: Image.Image, caption: str, sub: str, x_label: str, y_label: str
) -> tuple[Image.Image, tuple[int, int]]:
    """Place ``inner`` on a black canvas with a caption; returns the canvas and inner origin."""
    w, h = inner.size
    canvas = Image.new("RGB", (w + _MARGIN_L + _MARGIN_R, h + _MARGIN_T + _MARGIN_B), _BG)
    canvas.paste(inner, (_MARGIN_L, _MARGIN_T))
    d = ImageDraw.Draw(canvas)
    d.text((_MARGIN_L, 10), caption, fill=_FG, font=_font(_CAPTION_PX))
    d.text((_MARGIN_L, 10 + _CAPTION_PX + 4), sub, fill=_DIM, font=_font(_TICK_PX))
    d.text((_MARGIN_L + w // 2 - 20, _MARGIN_T + h + 30), x_label, fill=_DIM, font=_font(_TICK_PX))
    d.text((6, _MARGIN_T + h // 2 - 8), y_label, fill=_DIM, font=_font(_TICK_PX))
    return canvas, (_MARGIN_L, _MARGIN_T)


def _x_time_ticks(
    canvas: Image.Image, origin: tuple[int, int], w: int, h: int, duration_s: float
) -> None:
    d = ImageDraw.Draw(canvas)
    step = _nice_step(duration_s / 6.0)
    t = 0.0
    while t <= duration_s + 1e-9:
        x = origin[0] + int(round(w * t / duration_s))
        d.line([(x, origin[1] + h), (x, origin[1] + h + 5)], fill=_DIM)
        d.text((x - 12, origin[1] + h + 8), f"{t:.0f}s", fill=_DIM, font=_font(_TICK_PX))
        t += step


def _nice_step(raw: float) -> float:
    for s in (1, 2, 5, 10, 15, 20, 30, 60, 120, 300):
        if s >= raw:
            return float(s)
    return 600.0


def render_feature_grid(
    grid: npt.NDArray[np.float32], name: str, config: Config, px: int
) -> Image.Image:
    """One normalized feature on the hero grid style, with a ramp legend.

    Args:
        grid: ``(size, size)`` values in [0, 1], oriented layout.
        name: feature name (selects the ramp hue).
        config: resolved configuration.
        px: side of the grid image in pixels.
    """
    hue = config.maps.ramp_hues[name].hue_deg
    srgb = ramp_srgb(grid.reshape(-1).astype(np.float64), hue, config)
    nodes = pool_colors(srgb, config)
    img = get_node_style(config).render_static(nodes, config.render.display_grid, px)
    legend = ramp_srgb(np.linspace(0.0, 1.0, _LEGEND_STEPS), hue, config)
    canvas = Image.new("RGB", (px, px + 56), _BG)
    canvas.paste(img, (0, 0))
    d = ImageDraw.Draw(canvas)
    bar_x0, bar_w, bar_y = px // 4, px // 2, px + 14
    for i in range(_LEGEND_STEPS):
        x0 = bar_x0 + i * bar_w // _LEGEND_STEPS
        x1 = bar_x0 + (i + 1) * bar_w // _LEGEND_STEPS
        d.rectangle((x0, bar_y, x1, bar_y + 10), fill=tuple(int(v) for v in legend[i]))
    d.text((bar_x0 - 40, bar_y - 3), "low", fill=_DIM, font=_font(_TICK_PX))
    d.text((bar_x0 + bar_w + 8, bar_y - 3), "high", fill=_DIM, font=_font(_TICK_PX))
    d.text((12, 12), name, fill=_FG, font=_font(_CAPTION_PX))
    return canvas


def render_structure(
    structure: npt.NDArray[np.float16], duration_s: float, config: Config, px: int
) -> Image.Image:
    """Self-similarity matrix (negative values drawn as 0) with time axes."""
    s = np.clip(structure.astype(np.float64), 0.0, 1.0)
    img = Image.fromarray(ramp_srgb(s, _STRUCTURE_HUE_DEG, config), "RGB").resize(
        (px, px), Image.Resampling.BILINEAR
    )
    canvas, origin = _frame(
        img,
        "Structure",
        "cosine self-similarity of 0.5 s blocks (timbre + harmony); bright = similar",
        "time",
        "time",
    )
    _x_time_ticks(canvas, origin, px, px, duration_s)
    d = ImageDraw.Draw(canvas)
    step = _nice_step(duration_s / 6.0)
    t = 0.0
    while t <= duration_s + 1e-9:
        y = origin[1] + int(round(px * t / duration_s))
        d.line([(origin[0] - 5, y), (origin[0], y)], fill=_DIM)
        d.text((origin[0] - 40, y - 6), f"{t:.0f}s", fill=_DIM, font=_font(_TICK_PX))
        t += step
    return canvas


def render_rhythm(
    tempogram: npt.NDArray[np.float16],
    tempo_bpm: float,
    pulse_clarity: float,
    duration_s: float,
    config: Config,
    px: int,
) -> Image.Image:
    """Tempogram (time on x, log BPM on y, high BPM at the top)."""
    rc = config.maps.rhythm
    tg = np.flipud(tempogram.astype(np.float64))
    h = px // 2
    img = Image.fromarray(ramp_srgb(tg, _RHYTHM_HUE_DEG, config), "RGB").resize(
        (px, h), Image.Resampling.BILINEAR
    )
    canvas, origin = _frame(
        img,
        "Rhythm",
        f"tempogram; tempo {tempo_bpm:.1f} BPM, pulse clarity {pulse_clarity:.2f}",
        "time",
        "BPM",
    )
    _x_time_ticks(canvas, origin, px, h, duration_s)
    d = ImageDraw.Draw(canvas)
    span = np.log(rc.bpm_max / rc.bpm_min)
    for bpm in _BPM_TICKS:
        if rc.bpm_min <= bpm <= rc.bpm_max:
            y = origin[1] + int(round(h * (1.0 - np.log(bpm / rc.bpm_min) / span)))
            d.line([(origin[0] - 5, y), (origin[0], y)], fill=_DIM)
            d.text((origin[0] - 38, y - 6), str(bpm), fill=_DIM, font=_font(_TICK_PX))
    if rc.bpm_min <= tempo_bpm <= rc.bpm_max:
        y = origin[1] + int(round(h * (1.0 - np.log(tempo_bpm / rc.bpm_min) / span)))
        d.line([(origin[0], y), (origin[0] + px, y)], fill=_ACCENT)
    return canvas


def render_dynamics(
    envelope: npt.NDArray[np.float32],
    hist: npt.NDArray[np.float32],
    lra_db: float,
    mean_db: float,
    peak_db: float,
    duration_s: float,
    config: Config,
    px: int,
) -> Image.Image:
    """Loudness over time (top) and the loudness histogram (bottom)."""
    lo, hi = config.maps.dynamics.hist_range_dbfs
    plot_h, hist_h = px // 3, px // 4
    inner = Image.new("RGB", (px, plot_h + 40 + hist_h), _BG)
    d = ImageDraw.Draw(inner)
    # envelope
    d.rectangle((0, 0, px - 1, plot_h - 1), outline=_GRID)
    for db in range(int(lo) + 10, int(hi), 10):
        y = int((hi - db) / (hi - lo) * plot_h)
        d.line([(0, y), (px, y)], fill=_GRID)
        d.text((4, y - 14), f"{db}", fill=_DIM, font=_font(_TICK_PX))
    n = envelope.size
    pts = [
        (i * (px - 1) / (n - 1), (hi - float(np.clip(envelope[i], lo, hi))) / (hi - lo) * plot_h)
        for i in range(n)
    ]
    d.line(pts, fill=_ACCENT, width=1)
    # histogram
    top = plot_h + 40
    peak = float(max(hist.max(), 1e-9))
    bw = px / hist.size
    for i, v in enumerate(hist):
        bh = int(round(float(v) / peak * (hist_h - 4)))
        d.rectangle(
            (int(i * bw) + 1, top + hist_h - bh, int((i + 1) * bw) - 1, top + hist_h),
            fill=(120, 170, 220),
        )
    for db in range(int(lo), int(hi) + 1, 10):
        x = int((db - lo) / (hi - lo) * (px - 1))
        d.text((x - 10, top + hist_h + 4), f"{db}", fill=_DIM, font=_font(_TICK_PX))
    canvas, origin = _frame(
        inner,
        "Dynamics",
        f"LRA {lra_db:.1f} dB, mean {mean_db:.1f} dBFS, peak {peak_db:.1f} dBFS",
        "dBFS (histogram)",
        "dBFS",
    )
    # replace the x label drawn by _frame under the histogram: time ticks go under the envelope
    d2 = ImageDraw.Draw(canvas)
    step = _nice_step(duration_s / 6.0)
    t = 0.0
    while t <= duration_s + 1e-9:
        x = origin[0] + int(round(px * t / duration_s))
        d2.text((x - 12, origin[1] + plot_h + 4), f"{t:.0f}s", fill=_DIM, font=_font(_TICK_PX))
        t += step
    return canvas


def render_all(
    arrays: dict[str, Any], signature: dict[str, Any], config: Config, px: int
) -> dict[str, Image.Image]:
    """Every companion-map render keyed by file stem (``features_<name>``, ``structure`` ...).

    Args:
        arrays: contents of ``arrays.npz``.
        signature: parsed ``signature.json``.
        config: resolved configuration.
        px: side of the main image in pixels.
    """
    duration = float(signature["song"]["duration_s"])
    out: dict[str, Image.Image] = {}
    for i, name in enumerate(config.maps.feature_grids):
        out[f"features_{name}"] = render_feature_grid(arrays["feature_grids"][i], name, config, px)
    out["structure"] = render_structure(arrays["structure"], duration, config, px)
    rh, dy = signature["rhythm"], signature["dynamics"]
    out["rhythm"] = render_rhythm(
        arrays["tempogram"], rh["tempo_bpm"], rh["pulse_clarity"], duration, config, px
    )
    out["dynamics"] = render_dynamics(
        arrays["dyn_envelope"],
        arrays["dyn_hist"],
        dy["lra_db"],
        dy["mean_loudness_db"],
        dy["peak_loudness_db"],
        duration,
        config,
        px,
    )
    return out
