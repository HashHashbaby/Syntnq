// M9 (D-066): similar songs, the compare view and ratings in the app. With the three bundled samples in
// the library: the pane lists the others nearest first; the compare view shows both signatures, the
// label, the corpus rank and the differences (and the same result as the engine); a rating persists across
// reloads and exports as CSV from Settings. Screenshots at 1440 and 390. Output: out/ui_review/m9/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m9");
mkdirSync(OUT, { recursive: true });
type App = { getState: () => { lib: unknown; samples: unknown[]; addSample: (s: string) => Promise<void> } };

async function loadSamples(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.goto("/");
  await page.waitForFunction(() => {
    const a = (window as unknown as { __synApp?: App }).__synApp;
    return !!a && !!a.getState().lib && a.getState().samples.length > 0;
  });
  for (const s of ["rock", "electronic", "ambient"]) await page.evaluate((x) => (window as unknown as { __synApp: App }).__synApp.getState().addSample(x), s);
  await expect(page.getByTestId("stage")).toBeVisible();
  await page.waitForTimeout(1200);
}

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`similar, compare, rating at ${w} px`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 735, hasTouch: w < 735, acceptDownloads: true });
    const page = await ctx.newPage();
    await loadSamples(page);
    const pane = page.getByRole("region", { name: "This song" });
    await pane.scrollIntoViewIfNeeded();
    const rows = pane.locator(".similar-row");
    await expect(rows).toHaveCount(2);
    const listed = await rows.locator(".similar-text .t-sub").allTextContents();
    await page.getByRole("radio", { name: "6 of 7" }).click();
    await expect(page.getByRole("radio", { name: "6 of 7" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: join(OUT, `${w}x${h}_1_pane.png`) });

    // compare with the nearest song from the pane
    await rows.first().click();
    const sheet = page.getByRole("dialog", { name: "Compare" });
    await expect(sheet.locator(".compare-label")).toBeVisible();
    const label = (await sheet.locator(".compare-label").textContent())!.trim();
    const diffs = await sheet.locator(".compare-diffs li").allTextContents();
    await expect(sheet.locator(".compare-canvas canvas")).toHaveCount(2);
    await page.waitForTimeout(800); // the sheet has finished sliding up
    const labelBox = (await sheet.locator(".compare-label").boundingBox())!;
    await page.screenshot({ path: join(OUT, `${w}x${h}_2_compare.png`) });
    const r = { listed, label, diffs, label_visible_without_scrolling: labelBox.y + labelBox.height <= h };
    writeFileSync(join(OUT, `m9_${w}.json`), JSON.stringify(r, null, 2));
    console.log(w, JSON.stringify(r));
    expect(["Very similar", "Somewhat similar", "Different"]).toContain(label);
    expect(r.label_visible_without_scrolling).toBe(true);

    // the rating survives a reload and exports as CSV
    await page.keyboard.press("Escape");
    await page.reload();
    await page.getByRole("option", { name: /Ambiental/ }).click(); // the app reopens at the library
    await expect(page.getByTestId("stage")).toBeVisible();
    await expect(page.getByRole("radio", { name: "6 of 7" })).toHaveAttribute("aria-checked", "true", { timeout: 10000 });
    if (w >= 1000) {
      await page.getByRole("button", { name: "Settings" }).click();
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export ratings (CSV)" }).click()]);
      const csv = readFileSync((await dl.path())!, "utf-8").trim().split("\n");
      writeFileSync(join(OUT, "ratings_export.csv"), csv.join("\n") + "\n");
      expect(csv[0]).toBe("song_id,title,artist,listener_id,rating,rated_at");
      expect(csv).toHaveLength(2);
      expect(csv[1]).toMatch(/,6,\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    }
    await ctx.close();
  });
}

test("the pane ranks songs by the same distance as the compare engine (nearest first)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadSamples(page);
  const order = await page.evaluate(async () => {
    // the app's own modules, served by the dev server
    const paths = ["/src/engine/compare.ts", "/src/params.ts"];
    const { distance } = (await import(/* @vite-ignore */ paths[0])) as { distance: (a: ArrayLike<number>, b: ArrayLike<number>, p: unknown) => number };
    const { params } = (await import(/* @vite-ignore */ paths[1])) as { params: unknown };
    const app = (window as unknown as { __synApp: { getState: () => { lib: { fingerprints: () => Promise<Array<{ songId: string; fingerprint: Float32Array }>>; get: (id: string) => Promise<{ title: string | null }> }; open: { record: { songId: string; fingerprint: Float32Array } } } } }).__synApp.getState();
    const me = app.open.record;
    const all = (await app.lib.fingerprints()).filter((f) => f.songId !== me.songId);
    const ranked = all.map((f) => ({ id: f.songId, d: distance(me.fingerprint, f.fingerprint, params) })).sort((a, b) => a.d - b.d);
    return Promise.all(ranked.map(async (r) => (await app.lib.get(r.id)).title));
  });
  const listed = await page.getByRole("region", { name: "This song" }).locator(".similar-row .similar-text .t-sub").allTextContents();
  expect(listed).toEqual(order);
});
