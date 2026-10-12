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

test("frame time while playing: 3D chips vs the flat 2D view", async ({ page }) => {
  test.setTimeout(120_000);
  const rows: string[] = [];
  for (const trueColour of [false, true]) {
    await page.goto("/");
    await page.evaluate((tc) => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true, trueColour: tc })), trueColour);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("syn-mural"));
    const sample = page.getByRole("button", { name: "Try a sample" });
    if (await sample.count()) await sample.click();
    else await page.getByRole("option").first().click();
    await page.waitForFunction((k) => window.__synesthesia?.stats.kind === k, trueColour ? "webgl2" : "three", { timeout: 15000 });
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const gaps: number[] = [];
      let last = performance.now();
      const t0 = last;
      const s0 = { ...window.__synesthesia!.stats };
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
      const s = window.__synesthesia!.stats;
      return { n: gaps.length, p50: gaps[Math.floor(gaps.length / 2)], p95: gaps[Math.floor(gaps.length * 0.95)], cpu: (s.totalMs - s0.totalMs) / Math.max(1, s.frames - s0.frames), kind: s.kind };
    });
    rows.push(`${(trueColour ? "flat 2D (True colour)" : "3D chips").padEnd(22)} ${r.kind.padEnd(7)} frames ${r.n}  p50 ${r.p50.toFixed(2)} ms  p95 ${r.p95.toFixed(2)} ms  engine+draw mean ${r.cpu.toFixed(2)} ms`);
    await page.getByRole("button", { name: "Pause" }).click();
  }
  console.log(`playing, uncapped, 1440 x 900:\n${rows.join("\n")}`);
});
