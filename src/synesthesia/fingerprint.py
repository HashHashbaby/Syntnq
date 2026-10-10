"""Fixed 133-value fingerprint and distance (docs/ANALYSIS.md section 9).

The 5 scalar entries come from the companion maps (tempo, pulse clarity, LRA, mean loudness,
duration); ``compute_fingerprint`` without ``scalars`` zero-fills them (incomplete).
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from synesthesia.color import SignatureColors, normalize_features
from synesthesia.config import Config

Array = npt.NDArray[np.float64]

_HUE_RANGE = (30.0, 265.0)  # degrees covered by the hue mapping
_N_HIST_BLOCKS = 6  # 5 feature histograms + hue x lightness
_JS_WEIGHT = 0.8
_SCALAR_WEIGHT = 0.2
_REF_TEMPO_BPM = 120.0  # scalar offsets below are fixed by the spec (section 9)
_LRA_SCALE_DB = 30.0
_LOUDNESS_FLOOR_DB = 60.0
_REF_DURATION_S = 180.0
_MIN_TEMPO_BPM = 1.0  # guard for songs without a detected pulse


def fingerprint_scalars(
    tempo_bpm: float,
    pulse_clarity: float,
    lra_db: float,
    mean_loudness_db: float,
    duration_s: float,
) -> Array:
    """The 5 scalar fingerprint entries (docs/ANALYSIS.md section 9).

    Returns:
        ``(5,)`` float64: ``log2(tempo/120)``, pulse clarity, ``lra/30``,
        ``(mean_loudness + 60)/60``, ``log2(duration/180)``.
    """
    return np.array(
        [
            np.log2(max(tempo_bpm, _MIN_TEMPO_BPM) / _REF_TEMPO_BPM),
            pulse_clarity,
            lra_db / _LRA_SCALE_DB,
            (mean_loudness_db + _LOUDNESS_FLOOR_DB) / _LOUDNESS_FLOOR_DB,
            np.log2(duration_s / _REF_DURATION_S),
        ],
        dtype=np.float64,
    )


def compute_fingerprint(
    f_color: Array,
    hits: npt.NDArray[np.uint32],
    colors: SignatureColors,
    config: Config,
    scalars: Array | None = None,
) -> npt.NDArray[np.float32]:
    """Build the fingerprint.

    Args:
        f_color: ``(T, 5)`` physical color features of all frames.
        hits: ``(K,)`` frames per cell (oriented order).
        colors: per-cell colors (for hue and lightness).
        config: resolved configuration.
        scalars: optional ``(5,)`` from :func:`fingerprint_scalars`; zeros when ``None``.

    Returns:
        ``(133,)`` float32 with the default config.
    """
    fp = config.fingerprint
    n_frames = normalize_features(f_color.T, config).T  # (T, 5) in [0, 1]
    blocks: list[Array] = []
    for f in range(n_frames.shape[1]):
        h, _ = np.histogram(n_frames[:, f], bins=fp.hist_bins, range=(0.0, 1.0))
        blocks.append(h / max(1, h.sum()))

    lt = config.color.lightness
    hue = np.clip(colors.oklch[:, 2], *_HUE_RANGE)
    light = np.clip(colors.oklch[:, 0], lt.empty_L, lt.max)
    joint, _, _ = np.histogram2d(
        hue,
        light,
        bins=(fp.hue_bins, fp.lightness_bins),
        range=(_HUE_RANGE, (lt.empty_L, lt.max)),
        weights=hits.astype(np.float64),
    )
    blocks.append(joint.ravel() / max(1.0, joint.sum()))

    tail = np.zeros(fp.n_scalars) if scalars is None else np.asarray(scalars, dtype=np.float64)
    out = np.concatenate([*blocks, tail]).astype(np.float32)
    if out.size != fp.length:
        raise AssertionError(f"fingerprint length {out.size} != {fp.length}")
    return out


def _js_divergence(p: Array, q: Array) -> float:
    """Jensen-Shannon divergence in bits, in [0, 1]."""
    m = 0.5 * (p + q)

    def kl(a: Array, b: Array) -> float:
        mask = a > 0
        return float(np.sum(a[mask] * np.log2(a[mask] / b[mask])))

    return 0.5 * kl(p, m) + 0.5 * kl(q, m)


def block_names(config: Config) -> list[str]:
    """Names of the fingerprint blocks in storage order, scalars last."""
    return [*config.maps.feature_grids, "hue_lightness", "scalars"]


def distance_blocks(
    a: npt.ArrayLike,
    b: npt.ArrayLike,
    config: Config,
    blocks: set[str],
    *,
    scalar_norm: float = 1.0,
) -> float:
    """Distance using only the named fingerprint blocks (for ablation).

    With every block this equals :func:`distance`. Without the scalars the value is the mean
    Jensen-Shannon divergence of the included histograms; without histograms, the scalar term.
    """
    fa, fb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    fp = config.fingerprint
    n_scalar = fp.n_scalars
    sizes = [fp.hist_bins] * 5 + [fp.hue_bins * fp.lightness_bins]
    edges = np.cumsum([0, *sizes])
    names = block_names(config)
    js_terms = [
        _js_divergence(fa[edges[i] : edges[i + 1]], fb[edges[i] : edges[i + 1]])
        for i, name in enumerate(names[:-1])
        if name in blocks
    ]
    scalar = min(1.0, float(np.linalg.norm(fa[-n_scalar:] - fb[-n_scalar:])) / scalar_norm)
    use_scalar = "scalars" in blocks
    if js_terms and use_scalar:
        return float(_JS_WEIGHT * np.mean(js_terms) + _SCALAR_WEIGHT * scalar)
    if js_terms:
        return float(np.mean(js_terms))
    return scalar if use_scalar else 0.0


def distance(
    a: npt.ArrayLike, b: npt.ArrayLike, config: Config, *, scalar_norm: float = 1.0
) -> float:
    """Distance between two fingerprints: ``0.8 * JS + 0.2 * scalar``.

    Args:
        a, b: ``(133,)`` fingerprints.
        config: resolved configuration (block sizes).
        scalar_norm: Euclidean scalar distance that maps to 1.0; calibrate over the corpus
            in M2 (1.0 until then).

    Returns:
        Distance in [0, 1].
    """
    fa, fb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    fp = config.fingerprint
    n_scalar = fp.n_scalars
    hist_a, hist_b = fa[:-n_scalar], fb[:-n_scalar]
    sizes = [fp.hist_bins] * 5 + [fp.hue_bins * fp.lightness_bins]
    edges = np.cumsum([0, *sizes])
    js = np.mean(
        [
            _js_divergence(hist_a[edges[i] : edges[i + 1]], hist_b[edges[i] : edges[i + 1]])
            for i in range(_N_HIST_BLOCKS)
        ]
    )
    scalar = min(1.0, float(np.linalg.norm(fa[-n_scalar:] - fb[-n_scalar:])) / scalar_norm)
    return float(_JS_WEIGHT * js + _SCALAR_WEIGHT * scalar)
