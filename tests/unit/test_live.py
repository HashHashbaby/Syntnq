from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest

from synesthesia.config import Config, load_config
from synesthesia.io import (
    decode_live_bin,
    decode_proto_bin,
    encode_live_bin,
    encode_proto_bin,
)
from synesthesia.live import LiveEngine, LiveStream, detect_beats, response_width
from synesthesia.preview import iter_frames, make_raster, rasterize, write_preview

SIZE = 64
K = SIZE * SIZE
D = 2


def _prototypes() -> npt.NDArray[np.float64]:
    r, c = np.divmod(np.arange(K), SIZE)
    return np.column_stack([r, c]).astype(np.float64) / SIZE


def _stream(
    cell: int, frames: int = 400, beats: tuple[float, ...] = (), onset: int = 255
) -> LiveStream:
    proto = _prototypes()
    x = np.tile(proto[cell], (frames, 1)).astype(np.float16)
    return LiveStream(
        fps=43.066,
        tau=0.05,
        x=x,
        bmu=np.full(frames, cell, dtype=np.uint16),
        loud=np.full(frames, 128, dtype=np.uint8),
        onset=np.full(frames, onset, dtype=np.uint8),
        color=np.full((frames, 5), 128, dtype=np.uint8),
        beat_times=np.array(beats, dtype=np.float32),
    )


def _static() -> npt.NDArray[np.float64]:
    return np.tile([0.5, 0.08, 200.0], (K, 1))


def _cfg(**live: object) -> Config:
    return load_config(overrides={"live": live})


def test_live_bin_round_trip() -> None:
    rng = np.random.default_rng(0)
    t, d = 50, 17
    stream = LiveStream(
        fps=43.066,
        tau=0.123,
        x=rng.standard_normal((t, d)).astype(np.float16),
        bmu=rng.integers(0, K, t).astype(np.uint16),
        loud=rng.integers(0, 256, t).astype(np.uint8),
        onset=rng.integers(0, 256, t).astype(np.uint8),
        color=rng.integers(0, 256, (t, 5)).astype(np.uint8),
        beat_times=np.array([0.5, 1.0, 1.5], dtype=np.float32),
    )
    buf = encode_live_bin(stream, SIZE)
    assert buf[:4] == b"SYNL"
    got, grid = decode_live_bin(buf)
    assert grid == SIZE
    assert np.isclose(got.fps, stream.fps, rtol=1e-6) and np.isclose(got.tau, stream.tau, rtol=1e-6)
    for name in ("x", "bmu", "loud", "onset", "color", "beat_times"):
        assert np.array_equal(getattr(got, name), getattr(stream, name)), name
    expected_len = 16 + 12 + t * d * 2 + t * 2 + t + t + t * 5 + 4 + 3 * 4
    assert len(buf) == expected_len


def test_proto_bin_round_trip_and_header_checks() -> None:
    proto = np.random.default_rng(1).standard_normal((K, 17))
    buf = encode_proto_bin(proto, SIZE)
    assert buf[:4] == b"SYNP" and len(buf) == 16 + 4 + K * 17 * 2
    assert np.array_equal(decode_proto_bin(buf), proto.astype(np.float16))
    with pytest.raises(ValueError):
        decode_live_bin(buf)  # wrong magic
    bad = bytearray(buf)
    bad[4] = 9  # unknown version
    with pytest.raises(ValueError):
        decode_proto_bin(bytes(bad))


def test_response_peaks_at_bmu_and_is_local() -> None:
    cell = 10 * SIZE + 20
    eng = LiveEngine(_stream(cell), _prototypes(), _static(), _cfg(blur_renormalize=True))
    r = eng.response(1.0)
    assert int(np.argmax(r)) == cell and r[cell] == pytest.approx(1.0)
    assert r[60 * SIZE + 60] < 1e-6


def test_blur_renormalize_keeps_peak_at_one() -> None:
    cell = 30 * SIZE + 30
    off = LiveEngine(_stream(cell), _prototypes(), _static(), _cfg(blur_renormalize=False))
    on = LiveEngine(_stream(cell), _prototypes(), _static(), _cfg(blur_renormalize=True))
    off.reset(1.0)
    on.reset(1.0)
    assert float(on._a.max()) == pytest.approx(1.0)
    assert float(off._a.max()) < 1.0


def test_attack_is_faster_than_release() -> None:
    cell = 20 * SIZE + 20
    cfg = _cfg(blur_renormalize=True, diffusion_passes=0)
    eng = LiveEngine(_stream(cell), _prototypes(), _static(), cfg)
    eng.reset(1.0)
    base = float(eng._a[cell])
    # jump the stream to a far cell: the new cell rises (attack), the old one falls (release)
    far = 50 * SIZE + 50
    eng.stream = _stream(far)
    eng.step(1.0 + 0.040)
    rise = float(eng._a[far])
    fall = base - float(eng._a[cell])
    assert rise > 0.5  # 1 - exp(-1) = 0.63 of the way to 1
    assert 0.0 < fall < rise  # release 250 ms moves less in the same 40 ms


