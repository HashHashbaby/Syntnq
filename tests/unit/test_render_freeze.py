"""The 2D static render is frozen at the M7 sign-off (D-050): its hash must not drift."""

from __future__ import annotations

from pathlib import Path

import yaml

from synesthesia.config import load_config
from synesthesia.io import RENDER_SOURCES, render_hash

ROOT = Path(__file__).resolve().parents[2]
FREEZE = ROOT / "config" / "render_freeze.yaml"


def test_render_hash_matches_the_frozen_value() -> None:
    frozen = yaml.safe_load(FREEZE.read_text(encoding="utf-8"))["render_hash"]
    got = render_hash(ROOT, load_config())
    assert got == frozen, (
        "The 2D static render changed (render_hash differs from config/render_freeze.yaml). "
        "A change to the signature render needs a DECISIONS entry, a new frozen hash and a "
        "re-run of the fidelity gates and the WebGL-vs-Python comparison."
    )


def test_render_hash_ignores_line_endings_and_covers_every_source(tmp_path: Path) -> None:
    cfg = load_config()
    for rel in RENDER_SOURCES:
        dst = tmp_path / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes((ROOT / rel).read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    assert render_hash(tmp_path, cfg) == render_hash(ROOT, cfg)
    last = tmp_path / RENDER_SOURCES[-1]
    last.write_bytes(last.read_bytes() + b"// edit\n")
    assert render_hash(tmp_path, cfg) != render_hash(ROOT, cfg)
