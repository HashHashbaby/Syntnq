"""Assemble the glass-chip review material from captured shots (``out/lens/shots``).

Sheets: full frames (flat 64 x 64 reference, variants A/B/C, previous lens look) for three songs,
100% crops, 300% crops; plus the size survey (390 px at DPR 1 and 3) and the determinism check.
"""

from __future__ import annotations

import hashlib
import sys

import numpy as np
from _corpus import ROOT
from PIL import Image, ImageDraw, ImageFont

from synesthesia.color import linear_to_srgb8, oklab_to_linear_srgb
from synesthesia.config import load_config
from synesthesia.render import render_sound_map

SHOTS = ROOT / "out" / "lens" / "shots"
DATA = ROOT / "out" / "lens" / "data"
OUT = ROOT / "out" / "lens"
SONGS = ["electronic", "rock", "ambient"]
COLS = [
    ("flat64", "FLAT 64 x 64 (current)"),
    ("gg_A", "A  lead gaps"),
    ("gg_B", "B  overlap 8%"),
    ("gg_C", "C  + backdrop haze"),
    ("lens", "previous lens look"),
]


def font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for name in ("arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def load(key: str, song: str, cfg) -> Image.Image:
    if key == "flat64":
        lab = np.frombuffer((DATA / f"{song}_static.f32").read_bytes(), dtype=np.float32)
        srgb = linear_to_srgb8(oklab_to_linear_srgb(lab.reshape(-1, 3).astype(np.float64)))
        return render_sound_map(srgb, cfg, 1440).convert("RGB")
    if key == "lens":
        return Image.open(SHOTS / f"a3_{song}_1440.png").convert("RGB")
    if key.startswith("gg_"):
        v = key.split("_")[1]
        return Image.open(SHOTS / f"gg_{v}_{song}_1440.png").convert("RGB")
    raise KeyError(key)


def main() -> int:
    cfg = load_config()
    tile = 400
    full = Image.new(
        "RGB", (len(COLS) * (tile + 6) + 6, len(SONGS) * (tile + 34) + 6), (10, 10, 10)
    )
    d = ImageDraw.Draw(full)
    crops100 = Image.new("RGB", (len(COLS) * 306 + 6, len(SONGS) * 336 + 6), (10, 10, 10))
    d2 = ImageDraw.Draw(crops100)
    for r, song in enumerate(SONGS):
        for c, (key, label) in enumerate(COLS):
            im = load(key, song, cfg)
            x, y = 6 + c * (tile + 6), 6 + r * (tile + 34)
            d.text((x, y), f"{song}: {label}", fill=(240, 240, 240), font=font(15))
            full.paste(im.resize((tile, tile), Image.Resampling.LANCZOS), (x, y + 24))
            x2, y2 = 6 + c * 306, 6 + r * 336
            d2.text((x2, y2), f"{song}: {label}", fill=(240, 240, 240), font=font(14))
            crops100.paste(im.crop((560, 200, 860, 500)), (x2, y2 + 24))
    full.save(OUT / "chips_variants_full.png")
    crops100.save(OUT / "chips_crops_100pct.png")

    # 300% crops from native renders (A, B, C, flat chips) and the previous look upscaled
    names = [
        ("F", "flat chips (no glass)"),
        ("A", "A lead gaps"),
        ("B", "B overlap 8%"),
        ("C", "C + haze"),
    ]
    z = Image.new("RGB", (len(names) * 426 + 6, 460), (10, 10, 10))
    dz = ImageDraw.Draw(z)
    for i, (k, label) in enumerate(names):
        dz.text((6 + i * 426, 6), f"{label} - 300%", fill=(240, 240, 240), font=font(16))
        z.paste(Image.open(SHOTS / f"zoom300_{k}.png").convert("RGB"), (6 + i * 426, 30))
    z.save(OUT / "chips_crops_300pct.png")

    # size survey
    parts = [
        ("size_390_dpr1.png", "390 px, DPR 1 (shown 2x nearest)", 2),
        ("size_390_dpr3.png", "390 px, DPR 3 (1170 device px, shown 100%)", 1),
    ]
    sz = Image.new("RGB", (780 + 1170 + 18, 1170 + 40), (10, 10, 10))
    ds = ImageDraw.Draw(sz)
    xx = 6
    for fn, label, scale in parts:
        im = Image.open(SHOTS / fn).convert("RGB")
        if scale > 1:
            im = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
        ds.text((xx, 6), label, fill=(240, 240, 240), font=font(16))
        sz.paste(im, (xx, 30))
        xx += im.width + 6
    sz.save(OUT / "chips_size_survey.png")

    ha = hashlib.sha256((SHOTS / "gg_A_electronic_1440.png").read_bytes()).hexdigest()[:16]
    sys.stdout.write(f"wrote sheets; A electronic sha {ha}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
