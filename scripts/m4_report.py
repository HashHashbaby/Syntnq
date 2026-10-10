"""M4 gate evidence: per-song map panels for the corpus, recomputed M2 metrics and block ablation.

Per-track arrays (and the scalar summaries) are cached under ``out/corpus/<config_hash[:12]>/``.
Panels go to ``<out>/panels/``; the ablation table is printed and written to ``<out>/ablation.md``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from _corpus import DEFAULT_AUDIO, DEFAULT_MANIFEST, ROOT, Track, read_tracks
from PIL import Image, ImageDraw, ImageFont

from synesthesia.config import Config, load_config
from synesthesia.evaluate import block_distance_matrix, corpus_metrics, scalar_scale
from synesthesia.fingerprint import block_names
from synesthesia.io import result_arrays, signature_dict
from synesthesia.maps.render_maps import render_all
from synesthesia.pipeline import SongResult, analyze
from synesthesia.render import render_sound_map

PANEL_PX = 520


def _scalars(result: SongResult, grid_size: int) -> dict[str, float]:
    sig = signature_dict(result, grid_size)
    return {**sig["rhythm"], **sig["dynamics"], "duration_s": sig["song"]["duration_s"]}


def _panel(
    t: Track, imgs: dict[str, Image.Image], config: Config, path: Path, sc: dict[str, float]
) -> None:
    order = ["sound_map", "structure", "rhythm", "dynamics"]
    feats = [f"features_{n}" for n in config.maps.feature_grids]
    w = PANEL_PX
    small = w // 3
    sheet = Image.new("RGB", (4 * w, w + 80 + small + 40), (12, 12, 12))
    d = ImageDraw.Draw(sheet)
    d.text(
        (12, 10),
        f"{t.track_id}  {t.genre}  |  {t.title[:40]} - {t.artist[:30]}  |  "
        f"{sc['tempo_bpm']:.0f} BPM  clarity {sc['pulse_clarity']:.2f}  LRA {sc['lra_db']:.1f} dB",
        fill=(235, 235, 235),
        font=ImageFont.load_default(size=22),
    )
    for i, k in enumerate(order):
        im = imgs[k]
        im = im.resize((w, int(im.height * w / im.width)), Image.Resampling.LANCZOS)
        sheet.paste(im, (i * w, 50))
    for i, k in enumerate(feats):
        im = imgs[k].crop((0, 0, imgs[k].width, imgs[k].width))
        sheet.paste(im.resize((small, small), Image.Resampling.LANCZOS), (i * (small + 10), w + 90))
    sheet.save(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--out", type=Path, default=ROOT / "out" / "m4")
    args = ap.parse_args()

    config = load_config()
    cache = ROOT / "out" / "corpus" / config.hash()[:12]
    cache.mkdir(parents=True, exist_ok=True)
    panels = args.out / "panels"
    panels.mkdir(parents=True, exist_ok=True)
    tracks = read_tracks(args.manifest, args.audio_dir)

    prints: list[Any] = []
    labels: list[str] = []
    tempo: list[float] = []
    for t in tracks:
        npz, meta = cache / f"{t.track_id}.npz", cache / f"{t.track_id}.json"
        if not (npz.is_file() and meta.is_file()):
            r = analyze(t.path, config)
            np.savez(npz, **result_arrays(r))
            meta.write_text(json.dumps(_scalars(r, config.grid.size)), encoding="utf-8")
            sys.stdout.write(f"analyzed {t.track_id} in {sum(r.timings.values()):.1f}s\n")
            sys.stdout.flush()
        a, sc = np.load(npz), json.loads(meta.read_text(encoding="utf-8"))
        prints.append(a["fingerprint"])
        labels.append(t.genre)
        tempo.append(sc["tempo_bpm"])
        sig = {
            "song": {"duration_s": sc["duration_s"]},
            "rhythm": {"tempo_bpm": sc["tempo_bpm"], "pulse_clarity": sc["pulse_clarity"]},
            "dynamics": {k: sc[k] for k in ("lra_db", "mean_loudness_db", "peak_loudness_db")},
        }
        arrays = {k: a[k] for k in a.files}
        imgs = render_all(arrays, sig, config, PANEL_PX)
        imgs["sound_map"] = render_sound_map(a["color_srgb"], config, PANEL_PX).convert("RGB")
        _panel(t, imgs, config, panels / f"{t.track_id}.png", sc)

    fps = np.vstack(prints)
    norm = scalar_scale(fps, config)
    all_blocks = set(block_names(config))
    rows: list[tuple[str, set[str]]] = [("all blocks", all_blocks)]
    rows += [(f"without {b}", all_blocks - {b}) for b in block_names(config)]
    rows += [
        ("histograms only (no scalars)", all_blocks - {"scalars"}),
        ("scalars only", {"scalars"}),
    ]
    chance = 1.0 / len(set(labels))
    lines = [
        f"tracks {len(tracks)}, genres {len(set(labels))}, chance {chance:.3f}, "
        f"scalar_norm {norm:.3f}",
        "",
        "| fingerprint | NN genre acc | within | between | between/within | near-dups (cross) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, blocks in rows:
        d = block_distance_matrix(fps, config, blocks, scalar_norm=norm)
        m = corpus_metrics(d, labels)
        ratio = m.between_mean / m.within_mean if m.within_mean > 0 else float("nan")
        lines.append(
            f"| {name} | {m.nn_accuracy:.3f} | {m.within_mean:.4f} | {m.between_mean:.4f} | "
            f"{ratio:.3f} | {len(m.near_duplicates)} ({m.cross_genre_near_duplicates}) |"
        )
    text = "\n".join(lines) + "\n"
    (args.out / "ablation.md").write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    sys.stdout.write(f"tempo range {min(tempo):.0f}-{max(tempo):.0f} BPM; panels in {panels}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
