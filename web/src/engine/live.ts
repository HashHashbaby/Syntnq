// Liquid-grid state machine: a port of LiveEngine in src/synesthesia/live.py (docs/LIVE.md
// section 2). The response field, smoothing, diffusion, ripples, trail and per-cell colour all
// run here on preallocated typed arrays; the GPU only composites the pooled result.
import { oklchToSrgb8Fast } from "../color/oklab";
import type { LiveStream, Prototypes } from "../data/formats";
import type { LiveParams, Params } from "../params";
import { WaveField, type WaveInputs } from "./wave";

const BYTE_MAX = 255;
const MIN_LIVE_LIGHTNESS = 0.05;
const RIPPLE_END_DECAYS = 5;
const SWELL_MAX = 0.12;
const RENORM_FLOOR = 1e-12;
const GAUSS_TRUNCATE = 4.0; // scipy.ndimage.gaussian_filter default
const MAX_RIPPLES = 16;

export interface EngineFrame {
  srgb: Uint8Array; // (K, 3) cell colours
  activation: Float32Array; // (K)
  radiusScale: Float32Array; // (K)
  trail: Float32Array; // (trailLength, 3): x_cell, y_cell, age fraction (oldest first)
  trailLength: number;
  bmu: number;
  beatFlash: boolean;
  /** (K) wave height -1..1 for the 3D chips (D-056); zero under reduced motion. */
  height: Float32Array;
}

interface Ripple {
  t0: number;
  cx: number;
  cy: number;
  amp: number;
}

export interface EngineOptions {
  reducedMotion?: boolean;
  nominalDt?: number;
}

export class LiveEngine {
  readonly size: number;
  readonly cells: number;
  private readonly dim: number;
  private readonly p2: Float64Array;
  private a: Float64Array;
  private readonly resp: Float64Array;
  private readonly blurTmp: Float64Array;
  private readonly blurOut: Float64Array;
  private readonly mean8: Float64Array;
  private readonly ring: Float64Array;
  private readonly xs: Float64Array;
  private readonly colorN = new Float64Array(5);
  private ripples: Ripple[] = [];
  private lastS: number | null = null;
  private readonly lv: LiveParams;
  private readonly hueFrom: number;
  private readonly hueTo: number;
  private readonly chromaMin: number;
  private readonly chromaMax: number;
  private readonly trailMax: number;
  private readonly frame: EngineFrame;
  private readonly wave: WaveField;
  private readonly waveInputs: WaveInputs;
  reducedMotion: boolean;
  nominalDt: number;

  constructor(
    private readonly stream: LiveStream,
    private readonly protos: Prototypes,
    private readonly staticOklch: Float32Array,
    p: Params,
    opts: EngineOptions = {},
  ) {
    this.size = p.grid.size;
    this.cells = this.size * this.size;
    this.dim = protos.dim;
    this.lv = p.live;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.nominalDt = opts.nominalDt ?? 1 / 30;
    this.hueFrom = p.color.hue.from_deg;
    this.hueTo = p.color.hue.to_deg;
    this.chromaMin = p.color.chroma.min;
    this.chromaMax = p.color.chroma.max;
    this.p2 = new Float64Array(this.cells);
    for (let i = 0; i < this.cells; i++) {
      let s = 0;
      for (let d = 0; d < this.dim; d++) {
        const v = protos.w[i * this.dim + d];
        s += v * v;
      }
      this.p2[i] = s;
    }
    this.a = new Float64Array(this.cells);
    this.resp = new Float64Array(this.cells);
    this.blurTmp = new Float64Array(this.cells);
    this.blurOut = new Float64Array(this.cells);
    this.mean8 = new Float64Array(this.cells);
    this.ring = new Float64Array(this.cells);
    this.xs = new Float64Array(this.dim);
    this.trailMax = Math.max(2, Math.round(this.lv.trail.length_s * stream.fps));
    this.frame = {
      srgb: new Uint8Array(this.cells * 3),
      activation: new Float32Array(this.cells),
      radiusScale: new Float32Array(this.cells),
      trail: new Float32Array(this.trailMax * 3),
      trailLength: 0,
      bmu: 0,
      beatFlash: false,
      height: new Float32Array(this.cells),
    };
    this.wave = new WaveField(this.size, p.live.flow);
    const strong: number[] = [];
    for (const b of stream.beatTimes) if (this.lerpScalar(stream.onset, b) / BYTE_MAX >= this.lv.ripple.onset_threshold) strong.push(b);
    const at = (t: number): { cx: number; cy: number } => {
      const cell = this.nearestBmu(t);
      return { cx: cell % this.size, cy: Math.floor(cell / this.size) };
    };
    this.waveInputs = {
      sourceAt: (t) => ({ ...at(t), amp: this.lerpScalar(stream.loud, t) / BYTE_MAX }),
      beats: Float64Array.from(strong),
      beatAt: (t) => ({ ...at(t), amp: this.lerpScalar(stream.onset, t) / BYTE_MAX }),
    };
  }

