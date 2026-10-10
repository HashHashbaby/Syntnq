from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from fixtures import make_signals as ms
from synesthesia.config import Config, load_config
from synesthesia.errors import ErrorCode, SynError
from synesthesia.ingest import DecodedAudio, decode_file, normalize, song_id


def _audio(x: np.ndarray, channels: int = 1) -> DecodedAudio:
    return DecodedAudio(np.tile(x[:, None], (1, channels)), ms.SAMPLE_RATE)


def test_normalize_output_rate_and_target_loudness(config: Config) -> None:
    y, info = normalize(_audio(ms.pink_noise()), config)
    assert y.size == round(ms.DURATION_S * config.ingest.sample_rate)
    assert info.original_rate == ms.SAMPLE_RATE
    assert info.measured_lufs + info.applied_gain_db == pytest.approx(
        config.ingest.target_lufs, abs=1e-6
    )
    assert info.peak_dbfs_after <= config.ingest.peak_ceiling_dbfs + 1e-6


def test_gain_invariance(config: Config) -> None:
    x = ms.aba_song()
    y1, i1 = normalize(_audio(x), config)
    y2, i2 = normalize(_audio(0.5 * x), config)  # -6.02 dB before ingest
    assert np.max(np.abs(y1 - y2)) < 1e-4
    assert i1.applied_gain_db - i2.applied_gain_db == pytest.approx(-6.0206, abs=1e-3)


def test_peak_ceiling_caps_gain(config: Config) -> None:
    x = 0.01 * ms.white_noise() / ms.PEAK  # quiet: wants a large boost
    x[1000] = 0.99  # but a spike limits it
    y, info = normalize(_audio(x), config)
    assert np.max(np.abs(y)) <= 10 ** (config.ingest.peak_ceiling_dbfs / 20) + 1e-9
    assert info.applied_gain_db < config.ingest.target_lufs - info.measured_lufs


def test_stereo_equals_mono(config: Config) -> None:
    x = ms.chord()
    y1, _ = normalize(_audio(x, 1), config)
    y2, _ = normalize(_audio(x, 2), config)
    assert np.array_equal(y1, y2)


def test_song_id_independent_of_container(tmp_path: Path, config: Config) -> None:
    # Write the *same* int16 samples to both containers: libsndfile quantizes float input
    # differently per format (1 LSB), which would make the two files different audio.
    pcm = np.rint(ms.aba_song() * 32767.0).astype(np.int16)
    wav, flac = tmp_path / "a.wav", tmp_path / "a.flac"
    sf.write(wav, pcm, ms.SAMPLE_RATE, subtype="PCM_16")
    sf.write(flac, pcm, ms.SAMPLE_RATE, subtype="PCM_16")
    ids = [song_id(normalize(decode_file(p, config), config)[0]) for p in (wav, flac)]
    assert ids[0] == ids[1]
    assert len(ids[0]) == 16


def _error_code(path: Path, config: Config) -> ErrorCode:
    with pytest.raises(SynError) as exc:
        normalize(decode_file(path, config), config)
    return exc.value.code


def test_too_short(wavs: dict[str, Path], config: Config) -> None:
    assert _error_code(wavs["short_10s"], config) is ErrorCode.E_TOO_SHORT


def test_silent(wavs: dict[str, Path], config: Config) -> None:
    assert _error_code(wavs["silence"], config) is ErrorCode.E_SILENT


def test_too_long(wavs: dict[str, Path]) -> None:
    cfg = load_config(overrides={"ingest": {"max_duration_s": 10.0}})
    assert _error_code(wavs["chord"], cfg) is ErrorCode.E_TOO_LONG


def test_format_size_and_decode_errors(
    tmp_path: Path, wavs: dict[str, Path], config: Config
) -> None:
    txt = tmp_path / "a.txt"
    txt.write_text("x")
    assert _error_code(txt, config) is ErrorCode.E_FORMAT

    tiny = load_config(overrides={"ingest": {"max_file_mb": 0}})
    assert _error_code(wavs["chord"], tiny) is ErrorCode.E_SIZE

    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not audio at all" * 100)
    assert _error_code(bad, config) is ErrorCode.E_DECODE


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_mp3_decodes_through_ffmpeg(tmp_path: Path, wavs: dict[str, Path], config: Config) -> None:
    mp3 = tmp_path / "chord.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wavs["chord"]), str(mp3)], check=True)
    audio = decode_file(mp3, config)
    assert audio.ffmpeg_version is not None and audio.ffmpeg_version.startswith("ffmpeg")
    assert audio.sample_rate == ms.SAMPLE_RATE
    y, info = normalize(audio, config)
    assert info.duration_s == pytest.approx(ms.DURATION_S, abs=0.2)
    assert np.isfinite(y).all()
