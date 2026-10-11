"""Readers and writers for the output files (docs/ANALYSIS.md section 11).

``arrays.npz`` is written uncompressed with fixed zip metadata so identical arrays give
identical bytes on one machine. ``live.bin`` / ``proto.bin`` arrive in M3/M6.
"""

from __future__ import annotations

import io
import json
import platform
import struct
import sys
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.pipeline import SongResult

if TYPE_CHECKING:
    from synesthesia.live import LiveStream

SCHEMA_VERSION = 1
_ZIP_DATE = (1980, 1, 1, 0, 0, 0)  # earliest zip timestamp: no wall-clock in the bytes
_ZIP_UNIX = 3
_ZIP_MODE = 0o600 << 16


def write_npz_deterministic(path: Path, arrays: dict[str, npt.NDArray[Any]]) -> None:
    """Write ``arrays`` as an uncompressed ``.npz`` with fixed timestamps, in dict order."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, arr in arrays.items():
            buf = io.BytesIO()
            np.lib.format.write_array(buf, np.ascontiguousarray(arr), allow_pickle=False)
            info = zipfile.ZipInfo(f"{name}.npy", date_time=_ZIP_DATE)
            info.create_system = _ZIP_UNIX
            info.external_attr = _ZIP_MODE
            info.compress_type = zipfile.ZIP_STORED
            zf.writestr(info, buf.getvalue())


def result_arrays(result: SongResult) -> dict[str, npt.NDArray[Any]]:
    """Arrays stored in ``arrays.npz`` (docs/ANALYSIS.md section 11)."""
    maps = result.maps
    return {
        "prototypes": result.prototypes.astype(np.float32),
        "std_mean": result.space.mean.astype(np.float64),
        "std_scale": result.space.scale.astype(np.float64),
        "block_weights": result.space.weights.astype(np.float64),
        "hits": result.stats.hits,
        "occ_norm": result.stats.occ_norm.astype(np.float32),
        "cell_features": result.stats.cell_features.astype(np.float32),
        "color_oklch": result.colors.oklch.astype(np.float32),
        "color_srgb": result.colors.srgb,
        "feature_grids": result.feature_grids,
        "structure": maps.structure,
        "tempogram": maps.rhythm.tempogram,
        "beat_times": maps.rhythm.beat_times_s,
        "dyn_envelope": maps.dynamics.envelope,
        "dyn_hist": maps.dynamics.hist,
        "fingerprint": result.fingerprint,
    }


def signature_dict(result: SongResult, config_grid_size: int) -> dict[str, Any]:
    """The ``signature.json`` document (no timing fields; those live in ``log.json``)."""
    info = result.ingest
    return {
        "schema_version": SCHEMA_VERSION,
        "pipeline_version": result.pipeline_version,
        "config_hash": f"sha256:{result.config_hash}",
        "calibration_hash": (
            f"sha256:{result.calibration_hash}" if result.calibration_hash else None
        ),
        "song": {
            "id": result.song_id,
            "title": None,
            "artist": None,
            "duration_s": info.duration_s,
            "source_name": result.source_name,
            "measured_lufs": info.measured_lufs,
            "applied_gain_db": info.applied_gain_db,
        },
        "grid": {
            "size": config_grid_size,
            "orientation": result.orientation,
            "frames": result.n_frames,
            "fps": result.fps,
        },
        "som": {
            "quantization_error": result.som.quantization_error,
            "topographic_error": result.som.topographic_error,
            "empty_units": result.som.empty_units,
        },
        "rhythm": {
            "tempo_bpm": result.maps.rhythm.tempo_bpm,
            "pulse_clarity": result.maps.rhythm.pulse_clarity,
        },
        "dynamics": {
            "lra_db": result.maps.dynamics.lra_db,
            "mean_loudness_db": result.maps.dynamics.mean_loudness_db,
            "peak_loudness_db": result.maps.dynamics.peak_loudness_db,
        },
        "fingerprint_complete": result.fingerprint_complete,
        "license": {"name": "unknown", "attribution": ""},
    }


def _lib_versions() -> dict[str, str]:
    from importlib.metadata import version

    return {
        "python": platform.python_version(),
        "platform": sys.platform,
        **{
            pkg: version(pkg)
            for pkg in ("numpy", "scipy", "librosa", "soxr", "pyloudnorm", "soundfile")
        },
    }


def write_result(result: SongResult, out_dir: Path, config: Config) -> Path:
    """Write ``signature.json``, ``arrays.npz`` and ``log.json`` into ``out_dir/<song_id>/``.

    Returns:
        The song directory.
    """
    grid_size = config.grid.size
    song_dir = out_dir / result.song_id
    song_dir.mkdir(parents=True, exist_ok=True)
    write_npz_deterministic(song_dir / "arrays.npz", result_arrays(result))
    from synesthesia.live import build_live_stream

    stream = build_live_stream(result, config)
    (song_dir / "live.bin").write_bytes(encode_live_bin(stream, grid_size))
    (song_dir / "proto.bin").write_bytes(encode_proto_bin(result.prototypes, grid_size))
    sig = signature_dict(result, grid_size)
    sig["live"] = {"tau": stream.tau, "audio_offset_s": stream.audio_offset_s}
    if result.emotion is not None:
        sig["emotion"] = {
            "valence": result.emotion[0],
            "arousal": result.emotion[1],
            "model_hash": f"sha256:{result.emotion_model_hash}",
        }
    (song_dir / "signature.json").write_text(
        json.dumps(sig, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    log = {
        "timings_s": {k: round(v, 4) for k, v in result.timings.items()},
        "total_s": round(sum(result.timings.values()), 4),
        "libraries": _lib_versions(),
        "ffmpeg": result.ingest.ffmpeg_version,
        "ingest": {
            "original_duration_s": result.ingest.original_duration_s,
            "original_channels": result.ingest.original_channels,
            "original_rate": result.ingest.original_rate,
            "trimmed_start_s": result.ingest.trimmed_start_s,
            "trimmed_end_s": result.ingest.trimmed_end_s,
            "peak_dbfs_after": result.ingest.peak_dbfs_after,
        },
        "warnings": [],
    }
    (song_dir / "log.json").write_text(
        json.dumps(log, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return song_dir


def read_signature(path: Path) -> dict[str, Any]:
    """Read ``signature.json``, refusing unknown schema major versions."""
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"unsupported schema_version {data.get('schema_version')!r}")
    return data


def read_arrays(path: Path) -> dict[str, npt.NDArray[Any]]:
    """Read ``arrays.npz`` into a dict."""
    with np.load(path, allow_pickle=False) as npz:
        return {k: npz[k] for k in npz.files}


# -- binary formats (docs/API.md section 3) ---------------------------------------------------
_BIN_VERSION = 1
_HEADER = struct.Struct("<4sHHII")  # magic, version, grid size, count, reserved


def _header(magic: bytes, grid_size: int, count: int) -> bytes:
    return _HEADER.pack(magic, _BIN_VERSION, grid_size, count, 0)


def _check_header(buf: bytes, magic: bytes) -> tuple[int, int]:
    m, version, grid_size, count, _ = _HEADER.unpack_from(buf, 0)
    if m != magic or version != _BIN_VERSION:
        raise ValueError(f"bad header: {m!r} v{version}, expected {magic!r} v{_BIN_VERSION}")
    return grid_size, count


def encode_live_bin(stream: LiveStream, grid_size: int) -> bytes:
    """Serialize a live stream as ``live.bin`` (``SYNL``)."""
    t, d = stream.x.shape
    out = io.BytesIO()
    out.write(_header(b"SYNL", grid_size, t))
    out.write(struct.pack("<ffHH", stream.fps, stream.tau, d, 0))
    out.write(np.ascontiguousarray(stream.x, dtype="<f2").tobytes())
    out.write(np.ascontiguousarray(stream.bmu, dtype="<u2").tobytes())
    out.write(np.ascontiguousarray(stream.loud, dtype=np.uint8).tobytes())
    out.write(np.ascontiguousarray(stream.onset, dtype=np.uint8).tobytes())
    out.write(np.ascontiguousarray(stream.color, dtype=np.uint8).tobytes())
    out.write(struct.pack("<I", stream.beat_times.size))
    out.write(np.ascontiguousarray(stream.beat_times, dtype="<f4").tobytes())
    return out.getvalue()


def decode_live_bin(buf: bytes) -> tuple[LiveStream, int]:
    """Parse ``live.bin``; returns the stream (``audio_offset_s`` is 0) and the grid size."""
    from synesthesia.live import LiveStream

    grid_size, t = _check_header(buf, b"SYNL")
    pos = _HEADER.size
    fps, tau, d, _ = struct.unpack_from("<ffHH", buf, pos)
    pos += 12

    def take(dtype: str, shape: tuple[int, ...]) -> npt.NDArray[Any]:
        nonlocal pos
        n = int(np.prod(shape))
        arr = np.frombuffer(buf, dtype=dtype, count=n, offset=pos).reshape(shape)
        pos += arr.nbytes
        return arr

    x = take("<f2", (t, d))
    bmu = take("<u2", (t,))
    loud = take("u1", (t,))
    onset = take("u1", (t,))
    color = take("u1", (t, 5))
    (n_beats,) = struct.unpack_from("<I", buf, pos)
    pos += 4
    beats = take("<f4", (n_beats,))
    return LiveStream(float(fps), float(tau), x, bmu, loud, onset, color, beats), grid_size


def encode_proto_bin(prototypes: npt.NDArray[np.float64], grid_size: int) -> bytes:
    """Serialize oriented prototypes as ``proto.bin`` (``SYNP``)."""
    k, d = prototypes.shape
    return (
        _header(b"SYNP", grid_size, k)
        + struct.pack("<HH", d, 0)
        + np.ascontiguousarray(prototypes, dtype="<f2").tobytes()
    )


def decode_proto_bin(buf: bytes) -> npt.NDArray[np.float16]:
    """Parse ``proto.bin`` into a ``(K, D)`` float16 array."""
    _, k = _check_header(buf, b"SYNP")
    d, _ = struct.unpack_from("<HH", buf, _HEADER.size)
    return np.frombuffer(buf, dtype="<f2", count=k * d, offset=_HEADER.size + 4).reshape(k, d)
