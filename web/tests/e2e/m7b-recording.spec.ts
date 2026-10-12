// Short screen recordings for the M7b phase evidence (docs/MILESTONES.md M7b): the interactions a
// phase changed, recorded at 1440 x 900 and 390 x 844. Videos go to out/ui_review/m7b/<phase>/video/
// as .webm under out/ui_review/m7b/ (converted to .mp4 for review with ffmpeg).
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase1", "video");

async function glide(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: 18 });
}

for (const size of [
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "390x844", width: 390, height: 844, touch: true },
] as const) {
  test(`phase 1 interactions ${size.name}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      recordVideo: { dir: OUT, size: { width: size.width, height: size.height } },
      colorScheme: "light",
    });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true, appearance: "light" })));
    await page.reload();
    await page.waitForTimeout(800);
    const add = page.getByRole("button", { name: "Add Song", exact: true });
    const b = (await add.boundingBox())!;
    if (!size.touch) {
      await glide(page, b.x + b.width / 2, b.y + b.height / 2); // hover
      await page.waitForTimeout(600);
      await page.mouse.down(); // press
      await page.waitForTimeout(350);
      await glide(page, b.x + b.width / 2 + 160, b.y + 60); // drag away and release: no click
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    await page.getByRole("button", { name: "Try a sample" }).click();
    await expect(page.getByTestId("stage")).toBeVisible();
    await page.waitForTimeout(1200);
    for (const name of ["Structure (3)", "Rhythm (4)", "Sound (1)"]) {
      await page.getByRole("button", { name }).click();
      await page.waitForTimeout(700);
    }
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(600);
    if (!size.touch) {
      await page.getByRole("button", { name: "Settings" }).click();
      await page.waitForTimeout(900);
      await page.getByLabel("Appearance").selectOption("dark");
      await page.waitForTimeout(1200);
      await page.getByLabel("Appearance").selectOption("light");
      await page.waitForTimeout(1200);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
    }
    await ctx.close();
  });
}
