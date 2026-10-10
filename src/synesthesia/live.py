"""Live stream export and the reference response-field math (docs/LIVE.md sections 1-3).

The live layer is an animation on top of the fixed static signature; it is not part of the
deterministic output arrays. ``LiveEngine`` is the Python reference that the WebGL renderer
(M7) must match.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import librosa
import numpy as np
import numpy.typing as npt
from scipy.ndimage import convolve, gaussian_filter

from synesthesia.color import (
    gamut_map,
    linear_to_srgb8,
    normalize_features,
    oklab_to_linear_srgb,
    oklch_to_oklab,
)
from synesthesia.config import Config
from synesthesia.pipeline import SongResult

Array = npt.NDArray[np.float64]

_BYTE_MAX = 255.0
_MAX_LIVE_LIGHTNESS = 0.95  # docs/LIVE.md 2.7 clamp
_RIPPLE_END_DECAYS = 5.0  # a ripple is dropped after this many decay times
_SWELL_MAX = 0.12  # docs/LIVE.md 2.9: dot radius swells up to +12% with A_i
_RENORM_FLOOR = 1e-12
_PEAK_EPS = 1e-9  # minimum curvature for a parabolic beat refinement


@dataclass(frozen=True)
class LiveStream:
    """Per-frame data for the liquid grid (docs/API.md ``live.bin``).

    Attributes:
        fps: analysis frames per second.
        tau: response width (``tau_scale`` x median BMU distance).
        x: ``(T, D)`` float16 standardized, weighted layout features.
        bmu: ``(T,)`` uint16 oriented best-matching cell per frame.
        loud: ``(T,)`` uint8 normalized loudness.
        onset: ``(T,)`` uint8 normalized onset strength.
        color: ``(T, 5)`` uint8 normalized color features (brightness, loudness, noisiness,
            harmonicity, change).
        beat_times: ``(B,)`` float32 seconds.
        audio_offset_s: seconds trimmed from the start of the source audio during ingest;
            analysis time ``s`` is source-file time ``s + audio_offset_s``.
    """

    fps: float
    tau: float
    x: npt.NDArray[np.float16]
    bmu: npt.NDArray[np.uint16]
    loud: npt.NDArray[np.uint8]
    onset: npt.NDArray[np.uint8]
    color: npt.NDArray[np.uint8]
    beat_times: npt.NDArray[np.float32]
    audio_offset_s: float = 0.0

    @property
    def n_frames(self) -> int:
        return int(self.x.shape[0])


def detect_beats(onset: Array, config: Config) -> npt.NDArray[np.float32]:
    """Beat times in seconds from the normalized onset envelope (``rhythm.start_bpm`` prior).

    Args:
        onset: ``(T,)`` onset strength in [0, 1], one value per analysis frame.
        config: resolved configuration.

    Returns:
        ``(B,)`` float32 seconds.
    """
    _, frames = librosa.beat.beat_track(
        onset_envelope=onset,
        sr=config.ingest.sample_rate,
        hop_length=config.frames.hop,
        start_bpm=config.maps.rhythm.start_bpm,
        units="frames",
    )
    fps = config.ingest.sample_rate / config.frames.hop
    k = np.asarray(frames, dtype=np.int64)
    inner = (k >= 1) & (k < onset.shape[0] - 1)
    offset = np.zeros(k.shape[0])
    y0, y1, y2 = (onset[np.clip(k + d, 0, onset.shape[0] - 1)] for d in (-1, 0, 1))
    curv = y0 - 2.0 * y1 + y2
    peaked = inner & (curv < -_PEAK_EPS)
    offset[peaked] = np.clip(0.5 * (y0 - y2)[peaked] / curv[peaked], -0.5, 0.5)
    seconds = (k + offset) / fps - config.live.beat_latency_s
    return np.asarray(np.maximum(seconds, 0.0), dtype=np.float32)


def response_width(x: Array, prototypes: Array, config: Config) -> float:
    """Response width tau such that ``live.tau_target_share`` of cells respond at r >= 0.5.

    For each sampled frame, ``d2_k`` is the squared distance (relative to the best match) of
    the k-th closest cell with ``k = share * K``; r >= 0.5 there means ``d2_k = 2 tau^2 ln 2``.
    The median over frames is used, then multiplied by ``live.tau_scale``.

    Args:
        x: ``(T, D)`` layout features of all frames.
        prototypes: ``(K, D)`` oriented prototypes.
        config: resolved configuration.

    Returns:
        tau in layout-space distance units.
    """
    lv = config.live
    stride = max(1, -(-x.shape[0] // lv.tau_sample_frames))
    xs = x[::stride]
    d2 = np.maximum(
        np.einsum("td,td->t", xs, xs)[:, None]
        - 2.0 * xs @ prototypes.T
        + np.einsum("kd,kd->k", prototypes, prototypes)[None, :],
        0.0,
    )
    d2 -= d2.min(axis=1, keepdims=True)
    k = min(prototypes.shape[0] - 1, max(1, int(round(lv.tau_target_share * prototypes.shape[0]))))
    kth = np.partition(d2, k, axis=1)[:, k]
    return float(lv.tau_scale * np.sqrt(np.median(kth) / (2.0 * np.log(2.0))))


def build_live_stream(result: SongResult, config: Config) -> LiveStream:
    """Assemble the live stream from an analysis result.

    Args:
        result: analysis output (oriented BMUs, layout features, color features).
        config: resolved configuration.

    Returns:
        :class:`LiveStream`.
    """
    f = result.features
    f_color = f.color_matrix()
    norm = normalize_features(f_color.T, config).T  # (T, 5) in [0, 1]
    tau = response_width(result.space.features, result.prototypes, config)
    return LiveStream(
        fps=float(result.fps),
        tau=tau,
        x=result.space.features.astype(np.float16),
        bmu=result.bmu,
        loud=np.rint(norm[:, 1] * _BYTE_MAX).astype(np.uint8),
        onset=np.rint(np.clip(f.onset, 0.0, 1.0) * _BYTE_MAX).astype(np.uint8),
        color=np.rint(norm * _BYTE_MAX).astype(np.uint8),
        beat_times=detect_beats(f.onset, config),
        audio_offset_s=float(result.ingest.trimmed_start_s),
    )


@dataclass
class _Ripple:
    t0: float
    cx: float
    cy: float
    amp: float


@dataclass(frozen=True)
class LiveFrame:
    """Everything needed to draw one display frame.

    Attributes:
        srgb: ``(K, 3)`` uint8 cell colors.
        activation: ``(K,)`` float64 in [0, 1], ``clamp(A + ring)``.
        radius_scale: ``(K,)`` float64 dot radius multiplier (1.0 = static radius).
        trail: ``(M, 3)`` float64 rows ``(x_cell, y_cell, age_fraction)`` oldest first,
            cell units, ``age_fraction`` 1 = oldest, 0 = now.
        bmu: current best-matching cell.
        beat_flash: True on the display frame where a beat time was crossed.
    """

    srgb: npt.NDArray[np.uint8]
    activation: Array
    radius_scale: Array
    trail: Array
    bmu: int
    beat_flash: bool = False


@dataclass
class LiveEngine:
    """Reference liquid-grid state machine; call :meth:`step` with increasing times.

    Args:
        stream: live stream.
        prototypes: ``(K, D)`` oriented prototypes (layout space).
        static_oklch: ``(K, 3)`` static OKLCH colors (L, C, hue degrees).
        config: resolved configuration.
        reduced_motion: apply ``live.reduced_motion`` (no ripples, no diffusion, slower
            release, no swelling, no trail).
        nominal_dt: display step in seconds assumed for the first frame after a seek.
    """

    stream: LiveStream
    prototypes: Array
    static_oklch: Array
    config: Config
    reduced_motion: bool = False
    nominal_dt: float = 1.0 / 30.0  # display step assumed on the first frame after a seek
    _a: Array = field(init=False)
    _ripples: list[_Ripple] = field(init=False, default_factory=list)
    _last_s: float | None = field(init=False, default=None)

    def __post_init__(self) -> None:
        size = self.config.grid.size
        self._size = size
        self._a = np.zeros(size * size, dtype=np.float64)
        ys, xs = np.divmod(np.arange(size * size), size)
        self._cx = xs.astype(np.float64)
        self._cy = ys.astype(np.float64)
        self._p2 = np.einsum("kd,kd->k", self.prototypes, self.prototypes)
        self._kernel = np.ones((3, 3)) / 8.0
        self._kernel[1, 1] = 0.0

    # -- frame access ----------------------------------------------------------------------
    def _locate(self, s: float) -> tuple[int, int, float]:
        n = self.stream.n_frames
        f = min(max(s * self.stream.fps, 0.0), n - 1.0)
        t0 = int(np.floor(f))
        return t0, min(t0 + 1, n - 1), f - t0

    def _lerp(self, arr: npt.NDArray[np.generic], s: float) -> Array:
        t0, t1, a = self._locate(s)
        out: Array = (1.0 - a) * arr[t0].astype(np.float64) + a * arr[t1].astype(np.float64)
        return out

    def response(self, s: float) -> Array:
        """Response field ``r_i`` in [0, 1] at time ``s`` (best match = 1), before blur."""
        x = self._lerp(self.stream.x, s)
        d2 = np.maximum(self._p2 - 2.0 * self.prototypes @ x + float(x @ x), 0.0)
        r = np.exp(-(d2 - d2.min()) / (2.0 * self.stream.tau**2))  # == exp(-d2/2tau^2)/max
        return np.asarray(r, dtype=np.float64)

    def _blurred_response(self, s: float) -> Array:
        loud = float(self._lerp(self.stream.loud, s)) / _BYTE_MAX
        lo, hi = self.config.live.glow_sigma_cells
        sigma = lo + (hi - lo) * loud
        size = self._size
        r = gaussian_filter(self.response(s).reshape(size, size), sigma, mode="nearest")
        out = np.asarray(r.ravel(), dtype=np.float64)
        if self.config.live.blur_renormalize:
            out = out / max(float(out.max()), _RENORM_FLOOR)
        return out

    # -- state updates ---------------------------------------------------------------------
    def reset(self, s: float) -> None:
        """Seek: set ``A`` to the response at ``s`` and clear ripples."""
        self._a = self._blurred_response(s)
        self._ripples.clear()
        self._last_s = s

    def step(self, s: float) -> LiveFrame:
        """Advance to display time ``s`` (seconds of analysis time) and return the frame."""
        lv = self.config.live
        if self._last_s is None:
            self.reset(s)
        assert self._last_s is not None
        dt = max(s - self._last_s, 0.0)
        r = self._blurred_response(s)

        release_ms = lv.reduced_motion.release_ms if self.reduced_motion else lv.release_ms
        k_up = 1.0 - np.exp(-dt / (lv.attack_ms / 1000.0))
        k_down = 1.0 - np.exp(-dt / (release_ms / 1000.0))
        self._a += (r - self._a) * np.where(r > self._a, k_up, k_down)

        do_diffusion = not (self.reduced_motion and not lv.reduced_motion.diffusion)
        if do_diffusion:
            size = self._size
            for _ in range(lv.diffusion_passes):
                grid = self._a.reshape(size, size)
                mean8 = convolve(grid, self._kernel, mode="nearest")
                self._a = ((1.0 - lv.diffusion_rate) * grid + lv.diffusion_rate * mean8).ravel()

        flash = self._spawn_ripples(self._last_s, s)
        self._last_s = s
        ring = self._ring_field(s)
        act = np.clip(self._a + ring, 0.0, 1.0)

        swell = not self.reduced_motion
        t0, _, a = self._locate(s)
        bmu = int(self.stream.bmu[min(t0 + (1 if a >= 0.5 else 0), self.stream.n_frames - 1)])
        return LiveFrame(
            srgb=self._colors(s, act),
            activation=act,
            radius_scale=1.0 + _SWELL_MAX * np.clip(self._a, 0.0, 1.0) * (1.0 if swell else 0.0),
            trail=np.empty((0, 3)) if self.reduced_motion else self._trail(s),
            bmu=bmu,
            beat_flash=flash,
        )

    # -- ripples ---------------------------------------------------------------------------
    def _spawn_ripples(self, s_prev: float, s: float) -> bool:
        beats = self.stream.beat_times
        # A beat belongs to the display frame nearest to it: shift the window by half a step so
        # it fires up to half a frame early instead of up to a full frame late.
        step = s - s_prev if s > s_prev else self.nominal_dt  # first frame after a seek
        crossed = beats[(beats > s - 0.5 * step) & (beats <= s + 0.5 * step)]
        if crossed.size == 0:
            return False
        rp = self.config.live.ripple
        if not (self.reduced_motion and not self.config.live.reduced_motion.ripples):
            for b in crossed:
                onset = float(self._lerp(self.stream.onset, float(b))) / _BYTE_MAX
                if onset >= rp.onset_threshold:
                    t0, _, a = self._locate(float(b))
                    cell = int(self.stream.bmu[t0 + (1 if a >= 0.5 else 0)])
                    self._ripples.append(
                        _Ripple(
                            float(b), cell % self._size, cell // self._size, rp.amplitude * onset
                        )
                    )
            del self._ripples[: max(0, len(self._ripples) - rp.max_concurrent)]
        return True

    def _ring_field(self, s: float) -> Array:
        rp = self.config.live.ripple
        ring = np.zeros(self._size * self._size)
        alive: list[_Ripple] = []
        for r in self._ripples:
            age = max(s - r.t0, 0.0)  # a ripple spawned half a frame ahead starts at age 0
            if age > _RIPPLE_END_DECAYS * rp.decay_s:
                continue
            alive.append(r)
            dist = np.hypot(self._cx - r.cx, self._cy - r.cy)
            radius = rp.speed_cells_per_s * age
            ring += (
                r.amp
                * np.exp(-((dist - radius) ** 2) / (2.0 * rp.width_cells**2))
                * np.exp(-age / rp.decay_s)
            )
        self._ripples = alive
        return ring

    # -- trail and color -------------------------------------------------------------------
    def _trail(self, s: float) -> Array:
        length = self.config.live.trail.length_s
        n = max(2, int(round(length * self.stream.fps)))
        t0, _, _ = self._locate(s)
        lo = max(0, t0 - n + 1)
        cells = self.stream.bmu[lo : t0 + 1].astype(np.int64)
        age = (t0 - np.arange(lo, t0 + 1)) / float(n)
        return np.column_stack([cells % self._size, cells // self._size, age]).astype(np.float64)

    def _colors(self, s: float, act: Array) -> npt.NDArray[np.uint8]:
        lv, cc = self.config.live, self.config.color
        color_n = self._lerp(self.stream.color, s) / _BYTE_MAX
        live_h = cc.hue.from_deg + (cc.hue.to_deg - cc.hue.from_deg) * color_n[0]
        live_c = cc.chroma.min + (cc.chroma.max - cc.chroma.min) * color_n[3]
        m = lv.live_mix_max * act
        base_l, base_c, base_h = (self.static_oklch[:, i] for i in range(3))
        arc = (live_h - base_h + 180.0) % 360.0 - 180.0  # shortest arc
        lch = np.stack(
            [
                np.minimum(base_l + lv.live_lightness_boost * act, _MAX_LIVE_LIGHTNESS),
                (1.0 - m) * base_c + m * live_c,
                (base_h + m * arc) % 360.0,
            ],
            axis=-1,
        )
        return linear_to_srgb8(oklab_to_linear_srgb(oklch_to_oklab(gamut_map(lch))))
