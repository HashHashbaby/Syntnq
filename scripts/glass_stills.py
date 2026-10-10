"""Look development: render the flat dots and three liquid-glass variants as stills.

Writes full frames (1024 px) and 3x zoom crops to ``out/glass/`` plus a labeled comparison
sheet and fidelity metrics (does the data mapping survive the glass look?).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
from _corpus import ROOT
from PIL import Image, ImageDraw, ImageFont

from synesthesia.color import linear_srgb_to_oklab, map_colors
from synesthesia.config import load_config
from synesthesia.glass import render_variant

VARIANTS = [("flat", "Flat (current)"), ("beads", "A  Glass beads"), ("sheet", "B  Glass sheet"),
            ("combo", "C  Combination")]  # fmt: skip
CROP_NOMINAL = 340  # nominal pixels in the crop window; 3x zoom -> 1020 px
ZOOM = 3
BLOOM_PAD = 24


def srgb_to_oklab(img: np.ndarray) -> np.ndarray:
    c = img.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return linear_srgb_to_oklab(lin)


def cell_means(img: np.ndarray, config, radius_cells: float) -> np.ndarray:
    """Mean OKLab of the pixels within ``radius_cells`` of every cell center, ``(K, 3)``."""
    size, margin = config.grid.size, config.render.margin_cells
    side = img.shape[0]
    pitch = side / (size + 2.0 * margin)
    lab = srgb_to_oklab(img)
    out = np.zeros((size * size, 3))
    half = int(np.ceil(radius_cells * pitch))
    for i in range(size * size):
        r, c = divmod(i, size)
        cy, cx = (margin + r + 0.5) * pitch, (margin + c + 0.5) * pitch
        y0, x0 = int(round(cy)) - half, int(round(cx)) - half
        patch = lab[y0 : y0 + 2 * half + 1, x0 : x0 + 2 * half + 1]
        yy, xx = np.mgrid[y0 : y0 + patch.shape[0], x0 : x0 + patch.shape[1]]
        mask = np.hypot(yy + 0.5 - cy, xx + 0.5 - cx) <= radius_cells * pitch
        out[i] = patch[mask].mean(axis=0)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--track", default="track_0005369")
    ap.add_argument("--px", type=int, default=1024)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "glass")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    config = load_config()
    npz = sorted(
        (ROOT / "out" / "corpus").glob(f"*/{args.track}.npz"), key=lambda p: p.stat().st_mtime
    )[-1]
    a = np.load(npz)
    colors = map_colors(
        a["cell_features"].astype(np.float64),
        a["occ_norm"].astype(np.float64),
        a["occ_norm"] < config.occupancy.empty_threshold,
        config,
    )
    srgb = colors.srgb
    size = config.grid.size
    sys.stdout.write(f"track {args.track}  config {config.hash()[:12]}  frame {args.px}px\n")

    # choose the crop window with the most lightness variation (a colour boundary)
    pitch = args.px / (size + 2.0 * config.render.margin_cells)
    lightness = colors.oklch[:, 0].reshape(size, size)
    best, win = -1.0, (0, 0)
    step = int(pitch * 4)
    for y in range(0, args.px - CROP_NOMINAL, step):
        for x in range(0, args.px - CROP_NOMINAL, step):
            c0 = int(x / pitch), int(y / pitch)
            n = int(CROP_NOMINAL / pitch)
            sd = lightness[c0[1] : c0[1] + n, c0[0] : c0[0] + n].std()
            if sd > best:
                best, win = sd, (x, y)
    window = (win[0], win[1], win[0] + CROP_NOMINAL, win[1] + CROP_NOMINAL)
    sys.stdout.write(f"crop window (nominal px) {window}\n")

    frames, crops = {}, {}
    sys.stdout.write(f"{'variant':16}{'full frame s':>14}{'crop (3x) s':>14}\n")
    for key, _ in VARIANTS:
        t0 = time.perf_counter()
        frames[key] = render_variant(srgb, config, key, args.px)
        t1 = time.perf_counter()
        crops[key] = render_variant(
            srgb, config, key, args.px, window=window, zoom=ZOOM, pad=BLOOM_PAD
        )
        t2 = time.perf_counter()
        sys.stdout.write(f"{key:16}{t1 - t0:14.2f}{t2 - t1:14.2f}\n")
        Image.fromarray(frames[key]).save(args.out / f"{key}_{args.px}.png")
        Image.fromarray(crops[key]).save(args.out / f"{key}_crop3x.png")

    # --- fidelity metrics over all cells (disc of radius 0.22 cells at the cell center) ---
    data_l = colors.oklch[:, 0]
    ref = cell_means(frames["flat"], config, 0.22)
    dim = data_l <= np.quantile(data_l, 0.10)
    chromatic = np.hypot(ref[:, 1], ref[:, 2]) > 0.03
    sys.stdout.write(
        f"\n{'variant':8}{'r(L,data)':>11}{'rank r':>9}{'mean dL':>9}{'dim10% L':>10}"
        f"{'hue err deg':>13}{'mean dE':>9}\n"
    )
    for key, _ in VARIANTS:
        m = cell_means(frames[key], config, 0.22)
        r = float(np.corrcoef(m[:, 0], data_l)[0, 1])
        rr = float(
            np.corrcoef(np.argsort(np.argsort(m[:, 0])), np.argsort(np.argsort(data_l)))[0, 1]
        )
        dh = np.rad2deg(np.arctan2(m[:, 2], m[:, 1]) - np.arctan2(ref[:, 2], ref[:, 1]))
        dh = np.abs((dh + 180.0) % 360.0 - 180.0)
        de = np.linalg.norm(m - ref, axis=1)
        sys.stdout.write(
            f"{key:8}{r:11.4f}{rr:9.4f}{np.mean(m[:, 0] - ref[:, 0]):+9.4f}"
            f"{m[dim, 0].mean():10.3f}{dh[chromatic].mean():13.2f}{de.mean():9.4f}\n"
        )

    # --- comparison sheet ---
    tile = 470
    font = ImageFont.load_default()
    sheet = Image.new("RGB", (len(VARIANTS) * (tile + 6) + 6, 2 * (tile + 26) + 6), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (key, label) in enumerate(VARIANTS):
        x = 6 + i * (tile + 6)
        dr.text((x, 8), f"{label}  (full frame {args.px}px)", fill=(235, 235, 235), font=font)
        sheet.paste(
            Image.fromarray(frames[key]).resize((tile, tile), Image.Resampling.LANCZOS), (x, 24)
        )
        dr.text((x, tile + 32), f"{label}  (3x crop)", fill=(235, 235, 235), font=font)
        sheet.paste(
            Image.fromarray(crops[key]).resize((tile, tile), Image.Resampling.LANCZOS),
            (x, tile + 48),
        )
    sheet.save(args.out / "glass_variants.png")
    sys.stdout.write(f"sheet: {args.out / 'glass_variants.png'}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
