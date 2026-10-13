// M7b phase 6 evidence (polish, D-064): every map with axes in real units, reading pointers and a live now
// layer from the screen's clock; screenshots at three sizes while playing; the now layers follow playback,
// hold on pause and follow seeks; worst cases at 320 px and 200 % text. Output: out/ui_review/m7b/phase6/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase6");
mkdirSync(join(OUT, "video"), { recursive: true });
const save = (key: string, value: unknown): void => writeFileSync(join(OUT, `phase6_${key}.json`), JSON.stringify(value, null, 2));
const MAPS = ["features", "structure", "rhythm", "dynamics"] as const;

async function openPlaying(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("stage")).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(2000);
}

/** Sum of alpha over the on-screen now layers (0 when nothing is drawn). */
const nowInk = (page: Page): Promise<number> =>
  page.evaluate(() => {
    let sum = 0;
    document.querySelectorAll<HTMLCanvasElement>("[data-testid=map-card] .mapfig-now").forEach((c) => {
      if (!c.width || !c.height) return;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) sum += d[i];
    });
    return sum;
  });

const nowHash = (page: Page): Promise<string> =>
  page.evaluate(() => {
    let h = 0;
    document.querySelectorAll<HTMLCanvasElement>("[data-testid=map-card] .mapfig-now").forEach((c) => {
      if (!c.width) return;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 16) h = (h * 31 + d[i]) | 0;
    });
    return String(h);
  });

for (const size of [{ name: "390x844", width: 390, height: 844 }, { name: "820x1180", width: 820, height: 1180 }, { name: "1440x900", width: 1440, height: 900 }]) {
  test(`maps while playing ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.width < 735, hasTouch: size.width < 1000 });
    const page = await ctx.newPage();
    await openPlaying(page);
    await page.screenshot({ path: join(OUT, `${size.name}_0_sound.png`) });
    for (const [i, v] of MAPS.entries()) {
      await page.keyboard.press(String(i + 2));
      await page.waitForTimeout(1200);
      const card = page.getByTestId("map-card");
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, `${size.name}_${i + 1}_${v}.png`) });
    }
    await ctx.close();
  });
}

test("now layers follow playback, hold on pause, follow seeks; rhythm reads the tempo (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openPlaying(page);
  const rows: Record<string, unknown> = {};
  let readout: string | null = null;
  for (const [i, v] of MAPS.entries()) {
    await page.keyboard.press(String(i + 2));
    await page.waitForTimeout(700);
    const ink = await nowInk(page);
    const a = await nowHash(page);
    await page.waitForTimeout(600);
    const b = await nowHash(page);
    rows[v] = { ink, moves_while_playing: a !== b };
    if (v === "rhythm") readout = await page.getByTestId("map-card").getByText(/^Now: /).textContent();
    expect(ink, `${v}: the now layer draws`).toBeGreaterThan(0);
    expect(a !== b, `${v}: the now layer moves while playing`).toBe(true);
  }
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(400);
  const p0 = await nowHash(page);
  await page.waitForTimeout(800);
  const p1 = await nowHash(page);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const p2 = await nowHash(page);
  const r = { maps: rows, rhythm_readout: readout, holds_on_pause: p0 === p1, follows_seek: p2 !== p1 };
  save("now", r);
  console.log("now", JSON.stringify(r));
  expect(readout).toMatch(/Now: (about \d+ BPM|no clear pulse)/);
  expect(r.holds_on_pause).toBe(true);
  expect(r.follows_seek).toBe(true);
  await ctx.close();
});

for (const { w, h } of [{ w: 320, h: 640 }, { w: 1440, h: 900 }]) {
  test(`worst case: maps at ${w} px, 200 % text`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 735, hasTouch: w < 735 });
    const page = await ctx.newPage();
    await openPlaying(page);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const problems: string[] = [];
    for (const [i, v] of MAPS.entries()) {
      await page.keyboard.press(String(i + 2));
      await page.waitForTimeout(700);
      const card = page.getByTestId("map-card");
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: join(OUT, `break_${w}_200pct_${v}.png`) });
      problems.push(
        ...(await page.evaluate((v) => {
          const out: string[] = [];
          if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`${v}: horizontal page scroll`);
          const card = document.querySelector<HTMLElement>("[data-testid=map-card]")!.getBoundingClientRect();
          document.querySelectorAll<HTMLElement>("[data-testid=map-card] .mapfig-xticks span, [data-testid=map-card] .mapfig-yticks span, [data-testid=map-card] .map-ramp-ends span").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.left < card.left - 0.5 || r.right > card.right + 0.5) out.push(`${v}: label outside the card "${el.textContent}"`);
          });
          document.querySelectorAll<HTMLElement>("[data-testid=map-card] .mapfig-plot").forEach((el) => {
            if (el.getBoundingClientRect().width < 120) out.push(`${v}: plot only ${el.getBoundingClientRect().width.toFixed(0)} px`);
          });
          return out;
        }, v)),
      );
    }
    save(`break_${w}_200pct`, problems);
    console.log(`${w}px 200%: ${problems.length ? problems.join("; ") : "ok"}`);
    expect(problems).toEqual([]);
    await ctx.close();
  });
}

test("recording: each map following the song (1440)", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await openPlaying(page);
  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press(String(i));
    await page.waitForTimeout(3500);
  }
  await ctx.close();
});

test("pointers float: closed by default, open on hover, focus and tap, close on Escape; the player stays in view", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openPlaying(page);
  const rows: Record<string, unknown> = {};
  for (const [i, v] of MAPS.entries()) {
    await page.keyboard.press(String(i + 2));
    await page.waitForTimeout(500);
    const player = (await page.getByRole("group", { name: "Playback" }).boundingBox())!;
    const chip = page.getByTestId("map-card").getByRole("button", { name: "How to read" }).first();
    const closed = await chip.getAttribute("aria-expanded");
    const card = (await page.getByTestId("map-card").locator(".mapfig-plot").first().boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.waitForTimeout(400);
    const hovered = await chip.getAttribute("aria-expanded");
    if (v === "structure") await page.screenshot({ path: join(OUT, "1440x900_pointers_open.png") });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const left = await chip.getAttribute("aria-expanded");
    rows[v] = { player_bottom: Math.round(player.y + player.height), closed, hovered, left };
    expect(player.y + player.height, `${v}: player in view`).toBeLessThanOrEqual(900);
    expect([closed, hovered, left]).toEqual(["false", "true", "false"]);
  }
  // keyboard: focus opens, Escape closes; tap (click) pins it open until tapped again
  const chip = page.getByTestId("map-card").getByRole("button", { name: "How to read" }).first();
  await chip.focus();
  const focused = await chip.getAttribute("aria-expanded");
  await page.keyboard.press("Escape");
  const escaped = await chip.getAttribute("aria-expanded");
  await chip.click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  const pinned = await chip.getAttribute("aria-expanded");
  await chip.click();
  const unpinned = await chip.getAttribute("aria-expanded");
  const r = { maps: rows, focused, escaped, pinned, unpinned };
  save("pointers", r);
  console.log("pointers", JSON.stringify(r));
  expect([focused, escaped, pinned, unpinned]).toEqual(["true", "false", "true", "false"]);
  await ctx.close();
});
