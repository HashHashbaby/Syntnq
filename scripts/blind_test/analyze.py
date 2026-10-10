"""Analyze blind-test result files (docs/DATA_RESEARCH.md section 4).

Reads every ``synesthesia_blind_*.csv`` in a folder (one per participant) and prints:
overall accuracy with a 95% Wilson interval, the one-sided exact binomial test against chance
(1 / n_options), per-participant accuracy, accuracy on trials with a same-genre foil versus the
others, and per-song accuracy. The gate result is printed last.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy import stats

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from synesthesia.config import load_config  # noqa: E402

_Z95 = 1.959963984540054


def wilson(k: int, n: int, z: float = _Z95) -> tuple[float, float]:
    """Wilson score interval for a proportion."""
    if n == 0:
        return float("nan"), float("nan")
    p = k / n
    d = 1.0 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return float(c - h), float(c + h)


def load(folder: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for path in sorted(folder.glob("synesthesia_blind_*.csv")):
        with path.open(encoding="utf-8", newline="") as f:
            rows.extend(csv.DictReader(f))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder", type=Path, help="folder with the participants' CSV files")
    args = ap.parse_args()
    config = load_config()
    bt = config.blind_test
    chance = 1.0 / bt.n_options

    rows = load(args.folder)
    if not rows:
        sys.stderr.write("no result files found\n")
        return 2
    people: dict[str, list[int]] = defaultdict(list)
    songs: dict[str, list[int]] = defaultdict(list)
    same: list[int] = []
    diff: list[int] = []
    for r in rows:
        ok = int(r["correct"])
        people[r["participant"]].append(ok)
        songs[r["song_id"]].append(ok)
        (same if int(r["same_genre_foil"]) else diff).append(ok)

    n_all = len(rows)
    k_all = sum(int(r["correct"]) for r in rows)
    lo, hi = wilson(k_all, n_all)
    test = stats.binomtest(k_all, n_all, chance, alternative="greater")
    sys.stdout.write(f"participants {len(people)}, trials {n_all}, chance {chance:.2f}\n")
    sys.stdout.write(
        f"overall accuracy {k_all / n_all:.3f}  95% CI [{lo:.3f}, {hi:.3f}]  "
        f"one-sided binomial p = {test.pvalue:.4g}\n"
    )
    per_person = np.array([np.mean(v) for v in people.values()])
    sd = float(per_person.std(ddof=1)) if per_person.size > 1 else float("nan")
    sys.stdout.write(
        f"per-participant mean {per_person.mean():.3f}  sd {sd:.3f}"
        f"  min {per_person.min():.2f}  max {per_person.max():.2f}\n"
    )
    for label, vals in (("same-genre foil trials", same), ("other trials", diff)):
        if vals:
            a, b = wilson(sum(vals), len(vals))
            sys.stdout.write(
                f"{label:24s} {sum(vals) / len(vals):.3f}  [{a:.3f}, {b:.3f}]  n={len(vals)}\n"
            )
    sys.stdout.write("per song:\n")
    for sid, v in sorted(songs.items(), key=lambda kv: np.mean(kv[1])):
        sys.stdout.write(f"  {sid}  {np.mean(v):.2f}  n={len(v)}\n")
    passed = per_person.mean() >= bt.gate_accuracy and test.pvalue < bt.gate_alpha
    sys.stdout.write(
        f"GATE (mean accuracy >= {bt.gate_accuracy:.2f} and p < {bt.gate_alpha}): "
        f"{'PASS' if passed else 'NOT MET'}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
