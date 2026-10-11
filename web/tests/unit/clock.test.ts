import { describe, expect, it } from "vitest";
import { analysisTime, deviceLatency, frameIndex, sourcePosition, startTimeFor } from "../../src/audio/clock";

describe("playback clock", () => {
  it("uses outputLatency, then baseLatency, then zero", () => {
    expect(deviceLatency({ outputLatency: 0.03, baseLatency: 0.01 })).toBe(0.03);
    expect(deviceLatency({ outputLatency: 0, baseLatency: 0.01 })).toBe(0.01);
    expect(deviceLatency({})).toBe(0);
    expect(deviceLatency({ outputLatency: NaN, baseLatency: -1 })).toBe(0);
  });

  it("source position follows the context clock minus latency", () => {
    const st = startTimeFor(10, 4, 0.02);
    expect(sourcePosition(10, { startTime: st, outputLatency: 0.02 })).toBeCloseTo(4, 12);
    expect(sourcePosition(12.5, { startTime: st, outputLatency: 0.02 })).toBeCloseTo(6.5, 12);
  });

  it("removes the ingest offset to get analysis time", () => {
    expect(analysisTime(6.5, 0.25)).toBeCloseTo(6.25, 12);
  });

  it("stays within one analysis frame of the audio over 5 minutes with jittery frames", () => {
    // Visual time is derived from the audio clock on every animation frame, so no error accumulates;
    // this simulates 60 fps with +-4 ms timer jitter and checks against the ideal audio frame.
    const fps = 43.066;
    const clock = { startTime: 100, outputLatency: 0.012 };
    let seed = 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 0.008;
    let worst = 0;
    for (let k = 0; k < 60 * 300; k++) {
      const now = 100 + 0.012 + k / 60;
      const drawn = now + rnd(); // when the frame callback actually ran
      const visual = frameIndex(analysisTime(sourcePosition(drawn, clock), 0), fps);
      const audio = frameIndex(analysisTime(sourcePosition(now, clock), 0), fps);
      worst = Math.max(worst, Math.abs(visual - audio));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
});