  // -- stream access -----------------------------------------------------------------------
  private locate(s: number): { t0: number; t1: number; a: number } {
    const n = this.stream.frames;
    const f = Math.min(Math.max(s * this.stream.fps, 0), n - 1);
    const t0 = Math.floor(f);
    return { t0, t1: Math.min(t0 + 1, n - 1), a: f - t0 };
  }

  private lerpScalar(arr: Uint8Array, s: number): number {
    const { t0, t1, a } = this.locate(s);
    return (1 - a) * arr[t0] + a * arr[t1];
  }

  private nearestBmu(s: number): number {
    const { t0, a } = this.locate(s);
    return this.stream.bmu[Math.min(t0 + (a >= 0.5 ? 1 : 0), this.stream.frames - 1)];
  }

  // -- response ----------------------------------------------------------------------------
  private response(s: number): void {
    const { t0, t1, a } = this.locate(s);
    const D = this.dim;
    const x = this.xs;
    let xx = 0;
    for (let d = 0; d < D; d++) {
      const v = (1 - a) * this.stream.x[t0 * D + d] + a * this.stream.x[t1 * D + d];
      x[d] = v;
      xx += v * v;
    }
    const w = this.protos.w;
    let dmin = Infinity;
    const r = this.resp;
    for (let i = 0; i < this.cells; i++) {
      let dot = 0;
      const o = i * D;
      for (let d = 0; d < D; d++) dot += w[o + d] * x[d];
      const d2 = Math.max(this.p2[i] - 2 * dot + xx, 0);
      r[i] = d2;
      if (d2 < dmin) dmin = d2;
    }
    const k = -1 / (2 * this.stream.tau * this.stream.tau);
    for (let i = 0; i < this.cells; i++) r[i] = Math.exp((r[i] - dmin) * k);
  }

  private blurredResponse(s: number): Float64Array {
    const loud = this.lerpScalar(this.stream.loud, s) / BYTE_MAX;
    const [lo, hi] = this.lv.glow_sigma_cells;
    const sigma = lo + (hi - lo) * loud;
    this.response(s);
    this.gaussian(this.resp, this.blurOut, sigma);
    if (this.lv.blur_renormalize) {
      let mx = 0;
      for (let i = 0; i < this.cells; i++) if (this.blurOut[i] > mx) mx = this.blurOut[i];
      const inv = 1 / Math.max(mx, RENORM_FLOOR);
      for (let i = 0; i < this.cells; i++) this.blurOut[i] *= inv;
    }
    return this.blurOut;
  }

