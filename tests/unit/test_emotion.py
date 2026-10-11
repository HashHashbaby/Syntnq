"""Emotion regressor and the colour-mapping emotion term (D-036)."""

from __future__ import annotations

import numpy as np
import pytest

from synesthesia.color import map_colors
from synesthesia.config import Config, load_config
from synesthesia.emotion import FEATURE_NAMES, fit_ridge, load_model, save_model


def test_ridge_recovers_a_linear_relation_and_clips_to_unit_range() -> None:
    rng = np.random.default_rng(0)
    x = rng.normal(size=(120, len(FEATURE_NAMES)))
    y = np.column_stack([0.4 * x[:, 0] - 0.2 * x[:, 3], 0.3 * x[:, 5]]) + 0.02 * rng.normal(
        size=(120, 2)
    )
    model, loo, scores = fit_ridge(x, y, (0.1, 1.0, 10.0))
    pred = model.predict(x)
    assert pred.shape == (120, 2) and np.abs(pred).max() <= 1.0
    assert np.corrcoef(pred[:, 0], y[:, 0])[0, 1] > 0.95
    assert np.corrcoef(loo[:, 1], y[:, 1])[0, 1] > 0.9  # out-of-fold predictions also work
    assert set(scores) == {0.1, 1.0, 10.0}
    assert model.predict(x[0]).shape == (2,)


def test_model_roundtrip(tmp_path: pytest.TempPathFactory) -> None:
    rng = np.random.default_rng(1)
    x = rng.normal(size=(50, len(FEATURE_NAMES)))
    y = rng.normal(scale=0.3, size=(50, 2))
    model, _, _ = fit_ridge(x, y, (1.0,))
    path = tmp_path / "m.json"  # type: ignore[operator]
    save_model(model, path)
    again = load_model(path)
    assert np.allclose(again.predict(x), model.predict(x))


def _inputs(config: Config) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    k = config.grid.size**2
    rng = np.random.default_rng(2)
    feats = rng.uniform(0.3, 0.7, size=(5, k))
    feats[0] = rng.uniform(2.7, 3.5, k)
    feats[1] = rng.uniform(-40, -20, k)
    feats[2] = rng.uniform(-5, -2, k)
    feats[3] = rng.uniform(0.2, 0.9, k)
    feats[4] = rng.uniform(0.7, 5.0, k)
    occ = rng.uniform(0.2, 1.0, k)
    empty = np.zeros(k, dtype=bool)
    empty[:100] = True
    return feats, occ, empty


def test_emotion_term_is_off_by_default_and_changes_nothing(config: Config) -> None:
    feats, occ, empty = _inputs(config)
    a = map_colors(feats, occ, empty, config)
    b = map_colors(feats, occ, empty, config, emotion=(0.9, 0.9))
    assert np.array_equal(a.srgb, b.srgb)


def test_emotion_term_shifts_lightness_chroma_and_hue_when_enabled() -> None:
    cfg = load_config(
        overrides={
            "color": {
                "emotion": {
                    "enabled": True,
                    "gain_lightness": 0.2,
                    "gain_chroma": 0.1,
                    "gain_hue": 0.3,
                },
                "display_smoothing_sigma": 0.0,
            }
        }
    )
    feats, occ, empty = _inputs(cfg)
    base = map_colors(feats, occ, empty, cfg)
    pos = map_colors(feats, occ, empty, cfg, emotion=(0.5, 0.5))
    neg = map_colors(feats, occ, empty, cfg, emotion=(-0.5, -0.5))
    live = ~empty
    assert pos.oklch[live, 0].mean() > base.oklch[live, 0].mean() > neg.oklch[live, 0].mean()
    assert pos.oklch[live, 1].mean() >= neg.oklch[live, 1].mean()
    # hue moves toward the warm end (smaller hue number) for positive valence
    assert pos.oklch[live, 2].mean() < base.oklch[live, 2].mean() < neg.oklch[live, 2].mean()
    assert np.allclose(pos.oklch[empty, 0], base.oklch[empty, 0])  # empty cells untouched
