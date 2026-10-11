# ruff: noqa: N806, E741, E501, UP031
"""M5c: human-alignment check against the Moodo dataset (colour choices for 200 clips).

Reads ``dataset_moodoo/moodo_dataset`` (git-ignored; its own terms apply, nothing from it is
committed), analyzes the 200 clips with the current pipeline and compares each clip's signature
mean hue / lightness / chroma (weighted by hits) with the mean human colour choice (49-colour HSV
palette -> OKLCH). Reports correlations with bootstrap CIs, the human split-half ceiling, per-clip
agreement and the relation to perceived valence / arousal.

Outputs go to ``out/moodo/`` (git-ignored): ``clips.csv``, ``report.txt``, ``scatter.png``.
"""

from __future__ import annotations

import argparse
import colorsys
import csv
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from _corpus import ROOT
from PIL import Image, ImageDraw, ImageFont
from scipy import stats

from synesthesia.color import (
    linear_srgb_to_oklab,
    oklab_to_oklch,
    srgb8_to_linear,
)
from synesthesia.config import load_config
from synesthesia.errors import SynError
from synesthesia.pipeline import analyze

DATA = ROOT / "dataset_moodoo" / "moodo_dataset"
OUT = ROOT / "out" / "moodo"
N_BOOT = 2000
N_SPLITS = 200
MIN_CLIP_S = (
    10.0  # Moodo clips are 14-25 s; the product minimum (20 s) is relaxed for this study only
)
MIN_RATERS_PER_HALF = 3
_TWO_PI = 2.0 * np.pi


# ---------------------------------------------------------------------------- dataset
def hsv_to_oklch(h: float, s: float, v: float) -> tuple[float, float, float]:
    """HSV in [0, 1] to OKLCH (L, C, hue degrees)."""
    rgb = np.array(colorsys.hsv_to_rgb(h, s, v))
    lin = srgb8_to_linear(np.rint(rgb * 255.0).astype(np.uint8).reshape(1, 3))
    lch = oklab_to_oklch(linear_srgb_to_oklab(lin))[0]
    return float(lch[0]), float(lch[1]), float(lch[2])


def load_ratings(path: Path) -> list[dict[str, float | str]]:
    """One dict per (rater, song): colour (HSV, OKLCH) and the mean perceived valence / arousal."""
    root = ET.parse(path).getroot()
    rows: list[dict[str, float | str]] = []
    for u in root.findall("item"):
        uid = u.findtext("UserID") or ""
        songs = u.find("Songs")
        if songs is None:
            continue
        for it in songs.findall("item"):
            col = it.find("SongColor")
            if col is None:
                continue
            h, s, v = (float(col.findtext(k) or 0.0) for k in ("H", "S", "V"))
            vs, as_ = [], []
            per = it.find("Perceived")
            if per is not None:
                for emo in per:
                    vs.append(float(emo.findtext("V") or "nan"))
                    as_.append(float(emo.findtext("A") or "nan"))
            L, C, hue = hsv_to_oklch(h, s, v)
            rows.append(
                {
                    "user": uid,
                    "song": it.findtext("SongID") or "",
                    "h": h,
                    "s": s,
                    "v": v,
                    "L": L,
                    "C": C,
                    "hue": hue,
                    "val": float(np.nanmean(vs)) if vs else float("nan"),
                    "aro": float(np.nanmean(as_)) if as_ else float("nan"),
                }
            )
    return rows


# ---------------------------------------------------------------------------- circular stats
def circ_mean_deg(angle_deg: np.ndarray, w: np.ndarray | None = None) -> float:
    a = np.deg2rad(angle_deg)
    w = np.ones_like(a) if w is None else w
    return float(np.rad2deg(np.arctan2((w * np.sin(a)).sum(), (w * np.cos(a)).sum())) % 360.0)


def circ_resultant(angle_deg: np.ndarray) -> float:
    a = np.deg2rad(angle_deg)
    return float(np.hypot(np.cos(a).mean(), np.sin(a).mean()))


