// M7b phase 4b evidence: the cold-start mural (D-061) and the live trail chart (D-062).
// - mural: shown from the first paint, held for one full sweep, slower fade; reduced motion; skip
// - chart: the same `s` as the grid on every frame; moves while playing, holds when paused, follows seeks;
//   screenshots at three sizes, reduced motion, worst cases at 320 px and 200 % text, recordings.
// Output: out/ui_review/m7b/phase4b/ (git-ignored).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase4b");
mkdirSync(join(OUT, "video"), { recursive: true });
const save = (key: string, value: unknown): void => writeFileSync(join(OUT, `phase4b_${key}.json`), JSON.stringify(value, null, 2));

type MuralLog = { shownAt: number | null; hideAt: number | null; removedAt: number | null };
const muralLog = (page: Page): Promise<MuralLog | null> => page.evaluate(() => window.__synMuralLog ?? null);

async function openSample(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("trail-graph")).toBeVisible();
}

test.describe("cold-start mural", () => {
  test("shown from the first paint, one full sweep, then the fade", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
    await page.goto("/");
    await expect(page.locator("#syn-mural")).toHaveClass(/show/);
    await page.waitForFunction(() => window.__synMuralLog?.removedAt != null, null, { timeout: 10000 });
    const log = (await muralLog(page))!;
    const nav = await page.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).responseEnd);
    const r = { shown_after_response_ms: log.shownAt! - nav, held_ms: log.hideAt! - log.shownAt!, fade_ms: log.removedAt! - log.hideAt! };
    save("mural", r);
    console.log("mural", JSON.stringify(r));
    expect(r.held_ms).toBeGreaterThanOrEqual(2350 - 20);
    expect(r.held_ms).toBeLessThan(2350 + 400);
    expect(r.fade_ms).toBeGreaterThanOrEqual(440);
  });

  test("reduced motion: the still mural for 1 s", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
    await page.goto("/");
    await page.waitForFunction(() => window.__synMuralLog?.removedAt != null, null, { timeout: 10000 });
    const log = (await muralLog(page))!;
    save("mural_reduced_held_ms", log.hideAt! - log.shownAt!);
    expect(log.hideAt! - log.shownAt!).toBeGreaterThanOrEqual(1000 - 20);
    expect(log.hideAt! - log.shownAt!).toBeLessThan(1000 + 400);
    await ctx.close();
  });

  test("a key press after 600 ms skips to the fade, and does nothing else", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
    await page.goto("/");
    await page.waitForFunction(() => window.__synMuralLog != null && performance.now() - (window.__synMuralLog.shownAt ?? 0) > 900);
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.__synMuralLog?.hideAt != null, null, { timeout: 3000 });
    const log = (await muralLog(page))!;
    save("mural_skipped_held_ms", log.hideAt! - log.shownAt!);
    expect(log.hideAt! - log.shownAt!).toBeLessThan(1500);
  });

  test("recording: cold start", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
    await page.goto("/");
    await page.waitForTimeout(4000);
    await ctx.close();
  });
});

