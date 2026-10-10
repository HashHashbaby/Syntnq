"""Export the data the glass-lens WebGL prototype renders (static colours and a live clip).

For each song: ``<name>_static.f32`` (64 x 64 x 3 OKLab) and, optionally, ``<name>_live.f32``
(n frames of OKLab and flow textures) plus ``<name>_meta.json``. The live engine stays in Python
(verified reference); the page only renders what it is given.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from _corpus import DEFAULT_AUDIO, ROOT

from synesthesia.color import oklch_to_oklab
from synesthesia.config import load_config
from synesthesia.lens_field import flow_field
from synesthesia.live import LiveEngine, build_live_stream
from synesthesia.pipeline import analyze

SONGS = {
    "electronic": "track_0005369",
    "rock": "track_0016862",
    "ambient": "track_0078956",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "lens" / "data")
    ap.add_argument("--live", default="electronic", help="song name to export a live clip for")
    ap.add_argument("--start", type=float, default=40.0)
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    cfg = load_config()
    size = cfg.grid.size
    index = {}
    for name, track in SONGS.items():
        result = analyze(Path(DEFAULT_AUDIO) / f"{track}.mp3", cfg)
        lab = oklch_to_oklab(result.colors.oklch).reshape(size, size, 3).astype(np.float32)
        (args.out / f"{name}_static.f32").write_bytes(lab.tobytes())
        index[name] = {"track": track, "static": f"{name}_static.f32"}
        sys.stdout.write(f"static {name}: {track}\n")
        if name != args.live:
            continue
        stream = build_live_stream(result, cfg)
        proto = result.prototypes.astype(np.float16).astype(np.float64)
        eng = LiveEngine(stream, proto, result.colors.oklch, cfg, nominal_dt=1.0 / args.fps)
        n = int(round(args.seconds * args.fps))
        eng.reset(args.start)
        frames_lab = np.empty((n, size, size, 3), dtype=np.float32)
        frames_flow = np.empty((n, size, size, 3), dtype=np.float32)
        loud = np.empty(n, dtype=np.float32)
        for k in range(n):
            s = args.start + k / args.fps
            fr = eng.step(s)
            lch = eng.colors_lch(s, fr.activation)
            frames_lab[k] = oklch_to_oklab(lch).reshape(size, size, 3)
            frames_flow[k] = flow_field(fr.activation, size)
            t0 = min(int(s * stream.fps), stream.n_frames - 1)
            loud[k] = stream.loud[t0] / 255.0
        (args.out / f"{name}_live_lab.f32").write_bytes(frames_lab.tobytes())
        (args.out / f"{name}_live_flow.f32").write_bytes(frames_flow.tobytes())
        index[name]["live"] = {
            "n": n, "fps": args.fps, "start": args.start, "loud": loud.tolist(),
            "lab": f"{name}_live_lab.f32", "flow": f"{name}_live_flow.f32",
        }  # fmt: skip
        sys.stdout.write(f"live {name}: {n} frames\n")
    (args.out / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
