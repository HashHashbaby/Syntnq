// The landing's cursor reveal (D-063), pure part: a small decaying mask over the signature card. The
// pointer stamps soft discs into it, larger when it moves faster; every cell halves in `half_life_s`.
// Where the mask is strong the static card gives way to the live grid underneath. Unit-tested; the
// component only uploads `cells` into a canvas and erases the card through it.
// All numbers: config ui.landing.

export interface RevealParams {
  reveal_grid: number;
  reveal_half_life_s: number;
  reveal_radius: number;
  reveal_speed_gain: number;
  reveal_radius_max: number;
}

const MAX_DT_S = 0.1;

export class RevealMask {
  readonly n: number;
  /** (n x n) 0..1, row 0 at the top of the card. */
  readonly cells: Float32Array;
  private last: { x: number; y: number; t: number } | null = null;

  constructor(private readonly p: RevealParams) {
    this.n = p.reveal_grid;
    this.cells = new Float32Array(this.n * this.n);
  }

  /** Brush radius (share of the card side) for a pointer speed in card sides per second. */
  radius(speed: number): number {
    return Math.min(this.p.reveal_radius + this.p.reveal_speed_gain * speed, this.p.reveal_radius_max);
  }

  /** The pointer at card coordinates (0..1, may lie outside) at time t (s). Stamps along the path. */
  move(x: number, y: number, t: number): void {
    const prev = this.last;
    this.last = { x, y, t };
    if (!prev) {
      this.stamp(x, y, this.radius(0));
      return;
    }
    const dt = Math.max(t - prev.t, 1e-3);
    const dist = Math.hypot(x - prev.x, y - prev.y);
    const r = this.radius(dist / dt);
    // one stamp per half radius travelled, so fast strokes stay continuous
    const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
    for (let i = 1; i <= steps; i++) this.stamp(prev.x + ((x - prev.x) * i) / steps, prev.y + ((y - prev.y) * i) / steps, r);
  }

  /** The pointer left: the next move starts a new stroke. */
  lift(): void {
    this.last = null;
  }

  /** Fade every cell by dt seconds of decay. */
  decay(dt: number): void {
    const k = Math.pow(0.5, Math.min(Math.max(dt, 0), MAX_DT_S) / this.p.reveal_half_life_s);
    const c = this.cells;
    for (let i = 0; i < c.length; i++) c[i] = c[i] < 1e-3 ? 0 : c[i] * k;
  }

  /** Mean of the mask (0..1): how much of the card is revealed. */
  coverage(): number {
    let s = 0;
    for (let i = 0; i < this.cells.length; i++) s += this.cells[i];
    return s / this.cells.length;
  }

  clear(): void {
    this.cells.fill(0);
    this.last = null;
  }

  private stamp(x: number, y: number, r: number): void {
    const n = this.n;
    const rc = r * n;
    const cx = x * n, cy = y * n;
    const x0 = Math.max(0, Math.floor(cx - rc)), x1 = Math.min(n - 1, Math.ceil(cx + rc));
    const y0 = Math.max(0, Math.floor(cy - rc)), y1 = Math.min(n - 1, Math.ceil(cy + rc));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) / rc;
        if (d >= 1) continue;
        const v = 1 - d * d * (3 - 2 * d); // soft edge (smoothstep falloff)
        const k = j * n + i;
        this.cells[k] = Math.max(this.cells[k], v);
      }
    }
  }
}

/** Beat values for a scroll progress p (0..1), all composited properties (D-063). */
export interface LandingBeat {
  hero: number; // 1 in the hero, 0 after
  cardScale: number; // the stage's scale (1, shrinking to disc_card_scale for the disc)
  disc: number; // disc opacity 0..1
  discAngle: number; // radians, scroll-scrubbed
  discTilt: number; // degrees
  card: number; // the card's opacity (0 while the disc carries it as its label)
  step: number; // copy step: 0 hero, 1 disc, 2 live, 3 map
  liveT: number; // 0..1 across the live beat
  headline: number; // headline scale
}

export interface BeatParams {
  hero_to: number;
  disc_from: number;
  disc_full: number;
  disc_to: number;
  live_from: number;
  map_from: number;
  disc_card_scale: number;
  disc_turns: number;
  disc_tilt_deg: number;
  headline_scale: number;
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

export function beatAt(p: number, b: BeatParams): LandingBeat {
  const intoDisc = smooth((p - b.disc_from) / (b.disc_full - b.disc_from)); // card -> label
  const outOfDisc = smooth((p - b.disc_to) / (b.live_from - b.disc_to)); // label -> card
  const inDisc = intoDisc * (1 - outOfDisc);
  const turn = clamp01((p - b.disc_full) / (b.disc_to - b.disc_full));
  return {
    hero: 1 - smooth(p / b.hero_to),
    cardScale: 1 - (1 - b.disc_card_scale) * inDisc,
    // the disc appears only once the card is nearly label-sized, so it never looms over the text; the
    // card hands over at the very end, where it matches the label exactly (flat, angle 0)
    disc: smooth((inDisc - 0.6) / 0.4),
    discAngle: turn * b.disc_turns * 2 * Math.PI,
    discTilt: b.disc_tilt_deg * smooth(turn * 4) * (1 - outOfDisc),
    card: inDisc >= 0.999 ? 0 : 1 - smooth((inDisc - 0.85) / 0.15),
    step: p < b.hero_to ? 0 : p < b.live_from - 0.03 ? 1 : p < b.map_from ? 2 : 3,
    liveT: clamp01((p - b.live_from) / (b.map_from - b.live_from)),
    headline: 1 - (1 - b.headline_scale) * smooth(p / b.hero_to),
  };
}
