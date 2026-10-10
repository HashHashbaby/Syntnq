from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import pytest
import yaml

from synesthesia.config import (
    CALIBRATION_META_KEY,
    Config,
    calibration_hash,
    load_config,
)
from synesthesia.evaluate import corpus_metrics, distance_matrix
from synesthesia.render import contact_sheet, render_sound_map, render_svg

K = 4096


def _srgb() -> np.ndarray:
    rng = np.random.default_rng(0)
    return rng.integers(0, 256, size=(K, 3), dtype=np.uint8)


def test_svg_has_4096_circles_and_is_deterministic(config: Config) -> None:
    svg = render_svg(_srgb(), config)
    assert svg == render_svg(_srgb(), config)
    root = ET.fromstring(svg)
    ns = "{http://www.w3.org/2000/svg}"
    assert len(root.findall(f".//{ns}circle")) == K
    assert root.find(f".//{ns}feGaussianBlur") is not None


def test_contact_sheet_geometry(config: Config) -> None:
    img = render_sound_map(_srgb(), config, 128)
    sheet = contact_sheet([(img, f"t{i}") for i in range(5)], cols=3, tile_px=64)
    assert sheet.size[0] == 3 * (64 + 8) + 8
    assert sheet.size[1] == 2 * (64 + 28 + 8) + 8


def test_calibration_meta_is_ignored_by_config_but_hashed(tmp_path: Path, repo_root: Path) -> None:
    (tmp_path / "default.yaml").write_text(
        (repo_root / "config" / "default.yaml").read_text(encoding="utf-8"), encoding="utf-8"
    )
    base = load_config(tmp_path / "default.yaml")
    doc = {
        "color": {"ranges": {"loudness_dbfs": [-45.0, -15.0]}},
        CALIBRATION_META_KEY: {"n_tracks": 30},
    }
    (tmp_path / "calibration.yaml").write_text(yaml.safe_dump(doc), encoding="utf-8")
    cal = load_config(tmp_path / "default.yaml")
    assert cal.color.ranges.loudness_dbfs == (-45.0, -15.0)
    assert cal.hash() != base.hash()
    h1 = calibration_hash(tmp_path / "default.yaml")
    assert h1 is not None and len(h1) == 64
    doc[CALIBRATION_META_KEY]["n_tracks"] = 31
    (tmp_path / "calibration.yaml").write_text(yaml.safe_dump(doc), encoding="utf-8")
    assert calibration_hash(tmp_path / "default.yaml") != h1


def test_corpus_metrics_on_a_toy_distance_matrix() -> None:
    # two genres of three tracks each; within-genre distances small, between large
    labels = ["a"] * 3 + ["b"] * 3
    d = np.full((6, 6), 0.6)
    d[:3, :3] = 0.1
    d[3:, 3:] = 0.1
    d[2, 1] = d[1, 2] = 0.01  # a near-duplicate inside genre a
    d[4, 0] = d[0, 4] = 0.04  # a cross-genre near-duplicate
    np.fill_diagonal(d, 0.0)
    m = corpus_metrics(d, labels)
    assert m.nn_accuracy == pytest.approx(4 / 6)  # tracks 0 and 4 are each other's nearest
    assert m.within_mean < m.between_mean
    assert len(m.near_duplicates) == 2 and m.cross_genre_near_duplicates == 1


def test_distance_matrix_is_symmetric_with_zero_diagonal(config: Config) -> None:
    rng = np.random.default_rng(1)
    fps = np.zeros((4, config.fingerprint.length), dtype=np.float32)
    for i in range(4):
        for b in range(5):
            h = rng.random(16)
            fps[i, b * 16 : (b + 1) * 16] = h / h.sum()
        h = rng.random(48)
        fps[i, 80:128] = h / h.sum()
    d = distance_matrix(fps, config)
    assert np.allclose(d, d.T) and np.allclose(np.diag(d), 0.0)
    assert d[0, 1] > 0.0
