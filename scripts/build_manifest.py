"""Build ``data/manifests/prototype_30.csv`` from MTG-Jamendo metadata (docs/DATA_RESEARCH.md §2).

Deterministic selection: tracks of 120-420 s whose *only* genre tag belongs to a group, sorted
by numeric track ID, first ``PER_GROUP`` per group (at most ``MAX_PER_ARTIST`` per artist)
whose license is CC BY or CC BY-SA and whose Jamendo download still answers a HEAD request.
No audio is downloaded here.

Inputs (git-ignored, fetched once from the MTG-Jamendo repository):
    data/meta/autotagging_genre.tsv, data/meta/raw.meta.tsv, data/meta/audio_licenses.txt
"""

from __future__ import annotations

import csv
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / "data" / "meta"
OUT = ROOT / "data" / "manifests" / "prototype_30.csv"

GROUPS: dict[str, tuple[str, ...]] = {
    "ambient_classical": ("ambient", "classical"),
    "rock_metal": ("rock", "metal", "hardrock", "punkrock", "heavymetal"),
    "electronic_dance": ("electronic", "dance", "techno", "house", "trance"),
    "hiphop_rnb": ("hiphop", "rap", "rnb"),
    "folk_acoustic_jazz": ("folk", "jazz", "singersongwriter", "blues"),
}
MIN_S, MAX_S, PER_GROUP = 120.0, 420.0, 6
MAX_PER_ARTIST = 2  # deterministic diversity cap (deviation from the spec text, see D-019)
ALLOWED_LICENSES = {"by", "by-sa"}
DOWNLOAD_URL = "https://mp3d.jamendo.com/download/track/{id}/mp32/"
COLUMNS = [
    "track_id", "title", "artist", "genre_group", "duration_s",
    "license", "license_url", "source_url", "content_length", "sha256",
]  # fmt: skip


def parse_licenses(path: Path) -> dict[int, tuple[str, str]]:
    """track id -> (license code such as 'by-sa', license url)."""
    out: dict[int, tuple[str, str]] = {}
    track: int | None = None
    pattern = re.compile(r"licenses/([a-z\-]+)/([0-9.]+)")
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.fullmatch(r"\d+/(\d+)\.mp3", line.strip())
        if m:
            track = int(m.group(1))
        elif line.startswith("Available under") and track is not None:
            url = line.rsplit(" ", 1)[-1]
            lm = pattern.search(url)
            if lm:
                out[track] = (lm.group(1), url)
    return out


def head_ok(url: str) -> int | None:
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 - fixed https host
            if resp.status == 200 and resp.headers.get("Content-Type", "").startswith("audio"):
                return int(resp.headers.get("Content-Length", "0"))
    except OSError:
        return None
    return None


def main() -> int:
    meta: dict[str, tuple[str, str]] = {}
    with (META / "raw.meta.tsv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            meta[row["TRACK_ID"]] = (row["TRACK_NAME"], row["ARTIST_NAME"])
    licenses = parse_licenses(META / "audio_licenses.txt")

    candidates: dict[str, list[tuple[int, str, float]]] = {g: [] for g in GROUPS}
    with (META / "autotagging_genre.tsv").open(encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        next(reader)
        for row in reader:
            genres = [t.split("---", 1)[1] for t in row[5:] if t.startswith("genre---")]
            duration = float(row[4])
            if len(genres) != 1 or not MIN_S <= duration <= MAX_S:
                continue
            for group, members in GROUPS.items():
                if genres[0] in members:
                    candidates[group].append((int(row[0].split("_")[1]), row[0], duration))

    rows: list[dict[str, str]] = []
    for group in GROUPS:
        taken = 0
        per_artist: dict[str, int] = {}
        for numeric_id, track_id, duration in sorted(candidates[group]):
            lic = licenses.get(numeric_id)
            if lic is None or lic[0] not in ALLOWED_LICENSES or track_id not in meta:
                continue
            if per_artist.get(meta[track_id][1], 0) >= MAX_PER_ARTIST:
                continue
            url = DOWNLOAD_URL.format(id=numeric_id)
            length = head_ok(url)
            if length is None:
                continue
            title, artist = meta[track_id]
            per_artist[artist] = per_artist.get(artist, 0) + 1
            rows.append(
                {
                    "track_id": track_id, "title": title, "artist": artist,
                    "genre_group": group, "duration_s": f"{duration:.1f}",
                    "license": f"CC {lic[0].upper()}", "license_url": lic[1],
                    "source_url": f"https://www.jamendo.com/track/{numeric_id}",
                    "content_length": str(length), "sha256": "",
                }
            )  # fmt: skip
            taken += 1
            if taken == PER_GROUP:
                break
        if taken < PER_GROUP:
            sys.stderr.write(f"warning: only {taken} tracks for {group}\n")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    total_mb = sum(int(r["content_length"]) for r in rows) / 1e6
    sys.stdout.write(f"{len(rows)} tracks, {total_mb:.0f} MB total -> {OUT}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
