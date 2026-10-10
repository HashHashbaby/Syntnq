"""Rhythm map: tempogram, tempo, beats, pulse clarity (docs/ANALYSIS.md section 8)."""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.maps.resample import resize_axis

Array = npt.NDArray[np.float64]

_EPS = 1e-12


@dataclass(frozen=True)
class RhythmMap:
    """Rhythm outputs with fixed shapes.

    Attributes:
        tempogram: ``(bpm_bins, time_cols)`` float16, each column normalized to max 1.
        tempo_bpm: global tempo from beat tracking (0.0 when no pulse was found).
        beat_times_s: ``(n,)`` float32 seconds from the start of the analyzed audio.
        pulse_clarity: max of the time-averaged normalized tempogram, in [0, 1].
    """

    tempogram: npt.NDArray[np.float16]
    tempo_bpm: float
    beat_times_s: npt.NDArray[np.float32]
    pulse_clarity: float


def bpm_axis(config: Config) -> Array:
    """The ``bpm_bins`` log-spaced BPM values of the stored tempogram rows."""
    rc = config.maps.rhythm
    return np.asarray(np.geomspace(rc.bpm_min, rc.bpm_max, rc.bpm_bins), dtype=np.float64)


_SECONDS_PER_MINUTE = 60.0


def _refine_tempo(estimate: float, beat_times: npt.NDArray[np.float32], config: Config) -> float:
    """Sharpen the frame-quantized tempo with the mean inter-beat interval of tracked beats.

    The tracker's tempo is a whole number of frames per beat (117.5 instead of 120 BPM at
    43 frames/s); beats are steady, so their mean interval is accurate to a fraction of a frame.
    Intervals far from the estimated period (missed or doubled beats) are ignored.
    """
    rc = config.maps.rhythm
    if estimate <= 0.0 or beat_times.size < rc.tempo_refine_min_beats:
        return estimate
    period = _SECONDS_PER_MINUTE / estimate
    ibi = np.diff(beat_times.astype(np.float64))
    kept = ibi[np.abs(ibi - period) <= rc.tempo_refine_tolerance * period]
    if kept.size < rc.tempo_refine_min_beats - 1:
        return estimate
    return float(_SECONDS_PER_MINUTE / kept.mean())


def compute_rhythm(onset: Array, config: Config) -> RhythmMap:
    """Tempogram resampled to log-BPM x time, plus global tempo and beats.

    Args:
        onset: ``(T,)`` onset-strength envelope at ``frames.hop`` samples per frame.
        config: resolved configuration (``maps.rhythm``, ``ingest.sample_rate``, ``frames.hop``).

    Returns:
        :class:`RhythmMap`.
    """
    rc = config.maps.rhythm
    sr, hop = config.ingest.sample_rate, config.frames.hop
    tg = librosa.feature.tempogram(
        onset_envelope=onset, sr=sr, hop_length=hop, win_length=rc.tempogram_win_frames
    ).astype(np.float64)  # (win, T), lag bins
    lag_bpm = librosa.tempo_frequencies(rc.tempogram_win_frames, sr=sr, hop_length=hop)[1:]
    # ascending log-BPM axis (lag 0 is infinite BPM and is dropped), linear interpolation in log-BPM
    x = np.log(lag_bpm[::-1])
    rows = tg[1:][::-1]
    pos = np.interp(np.log(bpm_axis(config)), x, np.arange(x.size))
    i0 = np.minimum(np.floor(pos).astype(np.int64), x.size - 2)
    w = (pos - i0)[:, None]
    by_bpm = rows[i0] * (1.0 - w) + rows[i0 + 1] * w  # (bpm_bins, T)

    cols = resize_axis(by_bpm, rc.time_cols, axis=1)
    peak = cols.max(axis=0, keepdims=True)
    norm = np.where(peak > _EPS, cols / np.maximum(peak, _EPS), 0.0)
    clarity = float(norm.mean(axis=1).max())

    tempo, beats = librosa.beat.beat_track(
        onset_envelope=onset, sr=sr, hop_length=hop, start_bpm=rc.start_bpm, units="frames"
    )
    beat_times = (np.asarray(beats, dtype=np.float64) * hop / sr).astype(np.float32)
    return RhythmMap(
        tempogram=norm.astype(np.float16),
        tempo_bpm=_refine_tempo(float(np.atleast_1d(tempo)[0]), beat_times, config),
        beat_times_s=beat_times,
        pulse_clarity=clarity,
    )
