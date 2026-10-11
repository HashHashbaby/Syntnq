// WebGL renderer vs the Python reference preview at 5 timestamps (docs/LIVE.md section 6):
// mean per-pixel difference must be <= 6/255 with identical parameters.
import { expect, test } from "@playwright/test";

const TOLERANCE = 6;

interface Row {
  frame: number;
  mean: number;
  max: number;
}

for (const prefix of ["aba", "click"]) {
  test(`WebGL frames match the Python reference (${prefix})`, async ({ page }) => {
    await page.goto("/");
    const rows = (await page.evaluate(async (pfx: string) => {
      // dynamic imports of dev-server modules (resolved by Vite in the page, not by TypeScript)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const load = (p: string): Promise<any> => import(/* @vite-ignore */ p);
      const [engineMod, poolMod, glMod, fmt, paramsMod] = await Promise.all([
        load("/src/engine/live.ts"),
        load("/src/engine/pool.ts"),
        load("/src/gl/renderer.ts"),
        load("/src/data/formats.ts"),
        load("/src/params.ts"),
      ]);
      const { params } = paramsMod;
      const get = async (n: string): Promise<ArrayBuffer> => (await fetch(`/tests/fixtures/${n}`)).arrayBuffer();
      const exp = await (await fetch(`/tests/fixtures/${pfx}_expected.json`)).json();
      const live = fmt.parseLive(await get(`${pfx}_live.bin`));
      const proto = fmt.parseProto(await get(`${pfx}_proto.bin`));
      const stat = fmt.parseStatic(await get(`${pfx}_static.bin`));
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      const renderer = new glMod.GridRenderer(canvas, params);
      renderer.resize(exp.raster_px, 1);
      const eng = new engineMod.LiveEngine(live, proto, stat.colorOklch, params, { nominalDt: 1 / exp.fps });
      const pooler = new poolMod.Pooler(params.grid.size, params.render.display_grid, 128);
      eng.reset(exp.start_s);
      const out: { frame: number; mean: number; max: number }[] = [];
      const cmp = document.createElement("canvas");
      cmp.width = exp.raster_px;
      cmp.height = exp.raster_px;
      const cctx = cmp.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      for (let k = 0; k < exp.n_frames; k++) {
        const f = eng.step(exp.start_s + k / exp.fps);
        if (!exp.raster_frames.includes(k)) continue;
        const pf = pooler.pool(f.srgb, f.radiusScale, f.trail, f.trailLength);
        renderer.draw(pf);
        const mine = renderer.readPixels();
        const bmp = await createImageBitmap(await (await fetch(`/tests/fixtures/${pfx}_raster_${String(k).padStart(2, "0")}.png`)).blob());
        cctx.drawImage(bmp, 0, 0);
        const ref = cctx.getImageData(0, 0, exp.raster_px, exp.raster_px).data;
        let sum = 0, max = 0;
        for (let i = 0; i < ref.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(mine[i + c] - ref[i + c]);
            sum += d;
            if (d > max) max = d;
          }
        }
        out.push({ frame: k, mean: sum / (ref.length / 4 * 3), max });
      }
      return out;
    }, prefix)) as Row[];
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      test.info().annotations.push({ type: "parity", description: `${prefix} frame ${r.frame}: mean ${r.mean.toFixed(3)}/255, max ${r.max}` });
      expect(r.mean, `frame ${r.frame}`).toBeLessThanOrEqual(TOLERANCE);
    }
    console.log(prefix, rows.map((r) => `${r.frame}:${r.mean.toFixed(2)}`).join("  "));
  });
}
