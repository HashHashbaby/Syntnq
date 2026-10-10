from __future__ import annotations

import numpy as np
import numpy.typing as npt

from synesthesia.color import map_colors
from synesthesia.config import Config
from synesthesia.fingerprint import compute_fingerprint, distance
from synesthesia.occupancy import cell_statistics

K = 4096
Array = npt.NDArray[np.float64]


def _toy() -> tuple[npt.NDArray[np.uint16], Array, Array]:
    rng = np.random.default_rng(0)
    bmu = rng.integers(0, 200, size=1000).astype(np.uint16)  # only the first 200 cells are hit
    f_color = np.column_stack(
        [
            rng.uniform(2.5, 3.5, 1000),
            rng.uniform(-40, -10, 1000),
            rng.uniform(-3, -1, 1000),
            rng.uniform(0, 1, 1000),
            rng.uniform(0, 2, 1000),
        ]
    )
    proto = np.tile([3.0, -25.0, -2.0, 1.0], (K, 1))
    return bmu, f_color, proto


def test_cell_statistics(config: Config) -> None:
    bmu, f_color, proto = _toy()
    s = cell_statistics(bmu, f_color, proto, config)
    assert s.hits.sum() == 1000 and s.hits.dtype == np.uint32
    assert s.occ_norm.max() == 1.0 and s.occ_norm.min() >= 0.0
    c = int(bmu[0])
    assert np.isclose(s.cell_features[0, c], f_color[bmu == c, 0].mean())
    empty_cell = K - 1
    assert s.hits[empty_cell] == 0
    assert s.cell_features[0, empty_cell] == 3.0  # prototype brightness
    assert s.cell_features[1, empty_cell] == -25.0
    assert s.empty[empty_cell]


def test_fingerprint_blocks_and_distance(config: Config) -> None:
    bmu, f_color, proto = _toy()
    s = cell_statistics(bmu, f_color, proto, config)
    colors = map_colors(s.cell_features, s.occ_norm, s.empty, config)
    fp = compute_fingerprint(f_color, s.hits, colors, config)
    n = config.fingerprint.hist_bins
    assert fp.shape == (config.fingerprint.length,) == (133,) and fp.dtype == np.float32
    for i in range(5):
        assert abs(fp[i * n : (i + 1) * n].sum() - 1.0) < 1e-5
    assert abs(fp[5 * n : 5 * n + 48].sum() - 1.0) < 1e-5
    assert np.all(fp[-5:] == 0.0)  # scalars arrive in M4

    other = fp.copy()
    other[:n] = np.roll(other[:n], 5)
    assert distance(fp, fp, config) == 0.0
    assert distance(fp, other, config) == distance(other, fp, config) > 0.0
    assert distance(fp, other, config) <= 1.0
