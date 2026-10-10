"""Feature grids: the five normalized color features per cell (docs/ANALYSIS.md section 8)."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config

Array = npt.NDArray[np.float64]


def feature_grids(normalized: Array, config: Config) -> npt.NDArray[np.float32]:
    """Reshape per-cell normalized features into ``(5, size, size)`` grids.

    Args:
        normalized: ``(5, K)`` features in [0, 1] (section 7 normalization), oriented order,
            rows brightness, loudness, noisiness, harmonicity, change.
        config: resolved configuration (``grid.size``).

    Returns:
        ``(5, size, size)`` float32; ``grid[f, row, col] = normalized[f, row * size + col]``.
    """
    size = config.grid.size
    return np.asarray(normalized.reshape(-1, size, size), dtype=np.float32)
