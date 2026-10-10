from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from synesthesia.config import Config, load_config


def test_default_config_loads(config: Config) -> None:
    assert config.grid.size == 64
    assert config.n_cells == 4096
    assert config.layout_dim == 17
    assert config.fingerprint.length == 133


def test_hash_is_stable_and_hex(config: Config) -> None:
    again = load_config()
    assert config.hash() == again.hash()
    assert len(config.hash()) == 64
    assert config.canonical_json() == again.canonical_json()


@pytest.mark.determinism
def test_hash_stable_across_processes(config: Config) -> None:
    out = subprocess.run(
        [sys.executable, "-m", "synesthesia.cli", "config-hash"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert out == config.hash()


def test_hash_changes_with_value() -> None:
    base = load_config()
    changed = load_config(overrides={"som": {"epochs": 41}})
    assert base.hash() != changed.hash()


def test_unknown_key_rejected(tmp_path: Path, repo_root: Path) -> None:
    data = yaml.safe_load((repo_root / "config" / "default.yaml").read_text(encoding="utf-8"))
    data["som"]["epochz"] = 3
    bad = tmp_path / "bad.yaml"
    bad.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ValidationError):
        load_config(bad)


def test_inconsistent_weights_rejected() -> None:
    with pytest.raises(ValidationError):
        load_config(overrides={"layout": {"block_weights": {"timbre": 0.9}}})


def test_calibration_merged_when_present(tmp_path: Path, repo_root: Path) -> None:
    (tmp_path / "default.yaml").write_text(
        (repo_root / "config" / "default.yaml").read_text(encoding="utf-8"), encoding="utf-8"
    )
    base = load_config(tmp_path / "default.yaml")
    (tmp_path / "calibration.yaml").write_text(
        yaml.safe_dump({"color": {"ranges": {"loudness_dbfs": [-40.0, -8.0]}}}), encoding="utf-8"
    )
    cal = load_config(tmp_path / "default.yaml")
    assert cal.color.ranges.loudness_dbfs == (-40.0, -8.0)
    assert cal.color.ranges.centroid_log10_hz == base.color.ranges.centroid_log10_hz
    assert cal.hash() != base.hash()
    assert load_config(tmp_path / "default.yaml", use_calibration=False).hash() == base.hash()


def test_config_is_immutable(config: Config) -> None:
    with pytest.raises(ValidationError):
        config.seed = 1  # type: ignore[misc]
