"""Grid-size check: analyze the corpus at 32, 40, 64 and 100 cells per side (M2 task 7).

Features are extracted once per track; only the SOM and everything after it repeat per size.
``som.sigma_start`` scales with the grid (16 at 64) so the initial neighborhood covers the same
share of the map. Writes one contact sheet and a metrics table per size under ``out/compare_sizes``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from _corpus import DEFAULT_AUDIO, DEFAULT_MANIFEST, ROOT, read_tracks

from synesthesia.config import load_config
from synesthesia.determinism import single_thread
from synesthesia.evaluate import corpus_metrics, distance_matrix
from synesthesia.features import extract_features
from synesthesia.ingest import decode_file, normalize, song_id
from synesthesia.pipeline import analyze_features
from synesthesia.render import contact_sheet, render_sound_map

REFERENCE_SIZE = 64
SIZES = (32, 40, 64, 100)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "compare_sizes")
    ap.add_argument("--sizes", type=int, nargs="+", default=list(SIZES))
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--tile", type=int, default=240)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    base = load_config()
    tracks = read_tracks(args.manifest, args.audio_dir)
    sizes = list(args.sizes)
    tiles: dict[int, list] = {s: [] for s in sizes}
    prints: dict[int, list] = {s: [] for s in sizes}
    som_stats: dict[int, list] = {s: [] for s in sizes}
    seconds: dict[int, float] = {s: 0.0 for s in sizes}
    labels: list[str] = []

    with single_thread():
        for t in tracks:
            y, info = normalize(decode_file(t.path, base), base)
            feats = extract_features(y, base)
            sid = song_id(y)
            labels.append(t.genre)
            for s in sizes:
                cfg = load_config(
                    overrides={
                        "grid": {"size": s},
                        "render": {"display_grid": s},  # compare analysis sizes at native density
                        "som": {"sigma_start": base.som.sigma_start * s / REFERENCE_SIZE},
                    }
                )
                r = analyze_features(feats, info, sid, cfg, source_name=t.path.name)
                seconds[s] += sum(r.timings.values())
                prints[s].append(r.fingerprint)
                som_stats[s].append(
                    [r.som.quantization_error, r.som.topographic_error, r.som.empty_units]
                )
                img = render_sound_map(r.colors.srgb, cfg, args.tile * 2)
                tiles[s].append((img, f"{s}: {t.title[:22]} - {t.artist[:12]}"))
            sys.stdout.write(f"done {t.track_id}\n")

    header = f"{'size':>5}{'NN acc':>8}{'within':>9}{'between':>9}{'dups':>6}{'cross':>6}"
    header += f"{'QE':>8}{'TE':>8}{'empty':>8}{'s/track':>9}"
    sys.stdout.write(header + "\n")
    for s in sizes:
        cfg = load_config(overrides={"grid": {"size": s}, "render": {"display_grid": s}})
        m = corpus_metrics(distance_matrix(np.vstack(prints[s]), cfg), labels)
        qe, te, em = np.mean(np.array(som_stats[s]), axis=0)
        sys.stdout.write(
            f"{s:>5}{m.nn_accuracy:8.3f}{m.within_mean:9.4f}{m.between_mean:9.4f}"
            f"{len(m.near_duplicates):6d}{m.cross_genre_near_duplicates:6d}"
            f"{qe:8.3f}{te:8.3f}{em:8.3f}{seconds[s] / len(tracks):9.1f}\n"
        )
        contact_sheet(tiles[s], cols=args.cols, tile_px=args.tile).save(
            args.out / f"contact_sheet_{s}.png"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
