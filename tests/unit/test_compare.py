"""Song comparison (M9, D-066): distance and score bounds, labels from the corpus quartiles,
notable differences only, plain-language directions and the no-tempo case."""

from __future__ import annotations

import numpy as np

from synesthesia.compare import compare, scalar_values, score_of
from synesthesia.config import load_config

CFG = load_config()
F = CFG.fingerprint


def _fp(rng: np.random.Generator, *, tempo: float = 120.0, bright_shift: int = 0) -> np.ndarray:
    parts = []
    for i in range(5):
        h = rng.random(F.hist_bins) + 0.05
        if i == 0 and bright_shift:
            h = np.roll(h, bright_shift)
        parts.append(h / h.sum())
    hl = rng.random(F.hue_bins * F.lightness_bins) + 0.05
    parts.append(hl / hl.sum())
    scal = np.array([np.log2(max(tempo, 1e-3) / 120.0), 0.6, 0.4, 0.6, 0.0])
    return np.concatenate([*parts, scal])


def test_identical_songs() -> None:
    a = _fp(np.random.default_rng(1))
    r = compare(a, a, CFG)
    assert r.distance == 0.0 and r.score == 100.0
    assert r.label == CFG.compare.labels[0] and r.top_differences == []


def test_label_follows_the_corpus_quartiles_and_score_is_monotone() -> None:
    c = CFG.compare
    assert c.very_similar_below < c.different_above
    p = c.percentiles
    assert score_of(p[0], p) == 100.0 and score_of(p[-1], p) == 0.0
    assert score_of(p[5], p) > score_of(p[15], p)
    rng = np.random.default_rng(2)
    a, b = _fp(rng), _fp(rng, tempo=60.0, bright_shift=6)
    r = compare(a, b, CFG)
    expected = (
        c.labels[0] if r.distance < c.very_similar_below
        else c.labels[2] if r.distance > c.different_above
        else c.labels[1]
    )  # fmt: skip
    assert r.label == expected
    assert 0 <= r.score <= 100 and len(r.top_differences) <= c.top_n
    assert all(d.weight >= c.min_weight for d in r.top_differences)


def test_tempo_sentence_and_no_clear_tempo() -> None:
    rng = np.random.default_rng(3)
    base = _fp(rng)
    fast, slow = base.copy(), base.copy()
    fast[-5], slow[-5] = np.log2(160 / 120), np.log2(80 / 120)
    texts = [d.text for d in compare(fast, slow, CFG).top_differences]
    assert any("faster than B (160 BPM vs 80 BPM)" in t for t in texts)
    none = base.copy()
    none[-5] = np.log2(1e-3 / 120)
    assert scalar_values(none, CFG)["tempo"] < CFG.compare.tempo_min_bpm
    texts = [d.text for d in compare(fast, none, CFG).top_differences]
    assert any(t.startswith("B has no clear tempo") for t in texts)
