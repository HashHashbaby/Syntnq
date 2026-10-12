// Frame rate while playing and clock drift (docs/MILESTONES.md M7 task 7).
// FPS_SECONDS and DRIFT_SECONDS select the run length (defaults are short for CI; the gate
// evidence uses DRIFT_SECONDS=300).
import { expect, test } from "@playwright/test";

const FPS_SECONDS = Number(process.env.FPS_SECONDS ?? 8);
const DRIFT_SECONDS = Number(process.env.DRIFT_SECONDS ?? 20);
const ANALYSIS_FPS = 43.066;

test.use({ viewport: { width: 1440, height: 900 } });

test("frame rate while playing the liquid grid", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.reload();
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeEnabled();
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(1000);
  const res = await page.evaluate(async (seconds: number) => {
    const times: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number): void => {
        times.push(now);
        if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const dts = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    const glc = document.createElement("canvas").getContext("webgl2");
    const dbg = glc?.getExtension("WEBGL_debug_renderer_info");
    const s = window.__synesthesia?.stats;
    return {
      fps: (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000),
      p50: dts[Math.floor(dts.length * 0.5)],
      p95: dts[Math.floor(dts.length * 0.95)],
      renderer: dbg && glc ? (glc.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : "unknown",
      kind: s?.kind,
      cpuMs: s?.lastMs,
    };
  }, FPS_SECONDS);
  console.log(`fps ${res.fps.toFixed(1)}  p50 ${res.p50.toFixed(1)} ms  p95 ${res.p95.toFixed(1)} ms  cpu/frame ${res.cpuMs?.toFixed(2)} ms  ${res.kind}  ${res.renderer}`);
  expect(["three", "webgl2"]).toContain(res.kind); // 3D chips by default (D-056), 2D with True colour
  expect(res.fps).toBeGreaterThan(24); // sanity floor for software GL; real devices are reported, not asserted
});

test("visual clock stays within one analysis frame of the audible output", async ({ page }) => {
  test.setTimeout((DRIFT_SECONDS + 40) * 1000);
  await page.goto("/");
  const r = await page.evaluate(async (seconds: number) => {
    const ctx = new AudioContext();
    await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    await new Promise((res) => setTimeout(res, 2000)); // let the output device start
    const latency = ctx.outputLatency > 0 ? ctx.outputLatency : ctx.baseLatency || 0;
    const c0 = ctx.currentTime;
    const w0 = performance.now();
    // what the visuals use is ctx.currentTime - latency; what is audible is the output timestamp
    let worst = 0;
    const samples: number[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((res) => setTimeout(res, 250));
      const ts = ctx.getOutputTimestamp();
      const visual = ctx.currentTime - latency;
      const heard = ts.contextTime ?? visual;
      const e = Math.abs(visual - heard);
      samples.push(e);
      worst = Math.max(worst, e);
    }
    const c1 = ctx.currentTime;
    const w1 = performance.now();
    osc.stop();
    await ctx.close();
    return { audio: c1 - c0, wall: (w1 - w0) / 1000, worst, latency, n: samples.length };
  }, DRIFT_SECONDS);
  const worstFrames = r.worst * ANALYSIS_FPS;
  const ppm = ((r.audio - r.wall) / r.wall) * 1e6;
  console.log(
    `over ${DRIFT_SECONDS} s (${r.n} samples): worst |visual - audible| ${(r.worst * 1000).toFixed(1)} ms = ${worstFrames.toFixed(2)} analysis frames; ` +
      `output latency ${(r.latency * 1000).toFixed(1)} ms; audio vs wall clock ${ppm.toFixed(0)} ppm`,
  );
  expect(worstFrames).toBeLessThanOrEqual(1);
});
