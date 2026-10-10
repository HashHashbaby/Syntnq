"""Labeled video samples of the liquid-glass variants in live mode.

One analysis and one ``LiveEngine`` drive four renderings of the same moment of the same song:
flat (current), A glass beads, B glass sheet, C combination. Writes one MP4 per variant (label
burned in) and a 2x2 comparison MP4, all with the song's audio.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from _corpus import DEFAULT_AUDIO, ROOT
from PIL import Image, ImageDraw, ImageFont

from synesthesia.config import load_config
from synesthesia.glass import bloom, flow_field, shade
from synesthesia.live import LiveEngine, build_live_stream
from synesthesia.pipeline import analyze
from synesthesia.preview import _draw_trail, make_raster, rasterize

VARIANTS = [
    ("flat", "FLAT  (current look)"),
    ("beads", "A  Glass beads"),
    ("sheet", "B  Glass sheet"),
    ("combo", "C  Combination"),
]
FILES = {
    "flat": "0_flat",
    "beads": "A_glass_beads",
    "sheet": "B_glass_sheet",
    "combo": "C_combination",
}
LABEL_PX = 26
GRID_PANEL = 540


def font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def label(img: np.ndarray, text: str, size: int) -> np.ndarray:
    im = Image.fromarray(img)
    d = ImageDraw.Draw(im, "RGBA")
    f = font(size)
    box = d.textbbox((0, 0), text, font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    pad = size // 3
    d.rounded_rectangle(
        (pad, pad, pad + w + 2 * pad, pad + h + 2 * pad), radius=pad, fill=(0, 0, 0, 190)
    )
    d.text((2 * pad, pad + pad - box[1]), text, fill=(255, 255, 255, 255), font=f)
    return np.asarray(im, dtype=np.uint8)


def open_sink(
    out: Path, px: int, fps: int, audio: Path, a_start: float, seconds: float, crf: int, kbps: int
):
    exe = shutil.which("ffmpeg")
    assert exe is not None, "ffmpeg not found"
    cmd = [
        exe, "-v", "error", "-y", "-nostdin", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{px}x{px}", "-r", str(fps), "-i", "-",
        "-ss", f"{a_start:.6f}", "-t", f"{seconds:.6f}", "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", f"{kbps}k",
        "-c:v", "libx264", "-crf", str(crf), "-pix_fmt", "yuv420p", "-t", f"{seconds:.6f}",
        "-movflags", "+faststart", str(out),
    ]  # fmt: skip
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--audio", type=Path, default=Path(DEFAULT_AUDIO) / "track_0005369.mp3")
    ap.add_argument("--start", type=float, default=40.0)
    ap.add_argument("--seconds", type=float, default=12.0)
    ap.add_argument("--px", type=int, default=720)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "glass_videos")
    ap.add_argument("--reduced-motion", action="store_true")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    cfg = load_config()
    sys.stdout.write("analyzing...\n")
    sys.stdout.flush()
    result = analyze(args.audio, cfg)
    stream = build_live_stream(result, cfg)
    proto = result.prototypes.astype(np.float16).astype(np.float64)
    engine = LiveEngine(
        stream, proto, result.colors.oklch, cfg, reduced_motion=args.reduced_motion,
        nominal_dt=1.0 / args.fps,
    )  # fmt: skip
    px, size = args.px, cfg.grid.size
    ras = make_raster(px, cfg)
    xs1 = np.arange(px, dtype=np.float32) + 0.5
    xs, ys = np.meshgrid(xs1, xs1)
    audio_start = args.start + stream.audio_offset_s
    n = int(round(args.seconds * args.fps))

    sinks = {
        key: open_sink(args.out / f"{FILES[key]}.mp4", px, args.fps, args.audio, audio_start,
                       args.seconds, cfg.preview.crf, cfg.preview.audio_kbps)
        for key, _ in VARIANTS
    }  # fmt: skip
    grid_sink = open_sink(
        args.out / "compare_2x2.mp4", 2 * GRID_PANEL, args.fps, args.audio, audio_start,
        args.seconds, cfg.preview.crf, cfg.preview.audio_kbps,
    )  # fmt: skip

    engine.reset(args.start)
    static_only = args.reduced_motion and cfg.live.glass.reduced_motion == "static"
    for k in range(n):
        s = args.start + k / args.fps
        fr = engine.step(s)
        grid = (fr.srgb.reshape(size, size, 3).astype(np.float32)) / 255.0
        flow = None if static_only else flow_field(fr.activation, size, cfg)
        trail = (
            _draw_trail(fr.trail, ras, cfg).astype(np.float32) if fr.trail.shape[0] >= 2 else 0.0
        )
        panels = {}
        for key, text in VARIANTS:
            if key == "flat":
                img = rasterize(fr, ras, cfg)
            else:
                scale = cfg.render.glass.combo_scale if key == "combo" else 1.0
                out_, cover = shade(
                    xs,
                    ys,
                    grid,
                    cfg,
                    key,
                    float(px),
                    strength_scale=scale,
                    flow=flow,
                    return_cover=True,
                )  # type: ignore[misc]
                comp = out_ + trail * (1.0 - cover[..., None]) if not np.isscalar(trail) else out_
                comp = bloom(np.clip(comp, 0.0, 1.0).astype(np.float32), cfg, float(px))
                img = np.asarray(np.rint(np.clip(comp, 0, 1) * 255.0), dtype=np.uint8)
            panels[key] = label(img, text, LABEL_PX)
            sinks[key].stdin.write(np.ascontiguousarray(panels[key]).tobytes())  # type: ignore[union-attr]
        tiles = [
            np.asarray(
                Image.fromarray(panels[key]).resize(
                    (GRID_PANEL, GRID_PANEL), Image.Resampling.LANCZOS
                )
            )
            for key, _ in VARIANTS
        ]
        top, bottom = np.hstack(tiles[:2]), np.hstack(tiles[2:])
        grid_sink.stdin.write(np.ascontiguousarray(np.vstack([top, bottom])).tobytes())  # type: ignore[union-attr]
        if k % 60 == 0:
            sys.stdout.write(f"frame {k}/{n}\n")
            sys.stdout.flush()

    for key, p in [*sinks.items(), ("grid", grid_sink)]:
        assert p.stdin is not None
        p.stdin.close()
        err = p.stderr.read().decode("utf-8", "replace") if p.stderr else ""
        if p.wait() != 0:
            sys.stderr.write(f"ffmpeg failed for {key}: {err[:300]}\n")
            return 1
    for f in sorted(args.out.glob("*.mp4")):
        sys.stdout.write(f"{f}\n")
    sys.stdout.write("=== DONE\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
