// M7b phase 5 evidence (landing, D-063): the beats at three sizes, the cursor reveal (paint, decay, touch,
// keyboard), the disc scrubbed by scroll (no idle spin), the damped scroll, reduced motion, frame times,
// worst cases and a recording. Output: out/ui_review/m7b/phase5/ (git-ignored).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase5");
mkdirSync(join(OUT, "video"), { recursive: true });
const save = (key: string, value: unknown): void => writeFileSync(join(OUT, `phase5_${key}.json`), JSON.stringify(value, null, 2));
const BEATS = [["2_into_disc", 0.21], ["3_disc", 0.3], ["4_disc_turning", 0.4], ["5_live", 0.62], ["6_map", 0.86]] as const;

async function openLanding(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("landing-stage")).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById("syn-mural") && !!window.__synLanding);
  await page.waitForFunction(() => window.__synLanding!.discAngle() !== null, null, { timeout: 15000 }); // the disc chunk is in
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

for (const size of [{ name: "390x844", width: 390, height: 844 }, { name: "820x1180", width: 820, height: 1180 }, { name: "1440x900", width: 1440, height: 900 }]) {
  test(`beats ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.width < 735, hasTouch: size.width < 1000 });
    const page = await ctx.newPage();
    await openLanding(page);
    await page.screenshot({ path: join(OUT, `${size.name}_0_hero.png`) });
    if (size.width >= 1000) {
      await paint(page);
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(OUT, `${size.name}_1_reveal.png`) });
    }
    for (const [name, p] of BEATS) {
      await scrollTo(page, p);
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, `${size.name}_${name}.png`) });
    }
    await page.getByRole("dialog", { name: "Welcome" }).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `${size.name}_7_key.png`) });
    await ctx.close();
  });
}

test("reveal: paints, halves in 1.5 s, drives the live layer; keyboard and touch (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openLanding(page);
  const before = await page.evaluate(() => ({ c: window.__synLanding!.coverage(), live: window.__synLanding!.live() }));
  await paint(page);
  // the pointer stays put (moving it away would paint along the way); compare with the exact decay
  const m0 = await page.evaluate(() => ({ t: performance.now(), c: window.__synLanding!.coverage(), live: window.__synLanding!.live() }));
  await page.waitForTimeout(1500);
  const m1 = await page.evaluate(() => ({ t: performance.now(), c: window.__synLanding!.coverage() }));
  const c0 = m0.c, c1 = m1.c, live = m0.live;
  const expected = Math.pow(0.5, (m1.t - m0.t) / 1000 / 1.5);
  // keyboard: Tab to "See it live" and press it; the whole card goes live
  await page.getByRole("button", { name: "See it live" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const kb = await page.evaluate(() => ({ live: window.__synLanding!.live(), cover: getComputedStyle(document.querySelector(".landing-cover")!).opacity }));
  await page.screenshot({ path: join(OUT, "1440x900_8_see_it_live.png") });
  await page.getByRole("button", { name: "Show the still card" }).click();
  // touch: a sideways drag paints (synthetic touch pointer events with a pressed contact)
  await page.waitForTimeout(2500);
  const touch = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".landing")!;
    const r = document.querySelector<HTMLElement>(".landing-layers")!.getBoundingClientRect();
    const before = window.__synLanding!.coverage();
    for (let i = 0; i <= 10; i++) host.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", buttons: 1, clientX: r.left + r.width * (0.2 + 0.06 * i), clientY: r.top + r.height * 0.5 }));
    const painted = window.__synLanding!.coverage() - before;
    for (let i = 0; i <= 10; i++) host.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", buttons: 0, clientX: r.left + r.width * (0.2 + 0.06 * i), clientY: r.top + r.height * 0.8 }));
    return { painted, hoverPainted: window.__synLanding!.coverage() - before - painted };
  });
  const r = { before, coverage_after_stroke: c0, live_while_revealed: live, coverage_after_1_5s: c1, half_life_ratio: c1 / c0, expected_ratio: expected, keyboard: kb, touch };
  save("reveal", r);
  console.log("reveal", JSON.stringify(r));
  expect(before.live).toBe(false); // nothing revealed: the grid rests (no idle engine work)
  expect(c0).toBeGreaterThan(0.05);
  expect(live).toBe(true);
  expect(Math.abs(c1 / c0 - expected)).toBeLessThan(0.05);
  expect(kb.live).toBe(true);
  expect(kb.cover).toBe("0");
  expect(touch.painted).toBeGreaterThan(0.01);
  expect(touch.hoverPainted).toBeLessThanOrEqual(0.0001); // a touch without contact does not paint
  await ctx.close();
});

test("disc: angle follows scroll, never spins on its own; the swap is flat at angle 0 (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openLanding(page);
  const rows: Array<{ p: number; angle: number | null; tilt: number }> = [];
  for (const p of [0.26, 0.3, 0.35, 0.4, 0.44]) {
    await scrollTo(page, p);
    await page.waitForTimeout(800);
    rows.push(await page.evaluate(() => ({ p: window.__synLanding!.progress(), angle: window.__synLanding!.discAngle(), tilt: window.__synLanding!.beat().discTilt })));
  }
  await scrollTo(page, 0.35);
  await page.waitForTimeout(800);
  const a0 = await page.evaluate(() => window.__synLanding!.discAngle());
  await page.waitForTimeout(1500);
  const a1 = await page.evaluate(() => window.__synLanding!.discAngle());
  // damped follow: right after a scroll the visuals lag, then settle on the target
  await scrollTo(page, 0.6);
  const lag: number[] = [];
  for (let i = 0; i < 8; i++) {
    lag.push(await page.evaluate(() => window.__synLanding!.progress()));
    await page.waitForTimeout(40);
  }
  const r = { rows, idle_change_rad: (a1 ?? 0) - (a0 ?? 0), damped_progress_after_scroll: lag };
  save("disc", r);
  console.log("disc", JSON.stringify(r));
  expect(rows[0].angle!).toBeLessThan(0.01); // flat at the swap (exactly 0 at disc_full; scroll px rounding)
  expect(rows[0].tilt).toBeLessThan(0.01);
  for (let i = 1; i < rows.length; i++) expect(rows[i].angle!).toBeGreaterThan(rows[i - 1].angle!);
  expect(r.idle_change_rad).toBe(0);
  expect(lag[0]).toBeLessThan(0.6 - 0.01); // it glides ...
  expect(lag[lag.length - 1]).toBeCloseTo(0.6, 2); // ... and arrives
  await ctx.close();
});

test("reduced motion: steps stacked, no hero type, no disc, no reveal (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Welcome" })).toBeVisible();
  await page.waitForFunction(() => !document.getElementById("syn-mural"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "1440x900_9_reduced_motion.png"), fullPage: false });
  expect(await page.locator(".landing-hero").count()).toBe(0);
  expect(await page.locator(".landing-disc").count()).toBe(0);
  expect(await page.evaluate(() => window.__synLanding === undefined)).toBe(true);
  await ctx.close();
});

for (const { w, h } of [{ w: 320, h: 640 }, { w: 1440, h: 900 }]) {
  test(`worst case: ${w} px at 200 % text`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 735, hasTouch: w < 735 });
    const page = await ctx.newPage();
    await openLanding(page);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `break_${w}_200pct_hero.png`) });
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const land = document.querySelector<HTMLElement>(".landing")!;
      if (land.scrollWidth > land.clientWidth + 1) out.push(`horizontal scroll ${land.scrollWidth} > ${land.clientWidth}`);
      document.querySelectorAll<HTMLElement>(".landing-hero .t-hero").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`hero line runs off screen: "${el.textContent}"`);
      });
      const skip = document.querySelector<HTMLElement>(".landing-skip")!.getBoundingClientRect();
      const btn = document.querySelector<HTMLElement>(".landing-hint .btn")?.getBoundingClientRect();
      if (btn && (btn.bottom > window.innerHeight + 1 || btn.top < 0)) out.push("See it live is off screen");
      if (skip.right > window.innerWidth + 1) out.push("Skip off screen");
      return out;
    });
    save(`break_${w}_200pct`, problems);
    console.log(`${w}px 200%: ${problems.length ? problems.join("; ") : "ok"}`);
    await ctx.close();
  });
}

test("recording: hero reveal, scroll through the beats, key, Try a sample (1440)", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await openLanding(page);
  await page.waitForTimeout(500);
  await paint(page);
  await paint(page);
  await page.waitForTimeout(1200);
  for (let p = 0; p <= 1.0001; p += 0.01) {
    await scrollTo(page, p);
    await page.waitForTimeout(70);
  }
  await page.getByRole("dialog", { name: "Welcome" }).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(1500);
  await page.getByRole("dialog", { name: "Welcome" }).getByRole("button", { name: "Try a sample" }).click();
  await page.waitForTimeout(2500);
  await ctx.close();
});
