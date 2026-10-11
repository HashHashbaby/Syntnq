"""OKLab/OKLCH mapping and sRGB gamut mapping (docs/ANALYSIS.md section 7).

Own implementation of Bjorn Ottosson's OKLab (no third-party color library) so results are
identical everywhere. The inverse matrices are numerical inverses of the published forward
matrices, so the round trip is exact to float64 precision.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy.ndimage import gaussian_filter

from synesthesia.config import Config

Array = npt.NDArray[np.float64]

# Linear sRGB -> LMS (Ottosson).
_M1 = np.array(
    [
        [0.4122214708, 0.5363325363, 0.0514459929],
        [0.2119034982, 0.6806995451, 0.1073969566],
        [0.0883024619, 0.2817188376, 0.6299787005],
    ]
)
# LMS' (cube-rooted) -> OKLab (Ottosson).
_M2 = np.array(
    [
        [0.2104542553, 0.7936177850, -0.0040720468],
        [1.9779984951, -2.4285922050, 0.4505937099],
        [0.0259040371, 0.7827717662, -0.8086757660],
    ]
)
_M1_INV = np.linalg.inv(_M1)
_M2_INV = np.linalg.inv(_M2)

_GAMUT_STEPS = 24  # bisection steps (spec)
_SRGB_LINEAR_BREAK = 0.0031308
_SRGB_LINEAR_SLOPE = 12.92
_SRGB_GAMMA = 2.4
_SRGB_A = 0.055
_GAMUT_EPS = 1e-9  # numerical slack when testing channels against [0, 1]
_MAX_8BIT = 255.0


def oklab_to_linear_srgb(lab: Array) -> Array:
    """OKLab ``(..., 3)`` to linear sRGB ``(..., 3)`` (not clipped)."""
    lms_ = lab @ _M2_INV.T
    return np.asarray((lms_**3) @ _M1_INV.T, dtype=np.float64)


def linear_srgb_to_oklab(rgb: Array) -> Array:
    """Linear sRGB ``(..., 3)`` to OKLab ``(..., 3)``."""
    lms_ = np.cbrt(rgb @ _M1.T)
    return np.asarray(lms_ @ _M2.T, dtype=np.float64)


def oklch_to_oklab(lch: Array) -> Array:
    """OKLCH ``(..., 3)`` with hue in degrees to OKLab."""
    h = np.deg2rad(lch[..., 2])
    return np.stack([lch[..., 0], lch[..., 1] * np.cos(h), lch[..., 1] * np.sin(h)], axis=-1)


def oklab_to_oklch(lab: Array) -> Array:
    """OKLab to OKLCH (hue in degrees, [0, 360))."""
    h = np.rad2deg(np.arctan2(lab[..., 2], lab[..., 1])) % 360.0
    return np.stack([lab[..., 0], np.hypot(lab[..., 1], lab[..., 2]), h], axis=-1)


def _in_gamut(rgb_lin: Array) -> npt.NDArray[np.bool_]:
    return np.asarray(np.all((rgb_lin >= -_GAMUT_EPS) & (rgb_lin <= 1.0 + _GAMUT_EPS), axis=-1))


def gamut_map(lch: Array) -> Array:
    """Reduce chroma at fixed L and H until each color is inside sRGB.

    Args:
        lch: ``(N, 3)`` OKLCH.

    Returns:
        ``(N, 3)`` OKLCH with chroma reduced where needed (bisection, 24 steps).
    """
    out = lch.copy()
    inside = _in_gamut(oklab_to_linear_srgb(oklch_to_oklab(lch)))
    if inside.all():
        return out
    idx = np.flatnonzero(~inside)
    lo = np.zeros(idx.size)
    hi = lch[idx, 1].copy()
    trial = lch[idx].copy()
    for _ in range(_GAMUT_STEPS):
        mid = 0.5 * (lo + hi)
        trial[:, 1] = mid
        ok = _in_gamut(oklab_to_linear_srgb(oklch_to_oklab(trial)))
        lo = np.where(ok, mid, lo)
        hi = np.where(ok, hi, mid)
    out[idx, 1] = lo
    return out


def linear_to_srgb8(rgb_lin: Array) -> npt.NDArray[np.uint8]:
    """Linear sRGB ``(..., 3)`` to gamma-encoded uint8."""
    c = np.clip(rgb_lin, 0.0, 1.0)
    enc = np.where(
        c <= _SRGB_LINEAR_BREAK,
        _SRGB_LINEAR_SLOPE * c,
        (1.0 + _SRGB_A) * np.power(c, 1.0 / _SRGB_GAMMA) - _SRGB_A,
    )
    return np.asarray(np.rint(enc * _MAX_8BIT), dtype=np.uint8)


def srgb8_to_linear(srgb8: npt.NDArray[np.uint8]) -> Array:
    """Gamma-encoded uint8 sRGB ``(..., 3)`` to linear sRGB float64."""
    c = srgb8.astype(np.float64) / _MAX_8BIT
    return np.asarray(
        np.where(
            c <= _SRGB_LINEAR_BREAK * _SRGB_LINEAR_SLOPE,
            c / _SRGB_LINEAR_SLOPE,
            np.power((c + _SRGB_A) / (1.0 + _SRGB_A), _SRGB_GAMMA),
        ),
        dtype=np.float64,
    )


def normalize_features(cell_features: Array, config: Config) -> Array:
    """Normalize ``(5, K)`` (or ``(T, 5)`` via transpose) physical features with global ranges.

    Args:
        cell_features: ``(5, K)`` rows brightness, loudness, noisiness, harmonicity, change.
        config: resolved configuration (``color.ranges``, calibration merged).

    Returns:
        ``(5, K)`` float64 in [0, 1].
    """
    r = config.color.ranges
    ranges = np.array(
        [r.centroid_log10_hz, r.loudness_dbfs, r.noisiness_log10, r.harmonicity, r.change_z]
    )
    lo, hi = ranges[:, 0:1], ranges[:, 1:2]
    return np.asarray(np.clip((cell_features - lo) / (hi - lo), 0.0, 1.0), dtype=np.float64)


@dataclass(frozen=True)
class SignatureColors:
    """Per-cell colors in oriented unit order.

    Attributes:
        oklch: ``(K, 3)`` float64 (L, C, hue in degrees) after gamut mapping.
        srgb: ``(K, 3)`` uint8.
        normalized: ``(5, K)`` normalized color features.
    """

    oklch: Array
    srgb: npt.NDArray[np.uint8]
    normalized: Array


def map_colors(
    cell_features: Array,
    occ_norm: Array,
    empty: npt.NDArray[np.bool_],
    config: Config,
    valence: Array | None = None,
    emotion: tuple[float, float] | None = None,
) -> SignatureColors:
    """Map per-cell features to colors.

    Hue = brightness, lightness = occupancy + loudness, chroma = harmonicity.

    Args:
        cell_features: ``(5, K)`` physical features per cell.
        occ_norm: ``(K,)`` normalized occupancy.
        empty: ``(K,)`` empty-cell mask.
        config: resolved configuration.
        valence: optional ``(K,)`` normalized valence, used only when ``valence_blend > 0``.
        emotion: optional song-level ``(valence, arousal)`` in [-1, 1]; applied when
            ``color.emotion.enabled`` (D-036). Empty cells are not changed.

    Returns:
        :class:`SignatureColors`.
    """
    cc = config.color
    if cc.space != "oklch" or cc.gamut != "srgb_chroma_bisect":
        raise ValueError("only oklch with srgb_chroma_bisect is implemented")
    n = normalize_features(cell_features, config)
    t = n[0]
    if cc.hue.valence_blend > 0.0:
        if valence is None:
            raise ValueError("color.hue.valence_blend > 0 requires valence")
        t = (1.0 - cc.hue.valence_blend) * t + cc.hue.valence_blend * valence
    em = cc.emotion
    use_emotion = em.enabled and emotion is not None
    if use_emotion:
        assert emotion is not None
        t = np.clip(t + em.gain_hue * emotion[0], 0.0, 1.0)
    hue = cc.hue.from_deg + (cc.hue.to_deg - cc.hue.from_deg) * t
    lt, ch = cc.lightness, cc.chroma
    light = lt.min + (lt.max - lt.min) * (
        lt.occupancy_weight * occ_norm + lt.loudness_weight * n[1]
    )
    chroma = ch.min + (ch.max - ch.min) * n[3]
    if use_emotion:
        assert emotion is not None
        light = np.clip(light + em.gain_lightness * emotion[0], lt.min, lt.max)
        chroma = np.clip(chroma + em.gain_chroma * 0.5 * (emotion[0] + emotion[1]), 0.0, ch.max)
    light = np.where(empty, lt.empty_L, light)
    chroma = np.where(empty, chroma * lt.empty_chroma_factor, chroma)

    if cc.display_smoothing_sigma > 0.0:
        size = config.grid.size
        light = gaussian_filter(
            light.reshape(size, size), cc.display_smoothing_sigma, mode="nearest"
        ).ravel()

    lch = gamut_map(np.stack([light, chroma, hue], axis=-1))
    srgb = linear_to_srgb8(oklab_to_linear_srgb(oklch_to_oklab(lch)))
    return SignatureColors(oklch=lch, srgb=srgb, normalized=n)
