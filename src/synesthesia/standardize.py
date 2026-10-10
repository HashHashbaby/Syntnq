"""Layout standardization and block weights (docs/ANALYSIS.md section 3).

Layout column order: ``[mfcc c1..c13, brightness, loudness, noisiness, change]`` (D = 17).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config

STD_FLOOR = 1e-8  # per-column std floor, docs/ANALYSIS.md section 3


@dataclass(frozen=True)
class LayoutSpace:
    """Standardized, weighted layout features and the parameters that produced them.

    Attributes:
        features: ``(T, D)`` float64, per-song z-scored and block weighted.
        mean: ``(D,)`` float64 per-column mean of the raw layout matrix.
        scale: ``(D,)`` float64 per-column std (floored).
        weights: ``(D,)`` float64 multiplier applied after z-scoring.
    """

    features: npt.NDArray[np.float64]
    mean: npt.NDArray[np.float64]
    scale: npt.NDArray[np.float64]
    weights: npt.NDArray[np.float64]


def layout_columns(config: Config) -> dict[str, slice]:
    """Column slices of the layout matrix by block name."""
    lo, hi = config.features.mfcc.use
    n_mfcc = hi - lo + 1
    return {
        "timbre": slice(0, n_mfcc),
        "brightness": slice(n_mfcc, n_mfcc + 1),
        "loudness": slice(n_mfcc + 1, n_mfcc + 2),
        "noisiness": slice(n_mfcc + 2, n_mfcc + 3),
        "change": slice(n_mfcc + 3, n_mfcc + 4),
    }


def zscore(
    x: npt.NDArray[np.float64],
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Per-column z-score with a std floor.

    Args:
        x: ``(T, D)`` float64.

    Returns:
        ``(z, mean, std)`` with shapes ``(T, D)``, ``(D,)``, ``(D,)``.
    """
    mean = x.mean(axis=0)
    std = np.maximum(x.std(axis=0), STD_FLOOR)
    return (x - mean) / std, mean, std


def block_weights(config: Config) -> npt.NDArray[np.float64]:
    """``(D,)`` multipliers: ``block weight / sqrt(block dims)`` per column."""
    cols = layout_columns(config)
    bw = config.layout.block_weights
    weights = np.zeros(config.layout_dim, dtype=np.float64)
    for name, sl in cols.items():
        dims = sl.stop - sl.start
        weights[sl] = getattr(bw, name) / np.sqrt(dims)
    return weights


def build_layout(raw: npt.NDArray[np.float64], config: Config) -> LayoutSpace:
    """Standardize and weight a raw layout matrix.

    Args:
        raw: ``(T, D)`` float64 in physical units, columns as in :func:`layout_columns`.
        config: resolved configuration.

    Returns:
        :class:`LayoutSpace` with everything needed to project other frames identically.
    """
    if raw.shape[1] != config.layout_dim:
        raise ValueError(f"expected {config.layout_dim} columns, got {raw.shape[1]}")
    z, mean, std = zscore(raw)
    weights = block_weights(config)
    return LayoutSpace(z * weights, mean, std, weights)


def project(raw: npt.NDArray[np.float64], space: LayoutSpace) -> npt.NDArray[np.float64]:
    """Project raw ``(T, D)`` frames into an existing layout space."""
    return (raw - space.mean) / space.scale * space.weights


def to_physical(layout: npt.NDArray[np.float64], space: LayoutSpace) -> npt.NDArray[np.float64]:
    """Invert :func:`project`: layout-space ``(..., D)`` back to physical units."""
    return layout / space.weights * space.scale + space.mean