  /** Separable Gaussian, edge-clamped ("nearest"), kernel as scipy.ndimage.gaussian_filter. */
  private gaussian(src: Float64Array, dst: Float64Array, sigma: number): void {
    const n = this.size;
    const radius = Math.floor(GAUSS_TRUNCATE * sigma + 0.5);
    const kernel = new Float64Array(2 * radius + 1);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-0.5 * (i / sigma) * (i / sigma));
      kernel[i + radius] = v;
      sum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    const tmp = this.blurTmp;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.min(Math.max(x + k, 0), n - 1);
          acc += kernel[k + radius] * src[y * n + xx];
        }
        tmp[y * n + x] = acc;
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(Math.max(y + k, 0), n - 1);
          acc += kernel[k + radius] * tmp[yy * n + x];
        }
        dst[y * n + x] = acc;
      }
    }
  }

  // -- state updates -----------------------------------------------------------------------
  reset(s: number): void {
    this.wave.reset(s);
    this.frame.height.fill(0);
    this.a.set(this.blurredResponse(s));
    this.ripples = [];
    this.lastS = s;
  }

  step(s: number): EngineFrame {
    const lv = this.lv;
    if (this.lastS === null) this.reset(s);
    const prev = this.lastS as number;
    const dt = Math.max(s - prev, 0);
    const r = this.blurredResponse(s);

    const releaseMs = this.reducedMotion ? lv.reduced_motion.release_ms : lv.release_ms;
    const kUp = 1 - Math.exp(-dt / (lv.attack_ms / 1000));
    const kDown = 1 - Math.exp(-dt / (releaseMs / 1000));
    const a = this.a;
    for (let i = 0; i < this.cells; i++) a[i] += (r[i] - a[i]) * (r[i] > a[i] ? kUp : kDown);

    const diffuse = !(this.reducedMotion && !lv.reduced_motion.diffusion);
    if (diffuse) {
      for (let pass = 0; pass < lv.diffusion_passes; pass++) this.diffusion(lv.diffusion_rate);
    }

    const flash = this.spawnRipples(prev, s);
    this.lastS = s;
    this.ringField(s);
    const f = this.frame;
    const swell = this.reducedMotion ? 0 : 1;
    for (let i = 0; i < this.cells; i++) {
      const ai = a[i];
      const act = Math.min(Math.max(ai + this.ring[i], 0), 1);
      f.activation[i] = act;
      f.radiusScale[i] = 1 + SWELL_MAX * Math.min(Math.max(ai, 0), 1) * swell;
    }
    this.colors(s, f.activation, f.srgb);
    if (this.reducedMotion) f.height.fill(0);
    else {
      this.wave.advance(s, this.waveInputs);
      const h = this.wave.h;
      for (let i = 0; i < this.cells; i++) f.height[i] = h[i];
    }
    this.trail(s);
    f.bmu = this.nearestBmu(s);
    f.beatFlash = flash;
    return f;
  }

  private diffusion(rate: number): void {
    const n = this.size;
    const a = this.a;
    const m = this.mean8;
    for (let y = 0; y < n; y++) {
      const y0 = Math.max(y - 1, 0), y1 = Math.min(y + 1, n - 1);
      for (let x = 0; x < n; x++) {
        const x0 = Math.max(x - 1, 0), x1 = Math.min(x + 1, n - 1);
        // 3x3 neighbourhood with the centre excluded, edge-clamped like scipy mode="nearest"
        const s =
          a[y0 * n + x0] + a[y0 * n + x] + a[y0 * n + x1] +
          a[y * n + x0] + a[y * n + x1] +
          a[y1 * n + x0] + a[y1 * n + x] + a[y1 * n + x1];
        m[y * n + x] = s / 8;
      }
    }
    for (let i = 0; i < this.cells; i++) a[i] = (1 - rate) * a[i] + rate * m[i];
  }

  // -- ripples -----------------------------------------------------------------------------
  private spawnRipples(sPrev: number, s: number): boolean {
    const beats = this.stream.beatTimes;
    const step = s > sPrev ? s - sPrev : this.nominalDt;
    const lo = s - 0.5 * step, hi = s + 0.5 * step;
    let crossed = false;
    const rp = this.lv.ripple;
    const allowRipples = !(this.reducedMotion && !this.lv.reduced_motion.ripples);
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (b > hi) break;
      if (b <= lo) continue;
      crossed = true;
      if (!allowRipples) continue;
      const onset = this.lerpScalar(this.stream.onset, b) / BYTE_MAX;
      if (onset >= rp.onset_threshold) {
        const { t0, a } = this.locate(b);
        const cell = this.stream.bmu[Math.min(t0 + (a >= 0.5 ? 1 : 0), this.stream.frames - 1)];
        this.ripples.push({ t0: b, cx: cell % this.size, cy: Math.floor(cell / this.size), amp: rp.amplitude * onset });
      }
    }
    if (this.ripples.length > rp.max_concurrent) {
      this.ripples.splice(0, this.ripples.length - Math.min(rp.max_concurrent, MAX_RIPPLES));
    }
    return crossed;
  }

  private ringField(s: number): void {
    const rp = this.lv.ripple;
    this.ring.fill(0);
    const alive: Ripple[] = [];
    const n = this.size;
    for (const r of this.ripples) {
      const age = Math.max(s - r.t0, 0);
      if (age > RIPPLE_END_DECAYS * rp.decay_s) continue;
      alive.push(r);
      const radius = rp.speed_cells_per_s * age;
      const fade = r.amp * Math.exp(-age / rp.decay_s);
      const inv = 1 / (2 * rp.width_cells * rp.width_cells);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dist = Math.hypot(x - r.cx, y - r.cy);
          const dd = dist - radius;
          this.ring[y * n + x] += fade * Math.exp(-dd * dd * inv);
        }
      }
    }
    this.ripples = alive;
  }

  // -- trail and colour ----------------------------------------------------------------------
  private trail(s: number): void {
    const f = this.frame;
    if (this.reducedMotion) {
      f.trailLength = 0;
      return;
    }
    const n = this.trailMax;
    const { t0 } = this.locate(s);
    const lo = Math.max(0, t0 - n + 1);
    let k = 0;
    for (let t = lo; t <= t0; t++) {
      const cell = this.stream.bmu[t];
      f.trail[k * 3] = cell % this.size;
      f.trail[k * 3 + 1] = Math.floor(cell / this.size);
      f.trail[k * 3 + 2] = (t0 - t) / n;
      k++;
    }
    f.trailLength = k;
  }

  private colors(s: number, act: Float32Array, out: Uint8Array): void {
    const lv = this.lv;
    const cn = this.colorN;
    const { t0, t1, a } = this.locate(s);
    for (let c = 0; c < 5; c++) cn[c] = ((1 - a) * this.stream.color[t0 * 5 + c] + a * this.stream.color[t1 * 5 + c]) / BYTE_MAX;
    const liveH = this.hueFrom + (this.hueTo - this.hueFrom) * cn[0];
    const liveC = this.chromaMin + (this.chromaMax - this.chromaMin) * cn[3];
    const swing = lv.global_lightness_swing * (2 * cn[1] - 1);
    const st = this.staticOklch;
    for (let i = 0; i < this.cells; i++) {
      const g = act[i];
      const m = Math.min(lv.global_mix + lv.live_mix_max * g, 1);
      const baseL = st[i * 3], baseC = st[i * 3 + 1], baseH = st[i * 3 + 2];
      const arc = liveH - baseH;
      const L = Math.min(Math.max(baseL + lv.live_lightness_boost * g + swing, MIN_LIVE_LIGHTNESS), lv.max_lightness);
      const C = ((1 - m) * baseC + m * liveC) * lv.live_chroma_gain;
      let H = (baseH + m * arc) % 360;
      if (H < 0) H += 360;
      oklchToSrgb8Fast(L, C, H, out, i * 3);
    }
  }
}
