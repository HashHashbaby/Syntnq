"""Stimulus selection and per-participant trial plans (docs/DATA_RESEARCH.md section 4).

Pure functions: the same config and manifest always give the same stimuli and plans. The static
page only renders a plan; it makes no random choices, so analysis can reconstruct every trial.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from synesthesia.config import Config


@dataclass(frozen=True)
class Song:
    track_id: str
    title: str
    artist: str
    genre: str
    license: str
    duration_s: float


@dataclass(frozen=True)
class Trial:
    """One trial: play the clip of ``song``, pick its signature among ``options``."""

    song: str
    options: tuple[str, ...]  # track ids, shuffled
    correct_pos: int
    same_genre_foil: bool


def select_stimuli(songs: list[Song], config: Config) -> list[Song]:
    """Deterministic stimulus songs: ``songs_per_group`` per genre, one per artist."""
    bt = config.blind_test
    rng = np.random.default_rng([config.seed, 1])
    chosen: list[Song] = []
    for genre, count in bt.songs_per_group.items():
        pool = sorted((s for s in songs if s.genre == genre), key=lambda s: s.track_id)
        order = rng.permutation(len(pool))
        per_artist: dict[str, int] = {}
        picked: list[Song] = []
        for i in order:
            s = pool[int(i)]
            if per_artist.get(s.artist, 0) >= bt.max_per_artist:
                continue
            per_artist[s.artist] = per_artist.get(s.artist, 0) + 1
            picked.append(s)
            if len(picked) == count:
                break
        if len(picked) < count:
            raise ValueError(f"not enough songs with distinct artists in {genre}")
        chosen.extend(sorted(picked, key=lambda s: s.track_id))
    return chosen


def make_plan(
    participant: int, songs: list[Song], stimuli: list[Song], config: Config
) -> list[Trial]:
    """Trial list for one participant number (>= 1).

    Foils are drawn from songs that are not stimuli, so no foil is another trial's answer.
    Exactly ``same_genre_trials`` trials get one same-genre foil; the remaining foils come from
    other genre groups.
    """
    bt = config.blind_test
    rng = np.random.default_rng([config.seed, 2, participant])
    stim_ids = {s.track_id for s in stimuli}
    pool = sorted((s for s in songs if s.track_id not in stim_ids), key=lambda s: s.track_id)
    order = [stimuli[int(i)] for i in rng.permutation(len(stimuli))]
    same_flags = np.zeros(len(order), dtype=bool)
    same_flags[rng.permutation(len(order))[: bt.same_genre_trials]] = True

    trials: list[Trial] = []
    for song, same in zip(order, same_flags, strict=True):
        same_pool = [s for s in pool if s.genre == song.genre]
        other_pool = [s for s in pool if s.genre != song.genre]
        foils: list[Song] = []
        if same:
            foils.append(same_pool[int(rng.integers(len(same_pool)))])
        n_other = bt.n_options - 1 - len(foils)
        other_genres = sorted({s.genre for s in other_pool})
        # spread other foils over different genre groups when possible
        for g in rng.permutation(len(other_genres))[:n_other]:
            cands = [s for s in other_pool if s.genre == other_genres[int(g)]]
            foils.append(cands[int(rng.integers(len(cands)))])
        while len(foils) < bt.n_options - 1:
            extra = other_pool[int(rng.integers(len(other_pool)))]
            if extra not in foils:
                foils.append(extra)
        options = [song, *foils]
        perm = rng.permutation(len(options))
        shuffled = tuple(options[int(i)].track_id for i in perm)
        trials.append(Trial(song.track_id, shuffled, shuffled.index(song.track_id), bool(same)))
    return trials
