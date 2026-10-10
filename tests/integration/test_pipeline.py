from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from synesthesia.config import Config
from synesthesia.fingerprint import distance
from synesthesia.io import read_arrays, read_signature, write_result
from synesthesia.pipeline import SongResult
from synesthesia.render import render_sound_map, save_png


def test_arrays_match_the_spec(
    results: dict[str, SongResult], config: Config, tmp_path: Path
) -> None:
    r = results["aba_song"]
    song_dir = write_result(r, tmp_path, config.grid.size)
    a = read_arrays(song_dir / "arrays.npz")
    k, d = config.n_cells, config.layout_dim
    expect = {
        "prototypes": ((k, d), np.float32),
        "std_mean": ((d,), np.float64),
        "std_scale": ((d,), np.float64),
        "block_weights": ((d,), np.float64),
        "hits": ((k,), np.uint32),
        "occ_norm": ((k,), np.float32),
        "cell_features": ((5, k), np.float32),
        "color_oklch": ((k, 3), np.float32),
        "color_srgb": ((k, 3), np.uint8),
        "feature_grids": ((5, 64, 64), np.float32),
        "fingerprint": ((133,), np.float32),
    }
    assert set(a) == set(expect)
    for name, (shape, dtype) in expect.items():
        assert a[name].shape == shape and a[name].dtype == dtype, name
    assert int(a["hits"].sum()) == r.n_frames
    sig = read_signature(song_dir / "signature.json")
    assert sig["song"]["id"] == r.song_id and sig["grid"]["frames"] == r.n_frames
    assert sig["fingerprint_complete"] is False
    assert sig["config_hash"] == f"sha256:{config.hash()}"
    assert (song_dir / "log.json").is_file()


def test_aba_song_has_two_distinct_regions(results: dict[str, SongResult]) -> None:
    r = results["aba_song"]
    assert r.som.topographic_error < 0.15
    hue = r.colors.oklch[r.stats.hits > 0, 2]
    assert hue.max() - hue.min() > 20.0  # warm noisy B vs cool pad A


def test_fingerprints_differ_between_songs(results: dict[str, SongResult], config: Config) -> None:
    sweep, chord = results["sine_sweep"], results["chord"]
    assert distance(sweep.fingerprint, chord.fingerprint, config) > 0.05


def test_render_is_deterministic(
    results: dict[str, SongResult], config: Config, tmp_path: Path
) -> None:
    r = results["chord"]
    img = render_sound_map(r.colors.srgb, config)
    assert img.size == (config.render.preview_px,) * 2
    meta = {"song_id": r.song_id, "pipeline_version": r.pipeline_version}
    save_png(img, tmp_path / "a.png", meta)
    save_png(render_sound_map(r.colors.srgb, config), tmp_path / "b.png", meta)
    assert (tmp_path / "a.png").read_bytes() == (tmp_path / "b.png").read_bytes()


@pytest.mark.determinism
def test_analyze_is_byte_identical_across_fresh_processes(
    wavs: dict[str, Path], tmp_path: Path
) -> None:
    digests = []
    for i in range(2):
        out = tmp_path / f"run{i}"
        cmd = [sys.executable, "-m", "synesthesia.cli", "analyze", str(wavs["aba_song"])]
        subprocess.run([*cmd, "--out", str(out)], check=True, capture_output=True)
        (song_dir,) = list(out.iterdir())
        digests.append(
            (
                song_dir.name,
                *(
                    hashlib.sha256((song_dir / rel).read_bytes()).hexdigest()
                    for rel in ("arrays.npz", "signature.json", "renders/sound_map.png")
                ),
            )
        )
    assert digests[0] == digests[1]
