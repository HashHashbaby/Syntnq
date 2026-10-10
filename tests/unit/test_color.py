from __future__ import annotations

import numpy as np
import numpy.typing as npt

from synesthesia.color import (
    gamut_map,
    linear_srgb_to_oklab,
    map_colors,
    oklab_to_linear_srgb,
    oklab_to_oklch,
    oklch_to_oklab,
)
from synesthesia.config import Config

K = 4096


def test_oklab_round_trip() -> None:
    rng = np.random.default_rng(0)
    rgb = rng.random((2000, 3))
    assert np.max(np.abs(oklab_to_linear_srgb(linear_srgb_to_oklab(rgb)) - rgb)) < 1e-9
    lab = np.stack([rng.random(500), rng.normal(0, 0.1, 500), rng.normal(0, 0.1, 500)], axis=-1)
    assert np.max(np.abs(oklch_to_oklab(oklab_to_oklch(lab)) - lab)) < 1e-9


def test_white_and_black() -> None:
    lab = linear_srgb_to_oklab(np.array([[1.0, 1.0, 1.0], [0.0, 0.0, 0.0]]))
    assert abs(lab[0, 0] - 1.0) < 1e-6 and abs(lab[1, 0]) < 1e-12
    assert np.max(np.abs(lab[:, 1:])) < 1e-4


def test_gamut_mapping_lands_inside_srgb_and_keeps_l_and_h() -> None:
    rng = np.random.default_rng(1)
    lch = np.stack(
        [rng.uniform(0.15, 0.9, 1000), rng.uniform(0.0, 0.5, 1000), rng.uniform(0, 360, 1000)],
        axis=-1,
    )
    out = gamut_map(lch)
    rgb = oklab_to_linear_srgb(oklch_to_oklab(out))
    assert rgb.min() >= -1e-6 and rgb.max() <= 1.0 + 1e-6
    assert np.array_equal(out[:, 0], lch[:, 0]) and np.array_equal(out[:, 2], lch[:, 2])
    assert np.all(out[:, 1] <= lch[:, 1] + 1e-12)


def _features(brightness: float, loudness: float, harmonicity: float) -> npt.NDArray[np.float64]:
    f = np.zeros((5, K))
    f[0], f[1], f[2], f[3], f[4] = brightness, loudness, -1.0, harmonicity, 0.0
    return f


def _color(f: npt.NDArray[np.float64], config: Config, occ: float = 1.0) -> npt.NDArray[np.float64]:
    occ_norm = np.full(K, occ)
    return map_colors(f, occ_norm, occ_norm < config.occupancy.empty_threshold, config).oklch


def test_louder_is_lighter(config: Config) -> None:
    quiet = _color(_features(3.0, -40.0, 0.5), config)
    loud = _color(_features(3.0, -10.0, 0.5), config)
    assert loud[:, 0].mean() > quiet[:, 0].mean()


def test_brighter_moves_hue_toward_warm(config: Config) -> None:
    dark = _color(_features(2.5, -20.0, 0.5), config)
    bright = _color(_features(3.6, -20.0, 0.5), config)
    assert dark[:, 2].mean() > bright[:, 2].mean()
    assert bright[:, 2].min() >= config.color.hue.to_deg - 1e-9
    assert dark[:, 2].max() <= config.color.hue.from_deg + 1e-9


def test_noisy_means_low_chroma(config: Config) -> None:
    noisy = _color(_features(3.0, -20.0, 0.0), config)
    tonal = _color(_features(3.0, -20.0, 1.0), config)
    assert noisy[:, 1].max() <= config.color.chroma.min + 1e-9
    assert tonal[:, 1].mean() > noisy[:, 1].mean()


def test_empty_cells_are_dim(config: Config) -> None:
    f = _features(3.0, -20.0, 1.0)
    colors = map_colors(f, np.zeros(K), np.ones(K, dtype=bool), config)
    assert np.allclose(colors.oklch[:, 0], config.color.lightness.empty_L)
    assert colors.srgb.dtype == np.uint8 and colors.srgb.shape == (K, 3)
