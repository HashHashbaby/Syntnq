"""Determinism helpers: thread limits, seeded RNG factory, array hashing.

Rules (CLAUDE.md rule 1): no unseeded randomness, BLAS/OpenMP limited to one
thread inside the pipeline, float64 compute.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager

import numpy as np
import numpy.typing as npt
from threadpoolctl import threadpool_limits

from synesthesia.config import Config


@contextmanager
def single_thread() -> Iterator[None]:
    """Limit every BLAS/OpenMP thread pool to one thread within the context."""
    with threadpool_limits(limits=1):
        yield


def rng(config: Config) -> np.random.Generator:
    """Return a fresh generator seeded from ``config.seed``."""
    return np.random.default_rng(config.seed)


def sha256_array(array: npt.ArrayLike) -> str:
    """SHA-256 hex digest of an array's dtype, shape and C-ordered bytes.

    Args:
        array: any array-like; converted with ``np.ascontiguousarray``.

    Returns:
        Hex digest. Arrays that differ in dtype or shape never collide on bytes alone.
    """
    arr = np.ascontiguousarray(array)
    h = hashlib.sha256()
    h.update(arr.dtype.str.encode("ascii"))
    h.update(repr(arr.shape).encode("ascii"))
    h.update(arr.tobytes())
    return h.hexdigest()
