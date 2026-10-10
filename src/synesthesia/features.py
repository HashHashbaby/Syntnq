"""Frame features, smoothing and change term (docs/ANALYSIS.md section 2).

All arithmetic is float64. Chroma (maps only) is computed in M4, not here.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np
import numpy.typing as npt
import scipy.fft
from scipy.ndimage import uniform_filter1d

from synesthesia.config import Config
from synesthesia.standardize import zscore

_ENERGY_EPS = 1e-10  # spec: silent frames have energy < 1e-10; also log/ratio guards
_MIN_CENTROID_HZ = 1.0  # floor before log10
_ONSET_NORM_PERCENTILE = 99.0

Array = npt.NDArray[np.float64]


@dataclass(frozen=True)
class FrameFeatures:
    """Per-frame features, ``T`` frames at ``fps = sample_rate / hop``.

    ``mfcc`` is ``(T, 13)``; every other field is ``(T,)``. Smoothed fields are used for
    layout, color and the live stream; ``*_raw`` are the unsmoothed values.
    """

    mfcc: Array
    mfcc_raw: Array
    brightness: Array  # log10 Hz, smoothed
    loudness: Array  # dBFS, smoothed
    loudness_raw: Array  # dBFS, unsmoothed (dynamics map)
    noisiness: Array  # log10 flatness, smoothed
    harmonicity: Array  # H^2 / (H^2 + P^2), smoothed
    change: Array  # novelty, from the smoothed features
    onset: Array  # [0, 1], unsmoothed
    fps: float

    @property
    def n_frames(self) -> int:
        return int(self.brightness.shape[0])

    def layout_raw(self) -> Array:
        """``(T, 17)`` raw layout matrix: mfcc, brightness, loudness, noisiness, change."""
        return np.column_stack(
            [self.mfcc, self.brightness, self.loudness, self.noisiness, self.change]
        )

    def color_matrix(self) -> Array:
        """``(T, 5)`` physical-unit color features: brightness, loudness, noisiness,
        harmonicity, change."""
        return np.column_stack(
            [self.brightness, self.loudness, self.noisiness, self.harmonicity, self.change]
        )


def _smooth(x: Array, width: int) -> Array:
    """Centered moving average along axis 0, edge-padded by repetition."""
    return np.asarray(uniform_filter1d(x, size=width, axis=0, mode="nearest"), dtype=np.float64)


def _change(z: Array, window_frames: int) -> Array:
    """Euclidean distance between the mean of the previous and next windows, ``(T,)``."""
    t = z.shape[0]
    csum = np.vstack([np.zeros((1, z.shape[1])), np.cumsum(z, axis=0)])
    idx = np.arange(t)
    p0, p1 = np.maximum(0, idx - window_frames), np.maximum(idx, 1)
    n0, n1 = idx, np.minimum(t, idx + window_frames)
    prev = (csum[p1] - csum[p0]) / (p1 - p0)[:, None]
    nxt = (csum[n1] - csum[n0]) / (n1 - n0)[:, None]
    return np.asarray(np.linalg.norm(nxt - prev, axis=1), dtype=np.float64)


def extract_features(y: Array, config: Config) -> FrameFeatures:
    """Compute frame features from normalized audio.

    Args:
        y: ``(N,)`` float64 mono audio at ``ingest.sample_rate`` Hz.
        config: resolved configuration.

    Returns:
        :class:`FrameFeatures` with ``T = 1 + N // hop`` frames.
    """
    fr, sr = config.frames, config.ingest.sample_rate
    mag = np.abs(
        librosa.stft(
            y, n_fft=fr.n_fft, hop_length=fr.hop, window=fr.window, center=True, pad_mode="reflect"
        )
    )  # (F, T)
    power = mag**2

    mel_basis = librosa.filters.mel(
        sr=sr, n_fft=fr.n_fft, n_mels=fr.n_mels, fmin=fr.fmin_hz, fmax=fr.fmax_hz, dtype=np.float64
    )
    mel_db = librosa.power_to_db(mel_basis @ power, ref=1.0, top_db=None)
    cfg_m = config.features.mfcc
    cep = scipy.fft.dct(mel_db, axis=0, type=2, norm="ortho")[: cfg_m.n_mfcc]
    mfcc_raw = np.ascontiguousarray(cep[cfg_m.use[0] : cfg_m.use[1] + 1].T)

    freqs = librosa.fft_frequencies(sr=sr, n_fft=fr.n_fft)
    energy = power.sum(axis=0)
    mag_sum = mag.sum(axis=0)
    centroid = (freqs @ mag) / np.maximum(mag_sum, _ENERGY_EPS)
    silent = energy < _ENERGY_EPS
    median = _MIN_CENTROID_HZ if silent.all() else float(np.median(centroid[~silent]))
    centroid = np.where(silent, median, centroid)
    brightness_raw = np.log10(np.maximum(centroid, _MIN_CENTROID_HZ))

    rms = librosa.feature.rms(
        y=y, frame_length=fr.n_fft, hop_length=fr.hop, center=True, pad_mode="reflect"
    )[0]
    loudness_raw = 20.0 * np.log10(rms + _ENERGY_EPS)

    flatness = librosa.feature.spectral_flatness(S=mag, power=2.0)[0]
    noisiness_raw = np.log10(flatness + _ENERGY_EPS)

    h = config.features.harmonicity
    harm, _ = librosa.decompose.hpss(mag, kernel_size=h.kernel_size, margin=h.margin)
    # Residual energy (neither harmonic nor percussive) counts as non-harmonic: D-016.
    harmonicity_raw = (harm**2).sum(axis=0) / (energy + _ENERGY_EPS)

    onset = librosa.onset.onset_strength(
        y=y, sr=sr, hop_length=fr.hop, n_fft=fr.n_fft, aggregate=np.median
    )
    t = mag.shape[1]
    onset = np.pad(onset, (0, max(0, t - onset.size)))[:t]
    scale = float(np.percentile(onset, _ONSET_NORM_PERCENTILE))
    onset_n = np.clip(onset / scale, 0.0, 1.0) if scale > 0.0 else np.zeros_like(onset)

    w = fr.smooth_frames
    mfcc_s = _smooth(mfcc_raw, w)
    bright_s = _smooth(brightness_raw[:, None], w)[:, 0]
    loud_s = _smooth(loudness_raw[:, None], w)[:, 0]
    noisy_s = _smooth(noisiness_raw[:, None], w)[:, 0]
    harm_s = _smooth(harmonicity_raw[:, None], w)[:, 0]

    z, _, _ = zscore(np.column_stack([mfcc_s, bright_s, loud_s, noisy_s]))
    fps = sr / fr.hop
    change = _change(z, max(1, int(round(config.features.change.window_s * fps))))

    return FrameFeatures(
        mfcc=mfcc_s,
        mfcc_raw=mfcc_raw,
        brightness=bright_s,
        loudness=loud_s,
        loudness_raw=loudness_raw,
        noisiness=noisy_s,
        harmonicity=harm_s,
        change=change,
        onset=np.asarray(onset_n, dtype=np.float64),
        fps=fps,
    )
