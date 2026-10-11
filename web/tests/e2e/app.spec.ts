import { expect, test } from "@playwright/test";
import { join } from "node:path";

const SAMPLE_AUDIO = join(process.cwd(), "public", "samples", "rock", "audio.mp3");

test.describe("app flow", () => {
  test("first landing, sample, maps, inspector, export, settings, persistence", async ({ page }) => {
    await page.goto("/");
    // the scroll-driven stage is shown once, with a visible Skip and the mapping key
    await expect(page.getByRole("dialog", { name: "Welcome" })).toBeVisible();
    await expect(page.getByText("Hear the music.")).toBeVisible();
    await page.getByRole("dialog", { name: "Welcome" }).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(page.getByLabel("How to read the colours")).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("dialog", { name: "Welcome" })).toHaveCount(0);

    // empty library, one filled button, sample available
    await expect(page.getByText("Add a song to see its signature.")).toBeVisible();
    await page.getByRole("button", { name: "Try a sample" }).click();
    await expect(page.getByTestId("stage")).toBeVisible();
    await expect(page.getByRole("img", { name: /Signature of/ })).toBeVisible();

    // all five map views
    for (const [name, key] of [["Features", "2"], ["Structure", "3"], ["Rhythm", "4"], ["Dynamics", "5"], ["Sound", "1"]] as const) {
      await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press(key);
    }
    await page.keyboard.press("2");
    await expect(page.getByRole("group", { name: "Feature" })).toBeVisible();
    await page.keyboard.press("1");

    // inspector on hover
    const stage = page.getByTestId("stage");
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText("Share of song").first()).toBeVisible();

    // export sheet: focus trap and Escape
    await page.keyboard.press("Control+e");
    await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Export" })).toHaveCount(0);

    // settings change the document attributes
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Appearance").selectOption("light");
    await page.getByLabel("Reduce transparency").selectOption("on");
    await page.getByLabel("Reduce motion").selectOption("on");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await page.keyboard.press("Escape");

    // persistence: the library survives a reload and the landing is not shown again
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Welcome" })).toHaveCount(0);
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("upload through the API, analysis stages, dedup", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
    await page.reload();
    await page.getByTestId("file-input").setInputFiles(SAMPLE_AUDIO);
    await expect(page.getByRole("progressbar", { name: "Analysis progress" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("stage")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1, name: "audio" })).toBeVisible();
    // the same file again resolves instantly (server-side dedup) and opens the same song
    await page.getByTestId("file-input").setInputFiles(SAMPLE_AUDIO);
    await expect(page.getByTestId("stage")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("option")).toHaveCount(1);
  });

  test("play, pause, seek and shortcuts", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("synesthesia.settings", JSON.stringify({ landingDone: true })));
    await page.reload();
    await page.getByRole("button", { name: "Try a sample" }).click();
    await expect(page.getByRole("button", { name: "Play" })).toBeEnabled();
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.waitForTimeout(1500);
    const t = await page.getByLabel("Seek").getAttribute("aria-valuetext");
    expect(t).toMatch(/^0:0[1-9]/);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });
});
