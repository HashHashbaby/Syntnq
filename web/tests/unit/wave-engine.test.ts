// The wave height as an engine output (D-056): moves with the music, flat under reduced motion,
// flat again after a seek, and never changes the colours the engine produces.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLive, parseProto, parseStatic } from "../../src/data/formats";
import { LiveEngine } from "../../src/engine/live";
import { params } from "../../src/params";

const FIX = join(__dirname, "..", "fixtures");
const d = existsSync(join(FIX, "click_live.bin")) ? describe : describe.skip;
const ab = (name: string): ArrayBuffer => {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

d("wave height in the live engine", () => {
  const stat = parseStatic(ab("click_static.bin"));
  const live = parseLive(ab("click_live.bin"), 0);
  const proto = parseProto(ab("click_proto.bin"));
  const make = (reducedMotion: boolean): LiveEngine => new LiveEngine(live, proto, stat.colorOklch, params, { reducedMotion });
  const run = (e: LiveEngine, from: number, to: number): { h: Float32Array; srgb: Uint8Array } => {
    e.reset(from);
    let f = e.step(from);
    for (let s = from; s <= to; s += 1 / 60) f = e.step(s);
    return { h: f.height.slice(), srgb: f.srgb.slice() };
  };
  const peak = (h: Float32Array): number => h.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

  it("moves with the music and stays bounded", () => {
    const { h } = run(make(false), 2, 5);
    expect(peak(h)).toBeGreaterThan(0.01);
    expect(peak(h)).toBeLessThanOrEqual(params.live.flow.wave_limit);
  });

  it("is flat under reduced motion", () => {
    expect(peak(run(make(true), 2, 5).h)).toBe(0);
  });

  it("is flat right after a seek (reset)", () => {
    const e = make(false);
    run(e, 2, 5);
    e.reset(10);
    expect(peak(e.step(10).height)).toBe(0);
  });

  it("does not change the colours", () => {
    const a = run(make(false), 2, 4).srgb;
    const b = (() => {
      const e = make(false);
      (e as unknown as { wave: { advance: () => void } }).wave.advance = () => undefined; // no wave at all
      return run(e, 2, 4).srgb;
    })();
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
