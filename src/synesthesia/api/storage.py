"""Output storage, retention and audio deletion (docs/API.md section 4).

Layout::

    <root>/uploads/<job_id>.<ext>             deleted right after ingest unless keep_audio
    <root>/songs/<song_id>/<config_hash_12>/  same files as out/<song_id>/ (docs/ANALYSIS.md 11)
    <root>/jobs.sqlite                        job records (see jobs.py)
"""

from __future__ import annotations

import json
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from synesthesia.metadata import SongMetadata

_SONG_ID = re.compile(r"^[0-9a-f]{16}$")
_JOB_ID = re.compile(r"^[0-9a-f]{32}$")
_SECONDS_PER_DAY = 86400.0
_META_NAME = "meta.json"


def valid_song_id(song_id: str) -> bool:
    """Song IDs are 16 hex characters; anything else is rejected (no path traversal)."""
    return bool(_SONG_ID.match(song_id))


def valid_job_id(job_id: str) -> bool:
    return bool(_JOB_ID.match(job_id))


@dataclass(frozen=True)
class SongMeta:
    """Library entry: descriptive metadata plus the fingerprint (docs/API.md section 1)."""

    song_id: str
    metadata: SongMetadata
    duration_s: float
    created_at: float
    fingerprint: list[float] | None = None

    def as_dict(self, *, include_fingerprint: bool = False) -> dict[str, Any]:
        d: dict[str, Any] = {
            "song_id": self.song_id,
            **self.metadata.as_dict(),
            "duration_s": self.duration_s,
            "created_at": self.created_at,
        }
        if include_fingerprint:
            d["fingerprint"] = self.fingerprint
        return d


class Storage:
    """Filesystem storage for uploads and analysis outputs."""

    def __init__(self, root: Path, config_hash12: str) -> None:
        self.root = Path(root)
        self.config_hash12 = config_hash12
        self.uploads = self.root / "uploads"
        self.songs = self.root / "songs"
        self.db_path = self.root / "jobs.sqlite"
        self.uploads.mkdir(parents=True, exist_ok=True)
        self.songs.mkdir(parents=True, exist_ok=True)

    # -- songs ---------------------------------------------------------------------------------
    def song_dir(self, song_id: str) -> Path:
        """Directory of a song's outputs for the current config."""
        if not valid_song_id(song_id):
            raise ValueError(f"invalid song id {song_id!r}")
        return self.songs / song_id / self.config_hash12

    def has_song(self, song_id: str) -> bool:
        return valid_song_id(song_id) and (self.song_dir(song_id) / "signature.json").is_file()

    def write_meta(
        self,
        song_id: str,
        metadata: SongMetadata,
        duration_s: float,
        fingerprint: list[float] | None = None,
    ) -> None:
        doc = {
            "song_id": song_id,
            **metadata.as_dict(),
            "duration_s": duration_s,
            "created_at": time.time(),
            "fingerprint": fingerprint,
        }
        (self.song_dir(song_id) / _META_NAME).write_text(json.dumps(doc), encoding="utf-8")

    def read_meta(self, song_id: str) -> SongMeta | None:
        path = self.song_dir(song_id) / _META_NAME
        if not path.is_file():
            return None
        d = json.loads(path.read_text(encoding="utf-8"))
        return SongMeta(
            song_id=d["song_id"],
            metadata=SongMetadata.from_dict(d),
            duration_s=float(d["duration_s"]),
            created_at=float(d["created_at"]),
            fingerprint=d.get("fingerprint"),
        )

    def list_songs(self) -> list[SongMeta]:
        out = []
        for d in sorted(self.songs.iterdir()):
            if valid_song_id(d.name) and self.has_song(d.name):
                meta = self.read_meta(d.name)
                if meta is not None:
                    out.append(meta)
        return sorted(out, key=lambda m: m.created_at, reverse=True)

    def page(
        self, *, limit: int, offset: int, query: str | None = None, sort: str = "recent"
    ) -> tuple[list[SongMeta], int]:
        """One page of the library and the total number of matches.

        Args:
            limit: page size.
            offset: first item.
            query: case-insensitive substring over title, artist and genre.
            sort: ``recent`` (newest first) or ``title``.
        """
        items = self.list_songs()
        if query:
            q = query.lower()
            items = [
                m
                for m in items
                if any(
                    q in (v or "").lower()
                    for v in (m.metadata.title, m.metadata.artist, m.metadata.genre)
                )
            ]
        if sort == "title":
            items.sort(key=lambda m: ((m.metadata.title or "").lower(), m.song_id))
        return items[offset : offset + limit], len(items)

    def delete_song(self, song_id: str) -> bool:
        """Delete every output of a song (all config hashes). Returns whether anything existed."""
        if not valid_song_id(song_id):
            return False
        target = self.songs / song_id
        if not target.is_dir():
            return False
        shutil.rmtree(target)
        return True

    # -- uploads -------------------------------------------------------------------------------
    def upload_path(self, job_id: str, suffix: str) -> Path:
        if not valid_job_id(job_id):
            raise ValueError(f"invalid job id {job_id!r}")
        return self.uploads / f"{job_id}.{suffix.lstrip('.').lower()}"

    def delete_upload(self, path: Path) -> None:
        path.unlink(missing_ok=True)

    # -- retention -----------------------------------------------------------------------------
    def cleanup(self, retention_days: int, now: float | None = None) -> list[str]:
        """Delete songs older than ``retention_days``; returns the removed song IDs."""
        t = time.time() if now is None else now
        cutoff = t - retention_days * _SECONDS_PER_DAY
        removed = []
        for meta in self.list_songs():
            if meta.created_at < cutoff and self.delete_song(meta.song_id):
                removed.append(meta.song_id)
        return removed

    def purge_stale_uploads(self) -> int:
        """Remove upload files left behind by a crash."""
        n = 0
        for p in self.uploads.iterdir():
            if p.is_file():
                p.unlink()
                n += 1
        return n
