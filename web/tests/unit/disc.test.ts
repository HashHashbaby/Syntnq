// Disc motion from the audio clock (D-060): steady rate locked to audio time, spin-up and coast, seeks
// turn the disc by omega x jump (under one turn, same direction), reduced motion follows omega x s only on pause and seek.
import { describe, expect, it } from "vitest";
import { DiscMotion, withinTurn, wrapHalfTurn } from "../../src/engine/disc";
import { params } from "../../src/params";

const p = params.web3d.disc;
const TAU = 2 * Math.PI;

/** Unwrapped angle change between two wrapped angles, assuming less than half a turn per step. */
const delta = (a: number, b: number): number => wrapHalfTurn(b - a);

function run(m: DiscMotion, from: { wall: number; s: number }, seconds: number, fps: number, playing: boolean, reduced = false, rate = 1) {
  let { wall, s } = from;
  let turned = 0;
  let a = m.angle;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    wall += 1 / fps;
    if (playing) s += rate / fps;
    const b = m.step({ wall, s, playing, reduced });
    turned += delta(a, b);
    a = b;
  }
  return { wall, s, turned };
}

describe("disc motion", () => {
  it("runs at 33 1/3 rpm against audio time once spun up, at any frame rate", () => {
    for (const fps of [30, 60, 144]) {
      const m = new DiscMotion(p);
      m.reset(0, 0);
      const warm = run(m, { wall: 0, s: 0 }, 3, fps, true);
      const r = run(m, warm, 4, fps, true);
      expect(r.turned / (r.s - warm.s)).toBeCloseTo(m.omega, 4);
      expect((m.omega * 60) / TAU).toBeCloseTo(p.rpm, 6);
    }
  });

  it("follows audio time, not wall time (a slow clock turns it slower)", () => {
    const m = new DiscMotion(p);
    m.reset(0, 0);
    const warm = run(m, { wall: 0, s: 0 }, 3, 60, true);
    // audio advancing at 0.99 of wall time (inside the seek threshold per frame)
    const r = run(m, warm, 4, 60, true, false, 0.99);
    expect(r.turned / (r.s - warm.s)).toBeCloseTo(m.omega, 4);
  });

  it("spins up and coasts down on the spin spring", () => {
    const m = new DiscMotion(p);
    m.reset(0, 0);
    const up = run(m, { wall: 0, s: 0 }, p.spin_response_s * 0.25, 60, true);
    expect(up.turned).toBeLessThan(m.omega * up.s * 0.6); // still spinning up
    const steady = run(m, up, 3, 60, true);
    const coast = run(m, steady, 4, 60, false);
    expect(coast.turned).toBeGreaterThan(0.05); // it coasts after pause ...
    expect(coast.turned).toBeLessThan(m.omega * p.spin_response_s); // ... and stops
    expect(m.atRest()).toBe(true);
  });

  it("turns by omega x jump on a seek while paused, and spins back when dragged back", () => {
    const m = new DiscMotion(p);
    m.reset(10, 0);
    const a0 = m.angle;
    m.step({ wall: 0.016, s: 10, playing: false, reduced: false });
    const jump = 0.4; // seconds: 1.4 rad, under half a turn
    m.step({ wall: 0.032, s: 10 + jump, playing: false, reduced: false });
    run(m, { wall: 0.032, s: 10 + jump }, 2, 60, false);
    expect(delta(a0, m.angle)).toBeCloseTo(m.omega * jump, 3);
    // dragging back spins it back
    m.step({ wall: 2.1, s: 10, playing: false, reduced: false });
    run(m, { wall: 2.1, s: 10 }, 2, 60, false);
    expect(delta(a0, m.angle)).toBeCloseTo(0, 3);
    expect(m.atRest()).toBe(true);
  });

  it("a long forward seek spins forward, under one turn", () => {
    const m = new DiscMotion(p);
    m.reset(0, 0);
    m.step({ wall: 0.016, s: 0, playing: false, reduced: false });
    const jump = 5; // 2.78 turns: the disc turns forward by the remainder (0.78 turn), not back
    const want = withinTurn(m.omega * jump);
    expect(want).toBeGreaterThan(0);
    expect(want).toBeLessThan(TAU);
    let a = m.angle, total = 0;
    for (let i = 0; i < 120; i++) {
      const b = m.step({ wall: 0.032 + i / 60, s: jump, playing: false, reduced: false });
      const d = b - a;
      total += d < -0.5 ? d + TAU : d; // forward steps only
      a = b;
    }
    expect(total).toBeCloseTo(want, 3);
    expect(m.angle).toBeCloseTo((m.omega * jump) % TAU, 3);
  });

  it("does not spin under reduced motion; the angle is omega x s on pause and seek", () => {
    const m = new DiscMotion(p);
    m.reset(0, 0);
    const r = run(m, { wall: 0, s: 0 }, 2, 60, true, true);
    expect(r.turned).toBe(0);
    m.step({ wall: r.wall + 0.016, s: r.s, playing: false, reduced: true });
    expect(m.angle).toBeCloseTo((m.omega * r.s) % TAU, 6);
    m.step({ wall: r.wall + 0.032, s: 7, playing: false, reduced: true });
    expect(m.angle).toBeCloseTo((m.omega * 7) % TAU, 6);
  });
});
