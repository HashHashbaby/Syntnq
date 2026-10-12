// Loading mural behaviour (D-052, docs/UI.md section 6): fast loads never show it, slow loads keep
// it at least min_ms, it fades out over fade_ms, and reduced motion makes it static.
import { expect, test, type Page } from "@playwright/test";

const SHOW_LOG = () => {
  // record whether the boot mural ever becomes visible, from the very first mutation
  (window as unknown as { __muralShown: boolean }).__muralShown = false;
  new MutationObserver(() => {
    const el = document.getElementById("syn-mural");
    if (el?.classList.contains("show")) (window as unknown as { __muralShown: boolean }).__muralShown = true;
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
};

async function slowBundle(page: Page, ms: number): Promise<void> {
  await page.route(/\/src\/main\.tsx/, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

// On the production bundle (the dev server serves hundreds of unbundled modules, so its first paint
// is legitimately slower than the 150 ms delay and the mural shows there).
test("a fast load never shows the mural and leaves no element behind", async ({ page }) => {
  await page.addInitScript(SHOW_LOG);
  await page.goto("http://127.0.0.1:5175/");
  await page.waitForFunction(() => !document.getElementById("syn-mural"));
  const log = await page.evaluate(() => ({ shown: (window as unknown as { __muralShown: boolean }).__muralShown, boot: window.__synMuralLog }));
  console.log(`fast load: shown ${log.shown}, gate ${JSON.stringify(log.boot)}`);
  expect(log.shown).toBe(false);
});

test("a slow load shows the mural for at least the minimum, then fades it out", async ({ page }) => {
  await slowBundle(page, 1200);
  await page.goto("/");
  await expect(page.locator("#syn-mural")).toHaveClass(/show/, { timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById("syn-mural"), null, { timeout: 15000 });
  const log = await page.evaluate(() => window.__synMuralLog!);
  const visible = log.hideAt! - log.shownAt!;
  const fade = log.removedAt! - log.hideAt!;
  console.log(`slow load: shown at ${log.shownAt!.toFixed(0)} ms, on screen ${visible.toFixed(0)} ms, fade ${fade.toFixed(0)} ms`);
  expect(log.shownAt!).toBeGreaterThanOrEqual(400);
  expect(visible).toBeGreaterThanOrEqual(600 - 1);
  expect(fade).toBeGreaterThanOrEqual(300 - 1);
  expect(fade).toBeLessThan(400);
});

test("reduced motion: the tiles are still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?mural=hold");
  await expect(page.locator("#syn-mural")).toHaveClass(/show/);
  const names = await page.locator(".mural-tile").first().evaluate((el) => getComputedStyle(el).animationName);
  expect(names).toBe("none");
});

test("in-app mural: a short load never shows it, a long one shows then leaves", async ({ page }) => {
  await page.goto("/?dev=mural&ms=100");
  await page.waitForTimeout(700);
  await expect(page.locator(".mural-cover")).toHaveCount(0);
  await page.goto("/?dev=mural&ms=1200");
  await expect(page.locator(".mural-cover")).toBeVisible({ timeout: 3000 });
  expect(await page.locator(".mural-cover .mural-tile").count()).toBe(96);
  await expect(page.locator(".mural-cover")).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByText("Loaded")).toBeVisible();
});

test("the mural fits short landscape screens and follows the text-size setting", async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto("/?mural=hold");
  await expect(page.locator("#syn-mural")).toHaveClass(/show/);
  const fit = await page.evaluate(() => {
    const m = document.querySelector(".mural")!.getBoundingClientRect();
    const w = document.querySelector(".mural-word")!.getBoundingClientRect();
    return { top: m.top, bottom: w.bottom, vh: innerHeight };
  });
  expect(fit.top).toBeGreaterThanOrEqual(0);
  expect(fit.bottom).toBeLessThanOrEqual(fit.vh);
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  const size = await page.locator(".mural-word").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBe(28); // 0.875rem at 200 % (D-053)
});
