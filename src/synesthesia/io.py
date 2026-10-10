"""Readers and writers for the output files (docs/ANALYSIS.md section 11).

``arrays.npz`` is written uncompressed with fixed zip metadata so identical arrays give
identical bytes on one machine. ``live.bin`` / ``proto.bin`` arrive in M3/M6.
"""

from __future__ import annotations

import io
import json
import platform
import sys
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from synesthesia.pipeline import SongResult

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
    """Arrays stored in ``arrays.npz`` (M1 subset of the spec's keys)."""
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


def write_result(result: SongResult, out_dir: Path, grid_size: int) -> Path:
    """Write ``signature.json``, ``arrays.npz`` and ``log.json`` into ``out_dir/<song_id>/``.

    Returns:
        The song directory.
    """
    song_dir = out_dir / result.song_id
    song_dir.mkdir(parents=True, exist_ok=True)
    write_npz_deterministic(song_dir / "arrays.npz", result_arrays(result))
    sig = signature_dict(result, grid_size)
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
