// Song comparison in the browser (D-066): the TypeScript port gives the Python results (distance, score,
// label, top differences) for every pair of bundled samples; nearest-song ranking.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compare, distance, nearest, scoreOf } from "../../src/engine/compare";
import { params } from "../../src/params";

const FIX = join(__dirname, "..", "fixtures", "compare_cases.json");
const have = existsSync(FIX);

interface Case {
  a: string;
  b: string;
  distance: number;
  score: number;
  label: string;
  top_differences: Array<{ key: string; weight: number; text: string }>;
}

(have ? describe : describe.skip)("compare parity with Python", () => {
  const fx = have ? (JSON.parse(readFileSync(FIX, "utf-8")) as { fingerprints: Record<string, number[]>; cases: Case[] }) : { fingerprints: {}, cases: [] };
  it("matches distance, score, label and the top differences for every sample pair", () => {
    expect(fx.cases.length).toBeGreaterThan(3);
    for (const c of fx.cases) {
      const r = compare(fx.fingerprints[c.a], fx.fingerprints[c.b], params);
      expect(r.distance).toBeCloseTo(c.distance, 5);
      expect(r.score).toBeCloseTo(c.score, 0);
      expect(r.label).toBe(c.label);
      expect(r.topDifferences.map((d) => d.key)).toEqual(c.top_differences.map((d) => d.key));
      expect(r.topDifferences.map((d) => d.text)).toEqual(c.top_differences.map((d) => d.text));
    }
  });

  it("is symmetric in distance, and a song is nearest to itself", () => {
    const [a, b] = Object.values(fx.fingerprints);
    expect(distance(a, b, params)).toBeCloseTo(distance(b, a, params), 12);
    const others = Object.entries(fx.fingerprints).map(([id, fingerprint]) => ({ id, fingerprint }));
    expect(nearest(a, others, params, 1)[0].distance).toBe(0);
  });
});

describe("score", () => {
  it("is the share of corpus pairs farther apart (100 at the closest, 0 past the farthest)", () => {
    const p = params.compare.percentiles;
    expect(scoreOf(0, p)).toBe(100);
    expect(scoreOf(p[p.length - 1] + 1, p)).toBe(0);
    expect(scoreOf(p[10], p)).toBeCloseTo(50, 6); // the corpus median
  });
});
