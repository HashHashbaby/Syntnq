// Motion behaviour (docs/UI.md section 8, D-044): press feedback, keyboard-instant changes,
// velocity-aware sheets, dip-through-dark landing steps, the landing-to-signature handoff, the
// phone map carousel and the reduced-motion fallbacks.
import { expect, test, type Page } from "@playwright/test";

async function openSample(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.reload();
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("stage")).toBeVisible();
}

const scale = async (page: Page, name: string): Promise<number> =>
  page.getByRole("button", { name }).evaluate((el) => {
    const m = getComputedStyle(el).transform.match(/matrix\(([^,]+),/);
    return m ? parseFloat(m[1]) : 1;
  });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("press feedback scales on pointer-down and releases on pointer-up", async ({ page }) => {
    await openSample(page);
    const btn = page.getByRole("button", { name: "Export" });
    const box = (await btn.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    expect(await scale(page, "Export")).toBeCloseTo(0.97, 2);
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
    await page.waitForTimeout(250);
    expect(await scale(page, "Close")).toBeCloseTo(1, 2);
    await page.keyboard.press("Escape");
  });

  test("keyboard-initiated sheet opens are instant; pointer-initiated ones animate", async ({ page }) => {
    await openSample(page);
    await page.keyboard.press("Control+e");
    const dlg = page.getByRole("dialog", { name: "Export" });
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);

    await page.getByRole("button", { name: "Export" }).click();
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((el) => getComputedStyle(el).animationName)).toBe("sheet-in");
    expect(await dlg.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) * 1000)).toBe(400);
    await page.keyboard.press("Escape");
  });

  test("a flick dismisses the sheet; a slow short pull springs back", async ({ page }) => {
    await openSample(page);
    const dlg = page.getByRole("dialog", { name: "Export" });

    await page.getByRole("button", { name: "Export" }).click();
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(600);
    const rest = (await dlg.boundingBox())!;
    const grab = (await page.getByTestId("sheet-grabber").boundingBox())!;
    const gx = grab.x + grab.width / 2;
    const gy = grab.y + grab.height / 2;

    // slow, short: 24 px over about 600 ms (0.04 px/ms) is below both thresholds
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(gx, gy + i * 4);
      await page.waitForTimeout(100);
    }
    const mid = (await dlg.boundingBox())!;
    expect(mid.y).toBeGreaterThan(rest.y + 10); // it followed the pointer
    await page.mouse.up();
    await page.waitForTimeout(900);
    await expect(dlg).toBeVisible();
    const back = (await dlg.boundingBox())!;
    expect(Math.abs(back.y - rest.y)).toBeLessThan(1.5);

    // flick: 50 px in a few milliseconds is far above 0.11 px/ms although it is under 30 % of the height
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx, gy + 25, { steps: 2 });
    await page.mouse.move(gx, gy + 50, { steps: 2 });
    await page.mouse.up();
    await expect(dlg).toHaveCount(0, { timeout: 2000 });
  });

  test("landing steps dip through dark: the old line leaves before the new one arrives", async ({ page }) => {
    await page.goto("/");
    const landing = page.getByRole("dialog", { name: "Welcome" });
    await expect(landing).toBeVisible();
    await landing.evaluate((el) => el.scrollTo(0, (el.scrollHeight - el.clientHeight) * 0.5));
    await page.waitForTimeout(1200);
    const t = await page.evaluate(() => {
      const steps = Array.from(document.querySelectorAll<HTMLElement>(".landing-step"));
      const read = (el: HTMLElement) => {
        const cs = getComputedStyle(el);
        return { active: el.dataset.active, delay: cs.transitionDelay.split(",")[0].trim(), duration: cs.transitionDuration.split(",")[0].trim(), opacity: cs.opacity };
      };
      return steps.map(read);
    });
    const active = t.find((s) => s.active === "true")!;
    const inactive = t.find((s) => s.active !== "true")!;
    expect(active.opacity).toBe("1");
    expect(active.delay).toBe("0.35s"); // out (250 ms) + rest (100 ms)
    expect(active.duration).toBe("0.35s");
    expect(inactive.opacity).toBe("0");
    expect(inactive.duration).toBe("0.25s");
    expect(inactive.delay).toBe("0s");
  });

  test("Try a sample on the landing hands the live stage over to the signature card", async ({ page }) => {
    await page.goto("/");
    const landing = page.getByRole("dialog", { name: "Welcome" });
    await expect(landing).toBeVisible();
    await expect(page.getByTestId("landing-stage")).toBeVisible({ timeout: 20_000 });
    await landing.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(500);
    // the key and the actions are reachable on screen at the end of the scroll (not only in the DOM)
    await expect(landing.getByLabel("How to read the colours")).toBeInViewport();
    await expect(landing.getByRole("button", { name: "Add a song" })).toBeInViewport();
    await page.evaluate(() => {
      const w = window as unknown as { __rects: DOMRect[]; __times: number[] };
      w.__rects = [];
      w.__times = [];
      const tick = (now: number): void => {
        const el = document.querySelector('[data-testid="landing-stage"]');
        if (el) {
          w.__rects.push(el.getBoundingClientRect());
          w.__times.push(now);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await landing.getByRole("button", { name: "Try a sample" }).click();
    // the chrome has faded out well before the stage lands (no key or buttons over the app)
    await page.waitForTimeout(350);
    expect(await landing.locator(".landing-after").evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBe(0);
    await expect(landing).toHaveCount(0, { timeout: 8000 });
    const stage = (await page.getByTestId("stage").boundingBox())!;
    const rects = await page.evaluate(() => (window as unknown as { __rects: DOMRect[] }).__rects);
    const last = rects[rects.length - 1];
    expect(rects.length).toBeGreaterThan(5);
    // the travelling stage ends on the signature card (within 3 px) and moved there in more than one frame
    expect(Math.abs(last.x - stage.x)).toBeLessThan(3);
    expect(Math.abs(last.y - stage.y)).toBeLessThan(3);
    expect(Math.abs(last.width - stage.width)).toBeLessThan(3);
    const moving = rects.filter((r, i) => i > 0 && Math.abs(r.x - rects[i - 1].x) > 0.5).length;
    expect(moving).toBeGreaterThan(3);
    // The only unavoidable main-thread work is creating the signature card's GL context (about 100 ms);
    // the travel itself is a compositor transform. Budget: no frame gap above 160 ms.
    const times = await page.evaluate(() => (window as unknown as { __times: number[] }).__times);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const worst = Math.max(...gaps);
    test.info().annotations.push({ type: 'longest frame gap', description: `${worst.toFixed(0)} ms over ${times.length} frames` });
    expect(worst, `longest frame gap ${worst.toFixed(1)} ms`).toBeLessThan(160);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("synesthesia.settings") ?? "{}").landingDone)).toBe(true);
  });

  test("Skip fades the landing out", async ({ page }) => {
    await page.goto("/");
    const landing = page.getByRole("dialog", { name: "Welcome" });
    await expect(landing).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();
    await page.waitForTimeout(100);
    const op = await landing.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(op).toBeLessThan(1);
    await expect(landing).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the next map peeks at the edge, shortcuts jump instantly, a swipe selects the map", async ({ page }) => {
    await openSample(page);
    const cards = page.locator(".carousel-card");
    await expect(cards).toHaveCount(5);
    await page.waitForTimeout(500); // the pane slide-in (300 ms) has finished
    const second = (await cards.nth(1).boundingBox())!;
    expect(second.x).toBeGreaterThan(390 - 60);
    expect(second.x).toBeLessThan(390 - 16);
    await expect(page.locator(".dots > span[data-active='true']")).toHaveCount(1);

    await page.keyboard.press("3");
    await expect(page.getByRole("button", { name: /^Structure/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Math.round((await cards.nth(2).boundingBox())!.x)).toBeLessThan(20);

    await page.locator(".carousel").evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
    await expect(page.getByRole("button", { name: /^Sound/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("stage")).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("no travelling stage and no slide: fades only", async ({ page }) => {
    await page.goto("/");
    const landing = page.getByRole("dialog", { name: "Welcome" });
    await expect(landing).toBeVisible();
    await expect(landing).toHaveAttribute("data-static", "true");
    await landing.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await landing.getByRole("button", { name: "Try a sample" }).click();
    await expect(landing).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByTestId("stage")).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    const dlg = page.getByRole("dialog", { name: "Export" });
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dlg).toHaveCount(0);
  });
});
