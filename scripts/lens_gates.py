"""Measure the glass-chip fidelity gates on captured stills.

Per variant and song, shots ``<prefix>_<variant>_<song>_1440.png`` (rendered without the glint, for
colour) and ``<prefix>g_<variant>_<song>_1440.png`` (with the glint, for gap luminance).

Gates (docs of the chip look; measured on rendered images):
- rendered luminance (OKLab L of the chip mean) vs the data lightness target: correlation >= 0.99
- hue error <= 3 degrees (mean over chromatic chips)
- area-weighted mean chip colour (glint excluded) within 0.02 OKLab of the data colour
- darkest 10% of chips within 0.02 L of target
- gaps never brighter than 5% of the average chip luminance (measured on the lead-gap variant)
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
MEASURE_RADIUS = (
    0.97  # fraction of the chip radius (whole chip incl. the ring; 1 px clear of the AA edge)
)


def to_lin(img: np.ndarray) -> np.ndarray:
    c = img.astype(np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def measure(
    prefix: str, variant: str, song: str, cfg, radius: float, overlap: bool
) -> dict[str, float]:
    g = cfg.render.glass
    size, block = cfg.grid.size, g.display_block
    n = size // block
    lab = np.frombuffer((DATA / f"{song}_static.f32").read_bytes(), dtype=np.float32)
    lab = lab.reshape(size, size, 3).astype(np.float64)
    img = np.asarray(Image.open(SHOTS / f"{prefix}_{variant}_{song}_{SIDE}.png").convert("RGB"))
    lin = to_lin(img)
    ok = linear_srgb_to_oklab(lin)
    pitch = SIDE / (n + 2 * MARGIN)
    occ = np.frombuffer((DATA / f"{song}_occ.f32").read_bytes(), dtype=np.float32)
    yy, xx = np.mgrid[0:SIDE, 0:SIDE]
    de, dh, data_l, rend_l, data_c = [], [], [], [], []
    for i in range(n * n):
        r, c = divmod(i, n)
        scale = (
            np.sqrt(1.0 + g.radius_occ_amount * (2.0 * float(occ[i]) - 1.0))
            if variant == "O"
            else 1.0
        )
        rad = radius * scale * pitch
        half = int(np.ceil(rad)) + 2
        cy, cx = (MARGIN + r + 0.5) * pitch, (MARGIN + c + 0.5) * pitch
        y0, x0 = int(cy) - half, int(cx) - half
        sl = (slice(y0, y0 + 2 * half + 1), slice(x0, x0 + 2 * half + 1))
        dist = np.hypot(yy[sl] + 0.5 - cy, xx[sl] + 0.5 - cx)
        ref = (
            lab[r * block : (r + 1) * block, c * block : (c + 1) * block]
            .reshape(-1, 3)
            .mean(axis=0)
        )
        m = ok[sl][dist <= MEASURE_RADIUS * rad].mean(axis=0)
        de.append(float(np.linalg.norm(m - ref)))
        data_l.append(ref[0])
        rend_l.append(m[0])
        data_c.append(float(np.hypot(ref[1], ref[2])))
        h = np.rad2deg(np.arctan2(m[2], m[1]) - np.arctan2(ref[2], ref[1]))
        dh.append(abs((h + 180) % 360 - 180))
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
    }  # fmt: skip


def gap_ratio(prefix: str, variant: str, song: str, cfg, radius: float) -> float:
    """Max luminance in the lead between neighbouring chips / mean chip luminance."""
    g = cfg.render.glass
    n = cfg.grid.size // g.display_block
    img = np.asarray(Image.open(SHOTS / f"{prefix}_{variant}_{song}_{SIDE}.png").convert("RGB"))
    y = to_lin(img) @ LUMA
    pitch = SIDE / (n + 2 * MARGIN)
    chips, gaps = [], []
    for r in range(1, n - 1):
        for c in range(1, n - 1):
            cy, cx = (MARGIN + r + 0.5) * pitch, (MARGIN + c + 0.5) * pitch
            chips.append(y[int(cy) - 3 : int(cy) + 4, int(cx) - 3 : int(cx) + 4].mean())
            # centre of the lead to the right and below: midway between chip edges
            gaps.append(
                y[
                    int(cy) - 1 : int(cy) + 2, int(cx + pitch / 2) - 1 : int(cx + pitch / 2) + 2
                ].max()
            )
            gaps.append(
                y[
                    int(cy + pitch / 2) - 1 : int(cy + pitch / 2) + 2, int(cx) - 1 : int(cx) + 2
                ].max()
            )
    return float(np.max(gaps) / np.mean(chips))


def main() -> int:
    cfg = load_config()
    g = cfg.render.glass
    prefix = sys.argv[1] if len(sys.argv) > 1 else "g"
    variants = sys.argv[2:] or ["A", "B", "C"]
    gates = {"dE p95": 0.02, "L corr": 0.99, "hue mean": 3.0, "dim dL": 0.02}
    keys = ["dE mean", "dE p95", "dE max", "L corr", "hue mean", "hue p95", "dim dL", "mean dL"]
    for v in variants:
        radius = g.overlap_radius if v == "B" else g.chip_radius
        sys.stdout.write(f"\n=== variant {v} (prefix {prefix}) ===\n")
        sys.stdout.write(f"{'':16}" + "".join(f"{s:>13}" for s in SONGS) + "\n")
        res = {s: measure(prefix, v, s, cfg, radius, v == "B") for s in SONGS}
        for k in keys:
            sys.stdout.write(f"{k:16}" + "".join(f"{res[s][k]:13.4f}" for s in SONGS))
            if k in gates:
                ok = all(
                    (res[s][k] >= gates[k]) if k == "L corr" else (res[s][k] <= gates[k])
                    for s in SONGS
                )
                sys.stdout.write(f"   gate {gates[k]}: {'PASS' if ok else 'FAIL'}")
            sys.stdout.write("\n")
        if (SHOTS / f"{prefix}g_{v}_{SONGS[0]}_{SIDE}.png").exists():
            gr = [gap_ratio(prefix + "g", v, s, cfg, radius) for s in SONGS]
            sys.stdout.write(
                f"{'gap/chip lum':16}"
                + "".join(f"{x:13.4f}" for x in gr)
                + f"   gate 0.05: {'PASS' if max(gr) <= 0.05 else 'FAIL'}\n"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
