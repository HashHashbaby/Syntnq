"""Export caption (M8, D-065): lines from the signature, the band under an unchanged square, fitting
long titles, determinism, characters the face lacks, and the SVG version."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from synesthesia.caption import (
    CaptionFontMissingError,
    CaptionText,
    add_caption,
    band_height,
    caption_text,
    svg_with_caption,
)
from synesthesia.config import load_config
from synesthesia.render import render_sound_map, render_svg

ROOT = Path(__file__).resolve().parents[2]
CFG = load_config()
FONTS = (ROOT / CFG.export.caption.font_regular).is_file()
needs_fonts = pytest.mark.skipif(not FONTS, reason="caption fonts not installed (make web-fonts)")
SIDE = 1024


def _square() -> Image.Image:
    rng = np.random.default_rng(3)
    colors = rng.integers(0, 256, size=(CFG.grid.size**2, 3), dtype=np.uint8)
    return render_sound_map(colors, CFG, SIDE)


def test_caption_text_from_signature() -> None:
    sig = {
        "song": {"title": "  Sam   Lee ", "artist": "Jo"},
        "license": {"name": "CC BY 4.0", "attribution": "Jo (CC BY 4.0)"},
    }
    assert caption_text(sig) == CaptionText("Sam Lee", "Jo", "Jo (CC BY 4.0)")
    assert caption_text({"song": {}, "license": {"name": "unknown"}}) == CaptionText(
        "Untitled", "", ""
    )
    assert caption_text({"song": {"title": "A"}, "license": {"name": "CC0"}}).attribution == "CC0"


@needs_fonts
def test_band_under_an_unchanged_square_and_deterministic() -> None:
    sq = _square()
    text = CaptionText("Ambiental", "Mister M", "Ambiental - Mister M (CC BY-SA)")
    a, dropped = add_caption(sq, text, CFG, ROOT)
    b, _ = add_caption(sq, text, CFG, ROOT)
    assert dropped == ""
    assert a.size == (SIDE, SIDE + band_height(CFG, SIDE))
    assert a.crop((0, 0, SIDE, SIDE)).tobytes() == sq.tobytes()  # the frozen render is untouched
    assert a.tobytes() == b.tobytes()
    band = np.asarray(a.crop((0, SIDE, SIDE, a.height)).convert("L"))
    assert band.max() > 200  # the title is drawn


@needs_fonts
def test_long_title_is_cut_before_the_wordmark() -> None:
    sq = _square()
    long = CaptionText(
        "Aleksandra Wiśniewska-Kowalczyk: Greatest Hits, Remastered (Deluxe Edition) [2025]", "", ""
    )
    img, _ = add_caption(sq, long, CFG, ROOT)
    band = np.asarray(img.crop((0, SIDE, SIDE, img.height)).convert("L")).astype(int)
    title_rows = band[: int(CFG.export.caption.title_y * band.shape[0])]
    lit = np.where(title_rows.max(axis=0) > 60)[0]
    gaps = np.where(np.diff(lit) > 0.03 * SIDE)[0]
    assert len(gaps) >= 1  # a clear gap separates the cut title from the wordmark


@needs_fonts
def test_characters_the_face_lacks_are_reported() -> None:
    _, dropped = add_caption(_square(), CaptionText("王秀英 Fox", "", ""), CFG, ROOT)
    assert dropped == "王秀英"


@needs_fonts
def test_svg_caption_is_live_text() -> None:
    svg = svg_with_caption(
        render_svg(np.zeros((CFG.grid.size**2, 3), np.uint8), CFG, SIDE),
        CaptionText("A & B", "C", ""),
        CFG,
        SIDE,
        ROOT,
    )
    assert f'height="{SIDE + band_height(CFG, SIDE)}"' in svg
    assert ">A &amp; B</text>" in svg and "SYNESTHESIA" in svg


def test_missing_fonts_raise(tmp_path: Path) -> None:
    with pytest.raises(CaptionFontMissingError):
        add_caption(_square(), CaptionText("A", "", ""), CFG, tmp_path)