test.describe("trail chart", () => {
  test("draws the same s as the grid on every frame, moves, holds on pause, follows seeks (1440)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSample(page);
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(3500);
    const sync = await page.evaluate(() => {
      const grid = new Map(window.__synesthesia!.sLog.map(([t, s]) => [t, s]));
      let matched = 0, mismatched = 0, maxDiff = 0;
      for (const [t, s] of window.__synGraph!.log) {
        if (!grid.has(t)) continue;
        matched++;
        const d = Math.abs(grid.get(t)! - s);
        maxDiff = Math.max(maxDiff, d);
        if (d !== 0) mismatched++;
      }
      return { matched, mismatched, maxDiff };
    });
    const moving = await page.evaluate(async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const l = window.__synGraph!.last()!;
        seen.add(`${l.x.toFixed(4)},${l.y.toFixed(4)}`);
        await new Promise((r) => setTimeout(r, 50));
      }
      return seen.size;
    });
    await page.getByTestId("trail-graph").screenshot({ path: join(OUT, "1440x900_graph_playing.png") });
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(600);
    const p0 = await page.evaluate(() => window.__synGraph!.last()!);
    await page.waitForTimeout(500);
    const p1 = await page.evaluate(() => window.__synGraph!.last()!);
    await page.getByTestId("trail-graph").screenshot({ path: join(OUT, "1440x900_graph_paused.png") });
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    const p2 = await page.evaluate(() => window.__synGraph!.last()!);
    const r = { sync, distinct_points_in_1s: moving, paused_holds: p0.s === p1.s && p0.x === p1.x && p0.y === p1.y, seek_s: p2.s - p1.s };
    save("chart", r);
    console.log("chart", JSON.stringify(r));
    expect(sync.matched).toBeGreaterThan(100);
    expect(sync.mismatched).toBe(0);
    expect(moving).toBeGreaterThan(3);
    expect(r.paused_holds).toBe(true);
    expect(r.seek_s).toBeCloseTo(5, 1);
  });

  for (const size of [{ name: "390x844", width: 390, height: 844 }, { name: "820x1180", width: 820, height: 1180 }, { name: "1440x900", width: 1440, height: 900 }]) {
    test(`screens ${size.name}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.width < 735, hasTouch: size.width < 1000 });
      const page = await ctx.newPage();
      await openSample(page);
      await page.getByRole("button", { name: "Play" }).click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: join(OUT, `${size.name}_1_playing.png`) });
      await page.getByTestId("trail-graph").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, `${size.name}_2_chart.png`) });
      await ctx.close();
    });
  }

  test("reduced motion: the dot only, no trail (1440)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await openSample(page);
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(2000);
    await page.getByTestId("trail-graph").screenshot({ path: join(OUT, "1440x900_graph_reduced_motion.png") });
    await ctx.close();
  });

  test("toggle (G) hides and shows the chart (1440)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSample(page);
    await page.keyboard.press("g");
    await expect(page.getByTestId("trail-graph")).toHaveCount(0);
    await page.getByRole("button", { name: "Loudness and brightness chart" }).click();
    await expect(page.getByTestId("trail-graph")).toBeVisible();
  });

  for (const { w, h } of [{ w: 320, h: 640 }, { w: 1440, h: 900 }]) {
    test(`worst case: ${w} px at 200 % text`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 735, hasTouch: w < 735 });
      const page = await ctx.newPage();
      await openSample(page);
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.getByRole("button", { name: "Play" }).click();
      await page.waitForTimeout(1500);
      const chart = page.getByTestId("trail-graph");
      await chart.scrollIntoViewIfNeeded();
      await chart.screenshot({ path: join(OUT, `break_${w}_200pct_chart.png`) });
      await page.getByRole("group", { name: "Playback" }).screenshot({ path: join(OUT, `break_${w}_200pct_player.png`) });
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push("horizontal page scroll");
        const pane = document.querySelector<HTMLElement>("[data-testid=trail-graph]")!.getBoundingClientRect();
        const plot = document.querySelector<HTMLElement>(".graph-plot")!.getBoundingClientRect();
        if (plot.width < 120) out.push(`plot only ${plot.width.toFixed(0)} px wide`);
        document.querySelectorAll<HTMLElement>(".graph-xticks span, .graph-yticks span, .graph-xtitle, .graph-ytitle").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.left < pane.left - 0.5 || r.right > pane.right + 0.5) out.push(`label outside the pane: "${el.textContent}"`);
        });
        const scrub = document.querySelector<HTMLElement>(".scrub")!.getBoundingClientRect();
        if (scrub.width < 48) out.push(`scrubber only ${scrub.width.toFixed(0)} px`);
        return out;
      });
      save(`break_${w}_200pct`, problems);
      console.log(`${w}px 200%: ${problems.length ? problems.join("; ") : "ok"}`);
      expect(problems).toEqual([]);
      await ctx.close();
    });
  }

  test("recording: grid and chart together, play, pause, seek, play (1440)", async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
    const page = await ctx.newPage();
    await openSample(page);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(6000);
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(1500);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(5000);
    await ctx.close();
  });
});
