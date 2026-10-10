from __future__ import annotations

from pathlib import Path

import pytest

from synesthesia.config import Config, load_config
from synesthesia.pipeline import SongResult, analyze


@pytest.fixture(scope="session")
def config() -> Config:
    return load_config()


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def wavs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Synthetic fixture WAVs written once per test session."""
    from fixtures import make_signals

    return make_signals.write_all(tmp_path_factory.mktemp("wavs"))


class _LazyResults(dict[str, SongResult]):
    """name -> analysis result, computed on first access."""

    def __init__(self, wavs: dict[str, Path], config: Config) -> None:
        super().__init__()
        self._wavs, self._config = wavs, config

    def __missing__(self, name: str) -> SongResult:
        self[name] = analyze(self._wavs[name], self._config)
        return self[name]


@pytest.fixture(scope="session")
def results(wavs: dict[str, Path], config: Config) -> dict[str, SongResult]:
    """Lazily analyzed fixture results (cache shared across tests)."""
    return _LazyResults(wavs, config)
