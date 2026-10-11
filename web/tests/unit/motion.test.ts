import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atRest, releaseVelocity, rubberband, stepSpring, type SpringState } from "../../src/motion/spring";
import * as tokens from "../../src/motion/tokens";

function run(from: number, to: number, v: number, p: { response: number; damping: number }, seconds: number) {
  let s: SpringState = { x: from, v };
  const xs: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    s = stepSpring(s, to, p, 1 / 60);
    xs.push(s.x);
  }
  return { s, xs };
}

describe("spring", () => {
  it("critically damped: reaches the target without overshoot", () => {
    const { s, xs } = run(0, 100, 0, { response: 0.4, damping: 1 }, 1.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100.5);
    expect(atRest(s, 100)).toBe(true);
  });

  it("under-damped: overshoots, then settles", () => {
    const { s, xs } = run(0, 100, 0, { response: 0.4, damping: 0.6 }, 2.5);
    expect(Math.max(...xs)).toBeGreaterThan(101);
    expect(atRest(s, 100)).toBe(true);
  });

  it("carries release velocity: a flick covers more ground in the first frames than a drop", () => {
    const flick = run(0, 100, 2000, { response: 0.4, damping: 1 }, 0.1).s.x;
    const drop = run(0, 100, 0, { response: 0.4, damping: 1 }, 0.1).s.x;
    expect(flick).toBeGreaterThan(drop * 1.5);
  });

  it("starts from the current value (no jump when retargeted mid-flight)", () => {
    const first = run(0, 100, 0, { response: 0.4, damping: 1 }, 0.2).s;
    const next = stepSpring(first, 0, { response: 0.4, damping: 1 }, 1 / 240);
    expect(Math.abs(next.x - first.x)).toBeLessThan(2);
  });

  it("rubber-banding resists progressively and never exceeds the dimension", () => {
    expect(rubberband(0, 500)).toBe(0);
    const a = rubberband(50, 500);
    const b = rubberband(500, 500);
    expect(a).toBeLessThan(50);
    expect(b).toBeLessThan(500 * 0.55);
    expect(rubberband(-50, 500)).toBeCloseTo(-a, 9);
  });

  it("release velocity uses the recent window, positive downward", () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 200, y: 10 },
      { t: 250, y: 30 },
      { t: 300, y: 70 },
    ];
    // last 100 ms: 60 px over 100 ms = 0.6 px/ms
    expect(releaseVelocity(samples, 100)).toBeCloseTo(0.6, 5);
    expect(releaseVelocity([{ t: 0, y: 0 }])).toBe(0);
  });
});

describe("motion tokens stay in sync with tokens.css", () => {
  const css = readFileSync(join(__dirname, "../../src/styles/tokens.css"), "utf-8");
  const cssVar = (name: string): string => {
    const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`missing --${name}`);
    return m[1].trim();
  };
  const ms = (name: string): number => parseFloat(cssVar(name));

  it("durations", () => {
    expect(tokens.DUR_HANDOFF_MS).toBe(ms("dur-handoff"));
    expect(tokens.DUR_REVEAL_MS).toBe(ms("dur-reveal"));
    expect(tokens.DIP_OUT_MS).toBe(ms("dip-out"));
  });

  it("easings", () => {
    expect(tokens.EASE_OUT).toBe(cssVar("ease-out"));
    expect(tokens.EASE_DRAWER).toBe(cssVar("ease-drawer"));
    expect(tokens.EASE_STAGE).toBe(cssVar("ease-stage"));
  });

  it("every UI duration except the scroll-linked stage stays within the documented budget", () => {
    for (const n of ["dur-press", "dur-fast", "dur-ui", "dur-push", "dur", "dur-sheet", "dur-reveal", "dur-handoff", "dur-slow", "dip-out", "dip-rest", "dip-in"]) {
      expect(ms(n), n).toBeLessThanOrEqual(500);
    }
    expect(ms("dur-press")).toBeLessThanOrEqual(160);
  });
});
