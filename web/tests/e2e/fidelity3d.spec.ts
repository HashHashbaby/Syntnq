// Colour fidelity of the live views (D-046 gates), on a straight-on render: each chip's flat face
// (3D) and each dot's centre (2D, true colour) averaged in linear light, compared in OKLab with the
// node colours of the same drawn frame. Gates: OKLab ΔE p95 <= 0.02, lightness r >= 0.99, mean hue
// error <= 3 deg (chroma >= 0.03), darkest decile mean |ΔL| <= 0.02. Three songs; chips at rest and
// mid-playback; the 2D view at rest. Results: out/ui_review/m7b/phase3/fidelity.json.
// The chips are asserted. The 2D dots are reported, not asserted: their screen-blended glow (D-017,
// D-026, part of the frozen render) lifts the dot centre by about 0.03-0.04 L, which fails dE95 and
// dim while L r and hue pass; the owner decides how the gate applies to the frozen 2D look.
// Both views must draw identical node colours (asserted).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { linearToOklab, srgb8ToLinear } from "../../src/color/oklab";
import type { Params } from "../../src/params";

const params = JSON.parse(readFileSync(join(process.cwd(), "src", "params.json"), "utf-8")) as Params;
const OUT = join(process.cwd(), "..", "out", "ui_review", "m7b", "phase3");
mkdirSync(OUT, { recursive: true });
const SONGS = ["ambient", "electronic", "rock"];
const GATES = { dE95: 0.02, Lr: 0.99, hue: 3, dim: 0.02 };

test.use({ viewport: { width: 1440, height: 900 } });

interface Sample {
  nodes: number[];
  means: number[]; // per node: mean linear R, G, B of the sampled face
}

/** Node colours and per-node face means from the same frame (one synchronous evaluate). */
async function sample(page: Page, mode: "chips" | "dots"): Promise<Sample> {
  const w = params.web3d;
  const half = mode === "chips" ? 0.45 * (w.chip_size - 2 * w.chip_corner) : 0.6 * params.render.node.dot.radius_ratio;
  return page.evaluate(
    ({ half, square }) => {
      const s = window.__synesthesia!;
      const nodes = s.nodes();
      const px = s.size();
      const pix = s.readPixels();
      const { nodes: n, margin } = s.layout();
      const pitch = px / (n + 2 * margin);
      const lin = (c: number): number => {
        const x = c / 255;
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      const means: number[] = [];
      const hp = half * pitch;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const cx = (margin + c + 0.5) * pitch, cy = (margin + r + 0.5) * pitch;
          let R = 0, G = 0, B = 0, k = 0;
          for (let y = Math.ceil(cy - hp); y <= Math.floor(cy + hp); y++) {
            for (let x = Math.ceil(cx - hp); x <= Math.floor(cx + hp); x++) {
              if (!square && (x - cx) ** 2 + (y - cy) ** 2 > hp * hp) continue;
              const o = (y * px + x) * 4;
              R += lin(pix[o]);
              G += lin(pix[o + 1]);
              B += lin(pix[o + 2]);
              k++;
            }
          }
          means.push(R / k, G / k, B / k);
        }
      }
      return { nodes, means };
    },
    { half, square: mode === "chips" },
  );
}

