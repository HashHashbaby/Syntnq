// M7b phase 3 evidence (3D chips, D-056): the chips at rest and playing at three sizes, a pointer-
// parallax still, True colour, reduced motion, close-ups and a recording.
// Output: out/ui_review/m7b/phase3/ (git-ignored).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase3");
mkdirSync(join(OUT, "video"), { recursive: true });
const SIZES = [
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "820x1180", width: 820, height: 1180, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
] as const;

async function openSample(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((e) => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true, ...e })), extra);
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("stage")).toBeVisible();
}

for (const size of SIZES) {
  test(`chips ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.width < 735 });
    const page = await ctx.newPage();
    await openSample(page);
    await page.waitForFunction(() => window.__synesthesia?.stats.kind === "three", null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `${size.name}_1_rest.png`) });
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: join(OUT, `${size.name}_2_playing.png`) });
    await ctx.close();
  });
}

test("parallax, close-ups, true colour, reduced motion (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openSample(page);
  await page.waitForFunction(() => window.__synesthesia?.stats.kind === "three", null, { timeout: 15000 });
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(3500);
  const st = (await page.getByTestId("stage").boundingBox())!;
  await page.mouse.move(st.x + st.width * 0.95, st.y + st.height * 0.05, { steps: 12 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, "1440x900_3_parallax.png") });
  await page.screenshot({ path: join(OUT, "1440x900_4_closeup_playing.png"), clip: { x: st.x + st.width * 0.55, y: st.y + st.height * 0.05, width: 300, height: 220 } });
  await page.getByRole("button", { name: "Pause" }).click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, "1440x900_5_closeup_rest.png"), clip: { x: st.x + st.width * 0.55, y: st.y + st.height * 0.05, width: 300, height: 220 } });
  await page.getByRole("button", { name: "True colour" }).click();
  await page.waitForFunction(() => window.__synesthesia?.stats.kind === "webgl2", null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, "1440x900_6_true_colour.png") });
  await ctx.close();
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const p2 = await c2.newPage();
  await openSample(p2);
  await p2.waitForFunction(() => window.__synesthesia?.stats.kind === "three", null, { timeout: 15000 });
  await p2.getByRole("button", { name: "Play" }).click();
  await p2.waitForTimeout(3000);
  await p2.screenshot({ path: join(OUT, "1440x900_7_reduced_motion_playing.png") });
  await c2.close();
});

test("recording: chips playing with parallax, then true colour (1440)", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await openSample(page);
  await page.waitForFunction(() => window.__synesthesia?.stats.kind === "three", null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Play" }).click();
  const st = (await page.getByTestId("stage").boundingBox())!;
  await page.waitForTimeout(2000);
  for (const [fx, fy] of [[0.9, 0.1], [0.1, 0.2], [0.2, 0.9], [0.85, 0.85], [0.5, 0.5]]) {
    await page.mouse.move(st.x + st.width * fx, st.y + st.height * fy, { steps: 30 });
    await page.waitForTimeout(500);
  }
  await page.mouse.move(5, 450, { steps: 20 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "True colour" }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "True colour" }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(1000);
  await ctx.close();
});
