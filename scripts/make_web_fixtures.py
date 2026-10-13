# ruff: noqa: E501
"""Generate the web app's parameters and parity fixtures from the Python reference (M7).

Writes:
- ``web/src/params.json``: the config values the web code needs (single source: config/default.yaml).
- ``web/tests/fixtures/`` (git-ignored): the binary files of the synthetic A/B/A fixture, the
  reference live engine's per-frame outputs (so the TypeScript port can be compared number by
  number), gamut-mapping cases, and rasterized reference frames for the renderer comparison.

Prototypes and static colours are rounded to the stored precision (float16 / float32) before the
reference engine runs, so the comparison isolates porting errors from storage rounding.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from _corpus import ROOT

sys.path.insert(0, str(ROOT / "tests"))
from PIL import Image  # noqa: E402

from fixtures import make_signals as ms  # noqa: E402
from synesthesia.color import gamut_map, linear_to_srgb8, oklab_to_linear_srgb, oklch_to_oklab  # noqa: E402
from synesthesia.compare import compare  # noqa: E402
from synesthesia.config import load_config  # noqa: E402
from synesthesia.display import make_raster, pool_colors, pool_values  # noqa: E402
from synesthesia.io import decode_static_bin, write_result  # noqa: E402
from synesthesia.live import LiveEngine, build_live_stream  # noqa: E402
from synesthesia.pipeline import analyze  # noqa: E402
from synesthesia.preview import rasterize  # noqa: E402
from synesthesia.render import render_sound_map  # noqa: E402

WEB = ROOT / "web"
FIX = WEB / "tests" / "fixtures"
N_FRAMES = 40
FPS = 30
START_S = 5.0
RASTER_FRAMES = (0, 10, 20, 30, 39)
RASTER_PX = 540
N_COLOR_CASES = 600


def export_params() -> None:
    cfg = load_config()
    doc = {
        "grid": {"size": cfg.grid.size},
        "live": cfg.live.model_dump(),
        "color": {
            "hue": cfg.color.hue.model_dump(),
            "chroma": cfg.color.chroma.model_dump(),
            "lightness": cfg.color.lightness.model_dump(),
        },
        "render": {
            "display_grid": cfg.render.display_grid,
            "margin_cells": cfg.render.margin_cells,
            "background": cfg.render.background,
            "node": cfg.render.node.model_dump(),
        },
        "ranges": cfg.color.ranges.model_dump(),
        "maps": {
            "feature_grids": cfg.maps.feature_grids,
            "ramp_hues": {k: v.hue_deg for k, v in cfg.maps.ramp_hues.items()},
            "ramp": cfg.maps.ramp.model_dump(),
        },
        "preview": {"fps": cfg.preview.fps},
        "web3d": cfg.web3d.model_dump(),
        "ui": cfg.ui.model_dump(),
        "fingerprint": {**cfg.fingerprint.model_dump(), "n_scalars": cfg.fingerprint.n_scalars},
        "compare": cfg.compare.model_dump(),
        "export": {
            "caption": cfg.export.caption.model_dump(
                exclude={"font_regular", "font_bold", "fallback_fonts"}
            ),
            "sizes": list(cfg.render.export_px),
        },
        "api": {
            "page_size_default": cfg.api.page_size_default,
            "page_size_max": cfg.api.page_size_max,
        },
    }
    (WEB / "src").mkdir(parents=True, exist_ok=True)
    (WEB / "src" / "params.json").write_text(
        json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def generate(prefix: str, signal: str, cfg, wavs) -> None:  # type: ignore[no-untyped-def]
    """Binary files and reference engine frames for one synthetic signal, files named ``<prefix>_*``."""
    with tempfile.TemporaryDirectory() as tmp:
        result = analyze(wavs[signal], cfg)
        song_dir = write_result(result, Path(tmp) / "out", cfg)
        for name in ("static.bin", "maps.bin", "live.bin", "proto.bin", "signature.json"):
            (FIX / f"{prefix}_{name}").write_bytes((song_dir / name).read_bytes())
    stream = build_live_stream(result, cfg)
    protos = result.prototypes.astype(np.float16).astype(np.float64)
    static = result.colors.oklch.astype(np.float32).astype(np.float64)
    engine = LiveEngine(stream, protos, static, cfg, False, nominal_dt=1.0 / FPS)
    engine.reset(START_S)

    srgb, radius, act, flash, bmu = [], [], [], [], []
    pooled_c, pooled_r, trails = [], [], []
    raster = make_raster(RASTER_PX, cfg)
    for k in range(N_FRAMES):
        s = START_S + k / FPS
        f = engine.step(s)
        srgb.append(f.srgb)
        radius.append(f.radius_scale.astype(np.float32))
        act.append(f.activation.astype(np.float32))
        flash.append(int(f.beat_flash))
        bmu.append(f.bmu)
        pooled_c.append(pool_colors(f.srgb, cfg))
        pooled_r.append(pool_values(f.radius_scale, cfg).astype(np.float32))
        trails.append(f.trail.astype(np.float32))
        if k in RASTER_FRAMES:
            Image.fromarray(rasterize(f, raster, cfg)).save(FIX / f"{prefix}_raster_{k:02d}.png")
    (FIX / f"{prefix}_frames_srgb.u8").write_bytes(np.stack(srgb).astype(np.uint8).tobytes())
    (FIX / f"{prefix}_frames_radius.f32").write_bytes(np.stack(radius).astype("<f4").tobytes())
    (FIX / f"{prefix}_frames_activation.f32").write_bytes(np.stack(act).astype("<f4").tobytes())
    (FIX / f"{prefix}_frames_pooled_srgb.u8").write_bytes(
        np.stack(pooled_c).astype(np.uint8).tobytes()
    )
    (FIX / f"{prefix}_frames_pooled_radius.f32").write_bytes(
        np.stack(pooled_r).astype("<f4").tobytes()
    )
    (FIX / f"{prefix}_frames_trail.f32").write_bytes(
        np.concatenate([t.ravel() for t in trails]).astype("<f4").tobytes()
    )
    meta = {
        "n_frames": N_FRAMES, "fps": FPS, "start_s": START_S,
        "cells": cfg.grid.size**2, "nodes": cfg.render.display_grid**2,
        "raster_frames": list(RASTER_FRAMES), "raster_px": RASTER_PX,
        "flash": flash, "bmu": bmu, "trail_len": [t.shape[0] for t in trails],
        "n_beats": int(stream.beat_times.size), "tau": stream.tau, "stream_frames": stream.n_frames,
    }  # fmt: skip
    (FIX / f"{prefix}_expected.json").write_text(
        json.dumps(meta, indent=2) + "\n", encoding="utf-8"
    )
    # trail chart (D-062): physical brightness (Hz) and loudness (dBFS) of every 37th frame, to check
    # the web's dequantisation of live.bin color_t against the analysis values
    phys = result.features.color_matrix()  # (T, 5) brightness log10 Hz, loudness dBFS, ...
    idx = list(range(0, phys.shape[0], 37))
    graph = {
        "frames": idx,
        "brightness_hz": [float(10.0 ** phys[i, 0]) for i in idx],
        "loudness_dbfs": [float(phys[i, 1]) for i in idx],
    }
    (FIX / f"{prefix}_graph.json").write_text(json.dumps(graph, indent=2) + "\n", encoding="utf-8")


def compare_cases(cfg) -> None:  # type: ignore[no-untyped-def]
    """M9: Python comparisons of every pair of bundled-sample fingerprints, for the TS port (D-066)."""
    index = WEB / "public" / "samples" / "index.json"
    if not index.is_file():
        return
    samples = json.loads(index.read_text(encoding="utf-8"))
    cases = []
    for a in samples:
        for b in samples:
            r = compare(a["fingerprint"], b["fingerprint"], cfg)
            cases.append({"a": a["slug"], "b": b["slug"], **r.to_json()})
    fps = {s["slug"]: s["fingerprint"] for s in samples}
    (FIX / "compare_cases.json").write_text(
        json.dumps({"fingerprints": fps, "cases": cases}, indent=1), encoding="utf-8"
    )


def export_references(cfg) -> None:  # type: ignore[no-untyped-def]
    """M8: the Python export (frozen 2D render, no caption) of each bundled sample at 1024 and 2048 px,
    for the web tests that compare the in-app view and the in-browser export with it (D-065)."""
    samples = WEB / "public" / "samples"
    for st_path in sorted(samples.glob("*/static.bin")):
        colors = decode_static_bin(st_path.read_bytes())["color_srgb"]
        for px in (1024, 2048):
            image = render_sound_map(colors, cfg, px)
            image.save(FIX / f"sample_{st_path.parent.name}_{px}.png", compress_level=6)


def main() -> int:
    cfg = load_config()
    export_params()
    FIX.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wavs = ms.write_all(Path(tmp) / "wavs")
        generate("aba", "aba_song", cfg, wavs)
        generate("click", "click_120bpm", cfg, wavs)
    export_references(cfg)
    compare_cases(cfg)
    rng = np.random.default_rng(7)
    lch = np.column_stack(
        [rng.uniform(0.05, 0.95, N_COLOR_CASES), rng.uniform(0.0, 0.40, N_COLOR_CASES),
         rng.uniform(0.0, 360.0, N_COLOR_CASES)]
    )  # fmt: skip
    out = linear_to_srgb8(oklab_to_linear_srgb(oklch_to_oklab(gamut_map(lch))))
    (FIX / "color_cases.json").write_text(
        json.dumps({"lch": lch.tolist(), "srgb": out.tolist()}), encoding="utf-8"
    )
    sys.stdout.write(f"wrote {FIX}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
