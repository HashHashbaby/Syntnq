// Song comparison in the browser (M9, D-066): the same distance, score, label and top differences as
// synesthesia/compare.py, from the 133-value fingerprints the library stores (never pixel positions),
// so the bundled samples and offline songs compare too. Parity with Python is unit-tested.
// All corpus numbers: config compare (params.json), written by scripts/calibrate_compare.py.
import type { Params } from "../params";

export const SCALARS = ["tempo", "pulse_clarity", "loudness_range", "mean_loudness", "duration"] as const;
export const HIST_FEATURES = ["brightness", "loudness", "noisiness", "harmonicity", "change"] as const;
const JS_WEIGHT = 0.8; // docs/ANALYSIS.md section 9: 0.8 JS + 0.2 scalar
const SCALAR_WEIGHT = 0.2;

const WORDS: Record<string, [string, string]> = {
  brightness: ["brighter", "darker"],
  loudness: ["louder in its moments", "quieter in its moments"],
  noisiness: ["noisier", "more tonal"],
  harmonicity: ["more harmonic", "more percussive"],
  change: ["more changeable", "steadier"],
  tempo: ["faster", "slower"],
  pulse_clarity: ["more clearly pulsed", "looser in its pulse"],
  loudness_range: ["more dynamic", "more even in level"],
  mean_loudness: ["louder overall", "quieter overall"],
  duration: ["longer", "shorter"],
};

export interface Difference {
  key: string;
  weight: number;
  text: string;
}

export interface Comparison {
  distance: number;
  score: number; // 0-100: share of reference pairs farther apart
  label: string;
  topDifferences: Difference[];
}

function blocks(fp: ArrayLike<number>, p: Params): number[][] {
  const f = p.fingerprint;
  const sizes = [...Array(5).fill(f.hist_bins), f.hue_bins * f.lightness_bins] as number[];
  const out: number[][] = [];
  let o = 0;
  for (const n of sizes) {
    out.push(Array.from({ length: n }, (_, i) => fp[o + i]));
    o += n;
  }
  return out;
}

/** Jensen-Shannon divergence in bits, in [0, 1] (as fingerprint._js_divergence). */
export function jsDivergence(p: number[], q: number[]): number {
  const kl = (a: number[], m: number[]): number => a.reduce((s, ai, i) => (ai > 0 ? s + ai * Math.log2(ai / m[i]) : s), 0);
  const m = p.map((v, i) => 0.5 * (v + q[i]));
  return 0.5 * kl(p, m) + 0.5 * kl(q, m);
}

function scalars(fp: ArrayLike<number>, p: Params): number[] {
  const n = p.fingerprint.n_scalars;
  return Array.from({ length: n }, (_, i) => fp[fp.length - n + i]);
}

/** The five scalars back in physical units (BPM, 0-1, dB, dBFS, seconds). */
export function scalarValues(fp: ArrayLike<number>, p: Params): Record<(typeof SCALARS)[number], number> {
  const s = scalars(fp, p);
  return { tempo: 120 * 2 ** s[0], pulse_clarity: s[1], loudness_range: s[2] * 30, mean_loudness: s[3] * 60 - 60, duration: 180 * 2 ** s[4] };
}

export function distance(a: ArrayLike<number>, b: ArrayLike<number>, p: Params): number {
  const ba = blocks(a, p), bb = blocks(b, p);
  const js = ba.reduce((s, blk, i) => s + jsDivergence(blk, bb[i]), 0) / ba.length;
  const sa = scalars(a, p), sb = scalars(b, p);
  const norm = Math.sqrt(sa.reduce((s, v, i) => s + (v - sb[i]) ** 2, 0));
  return JS_WEIGHT * js + SCALAR_WEIGHT * Math.min(1, norm / p.compare.scalar_norm);
}

