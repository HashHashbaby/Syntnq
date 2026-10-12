import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLASS_SELECTOR, displacementMap } from "../../src/glass/glass";

const px = (m: Uint8ClampedArray, w: number, x: number, y: number): [number, number] => [m[(y * w + x) * 4], m[(y * w + x) * 4 + 1]];

describe("glass displacement map", () => {
  const w = 120, h = 44, r = 22, bezel = 14;
  const m = displacementMap(w, h, r, bezel);

  it("leaves the centre undistorted", () => {
    expect(px(m, w, 60, 22)).toEqual([128, 128]);
  });

  it("bends the rim inward along the edge normal", () => {
    const [, gTop] = px(m, w, 60, 1); // top edge: sample moves down (+y)
    const [, gBottom] = px(m, w, 60, h - 2); // bottom edge: sample moves up (-y)
    const [rLeft] = px(m, w, 23, 22); // inside the bezel near the left cap? centre row is far from caps
    expect(gTop).toBeGreaterThan(200);
    expect(gBottom).toBeLessThan(56);
    expect(rLeft).toBe(128);
    const [rCap] = px(m, w, 1, 22); // left cap: sample moves right (+x)
    expect(rCap).toBeGreaterThan(200);
  });

  it("is zero outside the shape", () => {
    expect(px(m, w, 0, 0)).toEqual([128, 128]); // the rounded corner is outside
  });
});

describe("glass selector", () => {
  it("matches the list in app.css, so every styled control also gets its lens", () => {
    const css = readFileSync(join(__dirname, "../../src/styles/app.css"), "utf-8");
    expect(css).toContain(`${GLASS_SELECTOR} {`);
  });
});
