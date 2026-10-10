"""Shared helpers for corpus scripts: manifest reading and audio lookup."""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "data" / "manifests" / "prototype_30.csv"
DEFAULT_AUDIO = ROOT / "data" / "audio" / "prototype_30"
AUDIO_SUFFIXES = (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".opus", ".aac")


@dataclass(frozen=True)
class Track:
    track_id: str
    title: str
    artist: str
    genre: str
    license: str
    path: Path


def read_tracks(manifest: Path, audio_dir: Path) -> list[Track]:
    """Tracks in manifest order; exits with a clear message if audio is missing."""
    tracks: list[Track] = []
    missing: list[str] = []
    with manifest.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            candidates = [audio_dir / f"{r['track_id']}{s}" for s in AUDIO_SUFFIXES]
            found = next((p for p in candidates if p.is_file()), None)
            if found is None:
                missing.append(r["track_id"])
                continue
            tracks.append(
                Track(r["track_id"], r["title"], r["artist"], r["genre_group"], r["license"], found)
            )
    if missing:
        sys.stderr.write(f"missing audio for {len(missing)} tracks, e.g. {missing[:3]}\n")
        raise SystemExit(2)
    return tracks
