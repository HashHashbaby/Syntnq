// A small damped spring for gesture-driven motion (docs/UI.md section 8). It animates from the
// current value and carries the release velocity, so an interrupted or flicked element keeps
// its speed. Springs are used only where a person can grab or flick the element; everything else
// is a CSS transition.

export interface SpringParams {
  /** Seconds to reach the target with no damping (Apple's "response"). Lower is snappier. */
  response: number;
  /** Damping ratio: 1 is critically damped (no overshoot), below 1 overshoots. */
  damping: number;
}

export interface SpringState {
  x: number;
  v: number;
}

const SUBSTEP_S = 1 / 240;
const REST_DISTANCE = 0.5;
const REST_SPEED = 5;
const MAX_FRAME_S = 0.05;

/** Advances the state by `dt` seconds with semi-implicit Euler substeps. */
export function stepSpring(s: SpringState, target: number, p: SpringParams, dt: number): SpringState {
  const omega = (2 * Math.PI) / p.response;
  const k = omega * omega;
  const c = 2 * p.damping * omega;
  let { x, v } = s;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP_S, left);
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
    left -= h;
  }
  return { x, v };
}

export function atRest(s: SpringState, target: number): boolean {
  return Math.abs(s.x - target) < REST_DISTANCE && Math.abs(s.v) < REST_SPEED;
}

export interface SpringRun {
  cancel: () => void;
  done: Promise<void>;
}

/**
 * Runs a spring from `from` (with `velocity` in units per second) to `to`, calling `onUpdate`
 * every frame. Resolves when it comes to rest; `cancel` stops it where it is.
 */
export function springTo(from: number, to: number, velocity: number, p: SpringParams, onUpdate: (x: number) => void): SpringRun {
  let state: SpringState = { x: from, v: velocity };
  let raf = 0;
  let last = performance.now();
  let stopped = false;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const frame = (now: number): void => {
    if (stopped) return;
    const dt = Math.min((now - last) / 1000, MAX_FRAME_S);
    last = now;
    state = stepSpring(state, to, p, dt);
    if (atRest(state, to)) {
      onUpdate(to);
      resolve();
      return;
    }
    onUpdate(state.x);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    cancel: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      resolve();
    },
    done,
  };
}

/** Progressive resistance past a boundary: the further past, the less the element follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  const o = Math.abs(overshoot);
  const r = (o * dimension * constant) / (dimension + constant * o);
  return overshoot < 0 ? -r : r;
}

/** Release velocity in px per ms from recent (t_ms, y) samples; positive is downward. */
export function releaseVelocity(samples: { t: number; y: number }[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const end = samples[samples.length - 1];
  let start = samples[0];
  for (const s of samples) {
    if (end.t - s.t <= windowMs) {
      start = s;
      break;
    }
  }
  const dt = end.t - start.t;
  return dt > 0 ? (end.y - start.y) / dt : 0;
}
