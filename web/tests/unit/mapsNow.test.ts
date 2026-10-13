// Companion maps, live part (D-064): now on the time axis, tempo at now, the current sound's trail, legends.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPO_COLS, TEMPO_ROWS, parseLive } from "../../src/data/formats";
import { bpmOfRow, featureLegend, nodeTrail, rowOfBpm, songFraction, tempoAt, timeTicks } from "../../src/engine/mapsNow";
import { params } from "../../src/params";

const FIX = join(__dirname, "..", "fixtures");
const have = existsSync(join(FIX, "aba_live.bin"));
const ab = (name: string): ArrayBuffer => {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("maps now", () => {
  it("maps the BPM rows on a log axis from 40 to 240", () => {
    expect(bpmOfRow(0)).toBeCloseTo(40, 6);
    expect(bpmOfRow(TEMPO_ROWS - 1)).toBeCloseTo(240, 6);
    expect(rowOfBpm(120)).toBeCloseTo(Math.log(3) / Math.log(6), 9);
  });

  it("finds the strongest tempo in the column at now", () => {
    const tg = new Float32Array(TEMPO_ROWS * TEMPO_COLS);
    const row = Math.round(rowOfBpm(128) * (TEMPO_ROWS - 1));
    tg[row * TEMPO_COLS + 100] = 1;
    tg[(row - 20) * TEMPO_COLS + 100] = 0.4;
    const t = tempoAt(tg, (100 + 0.5) / TEMPO_COLS);
    expect(t.bpm).toBeCloseTo(128, -0.5);
    expect(t.strength).toBe(1);
  });

  it("puts ticks at the start, quarters and end", () => {
    expect(timeTicks(240, 4)).toEqual([0, 60, 120, 180, 240]);
  });

  it("names both ends of every feature ramp in words and units", () => {
    for (const f of ["brightness", "loudness", "noisiness", "harmonicity", "change"]) {
      const l = featureLegend(f, params);
      expect(l.low.length).toBeGreaterThan(2);
      expect(l.highValue.length).toBeGreaterThan(0);
    }
    expect(featureLegend("brightness", params).highValue).toMatch(/kHz/);
    expect(featureLegend("loudness", params).lowValue).toMatch(/dBFS/);
  });

  (have ? it : it.skip)("follows the song: fraction of the analysed frames, trail of the grid's window ending now", () => {
    const live = parseLive(ab("aba_live.bin"));
    expect(songFraction(0, live)).toBe(0);
    expect(songFraction((live.frames - 1) / live.fps, live)).toBeCloseTo(1, 9);
    expect(songFraction(1e6, live)).toBe(1);
    const s = (live.frames / live.fps) * 0.5;
    const tr = nodeTrail(live, s, params);
    expect(tr.n).toBe(Math.max(2, Math.round(params.ui.maps_live.now_trail_s * live.fps)));
    const last = live.bmu[Math.floor(s * live.fps)];
    expect(tr.pts[(tr.n - 1) * 3]).toBe((last % 64) / 2);
    expect(tr.pts[(tr.n - 1) * 3 + 1]).toBe(Math.floor(last / 64) / 2);
    expect(params.ui.maps_live.now_trail_s).toBe(params.live.trail.length_s);
  });
});
