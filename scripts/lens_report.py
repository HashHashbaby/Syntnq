"""Assemble the glass-lens review material from captured shots (``out/lens/shots``).

Produces comparison sheets (flat 64 x 64 beside glass 32 x 32 for three songs, 100% crops, size
survey), fidelity metrics measured on the captured images, and a determinism check.
"""

from __future__ import annotations

import hashlib
import sys

import numpy as np
from _corpus import ROOT
from PIL import Image, ImageDraw, ImageFont

from synesthesia.color import linear_srgb_to_oklab, linear_to_srgb8, oklab_to_linear_srgb
from synesthesia.config import load_config
from synesthesia.render import render_sound_map

SHOTS = ROOT / "out" / "lens" / "shots"
DATA = ROOT / "out" / "lens" / "data"
OUT = ROOT / "out" / "lens"
SONGS = ["electronic", "rock", "ambient"]


def srgb8_to_lab(img: np.ndarray) -> np.ndarray:
    c = img.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return linear_srgb_to_oklab(lin)


def font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for name in ("arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def labeled(img: Image.Image, text: str) -> Image.Image:
    out = Image.new("RGB", (img.width, img.height + 34), (16, 16, 16))
    out.paste(img, (0, 34))
    ImageDraw.Draw(out).text((8, 6), text, fill=(240, 240, 240), font=font(20))
    return out


def main() -> int:
    cfg = load_config()
    size = cfg.grid.size
    block = cfg.render.glass.display_block
    lenses = size // block
    head = ["song", "r(L)", "rank r", "mean dL", "hue err", "dim 10% L", "dim data"]
    sys.stdout.write(f"{head[0]:12}" + "".join(f"{h:>10}" for h in head[1:]) + "\n")
    rows = []
    for name in SONGS:
        lab = np.frombuffer((DATA / f"{name}_static.f32").read_bytes(), dtype=np.float32).reshape(
            size, size, 3
        )
        lab = lab.astype(np.float64)
        srgb = linear_to_srgb8(oklab_to_linear_srgb(lab.reshape(-1, 3)))
        flat = render_sound_map(srgb, cfg, 1440)
        glass = Image.open(SHOTS / f"final_{name}_1440.png").convert("RGB")
        rows.append((labeled(flat, f"{name}  -  flat 64 x 64 (current)"),
                     labeled(glass, f"{name}  -  glass 32 x 32 lenses")))  # fmt: skip

        # fidelity: mean OKLab of the central disc of each lens vs the mean of its 4 sub-cells
        g = np.asarray(glass)
        pitch = 1440 / (lenses + 2 * 0.6)
        m = np.zeros((lenses * lenses, 3))
        ref = np.zeros((lenses * lenses, 3))
        yy, xx = np.mgrid[0:1440, 0:1440]
        for i in range(lenses * lenses):
            r, c = divmod(i, lenses)
            cy, cx = (0.6 + r + 0.5) * pitch, (0.6 + c + 0.5) * pitch
            y0, x0 = int(cy - 0.30 * pitch), int(cx - 0.30 * pitch)
            y1, x1 = int(cy + 0.30 * pitch) + 1, int(cx + 0.30 * pitch) + 1
            patch = g[y0:y1, x0:x1]
            mask = (
                np.hypot(yy[y0:y1, x0:x1] + 0.5 - cy, xx[y0:y1, x0:x1] + 0.5 - cx) <= 0.30 * pitch
            )
            m[i] = srgb8_to_lab(patch[mask]).mean(axis=0)
            ref[i] = (
                lab[r * block : (r + 1) * block, c * block : (c + 1) * block]
                .reshape(-1, 3)
                .mean(axis=0)
            )
        r_l = float(np.corrcoef(m[:, 0], ref[:, 0])[0, 1])
        rank = float(
            np.corrcoef(np.argsort(np.argsort(m[:, 0])), np.argsort(np.argsort(ref[:, 0])))[0, 1]
        )
        chroma = np.hypot(ref[:, 1], ref[:, 2]) > 0.04
        dh = np.rad2deg(np.arctan2(m[:, 2], m[:, 1]) - np.arctan2(ref[:, 2], ref[:, 1]))
        dh = np.abs((dh + 180) % 360 - 180)
        dim = ref[:, 0] <= np.quantile(ref[:, 0], 0.10)
        sys.stdout.write(
            f"{name:12}{r_l:8.4f}{rank:8.4f}{np.mean(m[:, 0] - ref[:, 0]):+9.4f}"
            f"{dh[chroma].mean():9.2f}{m[dim, 0].mean():11.3f}{ref[dim, 0].mean():10.3f}\n"
        )

    # sheets
    tile = 720
    sheet = Image.new("RGB", (2 * tile + 12, len(rows) * (tile + 34 + 6)), (8, 8, 8))
    for k, (a, b) in enumerate(rows):
        y = k * (tile + 40)
        sheet.paste(a.resize((tile, tile + 34), Image.Resampling.LANCZOS), (0, y))
        sheet.paste(b.resize((tile, tile + 34), Image.Resampling.LANCZOS), (tile + 12, y))
    sheet.save(OUT / "compare_flat_vs_glass.png")

    # 100% crops: 1440 px render, native pixels
    crops = []
    for name in SONGS:
        im = Image.open(SHOTS / f"final_{name}_1440.png").convert("RGB")
        crops.append(
            labeled(
                im.crop((560, 300, 1160, 900)),
                f"{name} - glass at 100% (600 x 600 px of a 1440 px frame)",
            )
        )
    cs = Image.new("RGB", (len(crops) * 612, 634), (8, 8, 8))
    for k, c in enumerate(crops):
        cs.paste(c, (k * 612, 0))
    cs.save(OUT / "glass_100pct_crops.png")

    # size survey: full lens vs simplified at 820 and 390 (enlarged 2x nearest for the 390 case)
    parts = []
    survey = [
        ("820_full", 820, "820 px - full lens"),
        ("820_simple", 820, "820 px - simplified"),
        ("390_full", 390, "390 px - full lens (x2)"),
        ("390_simple", 390, "390 px - simplified (x2)"),
    ]
    for tag, px, label in survey:
        im = Image.open(SHOTS / f"size_{tag}.png").convert("RGB")
        if px == 390:
            im = im.resize((780, 780), Image.Resampling.NEAREST)
        parts.append(labeled(im.crop((0, 0, 780, 780)) if px == 820 else im, label))
    sz = Image.new("RGB", (2 * 786, 2 * (780 + 40)), (8, 8, 8))
    for k, p in enumerate(parts):
        sz.paste(p, ((k % 2) * 786, (k // 2) * 820))
    sz.save(OUT / "size_survey.png")

    # determinism: identical stills from the same machine
    ha = hashlib.sha256((SHOTS / "det_a.png").read_bytes()).hexdigest()
    hb = hashlib.sha256((SHOTS / "det_b.png").read_bytes()).hexdigest()
    sys.stdout.write(f"\ndeterminism: det_a {ha[:16]}  det_b {hb[:16]}  identical={ha == hb}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
