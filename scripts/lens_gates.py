"""Measure the glass-lens fidelity and rim gates on captured stills.

Gates (central zone = within ``render.glass.central_radius`` of the lens radius, ~50% of the area):
- mean colour of the central zone within 0.02 OKLab of the data colour (mean of the 4 sub-cells)
- lightness correlation with the data >= 0.99, hue error <= 3 degrees (all three songs)
- darkest 10% of lenses within 0.02 L of the data
- rim: peak luminance <= rim_max_ratio * lens luminance + floor; no clipped white outside the glint
- at 50% downscale the lens colour reads before any ring does (ring / interior contrast reported)

Usage: ``python scripts/lens_gates.py <prefix> ...`` for shots ``<prefix>_<song>_1440.png``.
"""

from __future__ import annotations

import sys

import numpy as np
from _corpus import ROOT
from PIL import Image

from synesthesia.color import linear_srgb_to_oklab
from synesthesia.config import load_config

SHOTS = ROOT / "out" / "lens" / "shots"
DATA = ROOT / "out" / "lens" / "data"
SONGS = ["electronic", "rock", "ambient"]
SIDE = 1440
MARGIN = 0.6
LUMA = np.array([0.2126, 0.7152, 0.0722])


def to_lin(img: np.ndarray) -> np.ndarray:
    c = img.astype(np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def measure(prefix: str, song: str, cfg) -> dict[str, float]:
    g = cfg.render.glass
    size, block = cfg.grid.size, g.display_block
    lenses = size // block
    lab = np.frombuffer((DATA / f"{song}_static.f32").read_bytes(), dtype=np.float32)
    lab = lab.reshape(size, size, 3).astype(np.float64)
    img = np.asarray(Image.open(SHOTS / f"{prefix}_{song}_{SIDE}.png").convert("RGB"))
    lin = to_lin(img)
    oklab = linear_srgb_to_oklab(lin)
    pitch = SIDE / (lenses + 2 * MARGIN)
    rad = g.lens_radius * pitch
    yy, xx = np.mgrid[0:SIDE, 0:SIDE]
    half = int(np.ceil(rad)) + 2

    de, dh, ratio, over, clipped = [], [], [], [], 0
    data_l, rend_l, data_c = [], [], []
    ring_contrast = []
    for i in range(lenses * lenses):
        r, c = divmod(i, lenses)
        cy, cx = (MARGIN + r + 0.5) * pitch, (MARGIN + c + 0.5) * pitch
        y0, x0 = int(cy) - half, int(cx) - half
        sl = (slice(y0, y0 + 2 * half + 1), slice(x0, x0 + 2 * half + 1))
        dist = np.hypot(yy[sl] + 0.5 - cy, xx[sl] + 0.5 - cx)
        ref = (
            lab[r * block : (r + 1) * block, c * block : (c + 1) * block]
            .reshape(-1, 3)
            .mean(axis=0)
        )
        center = dist <= g.central_radius * rad
        m = oklab[sl][center].mean(axis=0)
        de.append(float(np.linalg.norm(m - ref)))
        data_l.append(ref[0])
        rend_l.append(m[0])
        data_c.append(float(np.hypot(ref[1], ref[2])))
        h = np.rad2deg(np.arctan2(m[2], m[1]) - np.arctan2(ref[2], ref[1]))
        dh.append(abs((h + 180) % 360 - 180))
        # rim: ring between 0.80 and 0.97 of the radius
        ring = (dist >= 0.80 * rad) & (dist <= 0.97 * rad)
        lum_c = float((lin[sl][center] @ LUMA).mean())
        lum_r = lin[sl][ring] @ LUMA
        ratio.append(float(lum_r.max() / max(lum_c, 1e-4)))
        over.append(float(lum_r.max() > 1.05 * (g.rim_max_ratio * lum_c + g.rim_floor)))
        ring_contrast.append(float(lum_r.mean() / max(lum_c, 1e-4)))
        outside = (dist > g.central_radius * rad) & (dist <= 1.05 * rad)
        px = img[sl][outside]
        clipped += int(np.sum(np.all(px >= 253, axis=1)))
    de, dh = np.array(de), np.array(dh)
    data_l, rend_l, data_c = np.array(data_l), np.array(rend_l), np.array(data_c)
    dim = data_l <= np.quantile(data_l, 0.10)
    chroma = data_c > 0.04
    return {
        "dE mean": de.mean(), "dE p95": np.percentile(de, 95), "dE max": de.max(),
        "L corr": float(np.corrcoef(data_l, rend_l)[0, 1]),
        "hue mean": dh[chroma].mean(), "hue p95": np.percentile(dh[chroma], 95),
        "dim dL": float(np.abs(rend_l[dim] - data_l[dim]).mean()),
        "mean dL": float((rend_l - data_l).mean()),
        "rim/lens p95": np.percentile(ratio, 95), "rim/lens max": max(ratio),
        "rim cap viol": float(np.mean(over)),
        "ring/centre mean": float(np.mean(ring_contrast)),
        "clipped px": float(clipped),
    }  # fmt: skip


def main() -> int:
    cfg = load_config()
    prefixes = sys.argv[1:] or ["final", "a1"]
    gates = {"dE p95": 0.02, "L corr": 0.99, "hue mean": 3.0, "dim dL": 0.02}
    for prefix in prefixes:
        sys.stdout.write(f"\n=== {prefix} ===\n")
        keys = [
            "dE mean", "dE p95", "dE max", "L corr", "hue mean", "hue p95", "dim dL", "mean dL",
            "rim/lens p95", "rim/lens max", "rim cap viol", "ring/centre mean", "clipped px",
        ]  # fmt: skip
        sys.stdout.write(f"{'':18}" + "".join(f"{s:>13}" for s in SONGS) + "\n")
        res = {s: measure(prefix, s, cfg) for s in SONGS}
        for k in keys:
            sys.stdout.write(f"{k:18}" + "".join(f"{res[s][k]:13.4f}" for s in SONGS))
            if k in gates:
                ok = all(
                    (res[s][k] >= gates[k]) if k == "L corr" else (res[s][k] <= gates[k])
                    for s in SONGS
                )
                sys.stdout.write(f"   gate {gates[k]}: {'PASS' if ok else 'FAIL'}")
            sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
