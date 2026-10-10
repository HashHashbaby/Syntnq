"""Typed configuration model mirroring ``config/default.yaml``.

Every tunable number lives in the YAML file and is read through :class:`Config`.
The SHA-256 of the canonical JSON of the resolved config (defaults merged with
``config/calibration.yaml`` when present) is stored in every output
(docs/ANALYSIS.md section 0).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, model_validator

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
DEFAULT_CONFIG_PATH = CONFIG_DIR / "default.yaml"
CALIBRATION_FILENAME = "calibration.yaml"
CALIBRATION_META_KEY = "calibration_meta"

_FLOAT_TOL = 1e-3


class _Section(BaseModel):
    """Base for all config sections: immutable, unknown keys rejected."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class Ingest(_Section):
    sample_rate: int  # Hz
    resampler: str
    mono: str
    target_lufs: float
    peak_ceiling_dbfs: float
    trim_silence_dbfs: float
    min_duration_s: float
    max_duration_s: float
    max_file_mb: int
    silent_lufs: float
    formats: list[str]


class Frames(_Section):
    n_fft: int
    hop: int  # samples
    window: str
    n_mels: int
    fmin_hz: float
    fmax_hz: float
    smooth_frames: int
    max_som_frames: int


class Mfcc(_Section):
    n_mfcc: int
    use: tuple[int, int]  # inclusive coefficient index range, e.g. (1, 13)


class LogFlag(_Section):
    log: bool


class Loudness(_Section):
    unit: str


class Noisiness(_Section):
    measure: str
    log: bool


class Harmonicity(_Section):
    method: str
    margin: float
    kernel_size: int


class Change(_Section):
    window_s: float


class Onset(_Section):
    aggregate: str


class Features(_Section):
    mfcc: Mfcc
    centroid: LogFlag
    loudness: Loudness
    noisiness: Noisiness
    harmonicity: Harmonicity
    change: Change
    onset: Onset


class BlockWeights(_Section):
    timbre: float
    brightness: float
    loudness: float
    noisiness: float
    change: float


class Layout(_Section):
    standardize: str
    block_weights: BlockWeights


class Grid(_Section):
    size: int
    topology: str


class Som(_Section):
    algorithm: str
    init: str
    epochs: int
    sigma_start: float
    sigma_end: float
    sigma_decay: str
    neighborhood: str
    dtype: str
    frame_chunk: int


class Orientation(_Section):
    enabled: bool
    up_feature: str
    right_feature: str


class Occupancy(_Section):
    kernel_sigma_cells: float
    gamma: float
    empty_threshold: float


class ColorRanges(_Section):
    centroid_log10_hz: tuple[float, float]
    loudness_dbfs: tuple[float, float]
    noisiness_log10: tuple[float, float]
    harmonicity: tuple[float, float]
    change_z: tuple[float, float]


class Hue(_Section):
    from_deg: float
    to_deg: float
    valence_blend: float


class Lightness(_Section):
    min: float
    max: float
    occupancy_weight: float
    loudness_weight: float
    empty_L: float  # noqa: N815 - mirrors the YAML key
    empty_chroma_factor: float


class Chroma(_Section):
    min: float
    max: float


class Color(_Section):
    space: str
    ranges: ColorRanges
    hue: Hue
    lightness: Lightness
    chroma: Chroma
    gamut: str
    display_smoothing_sigma: float


class StructureMap(_Section):
    block_s: float
    features: list[str]
    size: int
    similarity: str


class RhythmMap(_Section):
    tempogram_win_frames: int
    bpm_min: float
    bpm_max: float
    bpm_bins: int
    time_cols: int
    start_bpm: float


class DynamicsMap(_Section):
    envelope_points: int
    hist_bins: int
    hist_range_dbfs: tuple[float, float]
    short_term_s: float
    lra_percentiles: tuple[float, float]


class Maps(_Section):
    feature_grids: list[str]
    structure: StructureMap
    rhythm: RhythmMap
    dynamics: DynamicsMap


class Fingerprint(_Section):
    version: int
    hist_bins: int
    hue_bins: int
    lightness_bins: int

    @property
    def n_scalars(self) -> int:
        """Scalar entries: tempo, pulse clarity, LRA, mean loudness, duration."""
        return 5

    @property
    def length(self) -> int:
        """Total fingerprint length (133 with the default config)."""
        return 5 * self.hist_bins + self.hue_bins * self.lightness_bins + self.n_scalars


class Ripple(_Section):
    onset_threshold: float
    speed_cells_per_s: float
    decay_s: float
    width_cells: float
    amplitude: float
    max_concurrent: int


class Trail(_Section):
    length_s: float
    width_cells: float
    opacity: float


class ReducedMotion(_Section):
    ripples: bool
    diffusion: bool
    release_ms: float


class Live(_Section):
    fps: float
    tau_target_share: float
    tau_sample_frames: int
    tau_scale: float
    beat_latency_s: float
    blur_renormalize: bool
    attack_ms: float
    release_ms: float
    diffusion_rate: float
    diffusion_passes: int
    glow_sigma_cells: tuple[float, float]
    live_mix_max: float
    max_lightness: float
    live_lightness_boost: float
    global_mix: float
    global_lightness_swing: float
    live_chroma_gain: float
    ripple: Ripple
    trail: Trail
    reduced_motion: ReducedMotion
    glass: LiveGlass
    flow: LiveFlow


class Caption(_Section):
    enabled: bool
    font: str


