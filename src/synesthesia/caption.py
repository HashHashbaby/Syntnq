"""Export caption (M8, D-065): a band under the static signature with the title, the artist, the
SYNESTHESIA wordmark and, for Creative Commons tracks, the licence attribution.

The square above the band is exactly the frozen 2D render (``render.render_sound_map``); this module
only adds the band. Text is set in TeX Gyre Heros from ``export.caption.font_*`` with Pillow's basic
layout, so the same fonts and Pillow give identical bytes. Characters the face lacks are drawn with
the first ``fallback_fonts`` entry that has them, or left out and reported.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont

from synesthesia.config import Config, ExportCaption

WORDMARK = "SYNESTHESIA"
_ELLIPSIS = "…"
_NOTDEF_PROBE = (
    "\U0010fffd"  # a private-use code point no text face maps: renders the .notdef glyph
)


class CaptionFontMissingError(FileNotFoundError):
    """The caption fonts are not installed (run ``make web-fonts``)."""


@dataclass(frozen=True)
class CaptionText:
    """The caption's lines (empty strings are left out)."""

    title: str
    artist: str
    attribution: str


def caption_text(signature: dict[str, Any]) -> CaptionText:
    """Title, artist and licence line from a signature (``song``, ``license`` sections).

    The licence line appears for Creative Commons tracks: their attribution, else the licence name.
    """
    song = signature.get("song") or {}
    lic = signature.get("license") or {}
    title = " ".join(str(song.get("title") or "").split()) or "Untitled"
    artist = " ".join(str(song.get("artist") or "").split())
    name = str(lic.get("name") or "")
    attribution = ""
    if name.upper().startswith("CC"):
        attribution = " ".join(str(lic.get("attribution") or "").split()) or name
    return CaptionText(title, artist, attribution)


def _resolve(root: Path, rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else root / p


@lru_cache(maxsize=32)
def _font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.BASIC)


def _glyph_mask(font: ImageFont.FreeTypeFont, ch: str) -> bytes:
    box = font.getbbox(ch)
    w, h = max(box[2] - box[0], 1), max(box[3] - box[1], 1)
    img = Image.new("L", (int(w) + 2, int(h) + 2), 0)
    ImageDraw.Draw(img).text((1 - box[0], 1 - box[1]), ch, font=font, fill=255)
    return img.tobytes() + bytes(str((w, h)), "ascii")


def _has_glyph(font: ImageFont.FreeTypeFont, ch: str) -> bool:
    if ch.isspace():
        return True
    return _glyph_mask(font, ch) != _glyph_mask(font, _NOTDEF_PROBE)


def _runs(
    text: str, faces: list[ImageFont.FreeTypeFont]
) -> tuple[list[tuple[str, ImageFont.FreeTypeFont]], str]:
    """Split text into runs by the first face that has each character, plus the dropped ones."""
    runs: list[tuple[str, ImageFont.FreeTypeFont]] = []
    dropped = ""
    for ch in text:
        face = next((f for f in faces if _has_glyph(f, ch)), None)
        if face is None:
            dropped += ch
            continue
        if runs and runs[-1][1] is face:
            runs[-1] = (runs[-1][0] + ch, face)
        else:
            runs.append((ch, face))
    return runs, dropped


def _width(runs: list[tuple[str, ImageFont.FreeTypeFont]]) -> float:
    return sum(f.getlength(t) for t, f in runs)


def _fit(
    text: str, faces: list[ImageFont.FreeTypeFont], max_w: float
) -> tuple[list[tuple[str, ImageFont.FreeTypeFont]], str]:
    """Runs for text, cut with an ellipsis to fit max_w pixels."""
    runs, dropped = _runs(text, faces)
    if _width(runs) <= max_w:
        return runs, dropped
    chars = "".join(t for t, _ in runs)
    lo, hi = 0, len(chars)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        cand, _ = _runs(chars[:mid].rstrip() + _ELLIPSIS, faces)
        if _width(cand) <= max_w:
            lo = mid
        else:
            hi = mid - 1
    cut, _ = _runs(chars[:lo].rstrip() + _ELLIPSIS, faces)
    return cut, dropped


def _faces(c: ExportCaption, root: Path, size: int, bold: bool) -> list[ImageFont.FreeTypeFont]:
    main = _resolve(root, c.font_bold if bold else c.font_regular)
    if not main.is_file():
        raise CaptionFontMissingError(f"caption font not found: {main} (run `make web-fonts`)")
    faces = [_font(str(main), size)]
    for fb in c.fallback_fonts:
        p = _resolve(root, fb)
        if p.is_file():
            faces.append(_font(str(p), size))
    return faces


def _draw_runs(
    draw: ImageDraw.ImageDraw,
    x: float,
    baseline: float,
    runs: list[tuple[str, ImageFont.FreeTypeFont]],
    fill: str,
) -> None:
    for text, face in runs:
        draw.text((x, baseline), text, font=face, fill=fill, anchor="ls")
        x += face.getlength(text)


def band_height(config: Config, side: int) -> int:
    """Caption band height in pixels for a square of ``side`` pixels."""
    return round(config.export.caption.band_ratio * side)


