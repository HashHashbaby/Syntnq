import { describe, expect, it } from "vitest";
import { WaveField, type WaveInputs } from "../../src/engine/wave";
import { params } from "../../src/params";

const N = params.grid.size;
const flow = params.live.flow;

function inputs(amp: (t: number) => number, beats: number[] = []): WaveInputs {
  return {
    sourceAt: (t) => ({ cx: 20, cy: 30, amp: amp(t) }),
    beats: Float64Array.from(beats),
    beatAt: () => ({ cx: 40, cy: 20, amp: 0.8 }),
  };
}

function run(fps: number, seconds: number, inp: WaveInputs): Float64Array {
  const w = new WaveField(N, flow);
  w.reset(0);
  const frames = Math.round(seconds * fps);
  for (let k = 1; k <= frames; k++) w.advance(k / fps, inp);
  return w.h.slice();
}

const maxAbs = (a: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
};

describe("wave field", () => {
  it("stays flat with no source and no beats", () => {
    expect(maxAbs(run(60, 1, inputs(() => 0)))).toBe(0);
  });

  it("a loud source raises the surface, bounded by the limit", () => {
    const h = run(60, 2, inputs(() => 1));
    expect(maxAbs(h)).toBeGreaterThan(0.05);
    expect(maxAbs(h)).toBeLessThanOrEqual(flow.wave_limit);
  });

  it("is a function of audio time, not of the display frame rate", () => {
    const inp = inputs((t) => 0.5 + 0.5 * Math.sin(t * 3), [0.4, 0.9, 1.3]);
    const a = run(30, 1.5, inp);
    const b = run(60, 1.5, inp);
    const c = run(144, 1.5, inp);
    let dab = 0, dac = 0;
    for (let i = 0; i < a.length; i++) {
      dab = Math.max(dab, Math.abs(a[i] - b[i]));
      dac = Math.max(dac, Math.abs(a[i] - c[i]));
    }
    expect(dab).toBeLessThan(1e-9);
    expect(dac).toBeLessThan(1e-9);
  });

  it("a beat sends a ring that leaves through the open edges", () => {
    const w = new WaveField(N, flow);
    w.reset(0);
    const inp = inputs(() => 0, [0.05]);
    for (let k = 1; k <= 30; k++) w.advance(k / 60, inp);
    const early = maxAbs(w.h);
    for (let k = 31; k <= 60 * 4; k++) w.advance(k / 60, inp);
    expect(early).toBeGreaterThan(0.02);
    expect(maxAbs(w.h)).toBeLessThan(early * 0.1);
  });

  it("a seek backwards resets to flat", () => {
    const w = new WaveField(N, flow);
    w.reset(0);
    const inp = inputs(() => 1);
    for (let k = 1; k <= 60; k++) w.advance(k / 60, inp);
    w.advance(0.2, inp);
    expect(maxAbs(w.h)).toBe(0);
  });
});
