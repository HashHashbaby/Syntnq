// Disc angle from the audio clock (D-060). Pure: no DOM, no three.js, so it is unit-tested.
// - Playing at speed: the angle advances by omega x (audio time advanced), never by frame counts, so
//   dtheta/ds = omega exactly once spun up.
// - Play / pause: the spin (0..1 of omega) follows a critically damped spring, so pause coasts to a stop
//   (the coast runs on wall time, since audio time stops).
// - Seek / scrub: an audio-time jump that wall time does not explain turns the disc by omega x jump,
//   reduced to less than one turn in the jump's direction, on a short spring (forward seeks spin it
//   forward, dragging back spins it back).
// - Reduced motion: no rotation; the angle is set to omega x s on pause and on seek.
// All numbers: config web3d.disc.
import { stepSpring, type SpringState } from "../motion/spring";
import type { DiscParams } from "../params";

const MAX_DT_S = 0.1; // a stalled tab does not turn into one huge step
const REST = 1e-4;

export interface DiscInput {
  wall: number; // wall-clock seconds (performance.now() / 1000)
  s: number; // audio position in seconds
  playing: boolean;
  reduced: boolean;
}

/** Reduce an angle to less than one turn, keeping its sign (a seek turns the way it jumped). */
export function withinTurn(a: number): number {
  const t = 2 * Math.PI;
  return Math.sign(a) * (Math.abs(a) % t);
}

/** Wrap an angle to (-pi, pi]. */
export function wrapHalfTurn(a: number): number {
  const t = 2 * Math.PI;
  const r = (((a + Math.PI) % t) + t) % t;
  return r - Math.PI;
}

export class DiscMotion {
  readonly omega: number; // rad/s at the steady rate
  angle = 0; // radians, clockwise on screen, wrapped to [0, 2 pi)
  private spin: SpringState = { x: 0, v: 0 };
  private pending: SpringState = { x: 0, v: 0 }; // seek angle still to turn
  private last: DiscInput | null = null;

  constructor(private readonly p: DiscParams) {
    this.omega = (p.rpm * 2 * Math.PI) / 60;
  }

  /** Start from position s without animating (a song opens). */
  reset(s: number, wall: number): void {
    this.angle = this.wrap(this.omega * s);
    this.spin = { x: 0, v: 0 };
    this.pending = { x: 0, v: 0 };
    this.last = { wall, s, playing: false, reduced: false };
  }

  /** Advance to this input; returns the angle to draw. */
  step(inp: DiscInput): number {
    const prev = this.last;
    this.last = inp;
    if (!prev) {
      this.reset(inp.s, inp.wall);
      this.last = inp;
      return this.angle;
    }
    const dt = Math.min(Math.max(inp.wall - prev.wall, 0), MAX_DT_S);
    const ds = inp.s - prev.s;
    const expected = inp.playing && prev.playing ? inp.wall - prev.wall : 0;
    const jump = ds - expected;
    const seeked = Math.abs(jump) > this.p.seek_threshold_s;

    if (inp.reduced) {
      this.spin = { x: 0, v: 0 };
      this.pending = { x: 0, v: 0 };
      if (!inp.playing || seeked) this.angle = this.wrap(this.omega * inp.s);
      return this.angle;
    }

    this.spin = stepSpring(this.spin, inp.playing ? 1 : 0, { response: this.p.spin_response_s, damping: 1 }, dt);
    const spin = Math.min(Math.max(this.spin.x, 0), 1.2);
    // playing: audio time drives the angle; paused: the coast runs on wall time
    const advance = inp.playing ? (seeked ? Math.min(expected, MAX_DT_S) : Math.max(ds, 0)) : dt;
    let a = this.angle + this.omega * spin * advance;

    if (seeked) this.pending = { x: this.pending.x + withinTurn(this.omega * jump), v: this.pending.v };
    if (Math.abs(this.pending.x) > REST || Math.abs(this.pending.v) > REST) {
      const next = stepSpring(this.pending, 0, { response: this.p.seek_response_s, damping: 1 }, dt);
      a += this.pending.x - next.x;
      this.pending = next;
    }
    this.angle = this.wrap(a);
    return this.angle;
  }

  /** Nothing left to animate (paused, coasted out, no seek pending): the loop may stop. */
  atRest(): boolean {
    const l = this.last;
    if (!l || l.playing) return false;
    return Math.abs(this.spin.x) < REST && Math.abs(this.spin.v) < REST && Math.abs(this.pending.x) < REST && Math.abs(this.pending.v) < REST;
  }

  private wrap(a: number): number {
    const t = 2 * Math.PI;
    return ((a % t) + t) % t;
  }
}
