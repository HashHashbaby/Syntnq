from __future__ import annotations

import numpy as np
import numpy.typing as npt
import pytest
from scipy.stats import spearmanr

from fixtures import make_signals as ms
from synesthesia.color import normalize_features
from synesthesia.config import Config
from synesthesia.features import FrameFeatures, extract_features
from synesthesia.ingest import DecodedAudio, normalize


def _features(
    x: npt.NDArray[np.float64], config: Config
) -> tuple[npt.NDArray[np.float64], FrameFeatures]:
    y, _ = normalize(DecodedAudio(x[:, None], ms.SAMPLE_RATE), config)
    return y, extract_features(y, config)


def test_shapes_and_ranges(config: Config) -> None:
    y, f = _features(ms.aba_song(), config)
    t = 1 + y.size // config.frames.hop
    assert f.n_frames == t
    assert f.mfcc.shape == (t, 13) and f.mfcc_raw.shape == (t, 13)
    assert f.layout_raw().shape == (t, config.layout_dim)
    assert f.color_matrix().shape == (t, 5)
    for arr in (f.mfcc, f.brightness, f.loudness, f.noisiness, f.harmonicity, f.change, f.onset):
        assert np.isfinite(arr).all()
    assert f.onset.min() >= 0.0 and f.onset.max() <= 1.0
    assert f.fps == pytest.approx(config.live.fps, abs=1e-3)


def test_sweep_brightness_increases(config: Config) -> None:
    _, f = _features(ms.sine_sweep(), config)
    rho = spearmanr(np.arange(f.n_frames), f.brightness).statistic
    assert rho > 0.95


def test_white_noise_is_noisy_not_harmonic(config: Config) -> None:
    _, f = _features(ms.white_noise(), config)
    n = normalize_features(f.color_matrix().T, config)
    assert np.median(n[2]) > 0.8  # noisiness
    assert np.median(f.harmonicity) < 0.2


def test_pure_tones_are_harmonic(config: Config) -> None:
    _, f = _features(ms.chord(), config)
    assert np.median(f.harmonicity) > 0.8


def test_change_peaks_at_texture_boundaries(config: Config) -> None:
    _, f = _features(ms.aba_song(), config)
    for seconds in (10.0, 20.0):
        b = int(round(seconds * f.fps))
        assert f.change[b - 3 : b + 4].max() > 5.0 * np.median(f.change)
