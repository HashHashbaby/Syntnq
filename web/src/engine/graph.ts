// The live trail chart (D-062), pure part: no DOM, unit-tested.
// x = loudness in dBFS (frame RMS), y = brightness as spectral centroid in Hz (log axis). Both come from
// live.bin `color_t`, which stores them normalised over the frozen calibration ranges (u8, clipped), so
// they read back exactly: value = lo + q / 255 x (hi - lo). The trail is a function of the audio time s
// alone (the frames of the last `trail_s` up to s, plus the interpolated point at s, as the grid's trail
// and LIVE.md 2.1), so the chart and the grid can never disagree about where the song is.
// All numbers: config ui.trail_graph, color.ranges, color.hue.
import type { LiveStream } from "../data/formats";
import type { Params } from "../params";

const BYTE_MAX = 255;
const BRIGHT = 0; // color_t columns: brightness, loudness, noisiness, harmonicity, change
const LOUD = 1;
const COLS = 5;

export interface Axes {
  dbLo: number;
  dbHi: number;
  logHzLo: number;
  logHzHi: number;
}

export function axesFrom(p: Params): Axes {
  return { dbLo: p.ranges.loudness_dbfs[0], dbHi: p.ranges.loudness_dbfs[1], logHzLo: p.ranges.centroid_log10_hz[0], logHzHi: p.ranges.centroid_log10_hz[1] };
}

/** A stored byte back to its physical value over [lo, hi]. */
export function dequant(q: number, lo: number, hi: number): number {
  return lo + (q / BYTE_MAX) * (hi - lo);
}

/** Plot fractions (0..1, y up) of a loudness (dBFS) and a brightness (log10 Hz). */
export function plotXY(db: number, logHz: number, a: Axes): [number, number] {
  return [(db - a.dbLo) / (a.dbHi - a.dbLo), (logHz - a.logHzLo) / (a.logHzHi - a.logHzLo)];
}

/** Ticks inside the axis range, as plot fractions. */
export function ticks(values: number[], lo: number, hi: number, log: boolean): Array<{ value: number; at: number }> {
  return values
    .map((v) => ({ value: v, at: ((log ? Math.log10(v) : v) - lo) / (hi - lo) }))
    .filter((t) => t.at >= -1e-9 && t.at <= 1 + 1e-9);
}

/** "-24 dBFS", "1.6 kHz", "640 Hz". */
export function formatDb(db: number): string {
  return `${Math.round(db)} dBFS`;
}
export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1).replace(/\.0$/, "")} kHz` : `${Math.round(hz)} Hz`;
}

export interface GraphPoint {
  db: number;
  logHz: number;
  clipped: boolean; // outside the calibration range on either axis: pinned to the edge
}

export interface GraphTrail {
  /** (n, 3) x fraction, y fraction, age 0 (now) .. 1 (oldest), oldest first; the last row is the point at s. */
  pts: Float32Array;
  n: number;
  now: GraphPoint;
  /** brightness of the point at s, normalised 0..1 (drives its colour, as in the grid) */
  brightNorm: number;
}

export class GraphSampler {
  readonly axes: Axes;
  private readonly frames: number; // trail frames, as the grid's trail
  private readonly out: GraphTrail;

  constructor(
    private readonly stream: LiveStream,
    private readonly p: Params,
  ) {
    this.axes = axesFrom(p);
    this.frames = Math.max(2, Math.round(p.ui.trail_graph.trail_s * stream.fps));
    this.out = { pts: new Float32Array((this.frames + 1) * 3), n: 0, now: { db: 0, logHz: 0, clipped: false }, brightNorm: 0 };
  }

  private q(t: number, col: number): number {
    return this.stream.color[t * COLS + col];
  }

  /** The point of frame t. */
  point(t: number): GraphPoint {
    const a = this.axes;
    const qb = this.q(t, BRIGHT), ql = this.q(t, LOUD);
    return { db: dequant(ql, a.dbLo, a.dbHi), logHz: dequant(qb, a.logHzLo, a.logHzHi), clipped: qb === 0 || qb === BYTE_MAX || ql === 0 || ql === BYTE_MAX };
  }

  /** Trail and current point at audio time s (seconds, analysis time). */
  at(s: number): GraphTrail {
    const st = this.stream;
    const last = st.frames - 1;
    const f = Math.min(Math.max(s * st.fps, 0), last);
    const t0 = Math.floor(f);
    const t1 = Math.min(t0 + 1, last);
    const k = f - t0;
    const lo = Math.max(0, t0 - this.frames + 1);
    const span = this.p.ui.trail_graph.trail_s;
    const o = this.out;
    let n = 0;
    for (let t = lo; t <= t0; t++) {
      const pt = this.point(t);
      const [x, y] = plotXY(pt.db, pt.logHz, this.axes);
      o.pts[n * 3] = x;
      o.pts[n * 3 + 1] = y;
      o.pts[n * 3 + 2] = Math.min(Math.max((s - t / st.fps) / span, 0), 1);
      n++;
    }
    // the point at s, interpolated between frames like the engine (LIVE.md 2.1)
    const qb = (1 - k) * this.q(t0, BRIGHT) + k * this.q(t1, BRIGHT);
    const ql = (1 - k) * this.q(t0, LOUD) + k * this.q(t1, LOUD);
    const a = this.axes;
    o.now = { db: dequant(ql, a.dbLo, a.dbHi), logHz: dequant(qb, a.logHzLo, a.logHzHi), clipped: qb <= 0 || qb >= BYTE_MAX || ql <= 0 || ql >= BYTE_MAX };
    const [x, y] = plotXY(o.now.db, o.now.logHz, a);
    o.pts[n * 3] = x;
    o.pts[n * 3 + 1] = y;
    o.pts[n * 3 + 2] = 0;
    n++;
    o.n = n;
    o.brightNorm = qb / BYTE_MAX;
    return o;
  }

  /** Whole-song density, (bins x bins) 0..1, row 0 = brightest, Gaussian-blurred, peak 1. */
  density(): Float32Array {
    const g = this.p.ui.trail_graph;
    const b = g.cloud_bins;
    const h = new Float32Array(b * b);
    for (let t = 0; t < this.stream.frames; t++) {
      const cx = Math.min(b - 1, Math.floor((this.q(t, LOUD) / BYTE_MAX) * b));
      const cy = Math.min(b - 1, Math.floor((1 - this.q(t, BRIGHT) / BYTE_MAX) * b));
      h[cy * b + cx] += 1;
    }
    const r = Math.max(1, Math.ceil(g.cloud_sigma_bins * 3));
    const w: number[] = [];
    for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * g.cloud_sigma_bins * g.cloud_sigma_bins)));
    const tmp = new Float32Array(b * b);
    const blur = (src: Float32Array, dst: Float32Array, dx: number, dy: number): void => {
      for (let y = 0; y < b; y++) {
        for (let x = 0; x < b; x++) {
          let acc = 0;
          for (let i = -r; i <= r; i++) {
            const xx = x + i * dx, yy = y + i * dy;
            if (xx < 0 || yy < 0 || xx >= b || yy >= b) continue;
            acc += src[yy * b + xx] * w[i + r];
          }
          dst[y * b + x] = acc;
        }
      }
    };
    blur(h, tmp, 1, 0);
    blur(tmp, h, 0, 1);
    let peak = 0;
    for (let i = 0; i < h.length; i++) peak = Math.max(peak, h[i]);
    if (peak > 0) for (let i = 0; i < h.length; i++) h[i] = Math.sqrt(h[i] / peak); // sqrt: rare regions stay visible
    return h;
  }
}