def circ_corr(a_deg: np.ndarray, b_deg: np.ndarray) -> float:
    """Jammalamadaka-SenGupta circular-circular correlation."""
    a, b = np.deg2rad(a_deg), np.deg2rad(b_deg)
    am = np.arctan2(np.sin(a).sum(), np.cos(a).sum())
    bm = np.arctan2(np.sin(b).sum(), np.cos(b).sum())
    sa, sb = np.sin(a - am), np.sin(b - bm)
    den = np.sqrt((sa**2).sum() * (sb**2).sum())
    return float((sa * sb).sum() / den) if den > 0 else float("nan")


def circ_lin_corr(theta_deg: np.ndarray, x: np.ndarray) -> float:
    """Mardia circular-linear correlation R in [0, 1]."""
    t = np.deg2rad(theta_deg)
    c, s = np.cos(t), np.sin(t)
    rxc, rxs, rcs = (np.corrcoef(x, c)[0, 1], np.corrcoef(x, s)[0, 1], np.corrcoef(c, s)[0, 1])
    r2 = (rxc**2 + rxs**2 - 2 * rxc * rxs * rcs) / (1 - rcs**2)
    return float(np.sqrt(max(r2, 0.0)))


def ang_diff_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return (a - b + 180.0) % 360.0 - 180.0


def boot_ci(fn, *arrays: np.ndarray, rng: np.random.Generator) -> tuple[float, float]:  # type: ignore[no-untyped-def]
    n = arrays[0].shape[0]
    vals = []
    for _ in range(N_BOOT):
        idx = rng.integers(0, n, n)
        v = fn(*(a[idx] for a in arrays))
        if np.isfinite(v):
            vals.append(v)
    return float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))


# ---------------------------------------------------------------------------- signature stats
def signature_stats(npz: dict[str, np.ndarray]) -> tuple[float, float, float]:
    """Mean L, C, hue of a signature, weighted by hits (empty cells carry no weight)."""
    lch = npz["color_oklch"].astype(np.float64)
    w = npz["hits"].astype(np.float64)
    w = w / w.sum()
    L = float((w * lch[:, 0]).sum())
    C = float((w * lch[:, 1]).sum())
    hue = circ_mean_deg(lch[:, 2], w * np.maximum(lch[:, 1], 1e-6))
    return L, C, hue


