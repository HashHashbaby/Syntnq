// M7b phase 2 evidence (loading mural, D-052): stills at three sizes in light and dark, a reduced-
// motion still, the in-app cover, and recordings of a slow boot and the in-app gate (frame cost:
// mural-cost.spec.ts). Output: out/ui_review/m7b/phase2/ (git-ignored).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase2");
mkdirSync(join(OUT, "video"), { recursive: true });
const SIZES = [
  { name: "390x844", width: 390, height: 844 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

async function settings(page: Page, appearance: string, extra: Record<string, string> = {}): Promise<void> {
  await page.addInitScript(
    ([a, e]) => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true, appearance: a, ...e })),
    [appearance, extra] as const,
  );
}

for (const size of SIZES) {
  for (const scheme of ["light", "dark"] as const) {
    test(`mural still ${size.name} ${scheme}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      const page = await ctx.newPage();
      await settings(page, scheme);
      await page.goto("/?mural=hold");
      await expect(page.locator("#syn-mural")).toHaveClass(/show/);
      await page.waitForTimeout(1250); // mid-sweep: the diagonal wave is crossing the mural
      await page.screenshot({ path: join(OUT, `${size.name}_${scheme}_mural.png`) });
      await ctx.close();
    });
  }
}

test("reduced motion and in-app cover stills", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await settings(page, "light");
  await page.goto("/?mural=hold");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "1440x900_light_mural_reduced_motion.png") });
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const p2 = await ctx2.newPage();
  await settings(p2, "light");
  await p2.goto("/?dev=mural&ms=4000");
  await expect(p2.locator(".mural-cover")).toBeVisible();
  await p2.waitForTimeout(1100);
  await p2.screenshot({ path: join(OUT, "1440x900_light_in_app_cover.png") });
  await ctx2.close();
});

for (const size of [SIZES[2], SIZES[0]]) {
  test(`recording: slow boot then app ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: "light", recordVideo: { dir: join(OUT, "video"), size: { width: size.width, height: size.height } } });
    const page = await ctx.newPage();
    await settings(page, "light");
    await page.route(/\/src\/main\.tsx/, async (route) => {
      await new Promise((r) => setTimeout(r, 2200));
      await route.continue();
    });
    await page.goto("/");
    await page.waitForFunction(() => !document.getElementById("syn-mural"), null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await ctx.close();
  });
}

test("recording: in-app gate, 100 ms load (never shows) then 2.5 s load", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await settings(page, "light");
  await page.goto("/?dev=mural&ms=100");
  await page.waitForTimeout(1200);
  await page.goto("/?dev=mural&ms=2500");
  await expect(page.getByText("Loaded")).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(800);
  await ctx.close();
});
