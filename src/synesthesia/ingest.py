"""Decode, mono, resample, trim and loudness-normalize audio (docs/ANALYSIS.md section 1).

``decode_file`` does the I/O (soundfile or an ffmpeg subprocess); ``normalize`` is a pure
function of the decoded samples and the config, so metadata never affects arrays.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pyloudnorm
import soundfile as sf
import soxr

from synesthesia.config import Config
from synesthesia.errors import ErrorCode, SynError

_BYTES_PER_MB = 1024 * 1024
_FFMPEG_SUFFIXES = frozenset({"mp3", "m4a", "aac", "opus"})
_SOUNDFILE_SUFFIXES = frozenset({"wav", "flac", "ogg"})
_RMS_EPS = 1e-10  # added before log10 so digital silence maps to a finite level
_SONG_ID_HEX_CHARS = 16
_RESAMPLER_QUALITY = {"soxr_hq": "HQ"}


@dataclass(frozen=True)
class DecodedAudio:
    """Decoded audio at the file's native rate.

    Attributes:
        samples: ``(N, C)`` float64, channels last.
        sample_rate: native sample rate in Hz.
        ffmpeg_version: first line of ``ffmpeg -version`` when ffmpeg was used, else ``None``.
    """

    samples: npt.NDArray[np.float64]
    sample_rate: int
    ffmpeg_version: str | None = None


@dataclass(frozen=True)
class IngestInfo:
    """Facts recorded about ingestion (never used to alter arrays afterwards)."""

    duration_s: float  # after trimming
    original_duration_s: float
    original_channels: int
    original_rate: int  # Hz
    trimmed_start_s: float
    trimmed_end_s: float
    measured_lufs: float
    applied_gain_db: float
    peak_dbfs_after: float
    ffmpeg_version: str | None


def _suffix(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


def _ffmpeg_version() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise SynError(ErrorCode.E_DECODE, "ffmpeg not found on PATH")
    out = subprocess.run([exe, "-version"], capture_output=True, text=True, check=False)
    return out.stdout.splitlines()[0] if out.stdout else "unknown"


def _decode_ffmpeg(path: Path, timeout_s: float) -> DecodedAudio:
    version = _ffmpeg_version()
    probe = shutil.which("ffprobe")
    exe = shutil.which("ffmpeg")
    if probe is None or exe is None:
        raise SynError(ErrorCode.E_DECODE, "ffmpeg/ffprobe not found on PATH")
    info = subprocess.run(
        [
            probe,
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=sample_rate,channels",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout_s,
    )
    try:
        stream = json.loads(info.stdout)["streams"][0]
        rate = int(stream["sample_rate"])
        channels = int(stream["channels"])
    except (KeyError, IndexError, ValueError, json.JSONDecodeError) as exc:
        raise SynError(ErrorCode.E_DECODE, f"ffprobe could not read {path.name}") from exc
    proc = subprocess.run(
        [
            exe,
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(path),
            "-vn",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-",
        ],
        capture_output=True,
        check=False,
        timeout=timeout_s,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise SynError(ErrorCode.E_DECODE, proc.stderr.decode("utf-8", "replace")[:200])
    raw = np.frombuffer(proc.stdout, dtype="<f4")
    raw = raw[: raw.size - raw.size % channels]
    return DecodedAudio(raw.reshape(-1, channels).astype(np.float64), rate, version)


def _decode_soundfile(path: Path) -> DecodedAudio:
    try:
        samples, rate = sf.read(path, dtype="float64", always_2d=True)
    except Exception as exc:  # soundfile raises RuntimeError/LibsndfileError
        raise SynError(ErrorCode.E_DECODE, str(exc)[:200]) from exc
    return DecodedAudio(samples, int(rate))


def decode_file(path: Path, config: Config) -> DecodedAudio:
    """Validate and decode an audio file.

    Args:
        path: audio file; extension must be in ``ingest.formats``.
        config: resolved configuration.

    Returns:
        Samples ``(N, C)`` float64 at the native sample rate.

    Raises:
        SynError: ``E_FORMAT``, ``E_SIZE`` or ``E_DECODE``.
    """
    path = Path(path)
    suffix = _suffix(path)
    if suffix not in config.ingest.formats or suffix not in (
        _FFMPEG_SUFFIXES | _SOUNDFILE_SUFFIXES
    ):
        raise SynError(ErrorCode.E_FORMAT, f"unsupported extension .{suffix}")
    if not path.is_file():
        raise SynError(ErrorCode.E_DECODE, f"{path} is not a file")
    if path.stat().st_size > config.ingest.max_file_mb * _BYTES_PER_MB:
        raise SynError(ErrorCode.E_SIZE, f"{path.stat().st_size} bytes")
    if suffix in _FFMPEG_SUFFIXES:
        try:
            return _decode_ffmpeg(path, config.ingest.decode_timeout_s)
        except subprocess.TimeoutExpired as exc:
            raise SynError(ErrorCode.E_DECODE, "decoder timed out") from exc
    return _decode_soundfile(path)


def _trim(y: npt.NDArray[np.float64], config: Config) -> tuple[npt.NDArray[np.float64], int, int]:
    """Trim leading/trailing blocks below the silence threshold. Returns (y, start, end)."""
    block = config.frames.n_fft
    n_blocks = max(1, y.size // block)
    usable = y[: n_blocks * block] if y.size >= block else y
    rms = np.sqrt(np.mean(usable.reshape(n_blocks, -1) ** 2, axis=1))
    level_db = 20.0 * np.log10(rms + _RMS_EPS)
    active = np.flatnonzero(level_db >= config.ingest.trim_silence_dbfs)
    if active.size == 0:
        raise SynError(ErrorCode.E_SILENT, "no audio above the trim threshold")
    start = int(active[0]) * block
    last = int(active[-1])
    end = y.size if last >= n_blocks - 1 else (last + 1) * block
    return y[start:end], start, end


def normalize(audio: DecodedAudio, config: Config) -> tuple[npt.NDArray[np.float64], IngestInfo]:
    """Mono, resample, trim and loudness-normalize decoded audio.

    Args:
        audio: decoded samples ``(N, C)`` at the native rate.
        config: resolved configuration.

    Returns:
        ``y`` of shape ``(N',)`` float64 at ``ingest.sample_rate`` Hz, and ingest facts.

    Raises:
        SynError: ``E_SILENT``, ``E_TOO_SHORT`` or ``E_TOO_LONG``.
    """
    cfg = config.ingest
    if cfg.mono != "mean":
        raise ValueError(f"unsupported ingest.mono {cfg.mono!r}")
    quality = _RESAMPLER_QUALITY.get(cfg.resampler)
    if quality is None:
        raise ValueError(f"unsupported ingest.resampler {cfg.resampler!r}")
    mono = np.mean(audio.samples, axis=1)
    original_duration = mono.size / audio.sample_rate
    if audio.sample_rate != cfg.sample_rate:
        mono = soxr.resample(mono, audio.sample_rate, cfg.sample_rate, quality=quality)
    mono = np.asarray(mono, dtype=np.float64)

    y, start, end = _trim(mono, config)
    duration = y.size / cfg.sample_rate
    if duration < cfg.min_duration_s:
        raise SynError(ErrorCode.E_TOO_SHORT, f"{duration:.1f} s after trimming")
    if duration > cfg.max_duration_s:
        raise SynError(ErrorCode.E_TOO_LONG, f"{duration:.1f} s")

    meter = pyloudnorm.Meter(cfg.sample_rate)
    lufs = float(meter.integrated_loudness(y))
    if not np.isfinite(lufs) or lufs < cfg.silent_lufs:
        raise SynError(ErrorCode.E_SILENT, f"integrated loudness {lufs} LUFS")
    peak = float(np.max(np.abs(y)))
    peak_dbfs = 20.0 * np.log10(peak)
    gain_db = min(cfg.target_lufs - lufs, cfg.peak_ceiling_dbfs - peak_dbfs)
    y = y * 10.0 ** (gain_db / 20.0)

    info = IngestInfo(
        duration_s=duration,
        original_duration_s=original_duration,
        original_channels=audio.samples.shape[1],
        original_rate=audio.sample_rate,
        trimmed_start_s=start / cfg.sample_rate,
        trimmed_end_s=(mono.size - end) / cfg.sample_rate,
        measured_lufs=lufs,
        applied_gain_db=float(gain_db),
        peak_dbfs_after=float(peak_dbfs + gain_db),
        ffmpeg_version=audio.ffmpeg_version,
    )
    return y, info


def song_id(y: npt.NDArray[np.float64]) -> str:
    """Song ID: first 16 hex chars of SHA-256 over little-endian float32 PCM of ``y``."""
    pcm = np.ascontiguousarray(y, dtype="<f4").tobytes()
    return hashlib.sha256(pcm).hexdigest()[:_SONG_ID_HEX_CHARS]
