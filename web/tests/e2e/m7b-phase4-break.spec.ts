// Break-ui pass for the player bar with the rotating disc (D-060): realistic worst cases entered at the
// data boundary (the dev-only `?data=worst` library, the store's open song, a browser without WebGL),
// at 320 / 390 / 1440 px and 200 % text. Shots: out/ui_review/m7b/phase4/break/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase4", "break");
mkdirSync(OUT, { recursive: true });

type Store = { getState: () => { open: { audio: Blob | null; record: { songId: string; durationS: number }; stat: { colorSrgb: Uint8Array } } | null }; setState: (s: unknown) => void };

async function openSample(page: Page, url = "/"): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.goto(url);
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("stage")).toBeVisible();
}

/** The player bar's own invariants: disc round and full size, nothing clipped or overflowing. */
async function playerProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const bar = document.querySelector<HTMLElement>(".player");
    if (!bar) return ["no player bar"];
    const b = bar.getBoundingClientRect();
    if (b.right > window.innerWidth + 1) out.push(`bar overflows the viewport (${Math.round(b.right)} > ${window.innerWidth})`);
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push("horizontal page scroll");
    const disc = bar.querySelector<HTMLElement>(".disc");
    if (disc && !disc.hidden) {
      const r = disc.getBoundingClientRect();
      const want = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--disc-size"));
      if (Math.abs(r.width - r.height) > 0.5) out.push(`disc not round: ${r.width.toFixed(1)} x ${r.height.toFixed(1)}`);
      if (Math.abs(r.width - want) > 0.5) out.push(`disc squeezed: ${r.width.toFixed(1)} of ${want}`);
      if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) out.push("disc pokes out of the bar");
    }
    const btn = bar.querySelector<HTMLElement>("button");
    if (btn) {
      const r = btn.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) out.push(`play button below 44 px: ${r.width.toFixed(0)} x ${r.height.toFixed(0)}`);
    }
    const time = bar.querySelector<HTMLElement>(".tabular");
    if (time) {
      if (time.scrollWidth > time.clientWidth + 1) out.push(`time clipped: "${time.textContent}"`);
      if (time.getBoundingClientRect().right > b.right + 0.5) out.push(`time outside the bar: "${time.textContent}"`);
      if (/NaN|undefined/.test(time.textContent ?? "")) out.push(`time renders "${time.textContent}"`);
    }
    const scrub = bar.querySelector<HTMLElement>(".scrub");
    if (scrub && scrub.getBoundingClientRect().width < 48) out.push(`scrubber only ${scrub.getBoundingClientRect().width.toFixed(0)} px wide`);
    return out;
  });
}

const results: Record<string, string[]> = {};

for (const { w, h } of [{ w: 320, h: 640 }, { w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  for (const zoom of [100, 200]) {
    test(`worst-case song, ${w} px, ${zoom} % text`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1000, isMobile: w < 735 });
      const page = await ctx.newPage();
      await openSample(page);
      // worst realistic values at the store boundary: the longest track the pipeline accepts
      // (max_duration_s 720 -> "12:00"), no audio on this device, and a near-black signature; a new song id
      // so a fresh player (no audio, duration from the record) takes over
      await page.evaluate(() => {
        const app = (window as unknown as { __synApp: Store }).__synApp;
        const open = app.getState().open!;
        const dark = new Uint8Array(open.stat.colorSrgb.length);
        for (let i = 0; i < dark.length; i += 3) dark.set([10, 9, 14], i);
        app.setState({ open: { ...open, audio: null, record: { ...open.record, songId: "break-worst", durationS: 720 }, stat: { ...open.stat, colorSrgb: dark } } });
      });
      if (zoom === 200) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await expect(page.getByTestId("disc")).toHaveAttribute("data-ready", "true", { timeout: 15000 });
      await page.waitForTimeout(400);
      const bar = page.getByRole("group", { name: "Playback" });
      await bar.scrollIntoViewIfNeeded();
      await bar.screenshot({ path: join(OUT, `${w}_${zoom}pct_worst.png`) });
      const p = await playerProblems(page);
      results[`${w}px ${zoom}% worst`] = p;
      console.log(`${w}px ${zoom}% worst-case: ${p.length ? p.join("; ") : "ok"}`);
      await ctx.close();
    });
  }
}

test("no WebGL: the disc steps aside, the player still works (390 and 1440)", async ({ browser }) => {
  for (const { w, h } of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 735, hasTouch: w < 735 });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/.test(type)) return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    await openSample(page);
    await expect(page.getByTestId("disc")).toBeHidden({ timeout: 15000 });
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByRole("group", { name: "Playback" }).screenshot({ path: join(OUT, `${w}_no_webgl.png`) });
    const p = await playerProblems(page);
    console.log(`${w}px no WebGL: ${p.length ? p.join("; ") : "ok"}`);
    expect(p).toEqual([]);
    await ctx.close();
  }
});

test("long worst-case title from the dev library, 320 px", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await openSample(page); // worst-case rows borrow a real song's data, so add one first
  await page.goto("/?data=worst");
  await page.getByRole("option").first().click();
  await expect(page.getByTestId("disc")).toHaveAttribute("data-ready", "true", { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "320_long_title_full.png"), fullPage: true });
  const p = await playerProblems(page);
  console.log(`320px long title: ${p.length ? p.join("; ") : "ok"}`);
  expect(p).toEqual([]);
  await ctx.close();
});
