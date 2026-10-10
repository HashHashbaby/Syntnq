"""SYNESTHESIA: turn a song into a visual signature (a 64 x 64 sonic-similarity map)."""

import os

# Semver. Bump minor for any change that alters output arrays, patch otherwise
# (docs/ANALYSIS.md section 0). Goldens must be regenerated on a minor bump.
PIPELINE_VERSION = "0.2.0"

# Determinism rule: native math libraries run on one thread. Thread pools are read when the
# library loads, so these are set before numpy/scipy import (this module is imported first by
# every entry point). threadpoolctl cannot see Apple Accelerate, which only honours
# VECLIB_MAXIMUM_THREADS at load time.
N_THREADS = 1
THREAD_ENV_VARS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "NUMEXPR_NUM_THREADS",
)
for _var in THREAD_ENV_VARS:
    os.environ[_var] = str(N_THREADS)

__all__ = ["N_THREADS", "PIPELINE_VERSION", "THREAD_ENV_VARS"]
