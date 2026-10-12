// Frame cost of the loading mural (D-052), measured uncapped (vsync and frame limit off) so the
// interval reflects the work rather than the display rate.
import { test } from "@playwright/test";

const GPU_ARGS = process.platform === "win32" ? ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--disable-gpu-sandbox"] : [];
test.use({ launchOptions: { args: ["--ignore-gpu-blocklist", ...GPU_ARGS, "--disable-gpu-vsync", "--disable-frame-rate-limit"] }, viewport: { width: 1440, height: 900 } });

test("rAF intervals with and without the mural", async ({ page }) => {
  const measure = async (): Promise<string> =>
    page.evaluate(async () => {
      const gaps: number[] = [];
      let last = performance.now();
      await new Promise<void>((done) => {
        const t0 = last;
        const f = (now: number): void => {
          gaps.push(now - last);
          last = now;
          if (now - t0 < 4000) requestAnimationFrame(f);
          else done();
        };
        requestAnimationFrame(f);
      });
      gaps.sort((a, b) => a - b);
      return `frames ${gaps.length}  p50 ${gaps[Math.floor(gaps.length / 2)].toFixed(2)} ms  p95 ${gaps[Math.floor(gaps.length * 0.95)].toFixed(2)} ms`;
    });
  await page.goto("/?mural=hold");
  await page.waitForTimeout(1000);
  const on = await measure();
  await page.evaluate(() => document.getElementById("syn-mural")?.remove());
  await page.waitForTimeout(500);
  const off = await measure();
  console.log(`mural on : ${on}\nmural off: ${off}`);
});
