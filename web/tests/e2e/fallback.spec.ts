import { expect, test } from "@playwright/test";

// The Canvas2D renderer draws the same pooled frame when WebGL2 is unavailable (docs/LIVE.md 4).
test("Canvas2D fallback matches the WebGL frame closely", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const load = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const [eng, pool, gl, c2d, fmt, pm] = await Promise.all([
      load("/src/engine/live.ts"), load("/src/engine/pool.ts"), load("/src/gl/renderer.ts"),
      load("/src/gl/canvas2d.ts"), load("/src/data/formats.ts"), load("/src/params.ts"),
    ]);
    const { params } = pm;
    const get = async (n: string): Promise<ArrayBuffer> => (await fetch(`/tests/fixtures/${n}`)).arrayBuffer();
    const live = fmt.parseLive(await get("aba_live.bin"));
    const proto = fmt.parseProto(await get("aba_proto.bin"));
    const stat = fmt.parseStatic(await get("aba_static.bin"));
    const engine = new eng.LiveEngine(live, proto, stat.colorOklch, params);
    const pooler = new pool.Pooler(params.grid.size, params.render.display_grid, 128);
    engine.reset(6);
    let f = engine.step(6);
    for (let k = 1; k < 12; k++) f = engine.step(6 + k / 30);
    const pf = pooler.pool(f.srgb, f.radiusScale, f.trail, f.trailLength);
    const a = document.createElement("canvas");
    const b = document.createElement("canvas");
    document.body.append(a, b);
    const g = new gl.GridRenderer(a, params);
    const c = new c2d.Canvas2DRenderer(b, params);
    g.resize(540, 1);
    c.resize(540, 1);
    g.draw(pf);
    c.draw(pf);
    const pa = g.readPixels();
    const pb = c.readPixels();
    let sum = 0;
    for (let i = 0; i < pa.length; i += 4) for (let k = 0; k < 3; k++) sum += Math.abs(pa[i + k] - pb[i + k]);
    return { mean: sum / (pa.length / 4 * 3), kind: c.kind };
  });
  console.log(`canvas2d vs webgl mean difference ${r.mean.toFixed(2)}/255`);
  expect(r.kind).toBe("canvas2d");
  expect(r.mean).toBeLessThan(12);
});

test("the app runs on Canvas2D when WebGL2 is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (type: string, ...rest: unknown[]) {
      if (type === "webgl2" || type === "webgl") return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (orig as any).call(this, type, ...rest);
    };
    localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("stage")).toBeVisible();
  await page.waitForTimeout(300);
  const kind = await page.evaluate(() => window.__synesthesia?.stats.kind);
  expect(kind).toBe("canvas2d");
});
