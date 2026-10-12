"""Time upload-to-done through the API for real corpus tracks (M6/M7 gate evidence).

Usage: ``uv run python scripts/real_track_latency.py <audio file> [...]``

Each file is uploaded to a fresh in-process API (empty temporary storage, so dedup cannot skip
the analysis) and the wall time from the POST to the job reaching ``done`` is printed with the
stage timings the job reports. Budget: 40 s for a 4-minute track (docs/MILESTONES.md M6).
"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import soundfile as sf
from fastapi.testclient import TestClient

from synesthesia.api.app import create_app
from synesthesia.config import load_config

POLL_S = 0.2
TIMEOUT_S = 300.0
BUDGET_S = 40.0


def time_one(path: Path) -> dict[str, Any]:
    """Upload ``path`` to a fresh API and return duration (s), elapsed (s) and the final job."""
    info = sf.info(str(path))
    cfg = load_config(overrides={"api": {"rate_limit_per_hour": 1000}})
    with (
        tempfile.TemporaryDirectory() as tmp,
        TestClient(create_app(cfg, storage_root=Path(tmp) / "storage")) as c,
    ):
        t0 = time.monotonic()
        with path.open("rb") as f:
            r = c.post("/api/analyze", files={"file": (path.name, f)})
        r.raise_for_status()
        job_id = r.json()["job_id"]
        while True:
            job: dict[str, Any] = c.get(f"/api/jobs/{job_id}").json()
            if job["state"] in ("done", "failed", "cancelled"):
                break
            if time.monotonic() - t0 > TIMEOUT_S:
                raise TimeoutError(path.name)
            time.sleep(POLL_S)
        elapsed = time.monotonic() - t0
    return {"duration_s": info.duration, "elapsed_s": elapsed, "job": job}


def main(argv: list[str]) -> int:
    worst = 0.0
    for arg in argv:
        res = time_one(Path(arg))
        worst = max(worst, res["elapsed_s"])
        print(
            f"{Path(arg).name}: audio {res['duration_s']:.1f} s, upload to {res['job']['state']} "
            f"{res['elapsed_s']:.1f} s (budget {BUDGET_S:.0f} s)"
        )
    print(f"worst {worst:.1f} s -> {'PASS' if worst <= BUDGET_S else 'FAIL'}")
    return 0 if worst <= BUDGET_S else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
