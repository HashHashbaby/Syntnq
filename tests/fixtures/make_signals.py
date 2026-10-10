"""Deterministic synthetic test signals (no network, no audio files committed).

Every generator is a pure function of its arguments and a fixed seed, so the
same call yields identical samples (and identical WAV bytes) on every run.
Signals are mono float64 in [-1, 1] at ``SAMPLE_RATE`` (deliberately not the
22,050 Hz analysis rate, so ingest has real resampling work to do).

Run ``python tests/fixtures/make_signals.py <out_dir>`` to write WAV files.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np
import numpy.typing as npt
import soundfile as sf
from scipy import signal

SAMPLE_RATE = 44_100
DURATION_S = 30.0
SHORT_DURATION_S = 10.0  # below the 20 s minimum, for E_TOO_SHORT tests
PEAK = 0.5  # -6 dBFS: leaves headroom so the peak ceiling never engages
CLICK_BPM = 120.0
SWEEP_HZ = (100.0, 8000.0)
CHORD_HZ = (261.63, 329.63, 392.00)  # C4 E4 G4 as pure tones
SEED = 7

Signal = npt.NDArray[np.float64]


def _time(duration_s: float) -> Signal:
    return np.arange(int(round(duration_s * SAMPLE_RATE))) / SAMPLE_RATE


def _peak_normalize(x: Signal, peak: float = PEAK) -> Signal:
    m = float(np.max(np.abs(x)))
    return x if m == 0.0 else x * (peak / m)


def sine_sweep(duration_s: float = DURATION_S) -> Signal:
    """Logarithmic sine sweep from 100 Hz to 8 kHz."""
    t = _time(duration_s)
    f0, f1 = SWEEP_HZ
    k = np.log(f1 / f0) / duration_s
    phase = 2.0 * np.pi * f0 * (np.exp(k * t) - 1.0) / k
    return _peak_normalize(np.sin(phase))


def white_noise(duration_s: float = DURATION_S) -> Signal:
    """Gaussian white noise."""
    rng = np.random.default_rng(SEED)
    return _peak_normalize(rng.standard_normal(int(round(duration_s * SAMPLE_RATE))))


def pink_noise(duration_s: float = DURATION_S) -> Signal:
    """Pink (1/f power) noise by spectral shaping of Gaussian noise."""
    rng = np.random.default_rng(SEED + 1)
    n = int(round(duration_s * SAMPLE_RATE))
    spec = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, d=1.0 / SAMPLE_RATE)
    freqs[0] = freqs[1]  # avoid division by zero at DC
    return _peak_normalize(np.fft.irfft(spec / np.sqrt(freqs), n=n))


def chord(duration_s: float = DURATION_S) -> Signal:
    """Sustained triad of pure sine tones."""
    t = _time(duration_s)
    return _peak_normalize(sum(np.sin(2.0 * np.pi * f * t) for f in CHORD_HZ))


def click_track(duration_s: float = DURATION_S, bpm: float = CLICK_BPM) -> Signal:
    """Short 1 kHz bursts with a fast decay, one per beat, starting at t = 0."""
    n = int(round(duration_s * SAMPLE_RATE))
    out = np.zeros(n)
    burst_t = np.arange(int(0.02 * SAMPLE_RATE)) / SAMPLE_RATE
    burst = np.sin(2.0 * np.pi * 1000.0 * burst_t) * np.exp(-burst_t / 0.004)
    step = 60.0 / bpm
    for beat in range(int(duration_s / step)):
        i = int(round(beat * step * SAMPLE_RATE))
        out[i : i + burst.size] += burst[: n - i]
    return _peak_normalize(out)


def _texture_a(duration_s: float) -> Signal:
    """Warm low pad: detuned saw-like harmonics on A2 and E3."""
    t = _time(duration_s)
    x = np.zeros_like(t)
    for f0 in (110.0, 164.81):
        for detune in (-0.4, 0.0, 0.4):
            for h in range(1, 9):
                x += np.sin(2.0 * np.pi * (f0 + detune) * h * t) / h
    return x


def _texture_b(duration_s: float) -> Signal:
    """Bright, noisy, pulsed texture: high-passed noise gated at 8 Hz."""
    rng = np.random.default_rng(SEED + 2)
    t = _time(duration_s)
    sos = signal.butter(4, 4000.0, btype="highpass", fs=SAMPLE_RATE, output="sos")
    noise = signal.sosfilt(sos, rng.standard_normal(t.size))
    gate = 0.5 * (1.0 + np.sign(np.sin(2.0 * np.pi * 8.0 * t)))
    return noise * (0.2 + 0.8 * gate)


def aba_song(duration_s: float = DURATION_S) -> Signal:
    """A/B/A song: two clearly different synth textures, equal thirds, short crossfades."""
    seg = duration_s / 3.0
    a = _peak_normalize(_texture_a(seg))
    b = _peak_normalize(_texture_b(seg))
    fade = int(0.05 * SAMPLE_RATE)
    ramp = np.linspace(0.0, 1.0, fade)
    out = []
    for part in (a, b, a):
        p = part.copy()
        p[:fade] *= ramp
        p[-fade:] *= ramp[::-1]
        out.append(p)
    return _peak_normalize(np.concatenate(out))


def silence(duration_s: float = DURATION_S) -> Signal:
    """Digital silence."""
    return np.zeros(int(round(duration_s * SAMPLE_RATE)))


def short_clip() -> Signal:
    """10 s clip (too short for analysis): a pad over soft noise."""
    t = _time(SHORT_DURATION_S)
    rng = np.random.default_rng(SEED + 3)
    return _peak_normalize(_texture_a(SHORT_DURATION_S) + 0.1 * rng.standard_normal(t.size))


SIGNALS: dict[str, Callable[[], Signal]] = {
    "sine_sweep": sine_sweep,
    "white_noise": white_noise,
    "pink_noise": pink_noise,
    "chord": chord,
    "click_120bpm": click_track,
    "aba_song": aba_song,
    "silence": silence,
    "short_10s": short_clip,
}


def write_all(out_dir: Path) -> dict[str, Path]:
    """Write every signal as 16-bit mono WAV into ``out_dir``; returns name -> path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for name, make in SIGNALS.items():
        path = out_dir / f"{name}.wav"
        sf.write(path, make(), SAMPLE_RATE, subtype="PCM_16", format="WAV")
        paths[name] = path
    return paths


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("out/fixtures")
    for name, p in write_all(target).items():
        sys.stdout.write(f"{name}: {p}\n")
