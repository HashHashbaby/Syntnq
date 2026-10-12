// M7b phase 2b evidence (graphite redesign, D-053..D-055): the main screens at three sizes, the
// loading mural, reduced transparency, and a short recording. Output: out/ui_review/m7b/phase2b/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase2b");
mkdirSync(join(OUT, "video"), { recursive: true });
const SIZES = [
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "820x1180", width: 820, height: 1180, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
] as const;

async function boot(page: Page, extra: Record<string, string> = {}, path = "/"): Promise<void> {
  await page.addInitScript((e) => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true, ...e })), extra);
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

for (const size of SIZES) {
  test(`screens ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.width < 735 });
    const page = await ctx.newPage();
    await boot(page);
    await expect(page.getByText("Add a song to see its signature.")).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${size.name}_1_library_empty.png`) });
    await page.getByRole("button", { name: "Try a sample" }).click();
    await expect(page.getByTestId("stage")).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `${size.name}_2_signature.png`) });
    if (size.width >= 735) {
      await page.getByRole("button", { name: "Structure (3)" }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(OUT, `${size.name}_3_map.png`) });
      await page.getByRole("button", { name: "Settings" }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(OUT, `${size.name}_4_settings.png`) });
    }
    await ctx.close();
  });
}

test("loading mural and reduced transparency (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await boot(page, {}, "/?mural=hold");
  await expect(page.locator("#syn-mural")).toHaveClass(/show/);
  await page.waitForTimeout(1250);
  await page.screenshot({ path: join(OUT, "1440x900_mural.png") });
  await ctx.close();
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await c2.newPage();
  await boot(p2, { reduceTransparency: "on" });
  await p2.getByRole("button", { name: "Try a sample" }).click();
  await expect(p2.getByTestId("stage")).toBeVisible();
  await p2.waitForTimeout(900);
  await p2.screenshot({ path: join(OUT, "1440x900_reduced_transparency.png") });
  await c2.close();
});

test("recording: library, sample, play, map switch, settings (1440)", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await boot(page);
  await page.waitForTimeout(900);
  const up = page.getByRole("button", { name: "Upload a song" });
  const b = (await up.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("stage")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(3000);
  for (const name of ["Structure (3)", "Sound (1)"]) {
    await page.getByRole("button", { name }).click();
    await page.waitForTimeout(800);
  }
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await ctx.close();
});
