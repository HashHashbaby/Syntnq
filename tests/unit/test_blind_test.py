"""Blind-test stimulus selection and trial plans (docs/DATA_RESEARCH.md section 4)."""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "blind_test"))
from plan import Song, make_plan, select_stimuli  # noqa: E402

from synesthesia.config import Config  # noqa: E402


@pytest.fixture(scope="module")
def songs(config: Config) -> list[Song]:
    out = []
    for g in config.blind_test.songs_per_group:
        for i in range(6):
            # two tracks per artist, as in the real corpus
            out.append(Song(f"{g[:3]}_{i}", f"t{i}", f"{g[:3]}_artist{i // 2}", g, "CC BY", 200.0))
    return out


def test_stimuli_follow_the_group_counts_and_one_per_artist(
    songs: list[Song], config: Config
) -> None:
    st = select_stimuli(songs, config)
    assert len(st) == 12
    counts = Counter(s.genre for s in st)
    assert dict(counts) == config.blind_test.songs_per_group
    assert len({(s.genre, s.artist) for s in st}) == len(st)
    assert select_stimuli(songs, config) == st  # deterministic


def test_plans_are_valid_for_every_participant(songs: list[Song], config: Config) -> None:
    bt = config.blind_test
    st = select_stimuli(songs, config)
    stim_ids = {s.track_id for s in st}
    genre = {s.track_id: s.genre for s in songs}
    for p in range(1, bt.n_participant_plans + 1):
        plan = make_plan(p, songs, st, config)
        assert [t.song for t in sorted(plan, key=lambda t: t.song)] == sorted(stim_ids)
        assert sum(t.same_genre_foil for t in plan) == bt.same_genre_trials
        for t in plan:
            assert len(t.options) == len(set(t.options)) == bt.n_options
            assert t.options[t.correct_pos] == t.song
            foils = [o for o in t.options if o != t.song]
            assert not (set(foils) & stim_ids)  # no foil is another trial's answer
            same = [o for o in foils if genre[o] == genre[t.song]]
            assert len(same) == (1 if t.same_genre_foil else 0)
        assert make_plan(p, songs, st, config) == plan  # deterministic


def test_plans_differ_between_participants_and_balance_positions(
    songs: list[Song], config: Config
) -> None:
    st = select_stimuli(songs, config)
    plans = [
        make_plan(p, songs, st, config) for p in range(1, config.blind_test.n_participant_plans + 1)
    ]
    assert len({tuple(t.song for t in p) for p in plans}) > 10
    pos = Counter(t.correct_pos for p in plans for t in p)
    total = sum(pos.values())
    for k in range(config.blind_test.n_options):
        assert abs(pos[k] / total - 1 / config.blind_test.n_options) < 0.05


def test_analysis_reports_accuracy_and_the_gate(
    songs: list[Song], config: Config, tmp_path: Path
) -> None:
    import csv
    import subprocess

    import numpy as np

    st = select_stimuli(songs, config)
    cols = [
        "participant", "age_band", "training", "trial", "song_id", "genre", "same_genre_foil",
        "correct_pos", "chosen_pos", "chosen_song_id", "correct", "rt_ms",
    ]  # fmt: skip
    rng = np.random.default_rng(0)

    def write(folder: Path, p_correct: float) -> None:
        folder.mkdir()
        for p in range(1, 11):
            with (folder / f"synesthesia_blind_{p}.csv").open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(cols)
                for i, t in enumerate(make_plan(p, songs, st, config), start=1):
                    ok = int(rng.random() < p_correct)
                    pos = t.correct_pos if ok else (t.correct_pos + 1) % len(t.options)
                    genre = next(s.genre for s in songs if s.track_id == t.song)
                    w.writerow([str(p), "", "", i, t.song, genre, int(t.same_genre_foil),
                                t.correct_pos, pos, t.options[pos], ok, 1000])  # fmt: skip

    script = Path(__file__).resolve().parents[2] / "scripts" / "blind_test" / "analyze.py"
    write(tmp_path / "good", 0.9)
    write(tmp_path / "chance", 0.25)
    good = subprocess.run([sys.executable, str(script), str(tmp_path / "good")],
                          capture_output=True, text=True, check=True).stdout  # fmt: skip
    bad = subprocess.run([sys.executable, str(script), str(tmp_path / "chance")],
                         capture_output=True, text=True, check=True).stdout  # fmt: skip
    assert "PASS" in good and "participants 10, trials 120" in good
    assert "NOT MET" in bad
