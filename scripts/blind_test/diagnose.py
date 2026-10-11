"""Ideal-observer diagnostic for the blind test (docs/MILESTONES.md M5, "diagnose").

Question: if a machine only sees what a signature contains (its five feature histograms), can it
match a 20 s clip to the right signature among the same options the participants saw? This separates
"the signatures do not carry clip-level information" from "people cannot read them".

For every participant plan and trial it compares the clip's feature histograms (frames of the
clip window, same normalization as the signature) with each option's full-song histograms by
mean Jensen-Shannon divergence, and picks the nearest option. A second observer uses only the
mean of the normalized brightness feature (a "hue-only" cue).
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "scripts"))

from _corpus import DEFAULT_AUDIO, DEFAULT_MANIFEST, read_tracks  # noqa: E402
from plan import Song, make_plan, select_stimuli  # noqa: E402

from synesthesia.color import normalize_features  # noqa: E402
from synesthesia.config import load_config  # noqa: E402
from synesthesia.features import extract_features  # noqa: E402
from synesthesia.fingerprint import _js_divergence  # noqa: E402
from synesthesia.ingest import decode_file, normalize  # noqa: E402
from synesthesia.pipeline import analyze  # noqa: E402

N_FEATURES = 5


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    args = ap.parse_args()
    config = load_config()
    bt = config.blind_test
    bins = config.fingerprint.hist_bins

    tracks = read_tracks(args.manifest, args.audio_dir)
    meta = {t.track_id: t for t in tracks}
    songs = [Song(t.track_id, t.title, t.artist, t.genre, t.license, 0.0) for t in tracks]
    with args.manifest.open(encoding="utf-8", newline="") as f:
        durations = {r["track_id"]: float(r["duration_s"]) for r in csv.DictReader(f)}
    stimuli = select_stimuli(songs, config)

    cache = ROOT / "out" / "corpus" / config.hash()[:12]
    cache.mkdir(parents=True, exist_ok=True)

    # whole-song feature histograms of every song (from the stored fingerprints)
    hist_full: dict[str, np.ndarray] = {}
    mean_bright: dict[str, float] = {}
    for t in tracks:
        npz = cache / f"{t.track_id}.npz"
        if not npz.is_file():
            from synesthesia.io import result_arrays

            np.savez(npz, **result_arrays(analyze(t.path, config)))
        with np.load(npz) as a:
            fp = a["fingerprint"].astype(np.float64)
            cf = a["cell_features"].astype(np.float64)
        hist_full[t.track_id] = fp[: N_FEATURES * bins].reshape(N_FEATURES, bins)
        centers = (np.arange(bins) + 0.5) / bins
        mean_bright[t.track_id] = float(hist_full[t.track_id][0] @ centers)
        del cf

    # clip-window histograms of the stimulus songs
    hist_clip: dict[str, np.ndarray] = {}
    for s in stimuli:
        audio = decode_file(meta[s.track_id].path, config)
        y, info = normalize(audio, config)
        feats = extract_features(y, config)
        start = bt.clip_start_fraction * durations[s.track_id] - info.trimmed_start_s
        lo = int(round(max(0.0, start) * feats.fps))
        hi = min(feats.n_frames, lo + int(round(bt.clip_s * feats.fps)))
        n = normalize_features(feats.color_matrix()[lo:hi].T, config).T  # (T, 5) in [0, 1]
        hs = np.stack([np.histogram(n[:, f], bins=bins, range=(0.0, 1.0))[0] for f in range(5)])
        hist_clip[s.track_id] = hs / np.maximum(hs.sum(axis=1, keepdims=True), 1)
        sys.stdout.write(f"clip window {s.track_id}: frames {lo}-{hi}\n")

    def js_dist(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.mean([_js_divergence(a[i], b[i]) for i in range(N_FEATURES)]))

    hit = {"hist": [], "bright": []}
    same_flags: list[bool] = []
    per_song: dict[str, list[int]] = {s.track_id: [] for s in stimuli}
    for p in range(1, bt.n_participant_plans + 1):
        for tr in make_plan(p, songs, stimuli, config):
            d_hist = [js_dist(hist_clip[tr.song], hist_full[o]) for o in tr.options]
            clip_b = float(hist_clip[tr.song][0] @ ((np.arange(bins) + 0.5) / bins))
            d_b = [abs(clip_b - mean_bright[o]) for o in tr.options]
            ok_h = int(int(np.argmin(d_hist)) == tr.correct_pos)
            ok_b = int(int(np.argmin(d_b)) == tr.correct_pos)
            hit["hist"].append(ok_h)
            hit["bright"].append(ok_b)
            same_flags.append(tr.same_genre_foil)
            per_song[tr.song].append(ok_h)
    same = np.array(same_flags)
    chance = 1.0 / bt.n_options
    sys.stdout.write(f"\ntrials {len(same)} (60 plans x 12), chance {chance:.2f}\n")
    for name, h in hit.items():
        h_arr = np.array(h)
        sys.stdout.write(
            f"ideal observer [{name:6s}] accuracy {h_arr.mean():.3f}   same-genre-foil trials "
            f"{h_arr[same].mean():.3f}   other trials {h_arr[~same].mean():.3f}\n"
        )
    sys.stdout.write("histogram observer, per song:\n")
    for sid, v in sorted(per_song.items(), key=lambda kv: np.mean(kv[1])):
        sys.stdout.write(f"  {sid}  {meta[sid].genre:20s} {np.mean(v):.2f}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
