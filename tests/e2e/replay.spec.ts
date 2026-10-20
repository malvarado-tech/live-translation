import { expect, test, type Page } from "@playwright/test";
import { expectContrast, setPrefs } from "./helpers";

async function time(page: Page): Promise<number> {
  const [m, s] = (await page.getByTestId("replay-time").first().innerText()).split(":").map(Number);
  return m * 60 + s;
}

test.describe("listener replay", () => {
  test("is labelled, credited, and calls no server route", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url());
    });
    await page.goto("/replay");
    await expect(page.getByTestId("listener-badge")).toHaveText(
      "Grabación de 1962 · traducción y voz generadas con IA",
    );
    // Credits sit behind one disclosure at the bottom.
    await expect(page.getByText("Dominio público", { exact: false })).toBeHidden();
    await page.getByTestId("replay-attribution").getByText("Créditos").click();
    await expect(page.getByTestId("replay-attribution")).toContainText("Dominio público");
    await expect(page.getByTestId("replay-attribution")).toContainText("John F. Kennedy");
    await page.getByTestId("options-button").click();
    await page.getByTestId("ui-lang-switch").getByRole("radio", { name: "English" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("listener-badge")).toHaveText(
      "1962 recording · AI-generated translation and voice",
    );
    await expect(page.getByTestId("replay-attribution")).toContainText("Public domain");
    await page.getByTestId("replay-play").click();
    await page.waitForTimeout(1500);
    expect(apiCalls).toEqual([]);
  });

  test("one clock drives audio and captions across language switches", async ({ page }) => {
    await setPrefs(page, { "lt.view.listener": "receiver" });
    await page.goto("/replay");
    await page.getByTestId("replay-play").click();
    await expect(page.getByTestId("replay-play")).toHaveAttribute("data-state", "playing");
    await expect(page.getByTestId("caption-tail")).toContainText("Zarpamos", { timeout: 5000 });
    await expect(page.getByTestId("listener-tally")).toHaveText("Reproducción en curso.");
    await expect
      .poll(async () => Number(await page.getByTestId("listener-meter").getAttribute("data-level")), { timeout: 5000 })
      .toBeGreaterThan(0.05);

    // Scrub to the moon line.
    await page.getByTestId("replay-scrub").fill("125");
    await expect(page.getByTestId("caption-tail")).toContainText(/Luna/, { timeout: 5000 });
    const before = await time(page);
    expect(before).toBeGreaterThanOrEqual(124);

    // Switch to Portuguese: same position, still playing, Portuguese captions.
    await page.getByTestId("language-button").click();
    await page.getByTestId("channel-pt").click();
    await expect(page.getByTestId("caption-tail")).toContainText(/Lua/, { timeout: 5000 });
    await expect(page.getByTestId("replay-play")).toHaveAttribute("data-state", "playing", { timeout: 5000 });
    const after = await time(page);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(3);

    // Original English.
    await page.getByTestId("language-button").click();
    await page.getByTestId("channel-en").click();
    await expect(page.getByTestId("caption-tail")).toContainText(/moon/, { timeout: 5000 });

    // Pause.
    await page.getByTestId("replay-play").click();
    await expect(page.getByTestId("replay-play")).toHaveAttribute("data-state", "paused");
    await expect(page.getByTestId("listener-tally")).toHaveText("Reproducción en pausa.");
  });

  test("the transport's play button is the only play control", async ({ page }) => {
    await page.goto("/replay");
    await expect(page.getByTestId("replay-play")).toBeEnabled();
    await expect(page.getByTestId("listen-button")).toHaveCount(0);
    await expect(page.getByTestId("mute-button")).toBeVisible();
    await page.getByTestId("replay-play").click();
    await expect(page.getByTestId("replay-play")).toHaveAttribute("data-state", "playing");
    await expect(page.getByTestId("listener-tally")).toHaveText("Reproducción en curso.");
  });

  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 430, height: 932 },
  ]) {
    test(`captions start under the language button and keep the newest line in view (${size.width}x${size.height})`, async ({ page }, info) => {
      test.skip(info.project.name !== "mobile", "phone layout");
      await page.setViewportSize(size);
      await page.goto("/replay");
      await page.getByTestId("replay-play").click();
      const stage = page.getByTestId("caption-stage");
      await expect(stage).toContainText("Zarpamos", { timeout: 5000 });
      await page.getByTestId("replay-play").click();

      // Few lines: the stack sits right under the language button.
      const lang = (await page.getByTestId("language-button").boundingBox())!;
      const first = (await stage.locator("p").first().boundingBox())!;
      expect(first.y - (lang.y + lang.height)).toBeLessThan(40);

      // Many lines: older lines move up under the fade, the newest stays whole.
      await page.getByTestId("replay-scrub").fill("125");
      await expect(stage).toContainText(/Luna/, { timeout: 5000 });
      await expect(stage).toHaveAttribute("data-overflow", "true");
      const box = (await stage.boundingBox())!;
      const newest = (await stage.locator("p").last().boundingBox())!;
      expect(newest.y).toBeGreaterThanOrEqual(box.y);
      expect(newest.y + newest.height).toBeLessThanOrEqual(box.y + box.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    });
  }

  test("captions view shows the stage and the language sheet", async ({ page }) => {
    await page.goto("/replay");
    await expect(page.getByTestId("listener-surface")).toHaveAttribute("data-view", "captions");
    await page.getByTestId("replay-play").click();
    await expect(page.getByTestId("caption-stage")).toContainText("Zarpamos", { timeout: 5000 });
    await page.getByTestId("language-button").click();
    await page.getByTestId("language-sheet").getByRole("button", { name: /Português/ }).click();
    await expect(page.getByTestId("caption-stage")).toContainText("Zarpamos neste", { timeout: 5000 });
  });
});

