from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from fixtures import make_signals as ms
from synesthesia.determinism import sha256_array


@pytest.mark.parametrize("name", list(ms.SIGNALS))
def test_signal_generation_is_deterministic(name: str) -> None:
    assert sha256_array(ms.SIGNALS[name]()) == sha256_array(ms.SIGNALS[name]())


@pytest.mark.determinism
def test_written_wavs_are_byte_identical(tmp_path: Path) -> None:
    first = ms.write_all(tmp_path / "a")
    second = ms.write_all(tmp_path / "b")
    assert set(first) == set(ms.SIGNALS)
    for name in first:
        h1 = hashlib.sha256(first[name].read_bytes()).hexdigest()
        h2 = hashlib.sha256(second[name].read_bytes()).hexdigest()
        assert h1 == h2, name


def test_durations_and_headroom() -> None:
    for name, make in ms.SIGNALS.items():
        x = make()
        expected = ms.SHORT_DURATION_S if name == "short_10s" else ms.DURATION_S
        assert x.size == round(expected * ms.SAMPLE_RATE), name
        assert np.max(np.abs(x)) <= ms.PEAK + 1e-9, name


def test_silence_is_silent() -> None:
    assert not np.any(ms.silence())


def test_click_track_has_120_bpm_spacing() -> None:
    x = ms.click_track()
    onsets = np.flatnonzero((np.abs(x) > 0.1) & (np.roll(np.abs(x), 1) <= 0.1))
    # first sample of each burst can sit under the threshold; look at burst starts
    gaps = np.diff(onsets[np.diff(onsets, prepend=-(10**9)) > ms.SAMPLE_RATE // 10])
    assert gaps.size > 10
    assert np.allclose(gaps / ms.SAMPLE_RATE, 60.0 / ms.CLICK_BPM, atol=2e-3)


def test_wav_roundtrip_metadata(tmp_path: Path) -> None:
    path = ms.write_all(tmp_path)["chord"]
    info = sf.info(path)
    assert info.samplerate == ms.SAMPLE_RATE
    assert info.channels == 1
    assert info.subtype == "PCM_16"
