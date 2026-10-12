// Cost of the floating glass panes while the grid plays (D-054), measured uncapped (vsync and frame
// limit off) per glass tier at 1440 x 900. Reported, not asserted.
import { expect, test } from "@playwright/test";

const GPU_ARGS = process.platform === "win32" ? ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--disable-gpu-sandbox"] : [];
test.use({ viewport: { width: 1440, height: 900 }, launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", ...GPU_ARGS, "--disable-gpu-vsync", "--disable-frame-rate-limit"] } });

test("frame time while playing, per glass tier", async ({ page }) => {
  test.setTimeout(180_000);
  const rows: string[] = [];
  const VARIANTS: [string, string, string][] = [
    ["refract", "", "as built (side panes frost while playing)"],
    ["refract", ":root[data-playing] .sidebar.pane, :root[data-playing] .inspector.pane { backdrop-filter: var(--glass-lens) blur(12px) saturate(140%) !important; }", "all panes refract (before the fix)"],
    ["refract", ".toolbar.pane, .player { backdrop-filter: blur(12px) saturate(140%) !important; }", "pills frost, side panes refract"],
    ["refract", ".sidebar.pane, .inspector.pane { backdrop-filter: blur(12px) saturate(140%) !important; }", "side panes frost, pills refract"],
    ["refract", ".pane, .player { backdrop-filter: blur(12px) saturate(140%) !important; }", "panes frost, controls refract"],
    ["frost", "", "frost tier"],
    ["solid", "", "solid tier"],
  ];
  for (const [tier, css, label] of VARIANTS) {
    await page.goto(`/${tier === "refract" ? "" : `?glass=${tier}`}`);
    await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("syn-mural"));
    const sample = page.getByRole("button", { name: "Try a sample" });
    if (await sample.count()) await sample.click();
    else await page.getByRole("option").first().click();
    await expect(page.getByRole("button", { name: "Play" })).toBeEnabled();
    await page.getByRole("button", { name: "Play" }).click();
    if (css) await page.addStyleTag({ content: css });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const gaps: number[] = [];
      let last = performance.now();
      const t0 = last;
      await new Promise<void>((done) => {
        const f = (now: number): void => {
          gaps.push(now - last);
          last = now;
          if (now - t0 < 5000) requestAnimationFrame(f);
          else done();
        };
        requestAnimationFrame(f);
      });
      gaps.sort((a, b) => a - b);
      return { n: gaps.length, p50: gaps[Math.floor(gaps.length / 2)], p95: gaps[Math.floor(gaps.length * 0.95)], tier: document.documentElement.dataset.glass };
    });
    rows.push(`${label.padEnd(34)} frames ${r.n}  p50 ${r.p50.toFixed(2)} ms  p95 ${r.p95.toFixed(2)} ms`);
    await page.getByRole("button", { name: "Pause" }).click();
  }
  console.log(`playing, uncapped, 1440 x 900:\n${rows.join("\n")}`);
});
