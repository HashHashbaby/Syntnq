"""Hit counts and kernel-smoothed occupancy (docs/ANALYSIS.md section 6)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy.ndimage import gaussian_filter

from synesthesia.config import Config

Array = npt.NDArray[np.float64]

N_COLOR_FEATURES = 5  # brightness, loudness, noisiness, harmonicity, change
_HARMONICITY_ROW = 3


@dataclass(frozen=True)
class CellStats:
    """Per-cell statistics in oriented unit order.

    Attributes:
        hits: ``(K,)`` uint32 frames per unit.
        occ_norm: ``(K,)`` float64 in [0, 1].
        cell_features: ``(5, K)`` float64 mean color features per unit (physical units).
        empty: ``(K,)`` bool, ``occ_norm < empty_threshold``.
    """

    hits: npt.NDArray[np.uint32]
    occ_norm: Array
    cell_features: Array
    empty: npt.NDArray[np.bool_]


def cell_statistics(
    bmu: npt.NDArray[np.uint16],
    f_color: Array,
    prototype_color: Array,
    config: Config,
) -> CellStats:
    """Compute hits, occupancy and per-cell mean features.

    Args:
        bmu: ``(T,)`` oriented unit index per frame.
        f_color: ``(T, 5)`` physical-unit color features per frame.
        prototype_color: ``(K, 4)`` physical-unit prototype values of brightness, loudness,
            noisiness, change (used for units with no hits).
        config: resolved configuration.

    Returns:
        :class:`CellStats`. Harmonicity is not a layout dimension, so empty units take a
        hit-weighted Gaussian average of their neighbors (global mean when isolated).
    """
    size = config.grid.size
    k_units = size * size
    hits = np.bincount(bmu, minlength=k_units).astype(np.uint32)
    sigma = config.occupancy.kernel_sigma_cells

    smooth = gaussian_filter(hits.reshape(size, size).astype(np.float64), sigma, mode="constant")
    peak = smooth.max()
    occ = (smooth / peak) if peak > 0 else smooth
    occ_norm = (occ**config.occupancy.gamma).ravel()

    counts = hits.astype(np.float64)
    means = np.empty((N_COLOR_FEATURES, k_units), dtype=np.float64)
    for f in range(N_COLOR_FEATURES):
        sums = np.bincount(bmu, weights=f_color[:, f], minlength=k_units)
        means[f] = np.divide(sums, counts, out=np.zeros(k_units), where=counts > 0)

    has = counts > 0
    proto_rows = (0, 1, 2, 4)  # brightness, loudness, noisiness, change
    for j, f in enumerate(proto_rows):
        means[f, ~has] = prototype_color[~has, j]

    h_sum = np.bincount(bmu, weights=f_color[:, _HARMONICITY_ROW], minlength=k_units)
    num = gaussian_filter(h_sum.reshape(size, size), sigma, mode="constant").ravel()
    den = gaussian_filter(counts.reshape(size, size), sigma, mode="constant").ravel()
    global_mean = float(f_color[:, _HARMONICITY_ROW].mean())
    fill = np.where(den > 0, num / np.where(den > 0, den, 1.0), global_mean)
    means[_HARMONICITY_ROW, ~has] = fill[~has]

    return CellStats(
        hits=hits,
        occ_norm=occ_norm,
        cell_features=means,
        empty=occ_norm < config.occupancy.empty_threshold,
    )
