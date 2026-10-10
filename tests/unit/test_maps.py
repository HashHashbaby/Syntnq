"""Companion maps (docs/ANALYSIS.md sections 8, 9, 15)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from synesthesia.config import Config
from synesthesia.fingerprint import fingerprint_scalars
from synesthesia.maps import compute_companion_maps
from synesthesia.maps.dynamics import compute_dynamics
from synesthesia.maps.feature_grids import feature_grids
from synesthesia.maps.resample import resize_axis
from synesthesia.pipeline import SongResult


def test_click_track_tempo_is_120(results: dict[str, SongResult]) -> None:
    r = results["click_120bpm"].maps.rhythm
    assert r.tempo_bpm == pytest.approx(120.0, abs=2.0)
    assert r.pulse_clarity > 0.3
    assert r.beat_times_s.dtype == np.float32 and r.beat_times_s.size > 10


def test_tempogram_peaks_at_the_tempo(results: dict[str, SongResult], config: Config) -> None:
    from synesthesia.maps.rhythm import bpm_axis

    tg = results["click_120bpm"].maps.rhythm.tempogram.astype(np.float64)
    assert tg.shape == (128, 256)
    axis = bpm_axis(config)
    peak_bpm = axis[int(np.argmax(tg.mean(axis=1)))]
    # the 120 BPM click train also has strong 60 and 240 BPM (sub/harmonic) components
    assert min(abs(peak_bpm - 120.0), abs(peak_bpm - 60.0), abs(peak_bpm - 240.0)) < 8.0
    assert tg.max() <= 1.0 and tg.min() >= 0.0


def test_aba_structure_has_block_similarity(results: dict[str, SongResult]) -> None:
    s = results["aba_song"].maps.structure.astype(np.float64)
    assert s.shape == (256, 256)
    n = s.shape[0]
    a1 = slice(0, n // 3 - 8)
    b = slice(n // 3 + 8, 2 * n // 3 - 8)
    a2 = slice(2 * n // 3 + 8, n - 1)
    aa = s[a1, a2].mean()
    ab = s[a1, b].mean()
    assert aa - ab > 0.2  # spec: A-A similarity exceeds A-B by 0.2
    assert abs(np.diag(s).mean() - 1.0) < 0.05
    assert s.max() <= 1.0 and s.min() >= -1.0


def test_dynamics_histogram_sums_to_one_and_ranges(
    results: dict[str, SongResult], config: Config
) -> None:
    d = results["aba_song"].maps.dynamics
    assert d.hist.shape == (40,) and d.hist.sum() == pytest.approx(1.0, abs=1e-6)
    assert d.envelope.shape == (1024,)
    assert 0.0 <= d.lra_db < 30.0
    assert d.peak_loudness_db <= 0.0 and d.mean_loudness_db < d.peak_loudness_db + 3.0


def test_dynamics_of_a_steady_and_a_stepped_signal(config: Config) -> None:
    fps = 43.0
    steady = np.full(int(60 * fps), -20.0)
    stepped = np.concatenate([np.full(int(30 * fps), -40.0), np.full(int(30 * fps), -10.0)])
    assert compute_dynamics(steady, fps, config).lra_db == pytest.approx(0.0, abs=1e-6)
    assert compute_dynamics(stepped, fps, config).lra_db > 20.0


def test_resize_axis_is_exact_area_average_and_nearest() -> None:
    a = np.arange(8, dtype=np.float64)
    assert np.allclose(resize_axis(a, 4), [0.5, 2.5, 4.5, 6.5])
    assert np.allclose(resize_axis(a, 3)[0], (0 + 1 + 2 * (8 / 3 - 2)) / (8 / 3), atol=1.0)
    assert np.allclose(resize_axis(np.array([1.0, 2.0]), 4), [1.0, 1.0, 2.0, 2.0])
    assert resize_axis(a, 8) is not None
    img = np.arange(64, dtype=np.float64).reshape(8, 8)
    assert resize_axis(resize_axis(img, 2, 0), 2, 1).mean() == pytest.approx(img.mean())


def test_maps_have_fixed_shapes_for_25_s_and_11_min(config: Config) -> None:
    from synesthesia.features import FrameFeatures

    rng = np.random.default_rng(0)
    fps = config.ingest.sample_rate / config.frames.hop
    for seconds in (25, 11 * 60):
        t = int(seconds * fps)
        loud = rng.normal(-25.0, 4.0, t)
        feats = FrameFeatures(
            mfcc=rng.normal(size=(t, 13)),
            mfcc_raw=rng.normal(size=(t, 13)),
            chroma_raw=rng.random((t, 12)),
            brightness=rng.normal(size=t),
            loudness=loud,
            loudness_raw=loud,
            noisiness=rng.normal(size=t),
            harmonicity=rng.random(t),
            change=rng.random(t),
            onset=rng.random(t),
            fps=fps,
        )
        m = compute_companion_maps(feats, config)
        assert m.structure.shape == (256, 256)
        assert m.rhythm.tempogram.shape == (128, 256)
        assert m.dynamics.envelope.shape == (1024,) and m.dynamics.hist.shape == (40,)


def test_fingerprint_scalars_follow_the_spec() -> None:
    s = fingerprint_scalars(120.0, 0.5, 15.0, -30.0, 180.0)
    assert np.allclose(s, [0.0, 0.5, 0.5, 0.5, 0.0])
    assert fingerprint_scalars(0.0, 0.0, 0.0, -60.0, 180.0)[0] < 0.0  # no pulse: finite


def test_feature_grids_reshape_in_cell_order(config: Config) -> None:
    k = config.grid.size**2
    norm = np.arange(5 * k, dtype=np.float64).reshape(5, k) / (5 * k)
    g = feature_grids(norm, config)
    assert g.shape == (5, config.grid.size, config.grid.size) and g.dtype == np.float32
    assert g[2, 3, 4] == pytest.approx(norm[2, 3 * config.grid.size + 4])


def test_complete_fingerprint_has_nonzero_scalars(results: dict[str, SongResult]) -> None:
    r = results["click_120bpm"]
    assert r.fingerprint_complete
    assert np.abs(r.fingerprint[-5:]).sum() > 0.0


def test_maps_are_deterministic(wavs: dict[str, Path], config: Config) -> None:
    from synesthesia.pipeline import analyze

    a, b = analyze(wavs["aba_song"], config), analyze(wavs["aba_song"], config)
    assert np.array_equal(a.maps.structure, b.maps.structure)
    assert np.array_equal(a.maps.rhythm.tempogram, b.maps.rhythm.tempogram)
    assert np.array_equal(a.fingerprint, b.fingerprint)
