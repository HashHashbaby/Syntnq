// CPU cost of one display frame (engine step + pooling). The renderer adds GPU time; the whole
// frame must fit 16.6 ms for 60 fps (docs/LIVE.md section 7 asks for GPU <= 6 ms on M1).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLive, parseProto, parseStatic } from "../../src/data/formats";
import { LiveEngine } from "../../src/engine/live";
import { Pooler } from "../../src/engine/pool";
import { params } from "../../src/params";

const FIX = join(__dirname, "..", "fixtures");
const d = existsSync(join(FIX, "click_live.bin")) ? describe : describe.skip;

function ab(name: string): ArrayBuffer {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

d("frame cost", () => {
  it("engine step plus pooling stays well inside a 60 fps frame", () => {
    const live = parseLive(ab("click_live.bin"));
    const proto = parseProto(ab("click_proto.bin"));
    const stat = parseStatic(ab("click_static.bin"));
    const eng = new LiveEngine(live, proto, stat.colorOklch, params);
    const pooler = new Pooler(params.grid.size, params.render.display_grid, 128);
    eng.reset(5);
    for (let k = 0; k < 20; k++) eng.step(5 + k / 60); // warm up
    const N = 200;
    const t0 = performance.now();
    for (let k = 0; k < N; k++) {
      const f = eng.step(6 + k / 60);
      pooler.pool(f.srgb, f.radiusScale, f.trail, f.trailLength);
    }
    const ms = (performance.now() - t0) / N;
    // eslint-disable-next-line no-console
    console.log(`engine+pool: ${ms.toFixed(2)} ms per frame`);
    expect(ms).toBeLessThan(6);
  });
});
