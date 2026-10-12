// River-ripple wave field (D-029 motion, D-046, D-056): a visual-only height on the 64 x 64 analysis
// grid that lifts and tilts the 3D chips. A damped 2D wave equation with an absorbing (sponge) border,
// carried by a gentle current with deterministic curl noise, fed by the best-matching cell scaled by
// loudness and by beat impulses. It is integrated at a fixed rate (`substep_hz`) up to the audio time,
// with sources sampled at every substep, so the surface at time s does not depend on the display
// frame rate. All parameters: config live.flow.
import type { FlowParams } from "../params";

export interface WaveSource {
  /** Source cell (column, row) and strength 0..1 (loudness). */
  cx: number;
  cy: number;
  amp: number;
}

export interface WaveInputs {
  /** The continuous source at analysis time t (seconds). */
  sourceAt: (t: number) => WaveSource;
  /** Beats with onset at or above the ripple threshold: time (s), cell and strength. */
  beats: ArrayLike<number>;
  beatAt: (t: number) => WaveSource | null;
}

const MAX_CATCH_UP_S = 0.5;

/** Integer hash -> [0, 1): the same on every platform (no trigonometric noise). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

export class WaveField {
  readonly size: number;
  readonly h: Float64Array;
  private v: Float64Array;
  private readonly hA: Float64Array;
  private readonly vA: Float64Array;
  private readonly sponge: Float64Array;
  private simT = 0;
  private readonly dt: number;

  constructor(size: number, private readonly p: FlowParams) {
    this.size = size;
    const k = size * size;
    this.h = new Float64Array(k);
    this.v = new Float64Array(k);
    this.hA = new Float64Array(k);
    this.vA = new Float64Array(k);
    this.sponge = new Float64Array(k);
    this.dt = 1 / p.substep_hz;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const edge = Math.min(x + 0.5, size - x - 0.5, y + 0.5, size - y - 0.5);
        const s = Math.min(Math.max(edge / p.sponge_cells, 0), 1);
        this.sponge[y * size + x] = (1 - s * s * (3 - 2 * s)) * p.sponge_damping;
      }
    }
  }

  /** Flat surface at analysis time t (a seek or a new start). */
  reset(t: number): void {
    this.h.fill(0);
    this.v.fill(0);
    this.simT = t;
  }

  /** Integrate from the last time to t (at most MAX_CATCH_UP_S of substeps). */
  advance(t: number, inputs: WaveInputs): void {
    if (t < this.simT) {
      this.reset(t);
      return;
    }
    if (t - this.simT > MAX_CATCH_UP_S) this.simT = t - MAX_CATCH_UP_S;
    while (this.simT + this.dt <= t) {
      this.substep(this.simT, inputs);
      this.simT += this.dt;
    }
  }

  private substep(t0: number, inputs: WaveInputs): void {
    const { p, size: n, dt } = this;
    const src = inputs.sourceAt(t0 + dt);
    const dl = Math.hypot(p.current_dir[0], p.current_dir[1]) || 1;
    const spd = p.current_speed * (1 + p.current_loud_gain * (src.amp - 0.5));
    const ux = (p.current_dir[0] / dl) * spd, uy = (p.current_dir[1] / dl) * spd;
    const curlAmp = p.curl_amp * Math.abs(spd);
    const tn = t0 * 0.07;
    // semi-Lagrangian advection of height and velocity by the current
    const e = 0.35;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const px = x + 0.5, py = y + 0.5;
        const n1 = valueNoise(px * p.curl_scale, py * p.curl_scale + tn);
        const n2 = valueNoise(px * p.curl_scale, (py + e) * p.curl_scale + tn);
        const n3 = valueNoise((px + e) * p.curl_scale, py * p.curl_scale + tn);
        const vx = ux + ((n2 - n1) / e) * curlAmp;
        const vy = uy - ((n3 - n1) / e) * curlAmp;
        const bx = Math.min(Math.max(x - vx * dt, 0), n - 1);
        const by = Math.min(Math.max(y - vy * dt, 0), n - 1);
        const x0 = Math.floor(bx), y0 = Math.floor(by);
        const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
        const fx = bx - x0, fy = by - y0;
        const i00 = y0 * n + x0, i10 = y0 * n + x1, i01 = y1 * n + x0, i11 = y1 * n + x1;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const i = y * n + x;
        this.hA[i] = this.h[i00] * w00 + this.h[i10] * w10 + this.h[i01] * w01 + this.h[i11] * w11;
        this.vA[i] = this.v[i00] * w00 + this.v[i10] * w10 + this.v[i01] * w01 + this.v[i11] * w11;
      }
    }
    // beat impulse in this substep (the same beats as the ripples)
    let beat: WaveSource | null = null;
    const beats = inputs.beats;
    for (let k = 0; k < beats.length; k++) {
      const b = beats[k];
      if (b > t0 + dt) break;
      if (b > t0) {
        beat = inputs.beatAt(b);
        break;
      }
    }
    const c2 = p.wave_speed * p.wave_speed;
    const inv2s2 = 1 / (2 * p.source_sigma_cells * p.source_sigma_cells);
    const emit = p.source_gain * src.amp * p.source_scale * dt;
    const kick = beat ? p.beat_gain * beat.amp * p.beat_scale : 0;
    const lim = p.wave_limit;
    const hA = this.hA, vA = this.vA;
    for (let y = 0; y < n; y++) {
      const yu = Math.max(y - 1, 0), yd = Math.min(y + 1, n - 1);
      for (let x = 0; x < n; x++) {
        const xl = Math.max(x - 1, 0), xr = Math.min(x + 1, n - 1);
        const i = y * n + x;
        const hc = hA[i];
        const lap = hA[y * n + xl] + hA[y * n + xr] + hA[yu * n + x] + hA[yd * n + x] - 4 * hc;
        let v = vA[i] + (c2 * lap - (p.damping + this.sponge[i]) * vA[i]) * dt;
        const dx = x - src.cx, dy = y - src.cy;
        v += emit * Math.exp(-(dx * dx + dy * dy) * inv2s2);
        if (beat) {
          const bx = x - beat.cx, by = y - beat.cy;
          v += kick * Math.exp(-(bx * bx + by * by) * inv2s2);
        }
        this.v[i] = v;
        this.h[i] = Math.min(Math.max(hc + v * dt, -lim), lim);
      }
    }
  }
}
