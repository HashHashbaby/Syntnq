"""Node styles: the look (texture and effect) of one drawn node (D-030).

Everything that decides how a node *looks* lives behind :class:`NodeStyle`; the analysis, the live
engine, the display pooling and the video/PNG writers never mention a specific look. To change or
add a look:

1. write a class with the three methods below (its parameters come from ``render.node.<name>``),
2. add its parameter model to ``config.py`` and its block to ``config/default.yaml``,
3. register it in ``_STYLES``.

Selecting it is then one config value, ``render.node.style``. The WebGL renderer follows the same
contract: one fragment shader per style, chosen by the same name.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

import numpy as np
import numpy.typing as npt
from PIL import Image, ImageDraw, ImageFilter

from synesthesia.config import Config, DotStyle
from synesthesia.display import Raster

Array = npt.NDArray[np.float64]

_SUPERSAMPLE = 2  # static render: draw at 2x then downsample with Lanczos (spec)
_MAX_8BIT = 255.0
_AA_PX = 1.0  # live render: anti-aliasing ramp width in pixels
_SVG_PRECISION = 3  # decimals for coordinates; fixed so output text is deterministic


def _parse_hex(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


class NodeStyle(Protocol):
    """The look of one node. Implementations are pure: same inputs, same pixels."""

    def render_static(self, srgb: npt.NDArray[np.uint8], n: int, side: int) -> Image.Image:
        """Static image of an ``n x n`` node grid.

        Args:
            srgb: ``(n*n, 3)`` uint8 node colours, ``i = row * n + col``.
            n: nodes per side.
            side: output side in pixels.
        """
        ...

    def draw_live(
        self,
        base: Array,
        srgb: npt.NDArray[np.uint8],
        radius_scale: Array,
        raster: Raster,
    ) -> npt.NDArray[np.uint8]:
        """One live frame: nodes (and their effects) over ``base``.

        Args:
            base: ``(px, px, 3)`` float in [0, 1], what is already drawn under the nodes (trail).
            srgb: ``(n*n, 3)`` uint8 node colours.
            radius_scale: ``(n*n,)`` radius multiplier (1.0 = static size).
            raster: pixel -> node geometry.

        Returns:
            ``(px, px, 3)`` uint8.
        """
        ...

    def svg(self, srgb: npt.NDArray[np.uint8], n: int, side: int) -> str:
        """Deterministic vector version of the static image (may approximate effects)."""
        ...


class DotNodeStyle:
    """Flat filled circle with a restrained additive glow (docs/ANALYSIS.md section 12)."""

    def __init__(self, params: DotStyle, margin_cells: float, background: str) -> None:
        self._p = params
        self._margin = margin_cells
        self._bg = _parse_hex(background)
        self._bg_hex = background

    def render_static(self, srgb: npt.NDArray[np.uint8], n: int, side: int) -> Image.Image:
        big = side * _SUPERSAMPLE
        pitch = big / (n + 2.0 * self._margin)
        radius = self._p.radius_ratio * pitch
        canvas = Image.new("RGB", (big, big), self._bg)
        draw = ImageDraw.Draw(canvas)
        for i in range(n * n):
            r, c = divmod(i, n)
            cx = (self._margin + c + 0.5) * pitch
            cy = (self._margin + r + 0.5) * pitch
            draw.ellipse(
                (cx - radius, cy - radius, cx + radius, cy + radius),
                fill=tuple(int(v) for v in srgb[i]),
            )
        dots = canvas.resize((side, side), Image.Resampling.LANCZOS)
        glow = dots.filter(
            ImageFilter.GaussianBlur(self._p.glow_sigma_ratio * pitch / _SUPERSAMPLE)
        )
        a = np.asarray(dots, dtype=np.float64) / _MAX_8BIT
        g = np.asarray(glow, dtype=np.float64) / _MAX_8BIT * self._p.glow_opacity
        screen = 1.0 - (1.0 - a) * (1.0 - g)
        return Image.fromarray(np.rint(screen * _MAX_8BIT).astype(np.uint8), "RGB")

    def draw_live(
        self,
        base: Array,
        srgb: npt.NDArray[np.uint8],
        radius_scale: Array,
        raster: Raster,
    ) -> npt.NDArray[np.uint8]:
        radius = self._p.radius_ratio * raster.pitch * radius_scale  # (N,) pixels
        coverage = np.clip((radius[raster.cell] - raster.dist) / _AA_PX + 0.5, 0.0, 1.0)
        coverage = np.where(raster.valid, coverage, 0.0)
        dots = (srgb[raster.cell].astype(np.float64) / _MAX_8BIT) * coverage[..., None]
        out = base * (1.0 - coverage[..., None]) + dots
        sigma = self._p.glow_sigma_ratio * raster.pitch
        glow = (
            np.asarray(
                Image.fromarray(np.rint(np.clip(out, 0, 1) * _MAX_8BIT).astype(np.uint8)).filter(
                    ImageFilter.GaussianBlur(sigma)
                ),
                dtype=np.float64,
            )
            / _MAX_8BIT
        )
        screen = 1.0 - (1.0 - out) * (1.0 - glow * self._p.glow_opacity)
        return np.asarray(np.rint(np.clip(screen, 0, 1) * _MAX_8BIT), dtype=np.uint8)

    def svg(self, srgb: npt.NDArray[np.uint8], n: int, side: int) -> str:
        pitch = side / (n + 2.0 * self._margin)
        radius = self._p.radius_ratio * pitch
        dots: list[str] = []
        for i in range(n * n):
            r, c = divmod(i, n)
            cx = (self._margin + c + 0.5) * pitch
            cy = (self._margin + r + 0.5) * pitch
            fill = "#{:02x}{:02x}{:02x}".format(*(int(v) for v in srgb[i]))
            dots.append(
                f'<circle cx="{cx:.{_SVG_PRECISION}f}" cy="{cy:.{_SVG_PRECISION}f}" '
                f'r="{radius:.{_SVG_PRECISION}f}" fill="{fill}"/>'
            )
        body = "\n".join(dots)
        sigma = self._p.glow_sigma_ratio * pitch
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{side}" height="{side}" viewBox="0 0 {side} {side}">\n'
            f'<defs>\n<filter id="glow" x="-5%" y="-5%" width="110%" height="110%">'
            f'<feGaussianBlur stdDeviation="{sigma:.{_SVG_PRECISION}f}"/></filter>\n'
            f'<g id="dots">\n{body}\n</g>\n</defs>\n'
            f'<rect width="{side}" height="{side}" fill="{self._bg_hex}"/>\n'
            f'<use xlink:href="#dots" href="#dots" filter="url(#glow)" '
            f'opacity="{self._p.glow_opacity}" style="mix-blend-mode:screen"/>\n'
            f'<use xlink:href="#dots" href="#dots"/>\n</svg>\n'
        )


def _make_dot(config: Config) -> NodeStyle:
    rc = config.render
    return DotNodeStyle(rc.node.dot, rc.margin_cells, rc.background)


_STYLES: dict[str, Callable[[Config], NodeStyle]] = {"dot": _make_dot}


def get_node_style(config: Config) -> NodeStyle:
    """The style selected by ``render.node.style``."""
    return _STYLES[config.render.node.style](config)
