// The live trail chart (D-062): dequantised loudness (dBFS) and brightness (Hz) match the Python analysis
// values within half a storage step; the trail is the grid's window; ticks, log axis, labels.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLive } from "../../src/data/formats";
import { axesFrom, formatDb, formatHz, GraphSampler, plotXY, ticks } from "../../src/engine/graph";
import { params } from "../../src/params";

const FIX = join(__dirname, "..", "fixtures");
const have = existsSync(join(FIX, "aba_graph.json"));
const d = have ? describe : describe.skip;
const ab = (name: string): ArrayBuffer => {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const a = axesFrom(params);
const stepDb = (a.dbHi - a.dbLo) / 255;
const stepLog = (a.logHzHi - a.logHzLo) / 255;

for (const prefix of ["aba", "click"]) {
  d(`chart values against the analysis (${prefix})`, () => {
    const g = JSON.parse(readFileSync(join(FIX, `${prefix}_graph.json`), "utf-8")) as { frames: number[]; brightness_hz: number[]; loudness_dbfs: number[] };
    const live = parseLive(ab(`${prefix}_live.bin`));
    const sampler = new GraphSampler(live, params);

    it("reads loudness (dBFS) and brightness (Hz) back within half a step, edges pinned", () => {
      let checked = 0;
      g.frames.forEach((t, i) => {
        const pt = sampler.point(t);
        const db = g.loudness_dbfs[i], logHz = Math.log10(g.brightness_hz[i]);
        const inDb = db > a.dbLo && db < a.dbHi, inHz = logHz > a.logHzLo && logHz < a.logHzHi;
        if (inDb) expect(Math.abs(pt.db - db)).toBeLessThanOrEqual(stepDb / 2 + 1e-6);
        else expect(pt.db).toBeCloseTo(db < a.dbLo ? a.dbLo : a.dbHi, 6);
        if (inHz) expect(Math.abs(pt.logHz - logHz)).toBeLessThanOrEqual(stepLog / 2 + 1e-6);
        else expect(pt.logHz).toBeCloseTo(logHz < a.logHzLo ? a.logHzLo : a.logHzHi, 6);
        if (!inDb || !inHz) expect(pt.clipped).toBe(true);
        checked++;
      });
      expect(checked).toBeGreaterThan(5);
    });

    it("draws the grid's trail window, oldest first, ending at the point at s", () => {
      const s = (live.frames / live.fps) * 0.5;
      const tr = sampler.at(s);
      const frames = Math.max(2, Math.round(params.ui.trail_graph.trail_s * live.fps));
      expect(tr.n).toBe(frames + 1);
      for (let i = 1; i < tr.n; i++) expect(tr.pts[i * 3 + 2]).toBeLessThanOrEqual(tr.pts[(i - 1) * 3 + 2] + 1e-6);
      expect(tr.pts[(tr.n - 1) * 3 + 2]).toBe(0);
      const [x, y] = plotXY(tr.now.db, tr.now.logHz, a);
      expect(tr.pts[(tr.n - 1) * 3]).toBeCloseTo(x, 6);
      expect(tr.pts[(tr.n - 1) * 3 + 1]).toBeCloseTo(y, 6);
      // a pure function of s: asking again gives the same trail
      const again = sampler.at(s);
      expect(Array.from(again.pts.subarray(0, again.n * 3))).toEqual(Array.from(tr.pts.subarray(0, tr.n * 3)));
    });

    it("builds a whole-song density with peak 1", () => {
      const den = sampler.density();
      expect(den.length).toBe(params.ui.trail_graph.cloud_bins ** 2);
      expect(Math.max(...den)).toBeCloseTo(1, 6);
    });
  });
}

describe("chart axes", () => {
  it("uses the grid trail window", () => {
    expect(params.ui.trail_graph.trail_s).toBe(params.live.trail.length_s);
  });

  it("places ticks inside the calibration range, brightness on a log axis", () => {
    const hz = ticks(params.ui.trail_graph.brightness_ticks_hz, a.logHzLo, a.logHzHi, true);
    expect(hz.map((t) => t.value)).toEqual([500, 1000, 2000, 4000]);
    expect(hz[1].at - hz[0].at).toBeCloseTo(hz[2].at - hz[1].at, 9); // octaves are equal steps
    const db = ticks(params.ui.trail_graph.loudness_ticks_dbfs, a.dbLo, a.dbHi, false);
    expect(db.length).toBeGreaterThanOrEqual(3);
    for (const t of [...hz, ...db]) expect(t.at).toBeGreaterThanOrEqual(0);
  });

  it("formats units", () => {
    expect(formatDb(-24.4)).toBe("-24 dBFS");
    expect(formatHz(640.2)).toBe("640 Hz");
    expect(formatHz(1630)).toBe("1.6 kHz");
    expect(formatHz(2000)).toBe("2 kHz");
  });
});
