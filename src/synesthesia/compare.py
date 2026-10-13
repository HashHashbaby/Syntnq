"""Song comparison (M9, D-066): distance, a corpus-relative score, a plain-language label and the
differences that matter most, all from the 133-value fingerprints (never pixel positions).

- distance: ``fingerprint.distance``, scalar term scaled by the corpus (``compare.scalar_norm``);
- score: the share of reference song pairs that are farther apart (0-100, higher = more similar),
  read from the corpus distance percentiles (``compare.percentiles``);
- label: "Very similar" below the corpus first quartile, "Different" above the third, "Somewhat
  similar" between;
- top differences: each fingerprint block's difference divided by its corpus median, the three
  largest of those at least ``compare.min_weight`` medians, phrased with the direction from the
  block's mean (feature histograms) or the scalar values (a tempo under ``tempo_min_bpm`` is "no
  clear tempo").

All corpus numbers are written by ``scripts/calibrate_compare.py`` into ``config/default.yaml``.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.fingerprint import _js_divergence, distance

# scalar order in the fingerprint (docs/ANALYSIS.md section 9)
SCALARS = ("tempo", "pulse_clarity", "loudness_range", "mean_loudness", "duration")
HIST_FEATURES = ("brightness", "loudness", "noisiness", "harmonicity", "change")

# words for the direction of a difference: (more, less)
_WORDS: dict[str, tuple[str, str]] = {
    "brightness": ("brighter", "darker"),
    "loudness": ("louder in its moments", "quieter in its moments"),
    "noisiness": ("noisier", "more tonal"),
    "harmonicity": ("more harmonic", "more percussive"),
    "change": ("more changeable", "steadier"),
    "tempo": ("faster", "slower"),
    "pulse_clarity": ("more clearly pulsed", "looser in its pulse"),
    "loudness_range": ("more dynamic", "more even in level"),
    "mean_loudness": ("louder overall", "quieter overall"),
    "duration": ("longer", "shorter"),
}


@dataclass(frozen=True)
class Difference:
    """A differing aspect: its key, how much it stands out (vs the corpus median), a sentence."""

    key: str
    weight: float
    text: str


@dataclass(frozen=True)
class Comparison:
    distance: float
    score: float  # 0-100: share of reference pairs farther apart
    label: str
    top_differences: list[Difference]

    def to_json(self) -> dict[str, Any]:
        d = asdict(self)
        d["top_differences"] = [asdict(x) for x in self.top_differences]
        return d


def _blocks(fp: npt.NDArray[np.float64], config: Config) -> list[npt.NDArray[np.float64]]:
    f = config.fingerprint
    sizes = [f.hist_bins] * 5 + [f.hue_bins * f.lightness_bins]
    edges = np.cumsum([0, *sizes])
    return [fp[edges[i] : edges[i + 1]] for i in range(len(sizes))]


def scalar_values(fp: npt.ArrayLike, config: Config) -> dict[str, float]:
    """The five scalars back in physical units (BPM, 0-1, dB, dBFS, seconds)."""
    s = np.asarray(fp, dtype=np.float64)[-config.fingerprint.n_scalars :]
    return {
        "tempo": 120.0 * 2.0 ** s[0],
        "pulse_clarity": float(s[1]),
        "loudness_range": float(s[2]) * 30.0,
        "mean_loudness": float(s[3]) * 60.0 - 60.0,
        "duration": 180.0 * 2.0 ** s[4],
    }


def _hist_mean(h: npt.NDArray[np.float64]) -> float:
    centres = (np.arange(h.size) + 0.5) / h.size
    total = float(h.sum())
    return float((h * centres).sum() / total) if total > 0 else 0.5


def block_differences(a: npt.ArrayLike, b: npt.ArrayLike, config: Config) -> dict[str, float]:
    """Raw per-aspect differences: JS divergence per histogram block, |delta| per scalar entry."""
    fa, fb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    ba, bb = _blocks(fa, config), _blocks(fb, config)
    out = {name: _js_divergence(ba[i], bb[i]) for i, name in enumerate(HIST_FEATURES)}
    out["palette"] = _js_divergence(ba[5], bb[5])
    n = config.fingerprint.n_scalars
    for i, name in enumerate(SCALARS):
        out[name] = abs(float(fa[-n + i] - fb[-n + i]))
    return out


def _fmt(key: str, v: float) -> str:
    if key == "tempo":
        return f"{v:.0f} BPM"
    if key == "loudness_range":
        return f"{v:.1f} dB"
    if key == "mean_loudness":
        return f"{v:.1f} dBFS"
    if key == "duration":
        m, s = divmod(round(v), 60)
        return f"{m}:{s:02d}"
    return f"{v:.2f}"


def _sentence(
    key: str, fa: npt.NDArray[np.float64], fb: npt.NDArray[np.float64], config: Config
) -> str:
    if key == "palette":
        return "The colour palettes differ (which hues and brightness levels the sounds take)."
    if key in HIST_FEATURES:
        i = HIST_FEATURES.index(key)
        ma, mb = _hist_mean(_blocks(fa, config)[i]), _hist_mean(_blocks(fb, config)[i])
        more, less = _WORDS[key]
        return f"A is {more if ma >= mb else less} than B."
    va, vb = scalar_values(fa, config)[key], scalar_values(fb, config)[key]
    if key == "tempo":
        lo = config.compare.tempo_min_bpm
        if va < lo and vb < lo:
            return "Neither has a clear tempo."
        if va < lo or vb < lo:
            who, other = ("A", vb) if va < lo else ("B", va)
            return f"{who} has no clear tempo; the other moves at {_fmt(key, other)}."
    more, less = _WORDS[key]
    return f"A is {more if va >= vb else less} than B ({_fmt(key, va)} vs {_fmt(key, vb)})."


def score_of(dist: float, percentiles: list[float]) -> float:
    """Share (0-100) of reference pairs farther apart than ``dist`` (evenly spaced percentiles)."""
    p = percentiles
    if dist <= p[0]:
        return 100.0
    if dist >= p[-1]:
        return 0.0
    step = 100.0 / (len(p) - 1)
    for i in range(len(p) - 1):
        if p[i] <= dist <= p[i + 1]:
            frac = (dist - p[i]) / (p[i + 1] - p[i]) if p[i + 1] > p[i] else 0.0
            return 100.0 - (i + frac) * step
    return 0.0


def compare(a: npt.ArrayLike, b: npt.ArrayLike, config: Config) -> Comparison:
    """Compare two fingerprints (``(133,)``); see the module docstring."""
    c = config.compare
    fa, fb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    d = distance(fa, fb, config, scalar_norm=c.scalar_norm)
    score = score_of(d, c.percentiles)
    label = (
        c.labels[0]
        if d < c.very_similar_below
        else c.labels[2]
        if d > c.different_above
        else c.labels[1]
    )
    raw = block_differences(fa, fb, config)
    weighted = sorted(
        ((k, v / max(c.block_medians[k], 1e-9)) for k, v in raw.items()),
        key=lambda kv: (-kv[1], kv[0]),
    )
    notable = [(k, w) for k, w in weighted if w >= c.min_weight and not math.isnan(w)]
    top = [Difference(k, round(w, 4), _sentence(k, fa, fb, config)) for k, w in notable[: c.top_n]]
    return Comparison(round(d, 6), round(score, 1), label, top)
