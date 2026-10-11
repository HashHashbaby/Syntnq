"""Write binary-format fixtures for the web loaders' round-trip tests (docs/API.md section 3).

Analyzes the synthetic A/B/A fixture and writes ``static.bin``, ``maps.bin``, ``live.bin``,
``proto.bin`` plus ``expected.json`` (a few checksums and shapes the TypeScript tests assert) to
the given folder (default ``out/format_fixtures``; CI copies it to ``web/tests/fixtures``).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from _corpus import ROOT

sys.path.insert(0, str(ROOT / "tests"))
from fixtures import make_signals as ms  # noqa: E402
from synesthesia.config import load_config  # noqa: E402
from synesthesia.io import read_arrays, write_result  # noqa: E402
from synesthesia.pipeline import analyze  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "format_fixtures")
    args = ap.parse_args()
    config = load_config()
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wavs = ms.write_all(Path(tmp) / "wavs")
        result = analyze(wavs["aba_song"], config)
        song_dir = write_result(result, Path(tmp) / "out", config)
        for name in ("static.bin", "maps.bin", "live.bin", "proto.bin"):
            (args.out / name).write_bytes((song_dir / name).read_bytes())
        arrays = read_arrays(song_dir / "arrays.npz")
    expected = {
        "song_id": result.song_id,
        "grid_size": config.grid.size,
        "frames": result.n_frames,
        "color_srgb_sum": int(arrays["color_srgb"].astype(np.int64).sum()),
        "hits_sum": int(arrays["hits"].sum()),
        "dyn_hist_sum": float(arrays["dyn_hist"].sum()),
        "structure_sha256": hashlib.sha256(arrays["structure"].tobytes()).hexdigest(),
        "n_beats": int(arrays["beat_times"].size),
    }
    (args.out / "expected.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
    sys.stdout.write(f"wrote {args.out}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
