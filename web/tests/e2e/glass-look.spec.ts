// Close-up of glass controls over the live grid, one image per tier (D-051 evidence).
import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase1");
mkdirSync(OUT, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

for (const scheme of ["light", "dark"] as const) {
  for (const tier of ["refract", "frost", "solid"] as const) {
    test(`glass over the live grid: ${scheme} ${tier}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/?dev=glass&n=6${tier === "refract" ? "" : `&glass=${tier}`}`);
      await page.evaluate((s) => document.documentElement.setAttribute("data-theme", s), scheme);
      await page.waitForFunction(() => !!document.querySelector(".stage-card canvas"));
      await page.waitForTimeout(1500);
      const card = (await page.locator(".stage-card").boundingBox())!;
      await page.screenshot({ path: join(OUT, `over_grid_${scheme}_${tier}.png`), clip: { x: card.x, y: card.y, width: Math.min(card.width, 760), height: 150 } });
    });
  }
}