test.describe("operator replay", () => {
  test("plays read-only with every channel metered", async ({ page }) => {
    await page.goto("/replay/operator");
    await expect(page.getByTestId("replay-label")).toContainText("Read-only replay");
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("tally-es")).toHaveText("Replay");
    await expect(page.getByTestId("tally-en")).toHaveText("Original");
    for (const code of ["input", "es", "pt", "en"]) {
      await expect
        .poll(async () => Number(await page.getByTestId(`meter-${code}`).getAttribute("data-level")), { timeout: 8000 })
        .toBeGreaterThan(0.02);
    }
    await expect(page.getByTestId("lane-target")).toContainText("Zarpamos", { timeout: 5000 });
    await page.getByTestId("monitor-pt").click();
    await expect(page.getByTestId("lane-target")).toContainText("Zarpamos neste");
    await page.getByTestId("settings-button").click();
    await page.getByRole("radio", { name: "Rows" }).click();
    await expect(page.getByTestId("rows-view")).toBeVisible();
  });
});

test.describe("caption history", () => {
  for (const view of ["captions", "receiver"] as const) {
    test(`${view} view: scroll back through the session, then back to latest`, async ({ page }) => {
      await setPrefs(page, { "lt.view.listener": view });
      await page.goto("/replay");
      const stage = page.getByTestId(view === "captions" ? "caption-stage" : "caption-tail");
      const scroller = stage.getByTestId("caption-scroll");
      await page.getByTestId("replay-play").click();
      await expect(stage).toContainText("Zarpamos", { timeout: 5000 });
      await page.getByTestId("replay-scrub").fill("140");
      await expect(stage).toHaveAttribute("data-overflow", "true", { timeout: 5000 });
      // The first line of the session is still there to read back.
      await expect(scroller.locator("p").first()).toContainText("Zarpamos");
      await expect(stage).toHaveAttribute("data-following", "true");
      const fadeWhileFollowing = await scroller.evaluate((el) => getComputedStyle(el).maskImage);
      expect(fadeWhileFollowing).toContain("gradient");
      await expect(page.getByTestId("caption-latest")).toHaveCount(0);

      // Scroll up: following stops and the button appears, announced politely.
      await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
      await expect(stage).toHaveAttribute("data-following", "false");
      const latest = page.getByTestId("caption-latest");
      await expect(latest).toBeVisible();
      await expect(latest).toHaveText("Volver a lo más reciente");
      expect(await latest.evaluate((el) => el.closest("[aria-live=polite]") !== null)).toBe(true);
      const box = (await latest.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await scroller.evaluate((el) => getComputedStyle(el).maskImage)).toBe("none");

      // New lines keep arriving; the reading position holds.
      await page.waitForTimeout(2500);
      expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(40);
      await expectContrast(page);

      // The button returns to the newest line and resumes following.
      await latest.click();
      await expect(stage).toHaveAttribute("data-following", "true");
      await expect(page.getByTestId("caption-latest")).toHaveCount(0);
      const gap = await scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
      expect(gap).toBeLessThanOrEqual(12);

      // Scrolling back to the bottom by hand also resumes following.
      await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
      await expect(page.getByTestId("caption-latest")).toBeVisible();
      await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await expect(stage).toHaveAttribute("data-following", "true");
      await expect(page.getByTestId("caption-latest")).toHaveCount(0);

      // The interface language switches the button too.
      await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
      await page.getByTestId("options-button").click();
      await page.getByTestId("ui-lang-switch").getByRole("radio", { name: "English" }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("caption-latest")).toHaveText("Back to latest");
    });
  }
});

test.describe("operator transcript history", () => {
  test("the lanes scroll back and return to the newest line", async ({ page }) => {
    await page.goto("/replay/operator");
    await page.getByTestId("primary-action").click();
    const lane = page.getByTestId("lane-target");
    const scroller = page.getByTestId("lane-target-scroll");
    await expect(lane).toContainText("Zarpamos", { timeout: 8000 });
    await page.getByTestId("replay-scrub").first().fill("140");
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 1), { timeout: 8000 }).toBe(true);
    await expect(scroller.locator("p").first()).toContainText("Zarpamos");
    await expect(lane).toHaveAttribute("data-following", "true");
    await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(lane).toHaveAttribute("data-following", "false");
    const latest = page.getByTestId("lane-target-latest");
    await expect(latest).toHaveText("Back to latest");
    await page.waitForTimeout(1500);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(40);
    await latest.click();
    await expect(lane).toHaveAttribute("data-following", "true");
    await expect(latest).toHaveCount(0);
    // The source lane works the same way.
    const source = page.getByTestId("lane-source-scroll");
    await source.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(page.getByTestId("lane-source-latest")).toBeVisible();
    await page.getByTestId("primary-action").click();
  });
});
