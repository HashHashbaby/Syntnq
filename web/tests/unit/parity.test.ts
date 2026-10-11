// Parity of the TypeScript port with the Python reference (fixtures: make web-fixtures).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oklchToSrgb8 } from "../../src/color/oklab";
import { parseLive, parseMaps, parseProto, parseStatic } from "../../src/data/formats";
import { LiveEngine } from "../../src/engine/live";
import { Pooler } from "../../src/engine/pool";
import { params } from "../../src/params";

const FIX = join(__dirname, "..", "fixtures");
const have = existsSync(join(FIX, "aba_expected.json"));
const d = have ? describe : describe.skip;

function ab(name: string): ArrayBuffer {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

d("colour conversion", () => {
  it("matches gamut-mapped sRGB from Python within one level", () => {
    const cases = JSON.parse(readFileSync(join(FIX, "color_cases.json"), "utf-8")) as {
      lch: number[][];
      srgb: number[][];
    };
    const out = new Uint8Array(3);
    let worst = 0;
    cases.lch.forEach(([L, C, H], i) => {
      oklchToSrgb8(L, C, H, out);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(out[k] - cases.srgb[i][k]));
    });
    expect(worst).toBeLessThanOrEqual(1);
  });
});

for (const prefix of ["aba", "click"]) {
  d(`binary formats and live engine (${prefix})`, () => {
    const expected = JSON.parse(readFileSync(join(FIX, `${prefix}_expected.json`), "utf-8"));
    const sig = JSON.parse(readFileSync(join(FIX, `${prefix}_signature.json`), "utf-8"));
    const stat = parseStatic(ab(`${prefix}_static.bin`));
    const live = parseLive(ab(`${prefix}_live.bin`), 0);
    const proto = parseProto(ab(`${prefix}_proto.bin`));
    const K = expected.cells as number;
    const N = expected.nodes as number;
    const T = expected.n_frames as number;

    it("parses the stored files with the documented shapes", () => {
      expect(stat.cells).toBe(K);
      expect(stat.gridSize).toBe(params.grid.size);
      expect(live.dim).toBe(17);
      expect(live.frames).toBe(expected.stream_frames);
      expect(live.tau).toBeCloseTo(expected.tau, 4);
      expect(live.beatTimes.length).toBe(expected.n_beats);
      expect(proto.cells).toBe(K);
      expect(sig.song.id).toHaveLength(16);
      const m = parseMaps(ab(`${prefix}_maps.bin`));
      expect(m.structure).toHaveLength(256 * 256);
      expect(m.dynHist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    });

    it("rejects wrong magic, version and truncated files", () => {
      const b = new Uint8Array(ab(`${prefix}_static.bin`));
      expect(() => parseMaps(b.buffer.slice(0) as ArrayBuffer)).toThrow(/magic/);
      const v = b.slice();
      v[4] = 9;
      expect(() => parseStatic(v.buffer as ArrayBuffer)).toThrow(/version/);
      expect(() => parseStatic(b.slice(0, 1000).buffer as ArrayBuffer)).toThrow(/truncated/);
    });

    it("reproduces the reference engine frame by frame", () => {
      const eng = new LiveEngine(live, proto, stat.colorOklch, params, { nominalDt: 1 / expected.fps });
      const ref = new Uint8Array(ab(`${prefix}_frames_srgb.u8`));
      const refR = new Float32Array(ab(`${prefix}_frames_radius.f32`));
      const refA = new Float32Array(ab(`${prefix}_frames_activation.f32`));
      eng.reset(expected.start_s);
      let maxDiff = 0, sumDiff = 0, maxA = 0, maxR = 0;
      for (let k = 0; k < T; k++) {
        const f = eng.step(expected.start_s + k / expected.fps);
        expect(f.beatFlash).toBe(expected.flash[k] === 1);
        expect(f.bmu).toBe(expected.bmu[k]);
        expect(f.trailLength).toBe(expected.trail_len[k]);
        for (let i = 0; i < K * 3; i++) {
          const dd = Math.abs(f.srgb[i] - ref[k * K * 3 + i]);
          maxDiff = Math.max(maxDiff, dd);
          sumDiff += dd;
        }
        for (let i = 0; i < K; i++) {
          maxA = Math.max(maxA, Math.abs(f.activation[i] - refA[k * K + i]));
          maxR = Math.max(maxR, Math.abs(f.radiusScale[i] - refR[k * K + i]));
        }
      }
      expect(maxA).toBeLessThan(1e-3);
      expect(maxR).toBeLessThan(1e-3);
      expect(maxDiff).toBeLessThanOrEqual(2);
      expect(sumDiff / (T * K * 3)).toBeLessThan(0.05);
    });

    it("pools like the reference (OKLab mean)", () => {
      const eng = new LiveEngine(live, proto, stat.colorOklch, params, { nominalDt: 1 / expected.fps });
      const pooler = new Pooler(params.grid.size, params.render.display_grid, 128);
      const refC = new Uint8Array(ab(`${prefix}_frames_pooled_srgb.u8`));
      const refR = new Float32Array(ab(`${prefix}_frames_pooled_radius.f32`));
      eng.reset(expected.start_s);
      let maxDiff = 0, maxR = 0;
      for (let k = 0; k < T; k++) {
        const f = eng.step(expected.start_s + k / expected.fps);
        const p = pooler.pool(f.srgb, f.radiusScale, f.trail, f.trailLength);
        for (let i = 0; i < N * 3; i++) maxDiff = Math.max(maxDiff, Math.abs(p.srgb[i] - refC[k * N * 3 + i]));
        for (let i = 0; i < N; i++) maxR = Math.max(maxR, Math.abs(p.radiusScale[i] - refR[k * N + i]));
      }
      expect(maxDiff).toBeLessThanOrEqual(2);
      expect(maxR).toBeLessThan(1e-3);
    });
  });
}
