"""Distinctiveness metrics over a corpus of fingerprints (docs/MILESTONES.md M2 task 6).

All functions are pure; fingerprints come from :mod:`synesthesia.fingerprint`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.fingerprint import distance, distance_blocks

Array = npt.NDArray[np.float64]

NEAR_DUPLICATE_DISTANCE = 0.05  # docs/MILESTONES.md M2 task 6(c)


@dataclass(frozen=True)
class CorpusMetrics:
    """Corpus-level distinctiveness numbers.

    Attributes:
        nn_accuracy: leave-one-out nearest-neighbor genre retrieval accuracy.
        within_mean: mean distance between same-genre pairs.
        between_mean: mean distance between different-genre pairs.
        near_duplicates: ``(i, j, same_genre)`` for pairs with distance below the threshold.
        cross_genre_near_duplicates: how many of those pairs span genres.
    """

    nn_accuracy: float
    within_mean: float
    between_mean: float
    near_duplicates: list[tuple[int, int, bool]]
    cross_genre_near_duplicates: int


def distance_matrix(
    fingerprints: npt.NDArray[np.float32], config: Config, scalar_norm: float = 1.0
) -> Array:
    """Symmetric ``(N, N)`` matrix of :func:`synesthesia.fingerprint.distance`."""
    n = fingerprints.shape[0]
    d = np.zeros((n, n), dtype=np.float64)
    for i in range(n):
        for j in range(i + 1, n):
            d[i, j] = d[j, i] = distance(
                fingerprints[i], fingerprints[j], config, scalar_norm=scalar_norm
            )
    return d


def block_distance_matrix(
    fingerprints: npt.NDArray[np.float32],
    config: Config,
    blocks: set[str],
    scalar_norm: float = 1.0,
) -> Array:
    """Like :func:`distance_matrix` but using only the named fingerprint blocks."""
    n = fingerprints.shape[0]
    d = np.zeros((n, n), dtype=np.float64)
    for i in range(n):
        for j in range(i + 1, n):
            d[i, j] = d[j, i] = distance_blocks(
                fingerprints[i], fingerprints[j], config, blocks, scalar_norm=scalar_norm
            )
    return d


def scalar_scale(fingerprints: npt.NDArray[np.float32], config: Config) -> float:
    """Largest pairwise Euclidean distance of the scalar entries: maps to distance 1.0 (spec 9)."""
    tail = fingerprints[:, -config.fingerprint.n_scalars :].astype(np.float64)
    diff = tail[:, None, :] - tail[None, :, :]
    return float(max(np.linalg.norm(diff, axis=2).max(), 1e-9))


def corpus_metrics(
    dist: Array, labels: list[str], threshold: float = NEAR_DUPLICATE_DISTANCE
) -> CorpusMetrics:
    """Compute retrieval accuracy, within/between genre distances and near-duplicates.

    Args:
        dist: ``(N, N)`` symmetric distance matrix with zero diagonal.
        labels: ``N`` genre labels.
        threshold: distance below which a pair counts as a near-duplicate.
    """
    n = len(labels)
    lab = np.asarray(labels)
    same = lab[:, None] == lab[None, :]
    off = ~np.eye(n, dtype=bool)
    masked = np.where(off, dist, np.inf)
    nearest = np.argmin(masked, axis=1)  # ties -> lowest index
    nn_acc = float(np.mean(lab[nearest] == lab))
    iu = np.triu_indices(n, k=1)
    within = dist[iu][same[iu]]
    between = dist[iu][~same[iu]]
    dup = [
        (int(i), int(j), bool(same[i, j]))
        for i, j in zip(*iu, strict=True)
        if dist[i, j] < threshold
    ]
    return CorpusMetrics(
        nn_accuracy=nn_acc,
        within_mean=float(within.mean()) if within.size else float("nan"),
        between_mean=float(between.mean()) if between.size else float("nan"),
        near_duplicates=dup,
        cross_genre_near_duplicates=sum(1 for _, _, s in dup if not s),
    )
