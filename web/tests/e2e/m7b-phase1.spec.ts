// M7b phase 1 evidence (docs/PLAN_3D_REDESIGN.md section 9.5): the new type, colour and glass
// tokens on the main screens at three sizes in light and dark, plus close-ups of the glass tiers,
// press and hover states, and the font comparison. Images go to test-results/m7b/phase1/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase1");
mkdirSync(OUT, { recursive: true });
const SIZES = [
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "820x1180", width: 820, height: 1180, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
] as const;

async function boot(page: Page, appearance: string, extra = "", landing = false): Promise<void> {
  await page.goto(`/${extra}`);
  await page.evaluate(
    ({ appearance, landing }) => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: !landing, appearance })),
    { appearance, landing },
  );
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
}

for (const size of SIZES) {
  for (const scheme of ["light", "dark"] as const) {
    test(`screens ${size.name} ${scheme}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, hasTouch: size.touch, isMobile: size.width < 735 });
      const page = await ctx.newPage();
      const id = `${size.name}_${scheme}`;
      await boot(page, scheme);
      await expect(page.getByText("Add a song to see its signature.")).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${id}_1_library_empty.png`) });
      await page.getByRole("button", { name: "Try a sample" }).click();
      await expect(page.getByTestId("stage")).toBeVisible();
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, `${id}_2_signature.png`) });
      if (size.width >= 735) {
        await page.getByRole("button", { name: "Settings" }).click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT, `${id}_3_settings.png`) });
      }
      await ctx.close();
    });
  }
}

test("glass tiers, states and fonts (1440, light and dark)", async ({ browser }) => {
  for (const scheme of ["light", "dark"] as const) {
    for (const tier of ["refract", "frost", "solid"] as const) {
      const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
      const page = await tctx.newPage();
      await boot(page, scheme, tier === "refract" ? "" : `?glass=${tier}`);
      expect(await page.evaluate(() => document.documentElement.dataset.glass)).toBe(tier);
      await page.getByRole("button", { name: "Try a sample" }).click();
      await expect(page.getByTestId("stage")).toBeVisible();
      await page.waitForTimeout(700);
      const lens = await page.getByRole("button", { name: "Play" }).evaluate((el) => getComputedStyle(el).getPropertyValue("--glass-lens"));
      if (tier === "refract") expect(lens).toContain("url(#syn-glass-");
      const player = page.getByRole("group", { name: "Playback" });
      const bar = (await player.boundingBox())!;
      const seg = (await page.getByRole("group", { name: "Map view" }).boundingBox())!;
      await page.screenshot({ path: join(OUT, `glass_${scheme}_${tier}_controls.png`), clip: { x: Math.min(seg.x, bar.x) - 24, y: seg.y - 24, width: Math.max(seg.width, bar.width) + 48, height: bar.y + bar.height - seg.y + 48 } });
      await page.screenshot({ path: join(OUT, `glass_${scheme}_${tier}_player.png`), clip: { x: bar.x - 16, y: bar.y - 16, width: bar.width + 32, height: bar.height + 32 } });
      await tctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    // hover and press on the primary and a secondary glass button (refract tier)
    await boot(page, scheme);
    const add = page.getByRole("button", { name: "Add Song", exact: true });
    const sample = page.getByRole("button", { name: "Try a sample" });
    const box = (await add.boundingBox())!;
    const clip = { x: box.x - 40, y: box.y - 24, width: Math.max(box.width, 260) + 80, height: box.height + 90 };
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `states_${scheme}_1_rest.png`), clip });
    await add.hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `states_${scheme}_2_hover.png`), clip });
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `states_${scheme}_3_pressed.png`), clip });
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await sample.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `states_${scheme}_4_focus.png`), clip });
    await ctx.close();
  }
  // font comparison on the library + signature (light): this machine's Helvetica, TeX Gyre Heros, Inter
  for (const font of ["stack", "heros", "inter"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    const page = await ctx.newPage();
    await boot(page, "light", font === "stack" ? "" : `?font=${font}`);
    await page.getByRole("button", { name: "Try a sample" }).click();
    await expect(page.getByTestId("stage")).toBeVisible();
    await page.waitForTimeout(800);
    const used = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    console.log(`font ${font}: ${used}`);
    await page.screenshot({ path: join(OUT, `font_${font}.png`) });
    await ctx.close();
  }
});
