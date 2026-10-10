from __future__ import annotations

import numpy as np
import pytest
from scipy.ndimage import gaussian_filter

from synesthesia.config import Config
from synesthesia.lens_field import lens_color, sample_field, swirl_angle, swirl_warp

BLOCK = 2


def _grid(seed: int, smooth: float = 1.5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    g = rng.random((64, 64, 3))
    g = np.stack([gaussian_filter(g[..., c], smooth) for c in range(3)], axis=-1)
    g = (g - g.min(axis=(0, 1))) / np.ptp(g, axis=(0, 1))
    g[..., 1:] -= 0.5  # OKLab-like a, b centred on zero
    return g


def _disc_points(radius: float, n: int = 160) -> tuple[np.ndarray, np.ndarray]:
    ax = (np.arange(n) + 0.5) / n * 2 * radius - radius
    qx, qy = np.meshgrid(ax, ax)
    inside = np.hypot(qx, qy) <= radius
    return qx[inside], qy[inside]


def test_field_interpolates_the_cell_centres() -> None:
    g = _grid(0)
    ii, jj = np.meshgrid(np.arange(3, 60, 7), np.arange(2, 60, 9), indexing="ij")
    got = sample_field(g, jj + 0.5, ii + 0.5)
    assert np.max(np.abs(got - g[ii, jj])) < 1e-12


def test_swirl_keeps_the_mean_colour_of_the_lens(config: Config) -> None:
    gl = config.render.glass
    radius, peak, power = gl.chip_radius, np.deg2rad(gl.swirl_angle_deg), gl.swirl_falloff_power
    qx, qy = _disc_points(radius)
    for seed in range(4):
        g = _grid(seed)
        for row, col in ((5, 7), (20, 11), (30, 30)):
            flat = lens_color(
                g, row, col, qx, qy, block=BLOCK, radius=radius, peak_rad=0.0, power=power
            )
            warped = lens_color(
                g, row, col, qx, qy, block=BLOCK, radius=radius, peak_rad=peak, power=power
            )
            # rigid ring rotation is area preserving: the lens mean must not move
            assert np.max(np.abs(flat.mean(axis=0) - warped.mean(axis=0))) < 5e-3


def test_lens_mean_matches_the_four_subcell_colours(config: Config) -> None:
    gl = config.render.glass
    qx, qy = _disc_points(gl.chip_radius)
    errs = []
    for seed in range(6):
        g = _grid(seed, smooth=1.2)
        for row, col in ((4, 4), (13, 21), (27, 9), (16, 16)):
            block = g[row * 2 : row * 2 + 2, col * 2 : col * 2 + 2].reshape(4, 3).mean(axis=0)
            warped = lens_color(
                g, row, col, qx, qy, block=BLOCK, radius=gl.chip_radius,
                peak_rad=np.deg2rad(gl.swirl_angle_deg), power=gl.swirl_falloff_power,
            )  # fmt: skip
            errs.append(np.abs(warped.mean(axis=0) - block).max())
    assert max(errs) < 0.06, max(errs)  # OKLab units; the field uses neighbors, so not exact


def test_subcell_centres_stay_in_their_own_quadrant(config: Config) -> None:
    gl = config.render.glass
    radius, power = gl.chip_radius, gl.swirl_falloff_power
    for peak_deg in (0.0, 15.0, gl.swirl_angle_deg, 60.0):
        for sx in (-1, 1):
            for sy in (-1, 1):
                cx, cy = sx * 0.25, sy * 0.25  # sub-cell centres of a 2 x 2 block, lens units
                wx, wy = swirl_warp(
                    np.array([cx]), np.array([cy]), radius, np.deg2rad(peak_deg), power
                )
                assert np.sign(wx[0]) == sx and np.sign(wy[0]) == sy, (peak_deg, sx, sy)


def test_swirl_angle_profile(config: Config) -> None:
    gl = config.render.glass
    r = np.array([0.0, 0.5 * gl.chip_radius, gl.chip_radius, 2 * gl.chip_radius])
    a = swirl_angle(r, gl.chip_radius, np.deg2rad(35.0), gl.swirl_falloff_power)
    assert a[0] == pytest.approx(np.deg2rad(35.0))
    assert a[1] == pytest.approx(np.deg2rad(35.0) * 0.25)  # (1 - 0.5)^2
    assert a[2] == 0.0 and a[3] == 0.0
