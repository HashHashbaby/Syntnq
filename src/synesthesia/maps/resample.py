"""Fixed-shape resampling used by every companion map (docs/ANALYSIS.md section 8)."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

Array = npt.NDArray[np.float64]


def resize_axis(a: Array, n: int, axis: int = 0) -> Array:
    """Resample ``a`` to ``n`` samples along ``axis``.

    Area averaging (exact, fractional bin edges) when there are more than ``n`` samples,
    nearest neighbour when there are fewer, identity when equal.

    Args:
        a: float64 array.
        n: output length along ``axis``.
        axis: axis to resample.

    Returns:
        Array with ``a.shape[axis] == n``.
    """
    x = np.moveaxis(np.asarray(a, dtype=np.float64), axis, 0)
    m = x.shape[0]
    if m == n:
        out = x
    elif m < n:
        idx = np.minimum(np.floor((np.arange(n) + 0.5) * m / n).astype(np.int64), m - 1)
        out = x[idx]
    else:
        csum = np.concatenate([np.zeros((1, *x.shape[1:])), np.cumsum(x, axis=0)])
        edges = np.linspace(0.0, float(m), n + 1)
        lo, hi = edges[:-1], edges[1:]

        def integral(pos: Array) -> Array:
            i = np.minimum(np.floor(pos).astype(np.int64), m - 1)
            frac = (pos - i).reshape((-1,) + (1,) * (x.ndim - 1))
            return np.asarray(csum[i] + frac * x[i], dtype=np.float64)

        out = (integral(hi) - integral(lo)) / (hi - lo).reshape((-1,) + (1,) * (x.ndim - 1))
    return np.asarray(np.moveaxis(out, 0, axis), dtype=np.float64)
