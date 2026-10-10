from __future__ import annotations

import numpy as np

from synesthesia.config import Config, load_config
from synesthesia.orient import TRANSFORMS, apply_transform, orient
from synesthesia.som import bmu_search, pca_init, train_som, training_subset
from synesthesia.standardize import LayoutSpace, layout_columns

SIZE = 64


def test_training_subset_stride() -> None:
    x = np.arange(100.0)[:, None]
    assert training_subset(x, 100).shape[0] == 100
    s = training_subset(x, 40)  # stride ceil(100 / 40) = 3
    assert s.shape[0] == 34 and s[1, 0] == 3.0


def test_bmu_ties_resolve_to_lowest_index() -> None:
    w = np.array([[0.0, 0.0], [1.0, 1.0], [1.0, 1.0]])
    idx, dist, second = bmu_search(np.array([[1.0, 1.0]]), w, chunk=8, second=True)
    assert idx[0] == 1 and second is not None and second[0] == 2 and dist[0] == 0.0


def test_pca_init_is_centered_and_deterministic() -> None:
    rng = np.random.default_rng(0)
    x = rng.standard_normal((500, 5)) * np.array([3.0, 2.0, 1.0, 0.5, 0.1])
    a, b = pca_init(x, 8), pca_init(x, 8)
    assert np.array_equal(a, b)
    assert a.shape == (64, 5)
    assert np.allclose(a.mean(axis=0), x.mean(axis=0), atol=1e-9)


def test_som_trains_deterministically_and_beats_init() -> None:
    rng = np.random.default_rng(1)
    centers = rng.standard_normal((5, 17)) * 2.0
    x = np.concatenate([c + 0.1 * rng.standard_normal((300, 17)) for c in centers])
    cfg = load_config(overrides={"som": {"epochs": 10}})
    r1, r2 = train_som(x, cfg), train_som(x, cfg)
    assert np.array_equal(r1.prototypes, r2.prototypes)
    assert np.array_equal(r1.bmu, r2.bmu)
    _, d0, _ = bmu_search(x, pca_init(x, cfg.grid.size), cfg.som.frame_chunk)
    assert r1.quantization_error < d0.mean()
    assert 0.0 <= r1.topographic_error <= 1.0 and 0.0 <= r1.empty_units <= 1.0
    assert r1.bmu.dtype == np.uint16


def test_orientation_is_invariant_to_rotating_the_map(config: Config) -> None:
    d = config.layout_dim
    cols = layout_columns(config)
    rng = np.random.default_rng(3)
    rr, cc = np.meshgrid(np.arange(SIZE), np.arange(SIZE), indexing="ij")
    grid = 0.05 * rng.standard_normal((SIZE, SIZE, d))
    grid[:, :, cols["brightness"].start] += -0.02 * rr + 0.005 * cc  # brighter toward the top
    grid[:, :, cols["loudness"].start] += 0.02 * cc + 0.003 * rr  # louder toward the right
    space = LayoutSpace(grid.reshape(-1, d), np.zeros(d), np.ones(d), np.ones(d))
    index = np.arange(SIZE * SIZE).reshape(SIZE, SIZE)
    frames = rng.integers(0, SIZE * SIZE, size=200).astype(np.uint16)

    ref = orient(grid.reshape(-1, d), frames, space, config)
    assert ref.transform == "identity"
    for name in TRANSFORMS:
        moved = np.ascontiguousarray(apply_transform(grid, name))
        moved_index = np.ascontiguousarray(apply_transform(index, name)).ravel()
        old_to_moved = np.empty_like(moved_index)
        old_to_moved[moved_index] = np.arange(moved_index.size)
        got = orient(moved.reshape(-1, d), old_to_moved[frames].astype(np.uint16), space, config)
        assert np.array_equal(got.prototypes, ref.prototypes), name
        assert np.array_equal(got.bmu, ref.bmu), name
