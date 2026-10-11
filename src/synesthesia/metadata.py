"""Optional descriptive metadata of a song (docs/ANALYSIS.md section 11, docs/API.md section 1).

All fields are nullable and never affect any array: they are carried through ``signature.json``,
the API and the library for later features (comparison, atlas views, research), see D-041.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from synesthesia.config import Config

FIELDS = ("title", "artist", "genre", "release_year", "source", "chart_peak", "chart_weeks")


@dataclass(frozen=True)
class SongMetadata:
    """Descriptive fields. ``chart_*`` are for exploratory research only (D-014)."""

    title: str | None = None
    artist: str | None = None
    genre: str | None = None
    release_year: int | None = None
    source: str | None = None
    chart_peak: int | None = None
    chart_weeks: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SongMetadata:
        """Build from a stored dict, ignoring unknown keys."""
        return cls(**{k: d.get(k) for k in FIELDS})

    @classmethod
    def parse(cls, raw: dict[str, str | None], config: Config) -> SongMetadata:
        """Validate user-supplied strings (form fields).

        Args:
            raw: field name -> string or ``None``/empty for "not given".
            config: resolved configuration (``api.metadata_*`` limits).

        Raises:
            ValueError: a field is too long, not an integer, or out of range.
        """
        api = config.api
        out: dict[str, Any] = {}
        for k in FIELDS:
            v = raw.get(k)
            v = v.strip() if isinstance(v, str) else v
            if v in (None, ""):
                out[k] = None
            elif k in ("release_year", "chart_peak", "chart_weeks"):
                try:
                    out[k] = int(v)
                except ValueError as exc:
                    raise ValueError(f"{k} must be an integer") from exc
            else:
                if len(v) > api.metadata_max_len:
                    raise ValueError(f"{k} is longer than {api.metadata_max_len} characters")
                out[k] = v
        lo, hi = api.metadata_year_range
        if out["release_year"] is not None and not lo <= out["release_year"] <= hi:
            raise ValueError(f"release_year must be {lo}-{hi}")
        if out["chart_peak"] is not None and out["chart_peak"] < 1:
            raise ValueError("chart_peak must be >= 1")
        if out["chart_weeks"] is not None and out["chart_weeks"] < 0:
            raise ValueError("chart_weeks must be >= 0")
        return cls(**out)
