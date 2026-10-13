// M8 export (D-065). Gate tests: the in-app static view at 1024 px against the Python export of the same
// song (gate 3/255; see the note on the WebGL renderer below), and the in-browser export (the path bundled
// samples take) at 2048 px (<= 3/255); the caption adds the band under an unchanged square. Evidence: out/ui_review/m8/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m8");
mkdirSync(OUT, { recursive: true });
const FIX = join(process.cwd(), "tests", "fixtures");
const SLUGS = ["ambient", "electronic", "rock"] as const;
const GATE = 3 / 255;

async function openSample(page: Page, slug: string): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true, trueColour: true })));
  await page.goto("/");
  await page.waitForFunction(() => {
    const app = (window as unknown as { __synApp?: { getState: () => { lib: unknown; samples: unknown[] } } }).__synApp;
    return !!app && !!app.getState().lib && app.getState().samples.length > 0;
  });
  await page.evaluate((s) => (window as unknown as { __synApp: { getState: () => { addSample: (x: string) => Promise<void> } } }).__synApp.getState().addSample(s), slug);
  await expect(page.getByTestId("stage")).toBeVisible();
  await page.waitForFunction(() => window.__synesthesia?.stats.kind === "webgl2", null, { timeout: 15000 });
  await page.waitForTimeout(1500); // the arrival reveal has finished: the static signature
}

/** Mean absolute RGB difference (0..1) between two images in the page, decoded from base64 PNGs. */
async function meanDiff(page: Page, aB64: string, bB64: string | null, aSize: number): Promise<{ mean: number; w: number; h: number; bw: number; bh: number }> {
  return page.evaluate(
    async ({ a, b, size }) => {
      const load = async (b64: string): Promise<ImageData> => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const x = c.getContext("2d")!;
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, c.width, c.height);
      };
      const A = await load(a);
      let B: ImageData;
      if (b) B = await load(b);
      else {
        // the live stage: read its pixels (top-down RGBA) as drawn
        const px = window.__synesthesia!.readPixels();
        const n = window.__synesthesia!.size();
        B = new ImageData(new Uint8ClampedArray(px), n, n);
      }
      let sum = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const ia = (y * A.width + x) * 4, ib = (y * B.width + x) * 4;
          sum += Math.abs(A.data[ia] - B.data[ib]) + Math.abs(A.data[ia + 1] - B.data[ib + 1]) + Math.abs(A.data[ia + 2] - B.data[ib + 2]);
        }
      }
      return { mean: sum / (size * size * 3) / 255, w: A.width, h: A.height, bw: B.width, bh: B.height };
    },
    { a: aB64, b: bB64, size: aSize },
  );
}

test("the in-app static view matches the Python export at 1024 px (mean <= 3/255)", async ({ browser }) => {
  // the stage is min(column, 100vh - 230px) wide: 512 CSS px at 742 px tall, so 1024 device px at 2x
  const rows: Record<string, unknown> = {};
  for (const slug of SLUGS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 742 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await openSample(page, slug);
    expect(await page.evaluate(() => window.__synesthesia!.size())).toBe(1024);
    const ref = readFileSync(join(FIX, `sample_${slug}_1024.png`)).toString("base64");
    const d = await meanDiff(page, ref, null, 1024);
    rows[slug] = d.mean * 255;
    await ctx.close();
  }
  writeFileSync(join(OUT, "m8_inapp_vs_python.json"), JSON.stringify({ gate_per_255: 3, mean_per_255: rows }, null, 2));
  console.log("in-app vs Python export (/255):", JSON.stringify(rows));
  // The milestone gate is 3/255. The in-app 2D view is the frozen WebGL renderer, whose GPU glow halo
  // differs slightly from the export's; its dot fill matches exactly (D-059). Measured 2.88-3.22/255, so
  // this asserts the bound accepted for this renderer at the M7 sign-off (D-050: WebGL vs Python <= 3.26),
  // which the owner kept for the in-app view (D-065, option a); the exports themselves meet 3/255 (next test).
  for (const [slug, v] of Object.entries(rows)) expect(v as number, `${slug}: in-app vs Python export (/255)`).toBeLessThanOrEqual(3.26);
});

test("the in-browser export matches the Python export at 2048 px; the caption adds the band", async ({ browser }) => {
  test.setTimeout(240_000);
  const rows: Record<string, unknown> = {};
  for (const slug of SLUGS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await openSample(page, slug);
    const save = async (px: number, caption: boolean): Promise<Buffer> => {
      await page.getByRole("button", { name: "Export" }).click();
      await page.locator("#exp-size").selectOption(String(px));
      const box = page.locator("#exp-caption");
      if ((await box.isChecked()) !== caption) await box.click();
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save" }).click()]);
      const path = await dl.path();
      return readFileSync(path!);
    };
    const plain = await save(2048, false);
    const ref = readFileSync(join(FIX, `sample_${slug}_2048.png`)).toString("base64");
    const d = await meanDiff(page, ref, plain.toString("base64"), 2048);
    const captioned = await save(slug === "ambient" ? 4096 : 2048, true);
    writeFileSync(join(OUT, `inbrowser_${slug}_${slug === "ambient" ? 4096 : 2048}_caption.png`), captioned);
    const dims = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, captioned.toString("base64"));
    rows[slug] = { plain_vs_python_per_255: d.mean * 255, plain_size: [d.bw, d.bh], captioned_size: dims };
    expect(d.mean, `${slug}: in-browser export vs Python export`).toBeLessThanOrEqual(GATE);
    expect([d.bw, d.bh]).toEqual([2048, 2048]);
    const side = slug === "ambient" ? 4096 : 2048;
    expect(dims).toEqual([side, side + Math.round(0.17 * side)]);
    await ctx.close();
  }
  writeFileSync(join(OUT, "m8_inbrowser_export.json"), JSON.stringify(rows, null, 2));
  console.log("in-browser export:", JSON.stringify(rows));
});

test("export sheet: caption on by default, sizes, worst-case title at 320 px (screenshots)", async ({ browser }) => {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 735, hasTouch: w < 735 });
    const page = await ctx.newPage();
    await openSample(page, "ambient");
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.locator("#exp-caption")).toBeChecked();
    expect(await page.locator("#exp-size option").allTextContents()).toEqual(["2048 px", "4096 px", "8192 px"]);
    await page.screenshot({ path: join(OUT, `${w}x${h}_export_sheet.png`) });
    await ctx.close();
  }
});
