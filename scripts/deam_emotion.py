# ruff: noqa: N806, E741, E501, UP031
"""D-039: train the emotion regressor on DEAM and test the colour term on Moodo.

Pre-registered in docs/DECISIONS.md D-039 (written before any DEAM data was analysed).
Stages (all cached; rerunning is cheap):
  1. extract data/deam/DEAM_audio.zip safely, 2. 24 clip-level features per DEAM clip
  (multiprocess), 3. ridge fit with 5-fold CV, 4. validate on all 200 Moodo clips,
  5. gains on the Moodo development half, 6. real-pipeline test on the held-out half
  and the swapped direction. Outputs: out/deam/ (git-ignored).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from _corpus import ROOT
from moodo_alignment import DATA, MIN_CLIP_S, circ_corr, load_ratings, signature_stats
from moodo_emotion_fit import CRIT, HUE_GAINS, corr_with_ci, human_means

from synesthesia.config import load_config
from synesthesia.emotion import (
    EMOTION_MODEL_FILENAME,
    EmotionModel,
    clip_features,
    save_model,
)
from synesthesia.features import extract_features
from synesthesia.ingest import decode_file, normalize
from synesthesia.pipeline import analyze

DEAM = ROOT / "data" / "deam"
AUDIO_X = DEAM / "audio_x"
OUT = ROOT / "out" / "deam"
ANN = DEAM / "annotations_x" / "annotations" / "annotations averaged per song" / "song_level"
ALPHAS = (1.0, 3.0, 10.0, 30.0, 100.0, 300.0, 1000.0)
N_FOLDS = 5
MOODO_OUT = ROOT / "out" / "moodo"
SCALE_EPS = 1e-9


def extract_audio() -> int:
    if AUDIO_X.is_dir() and any(AUDIO_X.glob("*.mp3")):
        return len(list(AUDIO_X.glob("*.mp3")))
    AUDIO_X.mkdir(parents=True, exist_ok=True)
    n = 0
    with zipfile.ZipFile(DEAM / "DEAM_audio.zip") as zf:
        for m in zf.infolist():
            name = Path(m.filename).name
            if m.is_dir() or not name.lower().endswith(".mp3"):
                continue
            (AUDIO_X / name).write_bytes(zf.read(m))  # flat: member paths are never used
            n += 1
    return n


def _features_job(path_str: str) -> tuple[str, list[float] | None, str]:
    try:
        cfg = load_config()
        y, _ = normalize(decode_file(Path(path_str), cfg), cfg)
        return Path(path_str).stem, clip_features(extract_features(y, cfg)).tolist(), ""
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
        return Path(path_str).stem, None, f"{type(exc).__name__}: {str(exc)[:80]}"


def build_features(workers: int) -> tuple[list[str], np.ndarray]:
    cache = OUT / "deam_features.npz"
    if cache.is_file():
        z = np.load(cache, allow_pickle=False)
        return [str(s) for s in z["ids"]], z["x"]
    files = sorted(str(p) for p in AUDIO_X.glob("*.mp3"))
    ids, rows, bad = [], [], []
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for k, (sid, feats, err) in enumerate(ex.map(_features_job, files, chunksize=4)):
            if feats is None:
                bad.append((sid, err))
            else:
                ids.append(sid)
                rows.append(feats)
            if (k + 1) % 100 == 0:
                sys.stdout.write(f"  features {k + 1}/{len(files)}\n")
                sys.stdout.flush()
    sys.stdout.write(f"features: {len(ids)} ok, {len(bad)} failed {bad[:3]}\n")
    x = np.asarray(rows, dtype=np.float64)
    np.savez(cache, ids=np.array(ids), x=x)
    return ids, x


def load_deam_targets() -> dict[str, tuple[float, float]]:
    out = {}
    for f in sorted(ANN.glob("static_annotations_averaged_songs_*.csv")):
        with f.open(encoding="utf-8", newline="") as fh:
            rd = csv.reader(fh)
            header = [h.strip() for h in next(rd)]
            iv, ia = header.index("valence_mean"), header.index("arousal_mean")
            for r in rd:
                out[r[0].strip()] = ((float(r[iv]) - 5.0) / 4.0, (float(r[ia]) - 5.0) / 4.0)
    return out


def ridge_fit(x: np.ndarray, y: np.ndarray, alpha: float) -> EmotionModel:
    mean, scale = x.mean(axis=0), np.maximum(x.std(axis=0), SCALE_EPS)
    z = (x - mean) / scale
    y0 = y.mean(axis=0)
    w = np.linalg.solve(z.T @ z + alpha * np.eye(z.shape[1]), z.T @ (y - y0))
    return EmotionModel(mean, scale, w, y0, alpha, x.shape[0])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workers", type=int, default=max(1, min(4, (os.cpu_count() or 2) - 1)))
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    log: dict[str, object] = {}

    sys.stdout.write(f"audio files: {extract_audio()}\n")
    ids, x_all = build_features(args.workers)
    targets = load_deam_targets()
    keep = [i for i, s in enumerate(ids) if s in targets]
    x = x_all[keep]
    y = np.array([targets[ids[i]] for i in keep])
    sys.stdout.write(f"DEAM clips with features and annotations: {len(keep)}\n")

    # (1) alpha by 5-fold CV, DEAM cross-validated r
    folds = np.arange(len(keep)) % N_FOLDS
    best_a, best_mse, best_pred = ALPHAS[0], np.inf, None
    for a in ALPHAS:
        pred = np.zeros_like(y)
        for f in range(N_FOLDS):
            tr, te = folds != f, folds == f
            pred[te] = np.clip(ridge_fit(x[tr], y[tr], a).predict(x[te]), -1, 1)
        mse = float(np.mean((pred - y) ** 2))
        if mse < best_mse:
            best_a, best_mse, best_pred = a, mse, pred
    assert best_pred is not None
    r_cv = [float(np.corrcoef(best_pred[:, j], y[:, j])[0, 1]) for j in range(2)]
    model = ridge_fit(x, y, best_a)
    sys.stdout.write(
        f"(1) DEAM 5-fold CV: alpha {best_a:g}, r valence {r_cv[0]:+.3f}, arousal {r_cv[1]:+.3f}\n"
    )
    log["deam_cv_r"] = r_cv

    # (2) validation on all 200 Moodo clips
    cfg0 = load_config(overrides={"ingest": {"min_duration_s": MIN_CLIP_S}})
    rows = load_ratings(DATA / "dataset.xml")
    clips = sorted({str(r["song"]) for r in rows}, key=int)
    human = human_means(rows, clips)
    x_moodo = np.load(MOODO_OUT / "clip_features.npy")
    pred_moodo = model.predict(x_moodo)
    r_val = [
        float(np.corrcoef(pred_moodo[:, 0], human["val"])[0, 1]),
        float(np.corrcoef(pred_moodo[:, 1], human["aro"])[0, 1]),
    ]
    sys.stdout.write(
        f"(2) Moodo validation (200 clips, never trained on): r valence {r_val[0]:+.3f}, arousal {r_val[1]:+.3f} (target >= 0.5)\n"
    )
    log["moodo_validation_r"] = r_val
    ok_e = r_val[0] >= 0.5 and r_val[1] >= 0.5

    # (3) gains on the development half
    dev = np.array([k for k in range(len(clips)) if k % 2 == 0])
    held = np.array([k for k in range(len(clips)) if k % 2 == 1])
    lch_base, hits = [], []
    for s in clips:
        with np.load(MOODO_OUT / "signatures" / f"{s}.npz") as z:
            lch_base.append(z["color_oklch"].astype(np.float64))
            hits.append(z["hits"].astype(np.float64))
    base = {k: np.zeros(len(clips)) for k in ("L", "C", "hue")}
    for i in range(len(clips)):
        base["L"][i], base["C"][i], base["hue"][i] = signature_stats(
            {"color_oklch": lch_base[i], "hits": hits[i]}
        )
    hue_cfg = cfg0.color.hue
    span = hue_cfg.from_deg - hue_cfg.to_deg

    def fit_gains(idx: np.ndarray) -> tuple[float, float, float]:
        v, a = pred_moodo[idx, 0], pred_moodo[idx, 1]
        k_l = float(np.cov(v, human["L"][idx] - base["L"][idx])[0, 1] / np.var(v, ddof=1))
        s = 0.5 * (v + a)
        k_c = float(np.cov(s, human["C"][idx] - base["C"][idx])[0, 1] / np.var(s, ddof=1))
        ok = idx[np.isfinite(human["hue"][idx])]
        best = (-2.0, 0.0)
        for kh in HUE_GAINS:
            mod = []
            for k in ok:
                lch = lch_base[k].copy()
                t = np.clip((hue_cfg.from_deg - lch[:, 2]) / span + kh * pred_moodo[k, 0], 0, 1)
                lch[:, 2] = hue_cfg.from_deg - span * t
                mod.append(signature_stats({"color_oklch": lch, "hits": hits[k]})[2])
            r = circ_corr(np.array(mod), human["hue"][ok])
            if r > best[0] + 1e-9:
                best = (r, float(kh))
        return k_l, k_c, best[1]

    gains_dev = fit_gains(dev)
    gains_held = fit_gains(held)
    sys.stdout.write(
        f"(3) gains fitted on development: lightness {gains_dev[0]:+.3f} chroma {gains_dev[1]:+.3f} hue {gains_dev[2]:.3f}\n"
    )
    log["gains_dev"] = gains_dev
    log["gains_held"] = gains_held

    # (4) real-pipeline evaluation (model file is what the pipeline loads)
    model_path = ROOT / "config" / EMOTION_MODEL_FILENAME
    save_model(model, model_path)
    rng = np.random.default_rng([cfg0.seed, 9])

    def run(idx: np.ndarray, gains: tuple[float, float, float]) -> dict[str, np.ndarray]:
        cfg = load_config(
            overrides={
                "ingest": {"min_duration_s": MIN_CLIP_S},
                "color": {
                    "emotion": {
                        "enabled": True,
                        "gain_lightness": gains[0],
                        "gain_chroma": gains[1],
                        "gain_hue": gains[2],
                    }
                },
            }
        )
        ours = {k: np.zeros(len(clips)) for k in ("L", "C", "hue")}
        for i in idx:
            res = analyze(DATA / "audio" / f"{clips[i]}.mp3", cfg)
            ours["L"][i], ours["C"][i], ours["hue"][i] = signature_stats(
                {"color_oklch": res.colors.oklch, "hits": res.stats.hits}
            )
        return ours

    try:
        sys.stdout.write("(4) evaluating held-out half with the real pipeline ...\n")
        sys.stdout.flush()
        c_new = corr_with_ci(run(held, gains_dev), human, held, rng)
        c_old = corr_with_ci(base, human, held, rng)
        sys.stdout.write("HELD-OUT (n=%d), baseline -> with emotion (DEAM regressor)\n" % held.size)
        for k, label in (("L", "lightness"), ("C", "chroma"), ("hue", "hue (circ)")):
            o, n = c_old[k], c_new[k]
            sys.stdout.write(
                f"  {label:11s} {o[0]:+.3f} [{o[1]:+.3f}, {o[2]:+.3f}] -> {n[0]:+.3f} [{n[1]:+.3f}, {n[2]:+.3f}]\n"
            )
        pass_a = all(c_new[k][0] >= CRIT[k] and c_new[k][1] > 0 for k in CRIT)
        sys.stdout.write(
            "swapped direction (gains fitted on held-out, tested on development) ...\n"
        )
        sys.stdout.flush()
        s_new = corr_with_ci(run(dev, gains_held), human, dev, rng)
        for k, label in (("L", "lightness"), ("C", "chroma"), ("hue", "hue (circ)")):
            n = s_new[k]
            sys.stdout.write(f"  {label:11s} -> {n[0]:+.3f} [{n[1]:+.3f}, {n[2]:+.3f}]\n")
        log["heldout"] = {k: {"baseline": c_old[k], "emotion": c_new[k]} for k in c_new}
        log["swapped_dev"] = {k: s_new[k] for k in s_new}
        log["criterion_a"] = pass_a
        log["criterion_e"] = ok_e
        sys.stdout.write(
            f"\ncriterion (a) held-out correlations: {'PASS' if pass_a else 'FAIL'};  criterion (e) validation r >= 0.5: {'PASS' if ok_e else 'FAIL'}\n"
        )
    finally:
        if not (log.get("criterion_a") and log.get("criterion_e")):
            model_path.unlink(missing_ok=True)  # not adopted: keep the model out of config/
            save_model(model, OUT / "emotion_model_deam.json")
    (OUT / "result.json").write_text(
        json.dumps(log, indent=2, default=float) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