export function blockDifferences(a: ArrayLike<number>, b: ArrayLike<number>, p: Params): Record<string, number> {
  const ba = blocks(a, p), bb = blocks(b, p);
  const out: Record<string, number> = {};
  HIST_FEATURES.forEach((k, i) => (out[k] = jsDivergence(ba[i], bb[i])));
  out.palette = jsDivergence(ba[5], bb[5]);
  const sa = scalars(a, p), sb = scalars(b, p);
  SCALARS.forEach((k, i) => (out[k] = Math.abs(sa[i] - sb[i])));
  return out;
}

export function scoreOf(dist: number, pct: number[]): number {
  if (dist <= pct[0]) return 100;
  if (dist >= pct[pct.length - 1]) return 0;
  const step = 100 / (pct.length - 1);
  for (let i = 0; i < pct.length - 1; i++) {
    if (pct[i] <= dist && dist <= pct[i + 1]) {
      const frac = pct[i + 1] > pct[i] ? (dist - pct[i]) / (pct[i + 1] - pct[i]) : 0;
      return 100 - (i + frac) * step;
    }
  }
  return 0;
}

function histMean(h: number[]): number {
  const total = h.reduce((s, v) => s + v, 0);
  return total > 0 ? h.reduce((s, v, i) => s + v * ((i + 0.5) / h.length), 0) / total : 0.5;
}

function fmt(key: string, v: number): string {
  if (key === "tempo") return `${v.toFixed(0)} BPM`;
  if (key === "loudness_range") return `${v.toFixed(1)} dB`;
  if (key === "mean_loudness") return `${v.toFixed(1)} dBFS`;
  if (key === "duration") {
    const t = Math.round(v);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  }
  return v.toFixed(2);
}

function sentence(key: string, a: ArrayLike<number>, b: ArrayLike<number>, p: Params): string {
  if (key === "palette") return "The colour palettes differ (which hues and brightness levels the sounds take).";
  const [more, less] = WORDS[key];
  const hi = (HIST_FEATURES as readonly string[]).indexOf(key);
  if (hi >= 0) return `A is ${histMean(blocks(a, p)[hi]) >= histMean(blocks(b, p)[hi]) ? more : less} than B.`;
  const va = scalarValues(a, p)[key as (typeof SCALARS)[number]], vb = scalarValues(b, p)[key as (typeof SCALARS)[number]];
  if (key === "tempo") {
    const lo = p.compare.tempo_min_bpm;
    if (va < lo && vb < lo) return "Neither has a clear tempo.";
    if (va < lo || vb < lo) return `${va < lo ? "A" : "B"} has no clear tempo; the other moves at ${fmt(key, va < lo ? vb : va)}.`;
  }
  return `A is ${va >= vb ? more : less} than B (${fmt(key, va)} vs ${fmt(key, vb)}).`;
}

export function compare(a: ArrayLike<number>, b: ArrayLike<number>, p: Params): Comparison {
  const c = p.compare;
  const d = distance(a, b, p);
  const label = d < c.very_similar_below ? c.labels[0] : d > c.different_above ? c.labels[2] : c.labels[1];
  const raw = blockDifferences(a, b, p);
  const ranked = Object.entries(raw)
    .map(([k, v]) => [k, v / Math.max(c.block_medians[k] ?? 1, 1e-9)] as const)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return {
    distance: d,
    score: scoreOf(d, c.percentiles),
    label,
    topDifferences: ranked.filter(([, w]) => w >= c.min_weight).slice(0, c.top_n).map(([k, w]) => ({ key: k, weight: w, text: sentence(k, a, b, p) })),
  };
}

/** The `n` songs nearest to `fp` among `others` (id -> fingerprint), nearest first. */
export function nearest(fp: ArrayLike<number>, others: Array<{ id: string; fingerprint: ArrayLike<number> }>, p: Params, n = p.compare.similar_n): Array<{ id: string; distance: number }> {
  return others
    .map((o) => ({ id: o.id, distance: distance(fp, o.fingerprint, p) }))
    .sort((x, y) => x.distance - y.distance || (x.id < y.id ? -1 : 1))
    .slice(0, n);
}
