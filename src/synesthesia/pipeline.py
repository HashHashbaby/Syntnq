"""``analyze(path, config) -> SongResult`` (docs/ANALYSIS.md section 0)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import numpy.typing as npt

from synesthesia import PIPELINE_VERSION
from synesthesia.color import SignatureColors, map_colors
from synesthesia.config import Config
from synesthesia.determinism import single_thread
from synesthesia.features import FrameFeatures, extract_features
from synesthesia.fingerprint import compute_fingerprint, fingerprint_scalars
from synesthesia.ingest import DecodedAudio, IngestInfo, decode_file, normalize, song_id
from synesthesia.maps import CompanionMaps, compute_companion_maps
from synesthesia.maps.feature_grids import feature_grids
from synesthesia.occupancy import CellStats, cell_statistics
from synesthesia.orient import orient
from synesthesia.som import SomResult, train_som
from synesthesia.standardize import LayoutSpace, build_layout, layout_columns, to_physical

Array = npt.NDArray[np.float64]


@dataclass(frozen=True)
class SongResult:
    """Everything the analysis produces for one song (arrays in oriented unit order)."""

    song_id: str
    source_name: str
    pipeline_version: str
    config_hash: str
    calibration_hash: str | None
    ingest: IngestInfo
    n_frames: int
    fps: float
    orientation: str
    som: SomResult
    space: LayoutSpace
    prototypes: Array  # (K, D) oriented, layout space
    bmu: npt.NDArray[np.uint16]  # (T,) oriented
    stats: CellStats
    colors: SignatureColors
    feature_grids: npt.NDArray[np.float32]  # (5, size, size)
    maps: CompanionMaps  # structure, rhythm, dynamics
    fingerprint: npt.NDArray[np.float32]
    fingerprint_complete: bool
    features: FrameFeatures
    timings: dict[str, float] = field(default_factory=dict)


def analyze_audio(
    audio: DecodedAudio,
    config: Config,
    *,
    source_name: str = "",
    calibration_hash: str | None = None,
) -> SongResult:
    """Analyze already-decoded audio. Same samples + config + version -> identical arrays.

    Args:
        audio: decoded samples ``(N, C)`` at the native rate.
        config: resolved configuration.
        source_name: file name, recorded only in metadata.
        calibration_hash: hash of the calibration file merged into ``config``, if any.

    Returns:
        :class:`SongResult`.
    """
    timings: dict[str, float] = {}
    clock = time.perf_counter()
    with single_thread():
        y, info = normalize(audio, config)
        sid = song_id(y)
        timings["normalize"] = time.perf_counter() - clock
        clock = time.perf_counter()
        feats = extract_features(y, config)
        timings["features"] = time.perf_counter() - clock
        return analyze_features(
            feats,
            info,
            sid,
            config,
            source_name=source_name,
            calibration_hash=calibration_hash,
            timings=timings,
        )


def analyze_features(
    feats: FrameFeatures,
    info: IngestInfo,
    sid: str,
    config: Config,
    *,
    source_name: str = "",
    calibration_hash: str | None = None,
    timings: dict[str, float] | None = None,
) -> SongResult:
    """Everything after feature extraction: layout, SOM, orientation, colors, fingerprint.

    Split out so calibration and grid-size experiments can reuse one feature extraction.
    The caller is responsible for running inside ``single_thread()`` when determinism matters.
    """
    timings = {} if timings is None else timings
    clock = time.perf_counter()

    def lap(name: str) -> None:
        nonlocal clock
        now = time.perf_counter()
        timings[name] = now - clock
        clock = now

    with single_thread():
        space = build_layout(feats.layout_raw(), config)
        lap("standardize")

        som = train_som(space.features, config)
        lap("som")

        oriented = orient(som.prototypes, som.bmu, space, config)
        lap("orient")

        f_color = feats.color_matrix()
        cols = layout_columns(config)
        physical = to_physical(oriented.prototypes, space)
        proto_color = np.column_stack(
            [
                physical[:, cols["brightness"].start],
                physical[:, cols["loudness"].start],
                physical[:, cols["noisiness"].start],
                physical[:, cols["change"].start],
            ]
        )
        stats = cell_statistics(oriented.bmu, f_color, proto_color, config)
        lap("occupancy")

        colors = map_colors(stats.cell_features, stats.occ_norm, stats.empty, config)
        grids = feature_grids(colors.normalized, config)
        lap("color")

        maps = compute_companion_maps(feats, config)
        lap("maps")

        scalars = fingerprint_scalars(
            maps.rhythm.tempo_bpm,
            maps.rhythm.pulse_clarity,
            maps.dynamics.lra_db,
            maps.dynamics.mean_loudness_db,
            info.duration_s,
        )
        fingerprint = compute_fingerprint(f_color, stats.hits, colors, config, scalars)
        lap("fingerprint")

    return SongResult(
        song_id=sid,
        source_name=source_name,
        pipeline_version=PIPELINE_VERSION,
        config_hash=config.hash(),
        calibration_hash=calibration_hash,
        ingest=info,
        n_frames=feats.n_frames,
        fps=feats.fps,
        orientation=oriented.transform,
        som=som,
        space=space,
        prototypes=oriented.prototypes,
        bmu=oriented.bmu,
        stats=stats,
        colors=colors,
        feature_grids=grids,
        maps=maps,
        fingerprint=fingerprint,
        fingerprint_complete=True,
        features=feats,
        timings=timings,
    )


def analyze(path: Path, config: Config, *, calibration_hash: str | None = None) -> SongResult:
    """Decode and analyze an audio file.

    Args:
        path: audio file (wav, flac, ogg, mp3, m4a, aac, opus).
        config: resolved configuration.
        calibration_hash: hash of the merged calibration file, if any.

    Returns:
        :class:`SongResult` with ``timings['decode']`` included.

    Raises:
        SynError: with a code from docs/ANALYSIS.md section 13.
    """
    t0 = time.perf_counter()
    audio = decode_file(Path(path), config)
    decode_s = time.perf_counter() - t0
    result = analyze_audio(
        audio, config, source_name=Path(path).name, calibration_hash=calibration_hash
    )
    result.timings["decode"] = decode_s
    return result
