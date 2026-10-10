"""Fill ``glass_bench_template.html`` with a real song's cell colors and the glass parameters.

Open the generated page in a WebGL2 browser (serve ``out/glass`` over http) to time the glass
shader on the local GPU. Parameters come from ``config.render.glass`` so the page tracks the
config.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import numpy as np
from _corpus import ROOT

from synesthesia.color import map_colors
from synesthesia.config import load_config


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--track", default="track_0005369")
    ap.add_argument("--side", type=int, default=1080)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "glass" / "gpu_bench.html")
    args = ap.parse_args()

    cfg = load_config()
    npz = sorted(
        (ROOT / "out" / "corpus").glob(f"*/{args.track}.npz"), key=lambda p: p.stat().st_mtime
    )[-1]
    a = np.load(npz)
    col = map_colors(
        a["cell_features"].astype(np.float64),
        a["occ_norm"].astype(np.float64),
        a["occ_norm"] < cfg.occupancy.empty_threshold,
        cfg,
    )
    g, sh = cfg.render.glass, cfg.render.glass.sheet
    params = {
        "light": list(g.light_dir), "shade": g.shade_strength, "inner": g.inner_glow,
        "spec": g.spec_strength, "spec_power": g.spec_power, "rim": g.rim_strength,
        "rim_width": g.rim_width, "refraction": g.refraction, "refraction_mix": g.refraction_mix,
        "caustic": g.caustic_strength, "caustic_offset": g.caustic_offset,
        "caustic_sigma": g.caustic_sigma, "strength": g.strength,
        "warp_amp": sh.warp_amp, "warp_wl": sh.warp_wavelength_cells, "frost": sh.frost,
        "sweep": sh.sweep_strength, "sweep_pos": sh.sweep_pos, "sweep_w": sh.sweep_width,
        "edge": sh.edge_strength, "edge_w": sh.edge_width, "combo_scale": g.combo_scale,
        "glow_sigma_ratio": cfg.render.glow_sigma_ratio, "glow_opacity": cfg.render.glow_opacity,
    }  # fmt: skip
    html = (Path(__file__).with_name("glass_bench_template.html")).read_text(encoding="utf-8")
    html = (
        html.replace("__GRID_B64__", base64.b64encode(col.srgb.astype(np.uint8).tobytes()).decode())
        .replace("__SIDE__", str(args.side))
        .replace("__PARAMS__", json.dumps(params))
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    sys.stdout.write(f"wrote {args.out}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
