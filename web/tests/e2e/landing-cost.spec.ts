// Landing frame time (D-063), uncapped (vsync and the frame limit off): the hero while the reveal paints
// and a scroll through the disc beat, at 1440 x 900. Output: out/ui_review/m7b/phase5/phase5_frames.json.
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase5");
const save = (key: string, value: unknown): void => writeFileSync(join(OUT, `phase5_${key}.json`), JSON.stringify(value, null, 2));

async function openLanding(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("landing-stage")).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById("syn-mural") && !!window.__synLanding);
  await page.waitForFunction(() => window.__synLanding!.discAngle() !== null, null, { timeout: 15000 });
}

async function scrollTo(page: Page, p: number): Promise<void> {
  await page.getByRole("dialog", { name: "Welcome" }).evaluate((el, p) => {
    const tr = el.querySelector(".landing-track") as HTMLElement;
    el.scrollTo(0, (tr.offsetHeight - el.clientHeight) * p);
  }, p);
}

async function paint(page: Page): Promise<void> {
  const b = (await page.locator(".landing-layers").boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.3);
  for (let i = 0; i <= 24; i++) await page.mouse.move(b.x + b.width * (0.15 + (0.7 * i) / 24), b.y + b.height * (0.35 + 0.3 * Math.sin(i / 3)), { steps: 2 });
}

test.use({ launchOptions: { args: ["--ignore-gpu-blocklist", ...(process.platform === "win32" ? ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu"] : []), "--disable-gpu-vsync", "--disable-frame-rate-limit"] } });
test("hero with the reveal painting, and scrolling through the disc beat (1440, uncapped)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLanding(page);
  const measure = async (during: () => Promise<void>): Promise<{ frames: number; p50: number; p95: number; max: number }> => {
    await page.evaluate(() => {
      const w = window as unknown as { __ft: number[]; __ftOn: boolean };
      w.__ft = [];
      w.__ftOn = true;
      let last = performance.now();
      const tick = (now: number): void => {
        w.__ft.push(now - last);
        last = now;
        if (w.__ftOn) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await during();
    return page.evaluate(() => {
      const w = window as unknown as { __ft: number[]; __ftOn: boolean };
      w.__ftOn = false;
      const s = w.__ft.slice(5).sort((a, b) => a - b);
      const q = (k: number): number => s[Math.min(s.length - 1, Math.floor(s.length * k))];
      return { frames: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
    });
  };
  const hero = await measure(async () => {
    for (let k = 0; k < 3; k++) await paint(page);
  });
  const disc = await measure(async () => {
    for (let p = 0.2; p <= 0.46; p += 0.01) {
      await scrollTo(page, p);
      await page.waitForTimeout(60);
    }
  });
  const r = { hero_reveal: hero, disc_scroll: disc };
  save("frames", r);
  console.log("frames", JSON.stringify(r));
  expect(hero.p95).toBeLessThan(16.7);
  expect(disc.p95).toBeLessThan(16.7);
});
