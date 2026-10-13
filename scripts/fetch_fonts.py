"""Fetch the app's text face (TeX Gyre Heros) and build Latin WOFF2 files for the web (D-048).

Downloads the official OpenType files from CTAN, checks their SHA-256, subsets them to Latin and
writes ``web/public/fonts/`` (git-ignored, like the bundled samples: no third-party binaries are
committed). The verified official OpenType files are also copied unchanged to ``data/fonts/``
(git-ignored) for the Python export caption (D-065). The GUST Font License (LPPL 1.3c + a
non-binding renaming request) and the family README are copied next to the fonts, with a MANIFEST
that lists the derived files.

Usage: ``uv run python scripts/fetch_fonts.py`` (``make web-fonts``).
"""

from __future__ import annotations

import hashlib
import io
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "fonts"
OTF_OUT = ROOT / "data" / "fonts"
CTAN = "https://mirrors.ctan.org/fonts/tex-gyre"

# source file -> (sha256 of the official file, output name)
FONTS = {
    "opentype/texgyreheros-regular.otf": (
        "6ae1a09d5a940367b7aaaa91ee8bd8a2c333bfe193e7096e23f931357d62081f",
        "syn-heros-regular.woff2",
    ),
    "opentype/texgyreheros-bold.otf": (
        "b170162835f4efc288886dd4231406dc47e19b614cf4416836635599d44a7d60",
        "syn-heros-bold.woff2",
    ),
}
DOCS = {
    "doc/GUST-FONT-LICENSE.txt": "2bd69affc3da00715116f713f57eab9707e96daf3562ad0215987b15b9c16f73",
    "doc/README-TeX-Gyre-Heros.txt": (
        "cb41cbe4091a67a7a7b39df62553a7fc05f03e9014d7d1e148687967f3250188"
    ),
}
# Basic Latin, Latin-1, common punctuation, arrows, minus, euro, trademark (Google Fonts "latin")
UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+0304,U+0308,U+0329,"
    "U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"
)
MANIFEST = """MANIFEST for the SYNESTHESIA web build of TeX Gyre Heros

Source: TeX Gyre Heros, (c) GUST e-foundry, from CTAN ({ctan}).
Licence: GUST Font License (GUST-FONT-LICENSE.txt), an instance of the LPPL 1.3c.

Derived files (subset to Latin and converted to WOFF2 with fontTools; glyph outlines unchanged):
{files}

Per clause 1 of the GUST Font License the files carry new names. Exception: the font names
inside the files are unchanged, so the face stays identifiable as TeX Gyre Heros.
"""


def fetch(rel: str, sha: str) -> bytes:
    """Download ``rel`` from CTAN and verify its SHA-256."""
    req = urllib.request.Request(f"{CTAN}/{rel}", headers={"User-Agent": "synesthesia-fetch-fonts"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data: bytes = r.read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        raise ValueError(f"checksum mismatch for {rel}: {got}")
    return data


def build_woff2(otf: bytes) -> bytes:
    """Subset an OpenType font to Latin with kerning and tabular figures kept; return WOFF2."""
    font = TTFont(io.BytesIO(otf))
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "tnum", "lnum", "case", "ss01"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return buf.getvalue()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    lines = []
    OTF_OUT.mkdir(parents=True, exist_ok=True)
    for rel, (sha, name) in FONTS.items():
        otf = fetch(rel, sha)
        (OTF_OUT / Path(rel).name).write_bytes(otf)  # unchanged official file, for the caption
        data = build_woff2(otf)
        (OUT / name).write_bytes(data)
        lines.append(f"  {name}  <-  {Path(rel).name}  ({len(data) / 1024:.1f} KiB)")
        print(lines[-1].strip())
    for rel, sha in DOCS.items():
        doc = fetch(rel, sha)
        (OUT / Path(rel).name).write_bytes(doc)
        (OTF_OUT / Path(rel).name).write_bytes(doc)
    (OUT / "MANIFEST-syn-heros.txt").write_text(
        MANIFEST.format(ctan=CTAN, files="\n".join(lines)), encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
