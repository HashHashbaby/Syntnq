"""Batch SOM with PCA initialization, BMU search and metrics (docs/ANALYSIS.md section 4).

Deterministic: no sampling order, no learning rate, no randomness. Unit index is
``i = row * size + col``, row 0 at the top.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config

Array = npt.NDArray[np.float64]

_PCA_SPAN = 2.0  # init spans +-2 component std devs over the grid (spec)
_DEN_FLOOR = 1e-12  # keep the old prototype when the neighborhood mass is below this
_N_COMPONENTS = 2


@dataclass(frozen=True)
class SomResult:
    """Trained map and assignment of every frame.

    Attributes:
        prototypes: ``(K, D)`` float64, unit ``i = row * size + col``.
        bmu: ``(T,)`` uint16 best-matching unit of each frame.
        bmu_dist: ``(T,)`` float64 Euclidean distance to the BMU.
        quantization_error: mean ``bmu_dist``.
        topographic_error: share of training frames whose first two BMUs are not 8-neighbors.
        empty_units: share of units with zero hits over all frames.
    """

    prototypes: Array
    bmu: npt.NDArray[np.uint16]
    bmu_dist: Array
    quantization_error: float
    topographic_error: float
    empty_units: float


def training_subset(x: Array, max_frames: int) -> Array:
    """Deterministic stride: every ``ceil(T / max_frames)``-th frame starting at 0."""
    t = x.shape[0]
    if t <= max_frames:
        return x
    return x[:: math.ceil(t / max_frames)]


def pca_init(train: Array, size: int) -> Array:
    """PCA initialization of a ``size x size`` grid.

    Args:
        train: ``(T, D)`` float64 training frames.
        size: grid side.

    Returns:
        ``(size * size, D)`` float64 prototypes.
    """
    mean = train.mean(axis=0)
    centered = train - mean
    cov = centered.T @ centered / max(1, train.shape[0] - 1)
    u, s, _ = np.linalg.svd(cov)
    comps = u[:, :_N_COMPONENTS].T.copy()  # (2, D)
    for k in range(_N_COMPONENTS):  # sign fix: largest |loading| positive
        if comps[k, int(np.argmax(np.abs(comps[k])))] < 0.0:
            comps[k] = -comps[k]
    std = np.sqrt(np.maximum(s[:_N_COMPONENTS], 0.0))
    axis = np.linspace(-_PCA_SPAN, _PCA_SPAN, size)
    rows = axis[:, None, None] * std[0] * comps[0][None, None, :]
    cols = axis[None, :, None] * std[1] * comps[1][None, None, :]
    return np.asarray((mean + rows + cols).reshape(size * size, -1), dtype=np.float64)


def bmu_search(
    x: Array, w: Array, chunk: int, *, second: bool = False
) -> tuple[npt.NDArray[np.int64], Array, npt.NDArray[np.int64] | None]:
    """Best (and optionally second-best) matching unit per frame, chunked.

    Uses ``||x||^2 - 2 x.w + ||w||^2``; ties resolve to the lowest unit index.

    Args:
        x: ``(T, D)`` frames.
        w: ``(K, D)`` prototypes.
        chunk: frames per distance block.
        second: also return the second BMU.

    Returns:
        ``(bmu (T,), dist (T,) Euclidean, bmu2 (T,) | None)``.
    """
    t = x.shape[0]
    wn = np.einsum("kd,kd->k", w, w)
    w_scaled = np.ascontiguousarray(-2.0 * w.T)
    bmu = np.empty(t, dtype=np.int64)
    dist = np.empty(t, dtype=np.float64)
    bmu2 = np.empty(t, dtype=np.int64) if second else None
    buf = np.empty((min(chunk, t), w.shape[0]), dtype=np.float64)
    for a in range(0, t, chunk):
        xb = x[a : a + chunk]
        n = xb.shape[0]
        d = buf[:n]
        np.matmul(xb, w_scaled, out=d)  # -2 x.w
        d += wn[None, :]  # + ||w||^2 (||x||^2 is constant per row; added back below)
        idx = np.argmin(d, axis=1)
        rows = np.arange(n)
        xn = np.einsum("td,td->t", xb, xb)
        bmu[a : a + n] = idx
        dist[a : a + n] = np.sqrt(np.maximum(d[rows, idx] + xn, 0.0))
        if bmu2 is not None:
            d[rows, idx] = np.inf
            bmu2[a : a + n] = np.argmin(d, axis=1)
    return bmu, dist, bmu2


def _neighborhood(size: int, sigma: float) -> Array:
    """1-D Gaussian ``(size, size)``; the 2-D kernel is its outer product."""
    pos = np.arange(size, dtype=np.float64)
    return np.exp(-((pos[:, None] - pos[None, :]) ** 2) / (2.0 * sigma**2))


def train_som(x: Array, config: Config) -> SomResult:
    """Train the batch SOM on layout features and assign every frame.

    Args:
        x: ``(T, D)`` float64 layout features (standardized and weighted).
        config: resolved configuration.

    Returns:
        :class:`SomResult`.
    """
    cfg, size = config.som, config.grid.size
    if cfg.algorithm != "batch" or cfg.init != "pca" or config.grid.topology != "planar":
        raise ValueError("only batch SOM with PCA init on a planar grid is implemented")
    k_units, d = size * size, x.shape[1]
    train = training_subset(x, config.frames.max_som_frames)
    w = pca_init(train, size)

    for epoch in range(cfg.epochs):
        frac = epoch / max(1, cfg.epochs - 1)
        sigma = cfg.sigma_start * (cfg.sigma_end / cfg.sigma_start) ** frac
        bmu, _, _ = bmu_search(train, w, cfg.frame_chunk)
        counts = np.bincount(bmu, minlength=k_units).astype(np.float64)
        sums = np.empty((k_units, d), dtype=np.float64)
        for j in range(d):
            sums[:, j] = np.bincount(bmu, weights=train[:, j], minlength=k_units)
        h = _neighborhood(size, sigma)
        s_grid = sums.reshape(size, size, d)
        # num[r, c] = sum_{i,k} h[r, i] h[c, k] S[i, k]
        rows_done = np.tensordot(h, s_grid, axes=(1, 0))  # (r, k, d)
        num = np.tensordot(h, rows_done, axes=(1, 1)).transpose(1, 0, 2)  # (c, r, d) -> (r, c, d)
        den = h @ counts.reshape(size, size) @ h.T
        w_grid = w.reshape(size, size, d)
        ok = den > _DEN_FLOOR
        new = np.where(ok[:, :, None], num / np.where(ok, den, 1.0)[:, :, None], w_grid)
        w = new.reshape(k_units, d)

    bmu_all, dist, _ = bmu_search(x, w, cfg.frame_chunk)
    train_bmu, _, train_bmu2 = bmu_search(train, w, cfg.frame_chunk, second=True)
    assert train_bmu2 is not None
    r1, c1 = np.divmod(train_bmu, size)
    r2, c2 = np.divmod(train_bmu2, size)
    adjacent = np.maximum(np.abs(r1 - r2), np.abs(c1 - c2)) <= 1
    hits = np.bincount(bmu_all, minlength=k_units)
    return SomResult(
        prototypes=w,
        bmu=bmu_all.astype(np.uint16),
        bmu_dist=dist,
        quantization_error=float(dist.mean()),
        topographic_error=float(1.0 - adjacent.mean()),
        empty_units=float(np.mean(hits == 0)),
    )
