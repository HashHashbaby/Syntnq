from __future__ import annotations

import xml.etree.ElementTree as ET

import numpy as np

from synesthesia.config import Config, load_config
from synesthesia.render import render_chip_svg

NS = "{http://www.w3.org/2000/svg}"


def _lab() -> np.ndarray:
    rng = np.random.default_rng(3)
    lab = np.zeros((64, 64, 3))
    lab[..., 0] = 0.3 + 0.5 * rng.random((64, 64))
    lab[..., 1:] = 0.1 * (rng.random((64, 64, 2)) - 0.5)
    return lab


def test_chip_config_bounds(config: Config) -> None:
    g = config.render.glass
    assert g.display_block == 2 and config.grid.size // g.display_block == 32
    assert 0.30 <= g.radius_min <= g.chip_radius <= g.radius_max <= 0.50
    assert g.overlap_radius <= g.overlap_radius_max <= 0.58
    f = config.live.flow
    assert f.mod_radius <= 0.15 + 1e-9 and f.wave_speed * (1.0 / (30 * f.substeps)) < 0.7  # CFL


def test_chip_svg_is_deterministic_and_well_formed(config: Config) -> None:
    svg = render_chip_svg(_lab(), config, 1024)
    assert svg == render_chip_svg(_lab(), config, 1024)
    root = ET.fromstring(svg)
    chips = [c for c in root.iter(f"{NS}circle") if c.get("fill", "").startswith("url(#c")]
    assert len(chips) == 32 * 32
    assert len(list(root.iter(f"{NS}radialGradient"))) == 32 * 32


def test_chip_svg_radius_tracks_config() -> None:
    cfg = load_config(overrides={"render": {"glass": {"chip_radius": 0.40}}})
    svg = render_chip_svg(_lab(), cfg, 1000)
    pitch = 1000 / (32 + 1.2)
    root = ET.fromstring(svg)
    first = next(c for c in root.iter(f"{NS}circle") if c.get("fill", "").startswith("url(#c"))
    assert abs(float(first.get("r", "0")) - 0.40 * pitch) < 0.01
