"""End-to-end sync check on the 120 BPM click track (docs/MILESTONES.md M3 task 4).

Renders a preview with the debug overlay (beat flash square + frame counter), then measures from
the *finished MP4*: when each flash frame appears in the video versus when each click is audible
in the muxed audio. Also compares the detected beat times with the known click times.

Pass criterion: every flash lands within one video frame (1 / fps) of a click.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from _corpus import ROOT

sys.path.insert(0, str(ROOT / "tests"))
from fixtures import make_signals as ms  # noqa: E402
from synesthesia.config import load_config  # noqa: E402

CLICK_LEVEL = 0.05  # fraction of the audio peak that counts as a click onset
CLICK_GAP_S = 0.2  # minimum separation between detected clicks
FLASH_LEVEL = 128  # grayscale level of the 1x1 corner probe that counts as "flash"
PROBE_PX = 12  # corner crop (inside the flash square, which is >= 6% of the frame)


def audio_clicks(mp4: Path) -> np.ndarray:
    """Click onset times (seconds from the start of the MP4's audio stream)."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(mp4), "-vn", "-ac", "1", "-ar", "44100",
         "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip
    x = np.abs(np.frombuffer(raw, dtype="<f4"))
    hits = np.flatnonzero(x > CLICK_LEVEL * x.max())
    if hits.size == 0:
        return np.empty(0)
    starts = hits[np.concatenate([[True], np.diff(hits) > CLICK_GAP_S * 44100])]
    return starts / 44100.0


def flash_times(mp4: Path, fps: int) -> np.ndarray:
    """Times (seconds) of video frames whose top-left corner is white."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(mp4), "-an",
         "-vf", f"crop={PROBE_PX}:{PROBE_PX}:0:0,scale=1:1,format=gray",
         "-f", "rawvideo", "-"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip
    levels = np.frombuffer(raw, dtype=np.uint8)
    return np.flatnonzero(levels > FLASH_LEVEL) / float(fps)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--start", type=float, default=2.0)
    ap.add_argument("--px", type=int, default=320)
    args = ap.parse_args()

    config = load_config()
    fps = config.preview.fps
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "click.wav"
        sf.write(wav, ms.click_track(), ms.SAMPLE_RATE, subtype="PCM_16")
        out = Path(tmp) / "out"
        subprocess.run(
            [sys.executable, "-m", "synesthesia.cli", "preview", str(wav), "--out", str(out),
             "--start", str(args.start), "--seconds", str(args.seconds), "--px", str(args.px),
             "--overlay", "--name", "sync"],
            check=True, capture_output=True,
        )  # fmt: skip
        mp4 = next(out.glob("*/sync.mp4"))
        clicks, flashes = audio_clicks(mp4), flash_times(mp4, fps)

    # clicks in the clip are at (n * 0.5 s - start) in source time; compare video vs audio
    sys.stdout.write(f"clicks heard {clicks.size}, flash frames {flashes.size}, fps {fps}\n")
    if clicks.size == 0 or flashes.size == 0:
        sys.stderr.write("no clicks or no flashes found\n")
        return 1
    err = np.array([f - clicks[np.argmin(np.abs(clicks - f))] for f in flashes])
    frame = 1.0 / fps
    sys.stdout.write(
        f"flash - click error (s): min {err.min():+.4f}  median {np.median(err):+.4f}  "
        f"max {err.max():+.4f}   one frame = {frame:.4f}\n"
    )
    ok = bool(np.all(np.abs(err) <= frame + 1e-9))
    first = np.ceil(args.start / 0.5) * 0.5 - args.start  # first click inside the clip
    grid = first + np.arange(clicks.size) * (60.0 / ms.CLICK_BPM)
    grid_err = float(np.max(np.abs(clicks - grid))) if clicks.size else float("nan")
    sys.stdout.write(f"audio click vs ideal 120 BPM grid: max error {grid_err:.4f} s\n")
    sys.stdout.write(f"RESULT: {'PASS' if ok else 'FAIL'} (|flash - click| <= 1 frame)\n")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
