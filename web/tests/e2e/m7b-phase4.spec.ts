// M7b phase 4 evidence (rotating disc, D-060): the disc in the player bar at three sizes, at rest and
// playing, a close-up, reduced motion, the rate measured from the drawn frames against audio time,
// spin-up and coast, seek behaviour, and a recording of play / pause / seek.
// Output: out/ui_review/m7b/phase4/ (git-ignored).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase4");
mkdirSync(join(OUT, "video"), { recursive: true });
const SIZES = [
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "820x1180", width: 820, height: 1180, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
] as const;

async function openSample(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("disc")).toHaveAttribute("data-ready", "true", { timeout: 15000 });
}

type Log = Array<[number, number, number]>;
const unwrap = (d: number): number => (d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
function turned(log: Log): number {
  let t = 0;
  for (let i = 1; i < log.length; i++) t += unwrap(log[i][2] - log[i - 1][2]);
  return t;
}
const discLog = (page: Page): Promise<Log> => page.evaluate(() => window.__synesthesiaDisc!.log.slice());

for (const size of SIZES) {
  test(`disc ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.width < 735 });
    const page = await ctx.newPage();
    await openSample(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${size.name}_1_rest.png`) });
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, `${size.name}_2_playing.png`) });
    const player = page.getByRole("group", { name: "Playback" });
    await player.screenshot({ path: join(OUT, `${size.name}_3_player.png`) });
    await ctx.close();
  });
}

test("rate, spin-up, coast and seek, measured from the drawn frames (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await openSample(page);
  await page.waitForTimeout(500);
  await page.getByTestId("disc").screenshot({ path: join(OUT, "1440x900_4_closeup_rest.png") });
  const omega = await page.evaluate(() => window.__synesthesiaDisc!.omega);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(600);
  const spinup = await discLog(page);
  await page.waitForTimeout(3000);
  const all = await discLog(page);
  await page.getByTestId("disc").screenshot({ path: join(OUT, "1440x900_5_closeup_playing.png") });
  // steady: the last 2 s of drawn frames against audio time
  const t1 = all[all.length - 1][0];
  const steady = all.filter((r) => r[0] >= t1 - 2);
  const rate = turned(steady) / (steady[steady.length - 1][1] - steady[0][1]);
  const rpm = (rate * 60) / (2 * Math.PI);
  // spin-up: turn over the first 0.6 s vs what full speed would have turned
  const su = spinup.filter((r) => r[1] > 0);
  const spinupShare = su.length > 1 ? turned(su) / (omega * (su[su.length - 1][1] - su[0][1])) : NaN;
  // coast after pause
  await page.getByRole("button", { name: "Pause" }).click();
  const before = (await discLog(page)).length;
  await page.waitForTimeout(2500);
  const coastLog = (await discLog(page)).slice(before - 1);
  const coast = turned(coastLog);
  const coastMs = (coastLog[coastLog.length - 1][0] - coastLog[0][0]) * 1000;
  // seek while paused: +0.5 s turns the disc by omega x 0.5 (wrapped), then rests
  const a0 = await page.evaluate(() => window.__synesthesiaDisc!.drawn());
  const s0 = await page.evaluate(() => window.__synesthesiaDisc!.log.at(-1)![1]);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1200);
  const a1 = await page.evaluate(() => window.__synesthesiaDisc!.drawn());
  const s1 = await page.evaluate(() => window.__synesthesiaDisc!.log.at(-1)![1]);
  const tau = 2 * Math.PI;
  const seekTurn = (((a1 - a0) % tau) + tau) % tau; // forward seek: a forward turn under one revolution
  const seekExpect = (omega * (s1 - s0)) % tau;
  const result = { rpm, rate_rad_per_audio_s: rate, frames: steady.length, spinup_share_first_0_6s: spinupShare, coast_rad: coast, coast_ms: coastMs, seek_s: s1 - s0, seek_turn_rad: seekTurn, seek_expected_rad: seekExpect };
  console.log(JSON.stringify(result, null, 2));
  writeFileSync(join(OUT, "disc.json"), JSON.stringify(result, null, 2));
  expect(Math.abs(rpm - 33.333)).toBeLessThan(0.05);
  expect(spinupShare).toBeLessThan(0.95); // spins up (part of it hides behind the output latency)
  expect(coast).toBeGreaterThan(0.1);
  expect(Math.abs(seekTurn - seekExpect)).toBeLessThan(0.01);
  await ctx.close();
});

test("reduced motion: no spin while playing (1440)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await openSample(page);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(1500);
  const a = await page.evaluate(() => window.__synesthesiaDisc!.drawn());
  await page.waitForTimeout(1500);
  const b = await page.evaluate(() => window.__synesthesiaDisc!.drawn());
  await page.getByRole("group", { name: "Playback" }).screenshot({ path: join(OUT, "1440x900_6_reduced_motion_playing.png") });
  expect(b).toBe(a);
  await ctx.close();
});

test("recording: play, pause (coast), seek, scrub back, play (1440)", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await openSample(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(1800);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(900);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(900);
  const scrub = (await page.getByRole("slider", { name: "Seek" }).boundingBox())!;
  await page.mouse.move(scrub.x + scrub.width * 0.5, scrub.y + scrub.height / 2);
  await page.mouse.down();
  await page.mouse.move(scrub.x + scrub.width * 0.2, scrub.y + scrub.height / 2, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(2500);
  await ctx.close();
});
