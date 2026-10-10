"""Render the M3 gate previews: 3 contrasting tracks (20 s each) plus a reduced-motion variant.

Each preview is analyzed from the prototype corpus audio and written to ``out/m3``. Tracks:
ambient (Mister M), rock (DevonMiles), electronic (Silence Abstrait); the electronic track is
rendered a second time with reduced motion.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from _corpus import DEFAULT_AUDIO, ROOT

JOBS = [
    ("track_0078956", "ambient_Mister_M", False),
    ("track_0016862", "rock_Crash_Into_June", False),
    ("track_0005369", "electronic_after_death", False),
    ("track_0005369", "electronic_after_death_reduced", True),
]
START_S, SECONDS = 40, 20


def main() -> int:
    out = ROOT / "out" / "m3"
    syn = [sys.executable, "-m", "synesthesia.cli"]
    for track, name, reduced in JOBS:
        cmd = [
            *syn, "preview", str(Path(DEFAULT_AUDIO) / f"{track}.mp3"),
            "--out", str(out), "--start", str(START_S), "--seconds", str(SECONDS), "--name", name,
        ]  # fmt: skip
        if reduced:
            cmd.append("--reduced-motion")
        sys.stdout.write(f"rendering {name}\n")
        sys.stdout.flush()
        subprocess.run(cmd, check=True)
    sys.stdout.write("=== DONE\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
