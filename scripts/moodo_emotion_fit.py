# ruff: noqa: N806, E741, E501, UP031
"""D-036: fit the emotion term on the Moodo development half and test it on the held-out half.

Pre-registered (docs/DECISIONS.md D-036): clips sorted by numeric id; even positions are the
development half, odd positions the held-out half. The ridge regressor (valence, arousal) and
the three gains (lightness, chroma, hue) are fitted on the development half only; the held-out
half is used once, for the final evaluation with the real pipeline.

Writes ``config/emotion_model.json`` and prints the gains to put in ``config/default.yaml``.
Outputs: ``out/moodo/emotion_fit.json`` (git-ignored).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from _corpus import ROOT
from moodo_alignment import (
    DATA,
    MIN_CLIP_S,
    N_BOOT,
    boot_ci,
    circ_corr,
    circ_mean_deg,
    load_ratings,
    signature_stats,
)

from synesthesia.config import load_config
from synesthesia.emotion import (
    EMOTION_MODEL_FILENAME,
    clip_features,
    fit_ridge,
    save_model,
)
from synesthesia.features import extract_features
from synesthesia.ingest import decode_file, normalize
from synesthesia.pipeline import analyze

OUT = ROOT / "out" / "moodo"
ALPHAS = (1.0, 3.0, 10.0, 30.0, 100.0, 300.0, 1000.0)
HUE_GAINS = np.round(np.arange(0.0, 1.0001, 0.025), 3)
CRIT = {"L": 0.40, "C": 0.40, "hue": 0.30}  # D-036 (a)


def human_means(rows: list[dict[str, float | str]], clips: list[str]) -> dict[str, np.ndarray]:
    out = {k: np.full(len(clips), np.nan) for k in ("L", "C", "hue", "val", "aro")}
    for i, s in enumerate(clips):
        rs = [r for r in rows if r["song"] == s]
        out["L"][i] = np.mean([r["L"] for r in rs])
        out["C"][i] = np.mean([r["C"] for r in rs])
        ch = [r for r in rs if r["s"] > 0]
        if len(ch) >= 3:
            out["hue"][i] = circ_mean_deg(
                np.array([r["hue"] for r in ch], dtype=float),
                np.array([r["C"] for r in ch], dtype=float),
            )
        out["val"][i] = np.nanmean([r["val"] for r in rs])
        out["aro"][i] = np.nanmean([r["aro"] for r in rs])
    return out


def corr_with_ci(
    ours: dict[str, np.ndarray],
    human: dict[str, np.ndarray],
    idx: np.ndarray,
    rng: np.random.Generator,
) -> dict[str, tuple[float, float, float]]:
    res = {}
    for k in ("L", "C"):
        a, b = ours[k][idx], human[k][idx]
        r = float(np.corrcoef(a, b)[0, 1])
        lo, hi = boot_ci(lambda x, y: np.corrcoef(x, y)[0, 1], a, b, rng=rng)
        res[k] = (r, lo, hi)
    ok = idx[np.isfinite(human["hue"][idx])]
    a, b = ours["hue"][ok], human["hue"][ok]
    r = circ_corr(a, b)
    lo, hi = boot_ci(circ_corr, a, b, rng=rng)
    res["hue"] = (r, lo, hi)
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=DATA)
    args = ap.parse_args()
    base_cfg = load_config(overrides={"ingest": {"min_duration_s": MIN_CLIP_S}})
    rng = np.random.default_rng([base_cfg.seed, 6])

    rows = load_ratings(args.data / "dataset.xml")
    clips = sorted({str(r["song"]) for r in rows}, key=int)
    human = human_means(rows, clips)
    dev = np.array([k for k in range(len(clips)) if k % 2 == 0])
    held = np.array([k for k in range(len(clips)) if k % 2 == 1])
    sys.stdout.write(f"clips {len(clips)}: development {dev.size}, held-out {held.size}\n")

    # clip features -------------------------------------------------------------------------
    feat_path = OUT / "clip_features.npy"
    if feat_path.is_file():
        x = np.load(feat_path)
    else:
        x = np.zeros((len(clips), 24))
        for i, s in enumerate(clips):
            y, _ = normalize(decode_file(args.data / "audio" / f"{s}.mp3", base_cfg), base_cfg)
            x[i] = clip_features(extract_features(y, base_cfg))
        np.save(feat_path, x)
    target = np.column_stack([human["val"], human["aro"]])

    # regressor on the development half ------------------------------------------------------
    model, loo, scores = fit_ridge(x[dev], target[dev], ALPHAS)
    pred_held = model.predict(x[held])
    sys.stdout.write(f"ridge alpha {model.alpha} (LOO MSE by alpha: "
                     + ", ".join(f"{a:g}:{m:.3f}" for a, m in scores.items()) + ")\n")  # fmt: skip
    r_dev = [float(np.corrcoef(loo[:, j], target[dev, j])[0, 1]) for j in range(2)]
    r_held = [float(np.corrcoef(pred_held[:, j], target[held, j])[0, 1]) for j in range(2)]
    sys.stdout.write(f"valence/arousal r: dev (leave-one-out) {r_dev[0]:+.2f} / {r_dev[1]:+.2f}; "
                     f"HELD-OUT {r_held[0]:+.2f} / {r_held[1]:+.2f}  (target >= 0.5)\n")  # fmt: skip

    # baseline signature stats --------------------------------------------------------------------
    lch_base, hits = [], []
    for s in clips:
        with np.load(OUT / "signatures" / f"{s}.npz") as z:
            lch_base.append(z["color_oklch"].astype(np.float64))
            hits.append(z["hits"].astype(np.float64))
    base = {k: np.zeros(len(clips)) for k in ("L", "C", "hue")}
    for i in range(len(clips)):
        L, C, h = signature_stats({"color_oklch": lch_base[i], "hits": hits[i]})
        base["L"][i], base["C"][i], base["hue"][i] = L, C, h

    # gains fitted on the development half (out-of-fold predictions) -------------------------------
    v, a = loo[:, 0], loo[:, 1]
    s_dev = 0.5 * (v + a)
    dl = human["L"][dev] - base["L"][dev]
    dc = human["C"][dev] - base["C"][dev]
    k_l = float(np.cov(v, dl)[0, 1] / np.var(v, ddof=1))
    k_c = float(np.cov(s_dev, dc)[0, 1] / np.var(s_dev, ddof=1))
    cfg0 = base_cfg.color.hue
    span = cfg0.from_deg - cfg0.to_deg
    ok = dev[np.isfinite(human["hue"][dev])]
    pos = {int(k): j for j, k in enumerate(dev)}
    best = (-2.0, 0.0)
    for kh in HUE_GAINS:
        mod = []
        for k in ok:
            lch = lch_base[k].copy()
            t = np.clip((cfg0.from_deg - lch[:, 2]) / span + kh * v[pos[int(k)]], 0.0, 1.0)
            lch[:, 2] = cfg0.from_deg - span * t
            mod.append(signature_stats({"color_oklch": lch, "hits": hits[k]})[2])
        r = circ_corr(np.array(mod), human["hue"][ok])
        if r > best[0] + 1e-9:
            best = (r, float(kh))
    k_h = best[1]
    sys.stdout.write(f"gains fitted on dev: lightness {k_l:+.3f}  chroma {k_c:+.3f}  hue {k_h:.3f} "
                     f"(dev hue circular r {best[0]:+.2f})\n")  # fmt: skip

    # final model (all development clips) -> file; evaluate with the real pipeline ---------------
    model_path = ROOT / "config" / EMOTION_MODEL_FILENAME
    save_model(model, model_path)
    cfg_emotion = load_config(
        overrides={
            "ingest": {"min_duration_s": MIN_CLIP_S},
            "color": {
                "emotion": {
                    "enabled": True,
                    "gain_lightness": k_l,
                    "gain_chroma": k_c,
                    "gain_hue": k_h,
                }
            },
        }
    )
    ours = {k: np.zeros(len(clips)) for k in ("L", "C", "hue")}
    for i, s in enumerate(clips):
        res = analyze(args.data / "audio" / f"{s}.mp3", cfg_emotion)
        ours["L"][i], ours["C"][i], ours["hue"][i] = signature_stats(
            {"color_oklch": res.colors.oklch, "hits": res.stats.hits}
        )

    report: dict[str, object] = {
        "gains": {"lightness": k_l, "chroma": k_c, "hue": k_h},
        "emotion_r_heldout": r_held,
        "emotion_r_dev_loo": r_dev,
    }
    sys.stdout.write("\n=== signature vs human mean colour, with the emotion term ===\n")
    passed = True
    for name, idx in (
        ("HELD-OUT (n=%d)" % held.size, held),
        ("development (n=%d)" % dev.size, dev),
    ):
        c_new = corr_with_ci(ours, human, idx, rng)
        c_old = corr_with_ci(base, human, idx, rng)
        sys.stdout.write(f"{name}\n")
        for k, label in (("L", "lightness"), ("C", "chroma"), ("hue", "hue (circ)")):
            n, o = c_new[k], c_old[k]
            sys.stdout.write(
                f"  {label:11s} baseline {o[0]:+.3f} [{o[1]:+.3f}, {o[2]:+.3f}]  ->  "
                f"with emotion {n[0]:+.3f} [{n[1]:+.3f}, {n[2]:+.3f}]\n"
            )
        report[name] = {k: {"baseline": c_old[k], "emotion": c_new[k]} for k in c_new}
        if idx is held:
            passed = all(c_new[k][0] >= CRIT[k] and c_new[k][1] > 0 for k in CRIT)
    val_ok = r_held[0] >= 0.5 and r_held[1] >= 0.5
    sys.stdout.write(
        f"\ncriterion (a) correlations >= {CRIT} with CI lower bound > 0: {'PASS' if passed else 'FAIL'}\n"
    )
    sys.stdout.write(f"criterion (e) emotion regressor held-out r >= 0.5 (reported, target): {'met' if val_ok else 'not met'}\n")  # fmt: skip
    report["criterion_a_pass"] = passed
    (OUT / "emotion_fit.json").write_text(
        json.dumps(report, indent=2, default=float) + "\n", encoding="utf-8"
    )
    sys.stdout.write(f"bootstrap resamples {N_BOOT}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
