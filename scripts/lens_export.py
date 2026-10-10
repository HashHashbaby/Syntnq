"""Export the data the glass-chip WebGL prototype renders.

Per song: ``<name>_static.f32`` (64 x 64 x 3 OKLab) and ``<name>_occ.f32`` (32 x 32 lens
occupancy). For songs in ``--live``: per-frame OKLab (``_live_lab``), flow (``_live_flow``) and
wave-source (``_live_src``: best-matching cell x, y, loudness, beat amplitude) textures.
The live engine stays in Python (verified reference); the page renders what it is given and runs
the visual-only wave tank on the GPU.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from _corpus import DEFAULT_AUDIO, ROOT

from synesthesia.color import oklch_to_oklab
from synesthesia.config import load_config
from synesthesia.lens_field import flow_field
from synesthesia.live import LiveEngine, build_live_stream
from synesthesia.pipeline import analyze

SONGS = {
    "electronic": ("track_0005369", 40.0),
    "rock": ("track_0016862", 40.0),
    "ambient": ("track_0078956", 40.0),
    "dance": ("track_0000773", 50.0),
    "click": (None, 2.0),
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "lens" / "data")
    ap.add_argument("--live", nargs="*", default=["dance", "ambient", "click"])
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    cfg = load_config()
    size = cfg.grid.size
    block = cfg.render.glass.display_block
    lenses = size // block
    rp = cfg.live.ripple
    index: dict[str, dict] = {}
    for name, (track, start) in SONGS.items():
        if track is None:
            sys.path.insert(0, str(ROOT / "tests"))
            from fixtures import make_signals as ms

            path = args.out / "click_120bpm.wav"
            sf.write(path, ms.click_track(), ms.SAMPLE_RATE, subtype="PCM_16")
        else:
            path = Path(DEFAULT_AUDIO) / f"{track}.mp3"
        result = analyze(path, cfg)
        lab = oklch_to_oklab(result.colors.oklch).reshape(size, size, 3).astype(np.float32)
        occ = result.stats.occ_norm.reshape(lenses, block, lenses, block).mean(axis=(1, 3))
        (args.out / f"{name}_static.f32").write_bytes(lab.tobytes())
        (args.out / f"{name}_occ.f32").write_bytes(occ.astype(np.float32).tobytes())
        index[name] = {"track": track or "click_120bpm", "static": f"{name}_static.f32",
                       "occ": f"{name}_occ.f32"}  # fmt: skip
        sys.stdout.write(f"static {name}\n")
        if name not in args.live:
            continue
        stream = build_live_stream(result, cfg)
        proto = result.prototypes.astype(np.float16).astype(np.float64)
        eng = LiveEngine(stream, proto, result.colors.oklch, cfg, nominal_dt=1.0 / args.fps)
        n = int(round(args.seconds * args.fps))
        eng.reset(start)
        labs = np.empty((n, size, size, 3), dtype=np.float32)
        flows = np.empty((n, size, size, 3), dtype=np.float32)
        src = np.zeros((n, 4), dtype=np.float32)
        loud = np.empty(n, dtype=np.float32)
        beat_frames = []
        for k in range(n):
            s = start + k / args.fps
            fr = eng.step(s)
            lch = eng.colors_lch(s, fr.activation)
            labs[k] = oklch_to_oklab(lch).reshape(size, size, 3)
            flows[k] = flow_field(fr.activation, size)
            t0 = min(int(s * stream.fps), stream.n_frames - 1)
            loud[k] = stream.loud[t0] / 255.0
            half = 0.5 / args.fps
            window = stream.beat_times[
                (stream.beat_times > s - half) & (stream.beat_times <= s + half)
            ]
            onset = max((eng.beat_onset(float(b)) for b in window), default=0.0)
            amp = rp.amplitude * onset if (fr.beat_flash and onset >= rp.onset_threshold) else 0.0
            if amp > 0:
                beat_frames.append(k)
            src[k] = (fr.bmu % size, fr.bmu // size, loud[k], amp)
        (args.out / f"{name}_live_lab.f32").write_bytes(labs.tobytes())
        (args.out / f"{name}_live_flow.f32").write_bytes(flows.tobytes())
        (args.out / f"{name}_live_src.f32").write_bytes(src.tobytes())
        beats_in = [float(b) for b in stream.beat_times if start <= b < start + args.seconds]
        index[name]["live"] = {
            "n": n, "fps": args.fps, "start": start, "loud": loud.tolist(),
            "beat_frames": beat_frames, "beat_times_s": beats_in,
            "lab": f"{name}_live_lab.f32", "flow": f"{name}_live_flow.f32",
            "src": f"{name}_live_src.f32",
        }  # fmt: skip
        sys.stdout.write(f"live {name}: {n} frames, {len(beat_frames)} beat emissions\n")
    (args.out / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
