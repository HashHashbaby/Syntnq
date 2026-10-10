"""Analyze the corpus, render a contact sheet and print distinctiveness metrics (M2 tasks 3, 5, 6).

Per-track arrays are cached in ``out/corpus/<config_hash[:12]>/<track_id>.npz``, so reruns are
cheap and any config or calibration change automatically invalidates the cache.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from _corpus import DEFAULT_AUDIO, DEFAULT_MANIFEST, ROOT, read_tracks

from synesthesia.config import load_config
from synesthesia.evaluate import corpus_metrics, distance_matrix
from synesthesia.io import result_arrays
from synesthesia.pipeline import analyze
from synesthesia.render import contact_sheet, render_sound_map


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "corpus")
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--tile", type=int, default=300)
    args = ap.parse_args()

    config = load_config()
    cache = args.out / config.hash()[:12]
    cache.mkdir(parents=True, exist_ok=True)
    tracks = read_tracks(args.manifest, args.audio_dir)

    tiles, prints, labels = [], [], []
    for t in tracks:
        npz = cache / f"{t.track_id}.npz"
        if not npz.is_file():
            result = analyze(t.path, config)
            arrays = result_arrays(result)
            arrays["som_stats"] = np.array(
                [
                    result.som.quantization_error,
                    result.som.topographic_error,
                    result.som.empty_units,
                ]
            )
            np.savez(npz, **arrays)
            sys.stdout.write(f"analyzed {t.track_id} in {sum(result.timings.values()):.1f}s\n")
        a = np.load(npz)
        prints.append(a["fingerprint"])
        labels.append(t.genre)
        img = render_sound_map(a["color_srgb"], config, args.tile * 2)
        tiles.append((img, f"{t.genre}: {t.title[:26]} - {t.artist[:16]}"))

    sheet = contact_sheet(tiles, cols=args.cols, tile_px=args.tile)
    target = args.out / f"contact_sheet_{config.hash()[:12]}.png"
    sheet.save(target)
    sys.stdout.write(f"contact sheet: {target}\n")

    dist = distance_matrix(np.vstack(prints), config)
    m = corpus_metrics(dist, labels)
    chance = 1.0 / len(set(labels))
    sys.stdout.write(f"tracks                        {len(tracks)}\n")
    sys.stdout.write(
        f"(a) leave-one-out NN genre acc {m.nn_accuracy:.3f}  (chance ~{chance:.2f})\n"
    )
    sys.stdout.write(f"(b) mean within-genre dist     {m.within_mean:.4f}\n")
    sys.stdout.write(f"    mean between-genre dist    {m.between_mean:.4f}\n")
    n_dup, n_cross = len(m.near_duplicates), m.cross_genre_near_duplicates
    sys.stdout.write(f"(c) near-duplicate pairs       {n_dup} (cross-genre {n_cross})\n")
    for i, j, same in m.near_duplicates:
        sys.stdout.write(
            f"      {tracks[i].track_id} ~ {tracks[j].track_id} d={dist[i, j]:.4f} same={same}\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
