from __future__ import annotations

import os
import sys

import numpy as np
from threadpoolctl import threadpool_info

from synesthesia import N_THREADS, THREAD_ENV_VARS
from synesthesia.config import Config
from synesthesia.determinism import rng, sha256_array, single_thread


def test_rng_is_reproducible(config: Config) -> None:
    a = rng(config).standard_normal(8)
    b = rng(config).standard_normal(8)
    assert np.array_equal(a, b)


def test_sha256_array_sensitive_to_content_dtype_shape() -> None:
    x = np.arange(12, dtype=np.float64)
    assert sha256_array(x) == sha256_array(x.copy())
    assert sha256_array(x) != sha256_array(x.astype(np.float32))
    assert sha256_array(x) != sha256_array(x.reshape(3, 4))
    y = x.copy()
    y[0] = 1.0
    assert sha256_array(x) != sha256_array(y)


def test_sha256_array_ignores_memory_layout() -> None:
    x = np.arange(12, dtype=np.float64).reshape(3, 4)
    assert sha256_array(x) == sha256_array(np.asfortranarray(x))


def test_thread_env_vars_are_pinned() -> None:
    for var in THREAD_ENV_VARS:
        assert os.environ[var] == str(N_THREADS), var


def test_single_thread_limits_pools() -> None:
    np.dot(np.ones((8, 8)), np.ones((8, 8)))  # make sure BLAS is loaded
    with single_thread():
        pools = threadpool_info()
        # Apple Accelerate is invisible to threadpoolctl; there the env-var test above is the
        # guard. Everywhere else a BLAS/OpenMP pool must be detected and limited.
        if sys.platform != "darwin":
            assert pools, "no BLAS/OpenMP pool detected"
        assert all(p["num_threads"] == N_THREADS for p in pools), pools
