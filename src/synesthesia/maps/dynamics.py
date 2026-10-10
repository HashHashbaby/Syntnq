"""Dynamics: loudness envelope, histogram and loudness range (docs/ANALYSIS.md section 8)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.maps.resample import resize_axis

Array = npt.NDArray[np.float64]

_POWER_EPS = 1e-12  # floor before log10 (a window of digital silence)
_DB = 10.0
_PEAK_PERCENTILE = 99.0


@dataclass(frozen=True)
class Dynamics:
    """Loudness summaries with fixed shapes.

    Attributes:
        envelope: ``(envelope_points,)`` float32 frame loudness (dBFS) over equal time segments.
        hist: ``(hist_bins,)`` float32, sums to 1.
        lra_db: loudness range, dB (95th - 10th percentile of 3 s short-term loudness).
        mean_loudness_db: level of the mean frame power, dBFS.
        peak_loudness_db: 99th percentile of frame loudness, dBFS.
    """

    envelope: npt.NDArray[np.float32]
    hist: npt.NDArray[np.float32]
    lra_db: float
    mean_loudness_db: float
    peak_loudness_db: float


def compute_dynamics(loudness_raw: Array, fps: float, config: Config) -> Dynamics:
    """Dynamics summaries from unsmoothed frame loudness.

    Args:
        loudness_raw: ``(T,)`` frame RMS loudness in dBFS, unsmoothed.
        fps: frames per second.
        config: resolved configuration (``maps.dynamics``).

    Returns:
        :class:`Dynamics`.
    """
    dc = config.maps.dynamics
    envelope = resize_axis(loudness_raw, dc.envelope_points)

    lo, hi = dc.hist_range_dbfs
    counts, _ = np.histogram(np.clip(loudness_raw, lo, hi), bins=dc.hist_bins, range=(lo, hi))
    hist = counts / max(1, counts.sum())

    power = _DB ** (loudness_raw / _DB)  # rms^2 per frame
    win = max(1, int(round(dc.short_term_s * fps)))
    hop = max(1, int(round(fps)))  # 1 s
    csum = np.concatenate([[0.0], np.cumsum(power)])
    starts = np.arange(0, max(1, power.size - win + 1), hop)
    ends = np.minimum(starts + win, power.size)
    short_term = _DB * np.log10(
        np.maximum((csum[ends] - csum[starts]) / (ends - starts), _POWER_EPS)
    )
    p_lo, p_hi = dc.lra_percentiles
    lra = float(np.percentile(short_term, p_hi) - np.percentile(short_term, p_lo))

    mean_db = _DB * float(np.log10(max(float(power.mean()), _POWER_EPS)))
    peak_db = float(np.percentile(loudness_raw, _PEAK_PERCENTILE))
    return Dynamics(
        envelope=envelope.astype(np.float32),
        hist=hist.astype(np.float32),
        lra_db=lra,
        mean_loudness_db=mean_db,
        peak_loudness_db=peak_db,
    )
