"""Side-by-side sheet of the translucent-glass variants G1..G3 against the flat reference and A."""

from __future__ import annotations

import sys

from _corpus import ROOT
from PIL import Image, ImageDraw

SHOTS = ROOT / "out" / "lens" / "shots"
REVIEW = ROOT / "out" / "lens" / "review"
COLS = [("gg_P1", "P1 white, glass"), ("gg_P2", "P2 white, stained pale-core"), ("gg_P3", "P3 white, 8% overlap"), ("gg_G5", "G5 black (for reference)")]


def main() -> int:
    song = sys.argv[1:] or ["electronic", "rock", "ambient"]
    tile = 560
    for s in song:
        sheet = Image.new("RGB", (len(COLS) * (tile + 6) + 6, tile + 36), (10, 10, 10))
        d = ImageDraw.Draw(sheet)
        for c, (k, label) in enumerate(COLS):
            im = Image.open(SHOTS / f"{k}_{s}_1440.png").convert("RGB")
            if k == "gg_A":
                im = im.crop((0, 0, 1440, 1440))
            sheet.paste(im.resize((tile, tile), Image.Resampling.LANCZOS), (6 + c * (tile + 6), 30))
            d.text((10 + c * (tile + 6), 8), f"{s}: {label}", fill=(240, 240, 240))
        sheet.save(REVIEW / f"{s}__glass_white_sheet.png")
    # 300% crop of one region, same four looks
    crop = Image.new("RGB", (len(COLS) * 436 + 6, 450), (10, 10, 10))
    for c, (k, label) in enumerate(COLS):
        im = Image.open(SHOTS / f"{k}_electronic_1440.png").convert("RGB").crop((600, 500, 800, 700))
        crop.paste(im.resize((430, 430), Image.Resampling.LANCZOS), (6 + c * 436, 12))
    crop.save(REVIEW / "glass_white_crops.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