def add_caption(
    square: Image.Image, text: CaptionText, config: Config, root: Path
) -> tuple[Image.Image, str]:
    """The square with the caption band under it.

    Args:
        square: ``side x side`` RGB static render.
        text: caption lines.
        config: resolved configuration (``export.caption``, ``render.margin_cells``,
            ``render.display_grid``, ``render.background``).
        root: project root, for the font paths.

    Returns:
        ``(image, dropped)``: an RGB image ``side x (side + band)`` and the characters left out
        because no face had them (empty when every character was drawn).

    Raises:
        CaptionFontMissingError: the caption fonts are not installed.
    """
    c = config.export.caption
    side = square.width
    band = band_height(config, side)
    out = Image.new("RGB", (side, side + band), config.render.background)
    out.paste(square, (0, 0))
    draw = ImageDraw.Draw(out)
    margin = (
        config.render.margin_cells
        * side
        / (config.render.display_grid + 2 * config.render.margin_cells)
    )
    right = side - margin

    mark_face = _faces(c, root, max(1, round(c.wordmark_ratio * side)), bold=True)[0]
    track = c.wordmark_tracking_em * mark_face.size
    mark_w = sum(mark_face.getlength(ch) for ch in WORDMARK) + track * (len(WORDMARK) - 1)
    title_y = side + c.title_y * band
    x = right - mark_w
    for ch in WORDMARK:
        draw.text((x, title_y), ch, font=mark_face, fill=c.colors.wordmark, anchor="ls")
        x += mark_face.getlength(ch) + track

    gap = 2 * mark_face.size
    dropped = ""
    lines = [
        (text.title, c.title_ratio, True, c.title_y, c.colors.title, right - mark_w - gap - margin),
        (text.artist, c.artist_ratio, False, c.artist_y, c.colors.artist, right - margin),
        (
            text.attribution,
            c.attribution_ratio,
            False,
            c.attribution_y,
            c.colors.attribution,
            right - margin,
        ),
    ]
    for line, ratio, bold, y, color, max_w in lines:
        if not line:
            continue
        faces = _faces(c, root, max(1, round(ratio * side)), bold)
        runs, lost = _fit(line, faces, max_w)
        dropped += lost
        _draw_runs(draw, margin, side + y * band, runs, color)
    return out, dropped


def svg_with_caption(svg: str, text: CaptionText, config: Config, side: int, root: Path) -> str:
    """The static SVG nested in a taller document with the caption as live text (fonts by name).

    Lines are cut with an ellipsis exactly as in the PNG (measured with the caption fonts).

    Raises:
        CaptionFontMissingError: the caption fonts are not installed.
    """
    c = config.export.caption
    band = band_height(config, side)
    margin = (
        config.render.margin_cells
        * side
        / (config.render.display_grid + 2 * config.render.margin_cells)
    )
    right = side - margin
    font = escape(c.web_font, {'"': "&quot;"})

    def t(
        s: str,
        y: float,
        size: float,
        color: str,
        weight: int,
        anchor: str = "start",
        x: float = margin,
        extra: str = "",
    ) -> str:
        return (
            f'<text x="{x:.2f}" y="{side + y * band:.2f}" font-family="{font}" '
            f'font-size="{size:.2f}" font-weight="{weight}" fill="{color}" '
            f'text-anchor="{anchor}"{extra}>{escape(s)}</text>'
        )

    mark_face = _faces(c, root, max(1, round(c.wordmark_ratio * side)), bold=True)[0]
    mark_w = sum(
        mark_face.getlength(ch) for ch in WORDMARK
    ) + c.wordmark_tracking_em * mark_face.size * (len(WORDMARK) - 1)

    def fit(line: str, ratio: float, bold: bool, max_w: float) -> str:
        runs, _ = _fit(line, _faces(c, root, max(1, round(ratio * side)), bold), max_w)
        return "".join(r for r, _ in runs)

    title = fit(text.title, c.title_ratio, True, right - mark_w - 2 * mark_face.size - margin)
    artist = fit(text.artist, c.artist_ratio, False, right - margin) if text.artist else ""
    attribution = (
        fit(text.attribution, c.attribution_ratio, False, right - margin)
        if text.attribution
        else ""
    )
    parts = [
        t(
            WORDMARK,
            c.title_y,
            c.wordmark_ratio * side,
            c.colors.wordmark,
            700,
            "end",
            right,
            f' letter-spacing="{c.wordmark_tracking_em}em"',
        )
    ]
    parts.append(t(title, c.title_y, c.title_ratio * side, c.colors.title, 700))
    if artist:
        parts.append(t(artist, c.artist_y, c.artist_ratio * side, c.colors.artist, 400))
    if attribution:
        parts.append(
            t(attribution, c.attribution_y, c.attribution_ratio * side, c.colors.attribution, 400)
        )
    inner = svg.strip()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side + band}" '
        f'viewBox="0 0 {side} {side + band}">\n'
        f'<rect width="{side}" height="{side + band}" fill="{config.render.background}"/>\n'
        f"{inner}\n" + "\n".join(parts) + "\n</svg>\n"
    )
