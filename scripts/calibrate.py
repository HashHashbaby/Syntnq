"""Write ``config/calibration.yaml``: global color ranges from the corpus (M2 task 4).

Ranges are the 2nd and 98th percentile of each color feature over *all frames of all tracks*
(docs/MILESTONES.md M2). Re-run ``corpus_report.py`` afterwards to re-analyze with them.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np
import yaml
from _corpus import DEFAULT_AUDIO, DEFAULT_MANIFEST, ROOT, read_tracks

from synesthesia.config import CALIBRATION_META_KEY, load_config
from synesthesia.determinism import single_thread
from synesthesia.features import extract_features
from synesthesia.ingest import decode_file, normalize

LOW_PCT, HIGH_PCT = 2.0, 98.0  # docs/MILESTONES.md M2 task 4
RANGE_KEYS = ["centroid_log10_hz", "loudness_dbfs", "noisiness_log10", "harmonicity", "change_z"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--out", type=Path, default=ROOT / "config" / "calibration.yaml")
    args = ap.parse_args()

    # Calibrate against the defaults: never feed a previous calibration into itself.
    config = load_config(use_calibration=False)
    frames: list[np.ndarray] = []
    with single_thread():
        for t in read_tracks(args.manifest, args.audio_dir):
            y, _ = normalize(decode_file(t.path, config), config)
            frames.append(extract_features(y, config).color_matrix())
            sys.stdout.write(f"features {t.track_id} {frames[-1].shape[0]} frames\n")
    allf = np.vstack(frames)
    lo, hi = np.percentile(allf, [LOW_PCT, HIGH_PCT], axis=0)
    ranges = {k: [round(float(lo[i]), 4), round(float(hi[i]), 4)] for i, k in enumerate(RANGE_KEYS)}
    doc = {
        "color": {"ranges": ranges},
        CALIBRATION_META_KEY: {
            "percentiles": [LOW_PCT, HIGH_PCT],
            "n_tracks": len(frames),
            "n_frames": int(allf.shape[0]),
            "manifest_sha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
        },
    }
    text = yaml.safe_dump(doc, sort_keys=True)
    args.out.write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    sys.stdout.write(f"wrote {args.out}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
