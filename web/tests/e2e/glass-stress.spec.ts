// Glass material cost over the live canvas (plan section 7.3, D-051). Each run shows N glass
// controls over the playing grid and reports rAF frame intervals; the table sets the glass-area
// budget. Numbers are reported, not asserted (headless GPU, one machine).
import { expect, test } from "@playwright/test";

const COUNTS = [0, 6, 12, 24];
const TIERS = ["refract", "frost", "solid"] as const;

// UNCAPPED=1 turns vsync and the frame-rate limit off, so frame time measures the work instead of
// sitting at 16.7 ms on a fast GPU (same GPU flags as playwright.config.ts).
const GPU_ARGS = process.platform === "win32" ? ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--disable-gpu-sandbox"] : [];
const UNCAPPED = process.env.UNCAPPED === "1" ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : [];
test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", ...GPU_ARGS, ...UNCAPPED] },
});

test("glass controls over the live canvas: frame-time table", async ({ page }) => {
  test.setTimeout(300_000);
  const rows: string[] = [];
  for (const tier of TIERS) {
    for (const n of COUNTS) {
      const q = tier === "refract" ? "" : `&glass=${tier}`;
      await page.goto(`/?dev=glass&n=${n}${q}`);
      await page.waitForFunction(() => !!window.__glassStress, null, { timeout: 30_000 });
      const r = await page.evaluate(() => window.__glassStress!);
      expect(r.tier).toBe(tier);
      rows.push(`${tier.padEnd(7)} n=${String(n).padStart(2)}  frames ${r.frames}  p50 ${r.p50.toFixed(1)} ms  p95 ${r.p95.toFixed(1)} ms  max ${r.max.toFixed(1)} ms`);
    }
  }
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    return dbg && gl ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : "unknown";
  });
  console.log(`glass stress on ${renderer}\n${rows.join("\n")}`);
});