class RenderGlass(_Section):
    mode: Literal["flat", "chip"]
    display_block: int
    radius_mode: Literal["constant", "occupancy"]
    chip_radius: float
    radius_occ_amount: float
    radius_min: float
    radius_max: float
    overlap: float
    overlap_radius: float
    overlap_radius_max: float
    overlap_lightness_comp: float
    swirl_angle_deg: float
    swirl_falloff_power: float
    absorb_edge_dark: float
    absorb_edge_sat: float
    edge_ring_start: float
    edge_ring_dark: float
    edge_ring_sat: float
    edge_directional: float
    grain: float
    veins: float
    vein_scale: float
    backlight: float
    haze_strength: float
    haze_sigma_cells: float
    glint_strength: float
    glint_size: float
    glint_offset: float
    light_dir: tuple[float, float, float]
    exposure: float
    bloom_strength: float
    bloom_sigma: float
    dither: float
    color_space: Literal["srgb", "display-p3"]
    chroma_ceiling: float
    chroma_ceiling_p3: float
    flat_fallback: bool


class LiveGlass(_Section):
    swirl_flow_gain: float
    swirl_loud_gain: float
    swirl_drift_hz: float
    reduced_motion: Literal["static", "flat"]


class LiveFlow(_Section):
    enabled: bool
    wave_speed: float
    damping: float
    substeps: int
    source_gain: float
    source_sigma_cells: float
    beat_gain: float
    current_dir: tuple[float, float]
    current_speed: float
    current_loud_gain: float
    curl_amp: float
    curl_scale: float
    mod_transmission: float
    mod_vibrance: float
    mod_radius: float
    slope_glint_gain: float
    wave_limit: float
    reduced_motion: Literal["follow", "static"]


class Render(_Section):
    export_px: list[int]
    preview_px: int
    margin_cells: float
    dot_radius_ratio: float
    glow_sigma_ratio: float
    glow_opacity: float
    background: str
    caption: Caption
    glass: RenderGlass


class Preview(_Section):
    fps: int
    px: int
    default_seconds: float
    codec: str
    crf: int
    audio_kbps: int


class Api(_Section):
    storage_dir: str
    keep_audio: bool
    retention_days: int
    max_concurrent_jobs: int
    job_timeout_s: float


class Performance(_Section):
    budget_analysis_s_per_4min: float
    budget_peak_ram_gb: float
    target_fps: int


class Config(_Section):
    """Full resolved configuration (schema v1)."""

    schema_version: Literal[1]
    seed: int
    ingest: Ingest
    frames: Frames
    features: Features
    layout: Layout
    grid: Grid
    som: Som
    orientation: Orientation
    occupancy: Occupancy
    color: Color
    maps: Maps
    fingerprint: Fingerprint
    live: Live
    render: Render
    preview: Preview
    api: Api
    performance: Performance

    @model_validator(mode="after")
    def _check_consistency(self) -> Config:
        w = self.layout.block_weights
        total = w.timbre + w.brightness + w.loudness + w.noisiness + w.change
        if abs(total - 1.0) > _FLOAT_TOL:
            raise ValueError(f"layout.block_weights must sum to 1, got {total}")
        lw = self.color.lightness
        if abs(lw.occupancy_weight + lw.loudness_weight - 1.0) > _FLOAT_TOL:
            raise ValueError("color.lightness weights must sum to 1")
        lo, hi = self.features.mfcc.use
        if not 0 <= lo <= hi < self.features.mfcc.n_mfcc:
            raise ValueError("features.mfcc.use must lie within 0..n_mfcc-1")
        expected_fps = self.ingest.sample_rate / self.frames.hop
        if abs(self.live.fps - expected_fps) > _FLOAT_TOL:
            raise ValueError(f"live.fps {self.live.fps} != sample_rate/hop {expected_fps}")
        if self.frames.smooth_frames % 2 == 0:
            raise ValueError("frames.smooth_frames must be odd (centered average)")
        return self

    @property
    def layout_dim(self) -> int:
        """Dimension D of the layout feature vector (17 with the default config)."""
        lo, hi = self.features.mfcc.use
        return (hi - lo + 1) + 4  # MFCCs + brightness, loudness, noisiness, change

    @property
    def n_cells(self) -> int:
        """Number of SOM cells (grid.size squared)."""
        return self.grid.size * self.grid.size

    def canonical_json(self) -> str:
        """Canonical JSON: sorted keys, no whitespace, ASCII only."""
        return json.dumps(
            self.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )

    def hash(self) -> str:
        """SHA-256 hex digest of :meth:`canonical_json`."""
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _read_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def load_config(
    path: Path | str | None = None,
    *,
    use_calibration: bool = True,
    overrides: dict[str, Any] | None = None,
) -> Config:
    """Load, merge and validate the configuration.

    Args:
        path: YAML file; defaults to ``config/default.yaml`` in the repository.
        use_calibration: merge ``calibration.yaml`` found next to ``path`` when present.
        overrides: nested dict deep-merged last (experiments, tests).

    Returns:
        Validated, immutable :class:`Config`.
    """
    cfg_path = Path(path) if path is not None else DEFAULT_CONFIG_PATH
    data = _read_yaml(cfg_path)
    calibration = cfg_path.parent / CALIBRATION_FILENAME
    if use_calibration and calibration.is_file():
        cal = _read_yaml(calibration)
        cal.pop(CALIBRATION_META_KEY, None)  # provenance only; never part of the config
        data = _deep_merge(data, cal)
    if overrides:
        data = _deep_merge(data, overrides)
    return Config.model_validate(data)


def calibration_hash(path: Path | str | None = None) -> str | None:
    """SHA-256 of the canonical JSON of the calibration file next to ``path``, or ``None``."""
    cfg_path = Path(path) if path is not None else DEFAULT_CONFIG_PATH
    calibration = cfg_path.parent / CALIBRATION_FILENAME
    if not calibration.is_file():
        return None
    text = json.dumps(_read_yaml(calibration), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