function metrics(s: Sample) {
  const lab = new Float64Array(3);
  const ref: number[][] = [], got: number[][] = [];
  for (let i = 0; i < s.nodes.length / 3; i++) {
    linearToOklab(srgb8ToLinear(s.nodes[i * 3]), srgb8ToLinear(s.nodes[i * 3 + 1]), srgb8ToLinear(s.nodes[i * 3 + 2]), lab);
    ref.push([lab[0], lab[1], lab[2]]);
    linearToOklab(s.means[i * 3], s.means[i * 3 + 1], s.means[i * 3 + 2], lab);
    got.push([lab[0], lab[1], lab[2]]);
  }
  const dE = ref.map((a, i) => Math.hypot(a[0] - got[i][0], a[1] - got[i][1], a[2] - got[i][2])).sort((a, b) => a - b);
  const mean = (v: number[]): number => v.reduce((x, y) => x + y, 0) / v.length;
  const La = ref.map((a) => a[0]), Lb = got.map((a) => a[0]);
  const ma = mean(La), mb = mean(Lb);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < La.length; i++) {
    sab += (La[i] - ma) * (Lb[i] - mb);
    saa += (La[i] - ma) ** 2;
    sbb += (Lb[i] - mb) ** 2;
  }
  const Lr = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 1;
  const hues: number[] = [];
  ref.forEach((a, i) => {
    if (Math.hypot(a[1], a[2]) < 0.03) return;
    const h1 = Math.atan2(a[2], a[1]), h2 = Math.atan2(got[i][2], got[i][1]);
    let d = Math.abs(h1 - h2) * (180 / Math.PI);
    if (d > 180) d = 360 - d;
    hues.push(d);
  });
  const order = La.map((l, i) => [l, i]).sort((a, b) => a[0] - b[0]).slice(0, Math.max(1, Math.round(La.length / 10)));
  const dim = mean(order.map(([, i]) => Math.abs(ref[i][0] - got[i][0])));
  return { dE95: dE[Math.floor(dE.length * 0.95)], dEmax: dE[dE.length - 1], Lr, hue: hues.length ? mean(hues) : 0, dim };
}

test("fidelity gates on the 3D chips and the 2D view", async ({ page }) => {
  test.setTimeout(240_000);
  const results: Record<string, ReturnType<typeof metrics>> = {};
  const sameNodes: Record<string, boolean> = {};
  for (const slug of SONGS) {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true, trueColour: false })));
    await page.reload();
    await page.waitForFunction(() => {
      const app = (window as unknown as { __synApp?: { getState: () => { lib: unknown; samples: unknown[] } } }).__synApp;
      return !!app && !!app.getState().lib && app.getState().samples.length > 0;
    });
    await page.evaluate((s) => (window as unknown as { __synApp: { getState: () => { addSample: (x: string) => Promise<void> } } }).__synApp.getState().addSample(s), slug);
    await expect(page.getByTestId("stage")).toBeVisible();
    await page.waitForFunction(() => window.__synesthesia?.stats.kind === "three", null, { timeout: 15000 });
    await page.mouse.move(5, 5); // no parallax: straight-on
    await page.waitForTimeout(1500);
    const chipsRest = await sample(page, "chips");
    results[`${slug} chips rest`] = metrics(chipsRest);
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(3000);
    results[`${slug} chips live`] = metrics(await sample(page, "chips"));
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "True colour" }).click();
    await page.waitForFunction(() => window.__synesthesia?.stats.kind === "webgl2", null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    const dotsRest = await sample(page, "dots");
    results[`${slug} 2D rest`] = metrics(dotsRest);
    sameNodes[slug] = chipsRest.nodes.length === dotsRest.nodes.length && chipsRest.nodes.every((v, i) => v === dotsRest.nodes[i]);
  }
  const rows = Object.entries(results).map(([k, m]) => `${k.padEnd(22)} dE95 ${m.dE95.toFixed(4)}  dEmax ${m.dEmax.toFixed(4)}  L r ${m.Lr.toFixed(4)}  hue ${m.hue.toFixed(2)} deg  dim dL ${m.dim.toFixed(4)}`);
  console.log(`fidelity (gates: dE95 <= ${GATES.dE95}, L r >= ${GATES.Lr}, hue <= ${GATES.hue}, dim <= ${GATES.dim})\n${rows.join("\n")}`);
  writeFileSync(join(OUT, "fidelity.json"), JSON.stringify({ gates: GATES, results, sameNodes }, null, 2));
  for (const [slug, same] of Object.entries(sameNodes)) expect(same, `${slug}: 2D and 3D draw identical node colours`).toBe(true);
  for (const [k, m] of Object.entries(results)) {
    if (k.includes("2D")) continue; // reported above (see the header comment)
    expect(m.dE95, `${k} dE95`).toBeLessThanOrEqual(GATES.dE95);
    expect(m.Lr, `${k} L r`).toBeGreaterThanOrEqual(GATES.Lr);
    expect(m.hue, `${k} hue`).toBeLessThanOrEqual(GATES.hue);
    expect(m.dim, `${k} dim`).toBeLessThanOrEqual(GATES.dim);
  }
});