def test_ripples_spawn_on_beats_and_respect_reduced_motion() -> None:
    cell = 32 * SIZE + 32
    stream = _stream(cell, beats=(1.0,), onset=255)
    cfg = _cfg(blur_renormalize=True)
    ring_cell = 32 * SIZE + 32 + 10  # ripple radius reaches 10 cells after about 0.42 s

    def activation_at(reduced: bool) -> float:
        eng = LiveEngine(stream, _prototypes(), _static(), cfg, reduced_motion=reduced)
        eng.reset(0.9)
        frame = None
        s = 0.9
        while s < 1.0 + 0.42:
            s += 1 / 30
            frame = eng.step(s)
        assert frame is not None
        return float(frame.activation[ring_cell])

    assert activation_at(False) > activation_at(True) + 0.05


def test_activation_brightens_cells_and_reduced_motion_disables_swell_and_trail() -> None:
    cell = 25 * SIZE + 25
    eng = LiveEngine(_stream(cell), _prototypes(), _static(), _cfg(blur_renormalize=True))
    eng.reset(2.0)
    frame = eng.step(2.0 + 1 / 30)
    quiet = frame.srgb[3 * SIZE + 3].astype(int).sum()
    lit = frame.srgb[cell].astype(int).sum()
    assert lit > quiet
    assert frame.radius_scale[cell] > 1.0 and frame.trail.shape[0] >= 2

    red = LiveEngine(
        _stream(cell), _prototypes(), _static(), _cfg(blur_renormalize=True), reduced_motion=True
    )
    red.reset(2.0)
    rf = red.step(2.0 + 1 / 30)
    assert np.all(rf.radius_scale == 1.0) and rf.trail.shape[0] == 0


def test_detect_beats_on_a_click_track(config: Config) -> None:
    fps = config.ingest.sample_rate / config.frames.hop
    n = int(20 * fps)
    onset = np.zeros(n)
    onset[np.round(np.arange(0.0, 20.0, 0.5) * fps).astype(int)] = 1.0
    beats = detect_beats(onset, config)
    assert beats.dtype == np.float32 and beats.size > 20
    assert np.median(np.diff(beats)) == pytest.approx(0.5, abs=0.03)


def test_beats_are_refined_below_one_frame(config: Config) -> None:
    fps = config.ingest.sample_rate / config.frames.hop
    n = int(20 * fps)
    t = np.arange(n) / fps
    # smooth onset pulses centred between analysis frames, 0.5 s apart
    centers = np.arange(0.51, 19.0, 0.5)
    onset = np.zeros(n)
    for c in centers:
        onset += np.exp(-((t - c) ** 2) / (2 * 0.012**2))
    beats = detect_beats(onset, config)
    peak_times = beats.astype(np.float64) + config.live.beat_latency_s  # undo the latency shift
    nearest = np.array([np.abs(centers - b).min() for b in peak_times])
    assert nearest.max() < 0.5 / fps  # better than half an analysis frame
    assert np.median(nearest) < 0.25 / fps


def test_response_width_hits_the_target_share(config: Config) -> None:
    proto = _prototypes()
    rng = np.random.default_rng(0)
    x = proto[rng.integers(0, K, 300)] + 0.001 * rng.standard_normal((300, D))
    tau = response_width(x, proto, config)
    share = config.live.tau_target_share
    frac = []
    for xi in x[::10]:
        d2 = ((proto - xi) ** 2).sum(1)
        r = np.exp(-(d2 - d2.min()) / (2.0 * tau**2))
        frac.append(float((r >= 0.5).mean()))
    assert np.median(frac) == pytest.approx(share, abs=0.02)
    wider = load_config(overrides={"live": {"tau_scale": 2.0}})
    assert response_width(x, proto, wider) == pytest.approx(2.0 * tau)


def test_raster_maps_pixels_to_cells(config: Config) -> None:
    ras = make_raster(640, config)
    pitch, margin = ras.pitch, config.render.margin_cells
    for r, c in ((0, 0), (10, 20), (63, 63)):
        py = int((margin + r + 0.5) * pitch)
        px = int((margin + c + 0.5) * pitch)
        assert ras.cell[py, px] == r * SIZE + c
        assert ras.dist[py, px] < 1.0
    assert not ras.valid[0, 0]


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_write_preview_makes_an_mp4_with_the_right_frame_count(
    config: Config, tmp_path: Path
) -> None:
    cell = 12 * SIZE + 12
    frames = iter_frames(
        _stream(cell, beats=(0.2,)),
        _prototypes(),
        _static(),
        config,
        start_s=0.5,
        seconds=1.0,
        fps=30,
        px=96,
    )
    out = write_preview(
        tmp_path / "t.mp4", frames, config, audio_path=None, audio_start_s=0.0,
        seconds=1.0, fps=30, px=96,
    )  # fmt: skip
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    assert probe.stdout.strip() == "96,96,30"


def test_rasterize_returns_uint8_image(config: Config) -> None:
    cell = 5 * SIZE + 5
    eng = LiveEngine(_stream(cell), _prototypes(), _static(), config)
    eng.reset(1.0)
    img = rasterize(eng.step(1.05), make_raster(200, config), config)
    assert img.shape == (200, 200, 3) and img.dtype == np.uint8
    assert img.max() > 0
