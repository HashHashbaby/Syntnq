"""Build the static blind-test page (M5): ``out/blind_test/`` with index.html, clips/ and sigs/.

Needs the 30-track corpus audio (``data/audio/prototype_30``). Signatures are the 32 x 32 sound
maps of the current pipeline. The output folder is self-contained (no server, no network) and is
git-ignored; share it only with attribution (the page lists it) and the licence limits of
docs/DATA_RESEARCH.md section 2.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "scripts"))

from _corpus import DEFAULT_AUDIO, DEFAULT_MANIFEST, read_tracks  # noqa: E402
from plan import Song, make_plan, select_stimuli  # noqa: E402

from synesthesia.config import Config, load_config  # noqa: E402
from synesthesia.io import result_arrays  # noqa: E402
from synesthesia.pipeline import analyze  # noqa: E402
from synesthesia.render import render_sound_map  # noqa: E402


def _clip(src: Path, dst: Path, start_s: float, config: Config) -> None:
    bt = config.blind_test
    fade_out = max(0.0, bt.clip_s - bt.clip_fade_s)
    filt = (
        f"loudnorm=I={bt.clip_lufs}:TP=-1.5:LRA=11,"
        f"afade=t=in:d={bt.clip_fade_s},afade=t=out:st={fade_out}:d={bt.clip_fade_s}"
    )
    cmd = [
        "ffmpeg", "-v", "error", "-y", "-nostdin", "-ss", f"{start_s:.3f}", "-t", f"{bt.clip_s}",
        "-i", str(src), "-vn", "-ac", "1", "-af", filt, "-b:a", f"{bt.clip_kbps}k",
        "-map_metadata", "-1", str(dst),
    ]  # fmt: skip
    subprocess.run(cmd, check=True)


def _colors(track_id: str, path: Path, config: Config, cache: Path) -> np.ndarray:
    npz = cache / f"{track_id}.npz"
    if not npz.is_file():
        np.savez(npz, **result_arrays(analyze(path, config)))
    with np.load(npz) as a:
        return np.asarray(a["color_srgb"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "blind_test")
    args = ap.parse_args()

    config = load_config()
    bt = config.blind_test
    tracks = read_tracks(args.manifest, args.audio_dir)
    meta = {t.track_id: t for t in tracks}
    songs = [Song(t.track_id, t.title, t.artist, t.genre, t.license, 0.0) for t in tracks]
    with args.manifest.open(encoding="utf-8", newline="") as f:
        durations = {r["track_id"]: float(r["duration_s"]) for r in csv.DictReader(f)}
    stimuli = select_stimuli(songs, config)
    plans = [make_plan(p, songs, stimuli, config) for p in range(1, bt.n_participant_plans + 1)]

    used = {s.track_id for s in stimuli}
    for plan in plans:
        for tr in plan:
            used.update(tr.options)

    out = args.out
    if out.exists():
        shutil.rmtree(out)
    (out / "clips").mkdir(parents=True)
    (out / "sigs").mkdir()
    cache = ROOT / "out" / "corpus" / config.hash()[:12]
    cache.mkdir(parents=True, exist_ok=True)

    for tid in sorted(used):
        t = meta[tid]
        img = render_sound_map(_colors(tid, t.path, config, cache), config, bt.signature_px)
        img.convert("RGB").save(out / "sigs" / f"{tid}.png", optimize=True)
    for s in stimuli:
        start = bt.clip_start_fraction * durations[s.track_id]
        _clip(meta[s.track_id].path, out / "clips" / f"{s.track_id}.mp3", start, config)
        sys.stdout.write(f"clip {s.track_id} {s.genre} from {start:.1f}s\n")

    data = {
        "n_trials": len(stimuli),
        "clip_s": bt.clip_s,
        "songs": {
            tid: {
                "title": meta[tid].title,
                "artist": meta[tid].artist,
                "genre": meta[tid].genre,
                "license": meta[tid].license,
            }
            for tid in sorted(used)
        },
        "stimuli": [s.track_id for s in stimuli],
        "plans": [
            [
                {
                    "song": tr.song,
                    "options": list(tr.options),
                    "correct_pos": tr.correct_pos,
                    "same_genre_foil": tr.same_genre_foil,
                }
                for tr in plan
            ]
            for plan in plans
        ],
    }
    html = (HERE / "template.html").read_text(encoding="utf-8")
    html = html.replace("__DATA__", json.dumps(data, separators=(",", ":")))
    (out / "index.html").write_text(html, encoding="utf-8")
    size_mb = sum(p.stat().st_size for p in out.rglob("*") if p.is_file()) / 1e6
    sys.stdout.write(f"wrote {out} ({size_mb:.1f} MB, {len(stimuli)} trials, {len(used)} images)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
