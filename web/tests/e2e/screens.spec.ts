// UI checklist on screenshots (docs/UI.md section 13): three sizes, light and dark, reduced
// motion and reduced transparency on and off. Screenshots go to test-results/screens/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SIZES = [
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "820x1180", width: 820, height: 1180, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
] as const;
const OUT = join(process.cwd(), "test-results", "screens");
mkdirSync(OUT, { recursive: true });
const MIN_HIT = 44;

async function prepare(page: Page, opts: { transparency: boolean; landing: boolean }): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ transparency, landing }) => {
      localStorage.setItem(
        "synesthesia.settings",
        JSON.stringify({ landingDone: !landing, reduceTransparency: transparency ? "on" : "auto" }),
      );
    },
    opts,
  );
  await page.reload();
}

async function checklist(page: Page, touch: boolean, label: string): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(250); // let transitions settle before reading computed colours
  const report = await page.evaluate(
    ({ touch, minHit }) => {
      const out: string[] = [];
      const vw = window.innerWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${vw}`);
      const visible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      if (touch) {
        document.querySelectorAll("button, select, input:not([type=file]):not([type=checkbox]), [role=option]").forEach((el) => {
          if (!visible(el)) return;
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.height + 0.5 < minHit || r.width + 0.5 < minHit) out.push(`hit target ${Math.round(r.width)}x${Math.round(r.height)}: ${el.tagName} ${(el.textContent ?? "").trim().slice(0, 20)} ${(el as HTMLElement).getAttribute("aria-label") ?? ""}`);
        });
        document.querySelectorAll("input[type=checkbox]").forEach((el) => {
          const lab = (el as HTMLInputElement).labels?.[0];
          const r = (lab ?? (el as HTMLElement)).getBoundingClientRect();
          if (r.height + 0.5 < minHit) out.push(`checkbox hit area ${Math.round(r.height)} px`);
        });
      }
      // contrast of text against its effective background
      const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = (r: number, g: number, b: number): number => {
        const f = (v: number): number => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el: Element): number[] => {
        const layers: number[][] = [];
        for (let e: Element | null = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c.length >= 3 && (c.length === 3 || c[3] > 0)) {
            layers.push(c);
            if (c.length === 3 || c[3] >= 1) break;
          }
        }
        let base = [0, 0, 0];
        for (const c of layers.reverse()) {
          const a = c.length === 4 ? c[3] : 1;
          base = [0, 1, 2].map((i) => c[i] * a + base[i] * (1 - a));
        }
        return base;
      };
      const worst: string[] = [];
      document.querySelectorAll("h1, h2, h3, p, span, label, button, a").forEach((el) => {
        if (!visible(el) || el.closest("canvas, .stage-card, .maps-card")) return;
        if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) return;
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        const a = fg.length === 4 ? fg[3] : 1;
        const bg = bgOf(el);
        const mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
        const l1 = lum(mix[0], mix[1], mix[2]);
        const l2 = lum(bg[0], bg[1], bg[2]);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(cs.fontSize);
        const need = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700) ? 3 : 4.5;
        if (ratio + 0.01 < need) worst.push(`${ratio.toFixed(2)}:1 "${(el.textContent ?? "").trim().slice(0, 24)}"`);
      });
      out.push(...worst.slice(0, 5).map((w) => `contrast ${w}`));
      return out;
    },
    { touch, minHit: MIN_HIT },
  );
  expect(report, `${label}: ${report.join("; ")}`).toEqual([]);
}

for (const size of SIZES) {
  for (const scheme of ["light", "dark"] as const) {
    for (const reducedMotion of [false, true]) {
      for (const transparency of [false, true]) {
        const id = `${size.name}_${scheme}_${reducedMotion ? "rm" : "motion"}_${transparency ? "rt" : "glass"}`;
        test.describe(id, () => {
          test.use({
            viewport: { width: size.width, height: size.height },
            colorScheme: scheme,
            reducedMotion: reducedMotion ? "reduce" : "no-preference",
            hasTouch: size.touch,
            isMobile: size.width < 735,
          });

          test("landing", async ({ page }) => {
            await prepare(page, { transparency, landing: true });
            const dlg = page.getByRole("dialog", { name: "Welcome" });
            await expect(dlg).toBeVisible();
            await page.waitForTimeout(400);
            await page.screenshot({ path: join(OUT, `${id}_landing.png`) });
            await expect(dlg).toHaveAttribute("data-static", String(reducedMotion));
            await checklist(page, size.touch, `${id} landing`);
            await dlg.evaluate((el) => el.scrollTo(0, el.scrollHeight));
            await page.waitForTimeout(300);
            await page.screenshot({ path: join(OUT, `${id}_landing_end.png`) });
            await expect(page.getByLabel("How to read the colours")).toBeVisible();
            await checklist(page, size.touch, `${id} landing end`);
            const filled = await page.locator(".landing .btn-filled").count();
            expect(filled).toBe(1);
          });

          test("library, signature view and sheets", async ({ page }) => {
            await prepare(page, { transparency, landing: false });
            await expect(page.getByText("Add a song to see its signature.")).toBeVisible();
            await page.screenshot({ path: join(OUT, `${id}_library_empty.png`) });
            await checklist(page, size.touch, `${id} library`);

            await page.getByRole("button", { name: "Try a sample" }).click();
            await expect(page.getByTestId("stage")).toBeVisible();
            await page.waitForTimeout(500);
            await page.screenshot({ path: join(OUT, `${id}_signature.png`) });
            await checklist(page, size.touch, `${id} signature`);

            // signature is the dominant element
            const stage = (await page.getByTestId("stage").boundingBox())!;
            expect((stage.width * stage.height) / (size.width * size.height)).toBeGreaterThan(0.2);
            const others = await page.evaluate(() =>
              [".inspector", ".player", ".toolbar", ".caption", ".segmented"].flatMap((sel) =>
                Array.from(document.querySelectorAll(sel)).map((el) => {
                  const r = el.getBoundingClientRect();
                  return r.width * r.height;
                }),
              ),
            );
            expect(stage.width * stage.height).toBeGreaterThan(Math.max(...others));
            // one primary (filled) action per pane: the library "+" and the player's play button
            expect(await page.locator(".sidebar .btn-filled:visible").count()).toBeLessThanOrEqual(1);
            expect(await page.locator(".detail .btn-filled:visible").count()).toBe(1);

            // keyboard: focus ring is visible
            await page.keyboard.press("Tab");
            const ring = await page.evaluate(() => {
              const cs = getComputedStyle(document.activeElement as Element);
              return { w: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
            });
            expect(ring.w).toBeGreaterThanOrEqual(2);
            expect(ring.style).not.toBe("none");

            // materials honour reduced transparency
            const mat = await page.evaluate(() => {
              const el = document.querySelector(".material");
              const cs = el ? getComputedStyle(el) : null;
              return cs ? { bf: cs.backdropFilter, bg: cs.backgroundColor } : null;
            });
            if (transparency && mat) expect(mat.bf === "none" || mat.bf === "").toBe(true);
            if (!transparency && mat) expect(mat.bf).toContain("blur");

            // maps
            for (const [i, name] of ["Features", "Structure", "Rhythm", "Dynamics"].entries()) {
              await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
              await page.waitForTimeout(150);
              await page.screenshot({ path: join(OUT, `${id}_map_${i + 2}_${name.toLowerCase()}.png`) });
            }
            await checklist(page, size.touch, `${id} maps`);
            await page.getByRole("button", { name: /^Sound/ }).click();

            // export sheet
            await page.getByRole("button", { name: "Export" }).click();
            await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
            await page.screenshot({ path: join(OUT, `${id}_export.png`) });
            await checklist(page, size.touch, `${id} export`);
            await page.keyboard.press("Escape");

            // settings sheet (phone: the library pane holds it, so go back first) and 200% text
            if (size.width < 735) await page.getByRole("button", { name: "Back to library" }).click();
            await page.getByRole("button", { name: "Settings" }).first().click();
            await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
            await page.screenshot({ path: join(OUT, `${id}_settings.png`) });
            await checklist(page, size.touch, `${id} settings`);
            await page.keyboard.press("Escape");

            await page.evaluate(() => {
              document.documentElement.style.fontSize = "200%";
            });
            await page.waitForTimeout(200);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow, "no horizontal overflow at 200% text size").toBeLessThanOrEqual(1);
            await page.screenshot({ path: join(OUT, `${id}_text200.png`) });
          });
        });
      }
    }
  }
}

test("no bundled fonts or Apple assets", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await page.waitForTimeout(500);
  expect(requests.filter((u) => /\.(woff2?|ttf|otf)(\?|$)/i.test(u))).toEqual([]);
  const families = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(families).toContain("system-ui");
});