def scatter_sheet(panels: list[tuple[str, np.ndarray, np.ndarray, str]], path: Path) -> None:
    w, h, pad = 420, 420, 46
    sheet = Image.new("RGB", (w * len(panels), h + 30), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=13)
    for i, (title, x, y, note) in enumerate(panels):
        ox = i * w
        d.text((ox + 10, 6), title, fill=(235, 235, 235), font=font)
        d.text((ox + 10, h + 8), note, fill=(160, 160, 160), font=font)
        ok = np.isfinite(x) & np.isfinite(y)
        lo = float(min(x[ok].min(), y[ok].min()))
        hi = float(max(x[ok].max(), y[ok].max()))
        span = max(hi - lo, 1e-9)
        d.rectangle((ox + pad, 28, ox + w - 14, h - pad + 10), outline=(70, 70, 70))
        for xv, yv in zip(x[ok], y[ok], strict=True):
            px = ox + pad + (xv - lo) / span * (w - pad - 14)
            py = h - pad + 10 - (yv - lo) / span * (h - pad - 18)
            d.ellipse((px - 2, py - 2, px + 2, py + 2), fill=(120, 190, 255))
    sheet.save(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    config = load_config(overrides={"ingest": {"min_duration_s": MIN_CLIP_S}})
    rng = np.random.default_rng([config.seed, 5])
    args.out.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []

    def say(s: str = "") -> None:
        lines.append(s)
        sys.stdout.write(s + "\n")

    # 1. human data -------------------------------------------------------------------
    rows = load_ratings(args.data / "dataset.xml")
    songs = sorted({str(r["song"]) for r in rows}, key=int)
    say(f"ratings {len(rows)} from {len({r['user'] for r in rows})} raters over {len(songs)} clips")
    by_song = {s: [r for r in rows if r["song"] == s] for s in songs}
    achro = float(np.mean([r["s"] == 0.0 for r in rows]))
    say(f"achromatic choices (S = 0: black/grey/white): {achro:.1%} of ratings")

    # 2. our pipeline on the clips ------------------------------------------------------
    cache = args.out / "signatures"
    cache.mkdir(exist_ok=True)
    ours: dict[str, tuple[float, float, float]] = {}
    failed: list[str] = []
    for s in songs:
        npz_path = cache / f"{s}.npz"
        if not npz_path.is_file():
            try:
                res = analyze(args.data / "audio" / f"{s}.mp3", config)
            except SynError as exc:
                failed.append(f"{s}: {exc.code}")
                continue
            np.savez(
                npz_path,
                color_oklch=res.colors.oklch.astype(np.float32),
                hits=res.stats.hits,
                fingerprint=res.fingerprint,
                duration=np.float64(res.ingest.duration_s),
            )
        with np.load(npz_path) as z:
            ours[s] = signature_stats({k: z[k] for k in z.files})
    say(f"analyzed {len(ours)} clips; failed {len(failed)} {failed[:5]}")

    # 3. per-clip human statistics -------------------------------------------------------
    clip_ids = [s for s in songs if s in ours]
    H = {
        k: np.full(len(clip_ids), np.nan)
        for k in ("L", "C", "hue", "R", "sdL", "sdC", "val", "aro", "n", "achro")
    }
    for i, s in enumerate(clip_ids):
        rs = by_song[s]
        L = np.array([r["L"] for r in rs], dtype=float)
        C = np.array([r["C"] for r in rs], dtype=float)
        hue = np.array([r["hue"] for r in rs], dtype=float)
        chroma_mask = np.array([r["s"] > 0 for r in rs])
        H["L"][i], H["C"][i] = L.mean(), C.mean()
        H["sdL"][i], H["sdC"][i] = L.std(ddof=1), C.std(ddof=1)
        H["n"][i], H["achro"][i] = len(rs), 1.0 - chroma_mask.mean()
        if chroma_mask.sum() >= 3:
            H["hue"][i] = circ_mean_deg(hue[chroma_mask], C[chroma_mask])
            H["R"][i] = circ_resultant(hue[chroma_mask])
        H["val"][i] = np.nanmean([r["val"] for r in rs])
        H["aro"][i] = np.nanmean([r["aro"] for r in rs])
    O = {
        "L": np.array([ours[s][0] for s in clip_ids]),
        "C": np.array([ours[s][1] for s in clip_ids]),
        "hue": np.array([ours[s][2] for s in clip_ids]),
    }
    say(
        f"raters per clip: min {int(H['n'].min())}, median {int(np.median(H['n']))}, "
        f"max {int(H['n'].max())}"
    )

    # 4. ceilings: split-half reliability across clips (Spearman-Brown) ------------------------
    def split_half() -> dict[str, float]:
        res = {"L": [], "C": [], "hue": []}
        for _ in range(N_SPLITS):
            a = {"L": [], "C": [], "hue": []}
            b = {"L": [], "C": [], "hue": []}
            for s in clip_ids:
                rs = by_song[s]
                perm = rng.permutation(len(rs))
                half = len(rs) // 2
                for part, idxs in ((a, perm[:half]), (b, perm[half : 2 * half])):
                    sel = [rs[j] for j in idxs]
                    part["L"].append(np.mean([r["L"] for r in sel]))
                    part["C"].append(np.mean([r["C"] for r in sel]))
                    ch = [r for r in sel if r["s"] > 0]
                    part["hue"].append(
                        circ_mean_deg(
                            np.array([r["hue"] for r in ch]), np.array([r["C"] for r in ch])
                        )
                        if len(ch) >= MIN_RATERS_PER_HALF
                        else np.nan
                    )
            for k in ("L", "C"):
                r = np.corrcoef(a[k], b[k])[0, 1]
                res[k].append(2 * r / (1 + r))
            ha, hb = np.array(a["hue"]), np.array(b["hue"])
            ok = np.isfinite(ha) & np.isfinite(hb)
            r = circ_corr(ha[ok], hb[ok])
            res["hue"].append(2 * r / (1 + r))
        return {k: float(np.mean(v)) for k, v in res.items()}

    ceil = split_half()

    # 5. correlations with CIs ------------------------------------------------------------
    say("")
    say(f"=== signature vs human mean colour per clip (n = {len(clip_ids)} clips) ===")
    hue_ok = np.isfinite(H["hue"])
    results: dict[str, tuple[float, tuple[float, float]]] = {}
    for k, name in (("L", "lightness"), ("C", "chroma")):
        r = float(np.corrcoef(O[k], H[k])[0, 1])
        rho = float(stats.spearmanr(O[k], H[k]).statistic)
        ci = boot_ci(lambda a, b: np.corrcoef(a, b)[0, 1], O[k], H[k], rng=rng)
        results[k] = (r, ci)
        say(
            f"{name:10s} Pearson r = {r:+.3f}  95% CI [{ci[0]:+.3f}, {ci[1]:+.3f}]  "
            f"Spearman {rho:+.3f}   human split-half ceiling {ceil[k]:.3f}"
        )
    r = circ_corr(O["hue"][hue_ok], H["hue"][hue_ok])
    ci = boot_ci(circ_corr, O["hue"][hue_ok], H["hue"][hue_ok], rng=rng)
    results["hue"] = (r, ci)
    say(
        f"{'hue':10s} circular r = {r:+.3f}  95% CI [{ci[0]:+.3f}, {ci[1]:+.3f}]  "
        f"human split-half ceiling {ceil['hue']:.3f}  (n = {int(hue_ok.sum())})"
    )
    for k, name in (("L", "lightness"), ("C", "chroma")):
        say(f"  mean {name}: ours {O[k].mean():.3f} vs human {H[k].mean():.3f}")
    say(
        f"  mean hue: ours {circ_mean_deg(O['hue']):.0f} deg vs "
        f"human {circ_mean_deg(H['hue'][hue_ok]):.0f} deg"
    )
    say(
        f"  our hue range {O['hue'].min():.0f}-{O['hue'].max():.0f} deg; "
        f"human mean-hue spread R = {circ_resultant(H['hue'][hue_ok]):.2f}"
    )

    # 6. agreement per clip ------------------------------------------------------------------
    say("")
    say("=== human inter-rater agreement per clip ===")
    say(
        f"hue concentration R (1 = identical hue): median {np.nanmedian(H['R']):.2f}, "
        f"IQR {np.nanpercentile(H['R'], 25):.2f}-{np.nanpercentile(H['R'], 75):.2f}"
    )
    say(
        f"lightness SD across raters: median {np.median(H['sdL']):.3f}; "
        f"chroma SD: {np.median(H['sdC']):.3f}"
    )
    say(f"achromatic share per clip: median {np.median(H['achro']):.1%}")

    dh = np.full(len(clip_ids), np.nan)
    dh[hue_ok] = np.abs(ang_diff_deg(O["hue"][hue_ok], H["hue"][hue_ok]))
    dL = O["L"] - H["L"]
    dC = O["C"] - H["C"]
    # standardized overall disagreement: z-scored |L diff| after removing the mean offset, + hue
    zL = np.abs((dL - dL.mean()) / dL.std())
    zC = np.abs((dC - dC.mean()) / dC.std())
    score = zL + zC + np.nan_to_num(dh / 45.0)

    order = np.argsort(score)
    say("closest agreement (clip: our L/C/hue | human L/C/hue | raters R):")
    for i in order[:8]:
        say(
            f"  {clip_ids[i]:>4s}: {O['L'][i]:.2f}/{O['C'][i]:.2f}/{O['hue'][i]:3.0f} | "
            f"{H['L'][i]:.2f}/{H['C'][i]:.2f}/{H['hue'][i]:3.0f} | R {H['R'][i]:.2f}"
        )
    say("largest disagreement:")
    for i in order[::-1][:8]:
        say(
            f"  {clip_ids[i]:>4s}: {O['L'][i]:.2f}/{O['C'][i]:.2f}/{O['hue'][i]:3.0f} | "
            f"{H['L'][i]:.2f}/{H['C'][i]:.2f}/{H['hue'][i]:3.0f} | R {H['R'][i]:.2f}"
        )

    # 7. emotion ----------------------------------------------------------------------------
    say("")
    say(
        "=== relation to perceived emotion (per-clip mean valence / arousal, n = %d) ==="
        % len(clip_ids)
    )
    val, aro = H["val"], H["aro"]
    say(f"valence-arousal correlation across clips: r = {np.corrcoef(val, aro)[0, 1]:+.2f}")
    say(f"{'':22s}{'valence':>10s}{'arousal':>10s}")
    for label, x in (
        ("human lightness", H["L"]),
        ("our lightness", O["L"]),
        ("human chroma", H["C"]),
        ("our chroma", O["C"]),
    ):
        say(
            f"{label:22s}{stats.spearmanr(x, val).statistic:+10.2f}{stats.spearmanr(x, aro).statistic:+10.2f}   (Spearman)"
        )
    say(
        f"{'human hue (circ-lin R)':22s}{circ_lin_corr(H['hue'][hue_ok], val[hue_ok]):10.2f}"
        f"{circ_lin_corr(H['hue'][hue_ok], aro[hue_ok]):10.2f}"
    )
    say(
        f"{'our hue (circ-lin R)':22s}{circ_lin_corr(O['hue'], val):10.2f}{circ_lin_corr(O['hue'], aro):10.2f}"
    )
    say("do the differences track emotion? (Spearman of our-minus-human with V, A)")
    say(
        f"  lightness diff: V {stats.spearmanr(dL, val).statistic:+.2f}  A {stats.spearmanr(dL, aro).statistic:+.2f}"
    )
    say(
        f"  chroma diff:    V {stats.spearmanr(dC, val).statistic:+.2f}  A {stats.spearmanr(dC, aro).statistic:+.2f}"
    )
    d_ok = np.isfinite(dh)
    say(
        f"  |hue diff|:     V {stats.spearmanr(dh[d_ok], val[d_ok]).statistic:+.2f}  "
        f"A {stats.spearmanr(dh[d_ok], aro[d_ok]).statistic:+.2f}"
    )

    # 8. outputs --------------------------------------------------------------------------------
    with (args.out / "clips.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "clip",
                "n_raters",
                "our_L",
                "our_C",
                "our_hue",
                "human_L",
                "human_C",
                "human_hue",
                "human_hue_R",
                "achromatic_share",
                "perc_valence",
                "perc_arousal",
            ]
        )
        for i, s in enumerate(clip_ids):
            w.writerow(
                [
                    s,
                    int(H["n"][i]),
                    *(
                        f"{v:.4f}"
                        for v in (
                            O["L"][i],
                            O["C"][i],
                            O["hue"][i],
                            H["L"][i],
                            H["C"][i],
                            H["hue"][i],
                            H["R"][i],
                            H["achro"][i],
                            H["val"][i],
                            H["aro"][i],
                        )
                    ),
                ]
            )
    scatter_sheet(
        [
            ("lightness: ours (x) vs human (y)", O["L"], H["L"], f"r = {results['L'][0]:+.2f}"),
            ("chroma: ours (x) vs human (y)", O["C"], H["C"], f"r = {results['C'][0]:+.2f}"),
            (
                "hue (deg): ours (x) vs human (y)",
                O["hue"][hue_ok],
                H["hue"][hue_ok],
                f"circular r = {results['hue'][0]:+.2f}",
            ),
        ],
        args.out / "scatter.png",
    )
    (args.out / "report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
