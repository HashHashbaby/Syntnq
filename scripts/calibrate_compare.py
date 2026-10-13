"""Calibrate song comparison on the 30-track prototype corpus (M9, D-066).

Computes, from the corpus fingerprints: the scalar scale (largest pairwise scalar distance -> 1.0,
as in M4), every pairwise distance, the quartile thresholds for the three labels, the distance
percentiles (0, 5, ..., 100) used for the score, and each aspect's median difference (so
differences of different kinds can be ranked). Writes them into the ``compare:`` block of
``config/default.yaml``.

Fingerprints come from the M4 analysis cache (``out/corpus/<hash>/<track>.npz``) after checking that
one cached fingerprint equals a fresh analysis of that track (within 1e-5); otherwise every track is
analysed again.

Usage: ``uv run python scripts/calibrate_compare.py`` (needs the corpus audio: make fetch-corpus).
"""

from __future__ import annotations

import datetime as dt
import re
import sys
from itertools import combinations

import numpy as np
from _corpus import DEFAULT_AUDIO, DEFAULT_MANIFEST, ROOT, read_tracks

from synesthesia.compare import block_differences
from synesthesia.config import load_config
from synesthesia.evaluate import scalar_scale
from synesthesia.fingerprint import distance
from synesthesia.pipeline import analyze

CONFIG = ROOT / "config" / "default.yaml"
PCTS = list(range(0, 101, 5))
CHECK_TOL = 1e-5


def corpus_fingerprints() -> tuple[np.ndarray, int]:
    cfg = load_config()
    tracks = read_tracks(DEFAULT_MANIFEST, DEFAULT_AUDIO)
    caches = sorted(
        (ROOT / "out" / "corpus").glob("*/"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    for cache in caches:
        files = [cache / f"{t.track_id}.npz" for t in tracks]
        if not all(f.is_file() for f in files):
            continue
        fresh = analyze(tracks[0].path, cfg).fingerprint
        cached = np.load(files[0])["fingerprint"]
        if np.max(np.abs(fresh.astype(np.float64) - cached.astype(np.float64))) <= CHECK_TOL:
            sys.stdout.write(
                f"using cached fingerprints from {cache.name} (checked on {tracks[0].track_id})\n"
            )
            return np.vstack([np.load(f)["fingerprint"] for f in files]), len(tracks)
    sys.stdout.write("no matching cache: analysing every track\n")
    return np.vstack([analyze(t.path, cfg).fingerprint for t in tracks]), len(tracks)


def main() -> int:
    cfg = load_config()
    fps, n = corpus_fingerprints()
    norm = scalar_scale(fps, cfg)
    pairs = list(combinations(range(n), 2))
    d = np.array([distance(fps[i], fps[j], cfg, scalar_norm=norm) for i, j in pairs])
    diffs = [block_differences(fps[i], fps[j], cfg) for i, j in pairs]
    medians = {k: float(np.median([x[k] for x in diffs])) for k in diffs[0]}
    q1, q3 = (float(v) for v in np.percentile(d, [25, 75]))
    pct = [round(float(v), 6) for v in np.percentile(d, PCTS)]
    med = ", ".join(f"{k}: {v:.6g}" for k, v in medians.items())
    block = (
        "  # --- calibrated (do not edit by hand) ---\n"
        f"  scalar_norm: {norm:.6f}\n"
        f"  very_similar_below: {q1:.6f}   # corpus first quartile of pairwise distance\n"
        f"  different_above: {q3:.6f}      # third quartile\n"
        f"  percentiles: [{', '.join(f'{v:.6f}' for v in pct)}]   # 0, 5, ..., 100\n"
        f"  block_medians: {{{med}}}\n"
        f"  calibration: {{corpus: prototype_30, tracks: {n}, pairs: {len(pairs)}, "
        f'date: "{dt.date.today().isoformat()}"}}\n'
    )
    text = CONFIG.read_text(encoding="utf-8")
    pattern = re.compile(r"  # --- calibrated \(do not edit by hand\) ---\n(?:  .*\n)+?(?=\n|\S)")
    if not pattern.search(text):
        raise SystemExit("compare block not found in config/default.yaml")
    CONFIG.write_text(pattern.sub(block, text, count=1), encoding="utf-8")
    sys.stdout.write(block)
    sys.stdout.write(f"distance min {d.min():.4f} median {np.median(d):.4f} max {d.max():.4f}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
