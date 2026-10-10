"""Download the tracks listed in ``data/manifests/prototype_30.csv`` (one HTTP GET per track).

Refuses to run without ``--yes`` (project rule: ask before downloading). Files go to
``data/audio/prototype_30/<track_id>.mp3`` (git-ignored). The size is checked against the
manifest's ``content_length``; the SHA-256 is written back to the manifest on first download and
verified on every later run. Uses only the standard library.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "manifests" / "prototype_30.csv"
AUDIO_DIR = ROOT / "data" / "audio" / "prototype_30"
URL = "https://mp3d.jamendo.com/download/track/{id}/mp32/"
PAUSE_S = 1.0  # be polite to the host between requests
CHUNK = 1 << 16


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--yes", action="store_true", help="confirm the download")
    ap.add_argument("--manifest", type=Path, default=MANIFEST)
    ap.add_argument("--audio-dir", type=Path, default=AUDIO_DIR)
    args = ap.parse_args()

    with args.manifest.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    total_mb = sum(int(r["content_length"]) for r in rows) / 1e6
    sys.stdout.write(f"{len(rows)} tracks, about {total_mb:.0f} MB -> {args.audio_dir}\n")
    if not args.yes:
        sys.stdout.write("dry run: pass --yes to download\n")
        return 0

    args.audio_dir.mkdir(parents=True, exist_ok=True)
    failures = 0
    for r in rows:
        numeric = int(r["track_id"].split("_")[1])
        target = args.audio_dir / f"{r['track_id']}.mp3"
        if not target.is_file():
            tmp = target.with_suffix(".part")
            with urllib.request.urlopen(URL.format(id=numeric), timeout=60) as resp:  # noqa: S310
                tmp.write_bytes(resp.read())
            tmp.replace(target)
            time.sleep(PAUSE_S)
        size = target.stat().st_size
        digest = _sha256(target)
        if size != int(r["content_length"]):
            sys.stderr.write(f"size mismatch {r['track_id']}: {size} != {r['content_length']}\n")
            failures += 1
        if r["sha256"] and r["sha256"] != digest:
            sys.stderr.write(f"checksum mismatch {r['track_id']}\n")
            failures += 1
        r["sha256"] = r["sha256"] or digest
        sys.stdout.write(f"ok {r['track_id']} {size} bytes {digest[:12]}\n")

    with args.manifest.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
