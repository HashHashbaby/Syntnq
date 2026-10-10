"""Canonical orientation of the map, 8 dihedral options (docs/ANALYSIS.md section 5).

Bright sounds end up toward the top, loud sounds toward the right, in every song.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.standardize import LayoutSpace, layout_columns, to_physical

Array = npt.NDArray[np.float64]

TRANSFORMS = (
    "identity",
    "rot90",
    "rot180",
    "rot270",
    "flipH",
    "flipV",
    "transpose",
    "antitranspose",
)


def apply_transform(grid: npt.NDArray[Any], name: str) -> npt.NDArray[Any]:
    """Apply a named dihedral transform to the first two axes of ``grid``."""
    if name == "identity":
        return grid
    if name == "rot90":
        return np.rot90(grid, 1, axes=(0, 1))
    if name == "rot180":
        return np.rot90(grid, 2, axes=(0, 1))
    if name == "rot270":
        return np.rot90(grid, 3, axes=(0, 1))
    if name == "flipH":
        return grid[:, ::-1]
    if name == "flipV":
        return grid[::-1]
    if name == "transpose":
        return np.swapaxes(grid, 0, 1)
    if name == "antitranspose":
        return np.swapaxes(grid, 0, 1)[::-1, ::-1]
    raise ValueError(f"unknown transform {name!r}")


@dataclass(frozen=True)
class Oriented:
    """Result of canonical orientation.

    Attributes:
        transform: name of the chosen dihedral transform.
        prototypes: ``(K, D)`` float64 in the oriented layout.
        bmu: ``(T,)`` uint16 oriented unit index per frame.
        old_to_new: ``(K,)`` int64 mapping an original unit index to its oriented index.
    """

    transform: str
    prototypes: Array
    bmu: npt.NDArray[np.uint16]
    old_to_new: npt.NDArray[np.int64]


def _corr(a: Array, b: Array) -> float:
    sa, sb = a.std(), b.std()
    if sa == 0.0 or sb == 0.0:
        return 0.0
    return float(np.mean((a - a.mean()) * (b - b.mean())) / (sa * sb))


def orient(
    prototypes: Array,
    bmu: npt.NDArray[np.uint16],
    space: LayoutSpace,
    config: Config,
) -> Oriented:
    """Choose and apply the canonical orientation.

    Args:
        prototypes: ``(K, D)`` float64 layout-space prototypes.
        bmu: ``(T,)`` uint16 unit index of each frame.
        space: layout standardization (to de-standardize brightness and loudness).
        config: resolved configuration.

    Returns:
        :class:`Oriented`. With ``orientation.enabled`` false the identity is returned.
    """
    size = config.grid.size
    k_units = size * size
    cols = layout_columns(config)
    grid = prototypes.reshape(size, size, -1)
    index = np.arange(k_units).reshape(size, size)

    if not config.orientation.enabled:
        best = "identity"
    else:
        physical = to_physical(prototypes, space).reshape(size, size, -1)
        up = physical[:, :, cols[config.orientation.up_feature].start]
        right = physical[:, :, cols[config.orientation.right_feature].start]
        rr, cc = np.meshgrid(
            np.arange(size, dtype=np.float64), np.arange(size, dtype=np.float64), indexing="ij"
        )
        best, best_score = TRANSFORMS[0], -np.inf
        for name in TRANSFORMS:  # fixed order: ties keep the first
            score = _corr(apply_transform(up, name).ravel(), -rr.ravel()) + _corr(
                apply_transform(right, name).ravel(), cc.ravel()
            )
            if score > best_score + 1e-12:
                best, best_score = name, score

    new_grid = np.ascontiguousarray(apply_transform(grid, best))
    old_at_new = np.ascontiguousarray(apply_transform(index, best)).ravel()
    old_to_new = np.empty(k_units, dtype=np.int64)
    old_to_new[old_at_new] = np.arange(k_units)
    return Oriented(
        transform=best,
        prototypes=new_grid.reshape(k_units, -1),
        bmu=old_to_new[bmu].astype(np.uint16),
        old_to_new=old_to_new,
    )
