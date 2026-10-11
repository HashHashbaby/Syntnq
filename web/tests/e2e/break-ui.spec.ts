// "Break the UI" pass (D-044): realistic worst-case data through the dev-only `?data=` switch,
// at 320 / 390 / 1440 px and at 200 % text. Shots go to test-results/break/.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "test-results", "break");
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { w: 320, h: 640 },
  { w: 390, h: 844 },
  { w: 1440, h: 900 },
];

async function seed(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
  await page.reload();
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.getByTestId("stage")).toBeVisible();
}

async function invariants(page: Page, label: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${vw}`);
    const text = document.body.innerText;
    for (const bad of ["undefined", "NaN", "[object", "null"]) if (text.includes(bad)) out.push(`rendered "${bad}"`);
    document.querySelectorAll<HTMLElement>(".row, .toolbar button, .segmented button, .player button").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const scroller = el.closest<HTMLElement>(".segmented");
      if (scroller && scroller.scrollWidth > scroller.clientWidth) return; // reachable by scrolling the control
      if (r.right > vw + 1 || r.left < -1) out.push(`out of view: ${el.className} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
    });
    document.querySelectorAll<HTMLElement>(".segmented button, .btn").forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1 && el.getBoundingClientRect().width > 0) out.push(`label overflows its button: "${(el.textContent ?? "").trim().slice(0, 20)}"`);
    });
    document.querySelectorAll<HTMLCanvasElement>(".thumb").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - r.height) > 0.5) out.push(`thumb not square ${r.width}x${r.height}`);
    });
    document.querySelectorAll<HTMLElement>(".truncate").forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1 && !el.title) out.push(`truncated text without a title: "${(el.textContent ?? "").slice(0, 30)}"`);
    });
    return out;
  });
  expect(problems, `${label}: ${problems.join("; ")}`).toEqual([]);
}

for (const size of WIDTHS) {
  test.describe(`${size.w}px`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });

    for (const mode of ["worst", "empty", "one", "many"] as const) {
      test(`library, ${mode}`, async ({ page }) => {
        await seed(page);
        await page.goto(`/?data=${mode}`);
        await page.waitForTimeout(400);
        if (mode === "empty") await expect(page.getByText("Add a song to see its signature.")).toBeVisible();
        else await expect(page.getByRole("option").first()).toBeVisible();
        await page.screenshot({ path: join(OUT, `${size.w}_library_${mode}.png`) });
        await invariants(page, `${size.w} library ${mode}`);
        if (mode === "many") {
          const rendered = await page.getByRole("option").count();
          expect(rendered, "virtualised: only visible rows exist").toBeLessThan(60);
          await page.locator(".list").evaluate((el) => el.scrollTo(0, el.scrollHeight));
          await page.waitForTimeout(300);
          await expect(page.getByRole("option").last()).toBeVisible();
        }
      });
    }

    test("signature view with the worst title, then 200 % text", async ({ page }) => {
      await seed(page);
      await page.goto("/?data=worst");
      await page.getByRole("option").first().click();
      await expect(page.getByTestId("stage")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${size.w}_signature_worst.png`) });
      await invariants(page, `${size.w} signature worst`);
      await expect(page.getByRole("button", { name: "Export" })).toBeInViewport();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `${size.w}_signature_worst_text200.png`) });
      await invariants(page, `${size.w} signature worst 200%`);
      await expect(page.getByRole("button", { name: "Export" })).toBeInViewport();
    });
  });
}
