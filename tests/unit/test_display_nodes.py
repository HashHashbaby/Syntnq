"""Display grid pooling and the node-style seam (D-030)."""

from __future__ import annotations

import numpy as np
import pytest

from synesthesia.color import linear_srgb_to_oklab, srgb8_to_linear
from synesthesia.config import Config, load_config
from synesthesia.display import display_block, make_raster, pool_colors, pool_trail, pool_values
from synesthesia.nodes import get_node_style
from synesthesia.render import render_sound_map, render_svg


@pytest.fixture(scope="module")
def config() -> Config:
    return load_config()


def _cells(config: Config, seed: int = 0) -> np.ndarray:
    k = config.grid.size**2
    return np.random.default_rng(seed).integers(0, 256, (k, 3), dtype=np.uint8)


def test_default_display_grid_is_32_over_a_64_analysis(config: Config) -> None:
    assert config.grid.size == 64
    assert config.render.display_grid == 32
    assert display_block(config) == 2


def test_pooling_is_the_oklab_mean_of_each_block(config: Config) -> None:
    cells = _cells(config)
    nodes = pool_colors(cells, config)
    assert nodes.shape == (32 * 32, 3)
    lab = linear_srgb_to_oklab(srgb8_to_linear(cells)).reshape(64, 64, 3)
    expect = lab[0:2, 0:2].reshape(-1, 3).mean(axis=0)
    got = linear_srgb_to_oklab(srgb8_to_linear(nodes[:1]))[0]
    assert np.linalg.norm(got - expect) < 0.02  # 8-bit quantisation and gamut clipping only
    # node (row 3, col 5) covers cells rows 6-7, cols 10-11
    expect = lab[6:8, 10:12].reshape(-1, 3).mean(axis=0)
    got = linear_srgb_to_oklab(srgb8_to_linear(nodes[3 * 32 + 5][None]))[0]
    assert np.linalg.norm(got - expect) < 0.02


def test_uniform_colour_pools_to_itself(config: Config) -> None:
    cells = np.tile(np.array([[200, 90, 40]], dtype=np.uint8), (64 * 64, 1))
    nodes = pool_colors(cells, config)
    assert np.abs(nodes.astype(int) - cells[0].astype(int)).max() <= 1


def test_pooling_is_identity_when_display_equals_analysis_grid() -> None:
    cfg = load_config(overrides={"render": {"display_grid": 64}})
    cells = _cells(cfg)
    assert pool_colors(cells, cfg) is cells
    values = np.arange(64 * 64, dtype=np.float64)
    assert np.array_equal(pool_values(values, cfg), values)


def test_display_grid_must_divide_the_analysis_grid() -> None:
    cfg = load_config(overrides={"render": {"display_grid": 48}})
    with pytest.raises(ValueError, match="divide"):
        display_block(cfg)


def test_trail_points_land_on_the_same_place_on_screen(config: Config) -> None:
    trail = np.array([[10.0, 20.0, 0.5]])  # cell centre (10.5, 20.5) analysis units
    out = pool_trail(trail, config)
    assert out[0, 0] == pytest.approx((10.5 / 2.0) - 0.5)
    assert out[0, 1] == pytest.approx((20.5 / 2.0) - 0.5)
    assert out[0, 2] == 0.5


def test_static_render_draws_one_dot_per_display_node(config: Config) -> None:
    black = np.zeros((64 * 64, 3), dtype=np.uint8)
    white = np.full((64 * 64, 3), 255, dtype=np.uint8)
    img = np.asarray(render_sound_map(white, config, 640).convert("L"))
    pitch = 640 / (32 + 2 * config.render.margin_cells)
    # centre of node (0, 0) lit, the gap between nodes dark, outside the grid dark
    c0 = int((config.render.margin_cells + 0.5) * pitch)
    gap = int((config.render.margin_cells + 1.0) * pitch)
    assert img[c0, c0] > 240
    assert img[c0, gap] < 80
    assert img[2, 2] < 10
    assert np.asarray(render_sound_map(black, config, 640)).max() == 0


def test_svg_has_one_circle_per_node(config: Config) -> None:
    svg = render_svg(_cells(config), config, 640)
    assert svg.count("<circle") == 32 * 32


def test_raster_is_on_the_display_grid(config: Config) -> None:
    ras = make_raster(320, config)
    assert ras.cell.max() == 32 * 32 - 1


def test_node_style_is_selected_by_config_and_swappable(config: Config) -> None:
    style = get_node_style(config)
    assert type(style).__name__ == "DotNodeStyle"
    # the seam: callers only use the NodeStyle methods
    for name in ("render_static", "draw_live", "svg"):
        assert callable(getattr(style, name))
