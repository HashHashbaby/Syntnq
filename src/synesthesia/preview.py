"""Python reference liquid-grid preview: MP4 with audio (docs/LIVE.md section 6).

Frames are rasterized with numpy (analytic anti-aliasing instead of the static renderer's 2x
supersampling, so a 1080 px frame costs tens of milliseconds) and piped to ffmpeg as raw RGB.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from synesthesia.config import Config
from synesthesia.display import Raster, make_raster, to_display
from synesthesia.errors import ErrorCode, SynError
from synesthesia.live import LiveEngine, LiveFrame, LiveStream
from synesthesia.nodes import get_node_style

Array = npt.NDArray[np.float64]

_MAX_8BIT = 255.0
_TRAIL_TINT = np.array([1.0, 1.0, 1.0])
_FLASH_FRACTION = 0.06  # side of the sync flash square as a fraction of the frame
_OVERLAY_MARGIN_PX = 8


def rasterize(frame: LiveFrame, raster: Raster, config: Config) -> npt.NDArray[np.uint8]:
    """Draw one live frame: pool to the display grid, trail underneath, then the nodes.

    Returns:
        ``(px, px, 3)`` uint8.
    """
    shown = to_display(frame.srgb, frame.radius_scale, frame.trail, config)
    base = np.zeros((raster.px, raster.px, 3))
    if shown.trail.shape[0] >= 2:
        base = _draw_trail(shown.trail, raster, config)
    return get_node_style(config).draw_live(base, shown.srgb, shown.radius_scale, raster)


def _draw_trail(trail: Array, raster: Raster, config: Config) -> Array:
    """Soft polyline through cell centers, fading with age (docs/LIVE.md 2.8)."""
    margin, pitch = config.render.margin_cells, raster.pitch
    layer = Image.new("L", (raster.px, raster.px), 0)
    draw = ImageDraw.Draw(layer)
    pts = [((x + 0.5 + margin) * pitch, (y + 0.5 + margin) * pitch) for x, y, _ in trail]
    width = max(1, int(round(config.live.trail.width_cells * pitch)))
    for (p0, p1), age in zip(zip(pts[:-1], pts[1:], strict=True), trail[1:, 2], strict=True):
        level = int(round(_MAX_8BIT * config.live.trail.opacity * (1.0 - float(age))))
        if level > 0 and p0 != p1:
            draw.line([p0, p1], fill=level, width=width)
    layer = layer.filter(ImageFilter.GaussianBlur(0.5 * width))
    tinted: Array = (np.asarray(layer, dtype=np.float64) / _MAX_8BIT)[..., None] * _TRAIL_TINT
    return tinted


def overlay_sync(
    frame: npt.NDArray[np.uint8], index: int, flash: bool, time_s: float
) -> npt.NDArray[np.uint8]:
    """Debug overlay for the sync check: frame counter text and a beat-flash square."""
    img = Image.fromarray(frame)
    draw = ImageDraw.Draw(img)
    side = int(frame.shape[0] * _FLASH_FRACTION)
    if flash:
        draw.rectangle((0, 0, side, side), fill=(255, 255, 255))
    draw.text(
        (_OVERLAY_MARGIN_PX, side + _OVERLAY_MARGIN_PX),
        f"frame {index}  t={time_s:.3f}s",
        fill=(255, 255, 255),
        font=ImageFont.load_default(),
    )
    return np.asarray(img, dtype=np.uint8)


def iter_frames(
    stream: LiveStream,
    prototypes: Array,
    static_oklch: Array,
    config: Config,
    *,
    start_s: float,
    seconds: float,
    fps: int,
    px: int,
    reduced_motion: bool = False,
    overlay: bool = False,
) -> Iterator[npt.NDArray[np.uint8]]:
    """Yield ``(px, px, 3)`` uint8 frames for analysis times ``[start_s, start_s + seconds)``."""
    engine = LiveEngine(
        stream, prototypes, static_oklch, config, reduced_motion, nominal_dt=1.0 / fps
    )
    raster = make_raster(px, config)
    n = int(round(seconds * fps))
    engine.reset(start_s)
    for k in range(n):
        s = start_s + k / fps
        frame = engine.step(s)
        img = rasterize(frame, raster, config)
        yield overlay_sync(img, k, frame.beat_flash, s) if overlay else img


def write_preview(
    out_path: Path,
    frames: Iterator[npt.NDArray[np.uint8]],
    config: Config,
    *,
    audio_path: Path | None,
    audio_start_s: float,
    seconds: float,
    fps: int,
    px: int,
) -> Path:
    """Pipe raw frames to ffmpeg (H.264 + AAC) and write the MP4.

    Args:
        out_path: output ``.mp4``.
        frames: frame iterator from :func:`iter_frames`.
        config: resolved configuration (``preview.codec/crf/audio_kbps``).
        audio_path: source audio, or ``None`` for a silent video.
        audio_start_s: position in ``audio_path`` (seconds) of the first frame.
        seconds: clip length.
        fps: video frame rate.
        px: frame side in pixels.
    """
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise SynError(ErrorCode.E_INTERNAL, "ffmpeg not found on PATH")
    if config.preview.codec != "h264":
        raise ValueError(f"unsupported preview.codec {config.preview.codec!r}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        exe, "-v", "error", "-y", "-nostdin",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{px}x{px}", "-r", str(fps), "-i", "-",
    ]  # fmt: skip
    if audio_path is not None:
        cmd += ["-ss", f"{audio_start_s:.6f}", "-t", f"{seconds:.6f}", "-i", str(audio_path)]
    cmd += ["-map", "0:v:0"]
    if audio_path is not None:
        cmd += ["-map", "1:a:0", "-c:a", "aac", "-b:a", f"{config.preview.audio_kbps}k"]
    cmd += [
        "-c:v", "libx264", "-crf", str(config.preview.crf), "-pix_fmt", "yuv420p",
        "-t", f"{seconds:.6f}", "-movflags", "+faststart", str(out_path),
    ]  # fmt: skip
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    try:
        for frame in frames:
            proc.stdin.write(np.ascontiguousarray(frame).tobytes())
    finally:
        proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise SynError(ErrorCode.E_INTERNAL, f"ffmpeg failed: {err[:300]}")
    return out_path
