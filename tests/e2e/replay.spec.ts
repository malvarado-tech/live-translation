import { expect, test, type Page } from "@playwright/test";

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
    await expect(page.getByTestId("replay-attribution")).toContainText("Dominio público");
    await page.getByTestId("ui-lang-toggle").click();
    await expect(page.getByTestId("listener-badge")).toHaveText(
      "1962 recording · AI-generated translation and voice",
    );
    await expect(page.getByTestId("replay-attribution")).toContainText("Public domain");
    await page.getByTestId("listen-button").click();
    await page.waitForTimeout(1500);
    expect(apiCalls).toEqual([]);
  });

  test("one clock drives audio and captions across language switches", async ({ page }) => {
    await page.goto("/replay");
    await page.getByTestId("listen-button").click();
    await expect(page.getByTestId("replay-play")).toHaveAttribute("data-state", "playing");
    await expect(page.getByTestId("caption-tail")).toContainText("Zarpamos", { timeout: 5000 });
    await expect(page.getByTestId("listener-tally")).toHaveText("Grabación");
    await expect
      .poll(async () => Number(await page.getByTestId("listener-meter").getAttribute("data-level")), { timeout: 5000 })
      .toBeGreaterThan(0.05);

    // Scrub to the moon line.
    await page.getByTestId("replay-scrub").fill("125");
    await expect(page.getByTestId("caption-tail")).toContainText(/Luna/, { timeout: 5000 });
    const before = await time(page);
    expect(before).toBeGreaterThanOrEqual(124);

    // Switch to Portuguese: same position, still playing, Portuguese captions.
    await page.getByTestId("channel-pt").click();
    await expect(page.getByTestId("caption-tail")).toContainText(/Lua/, { timeout: 5000 });
    await expect(page.getByTestId("replay-play")).toHaveAttribute("data-state", "playing", { timeout: 5000 });
    const after = await time(page);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(3);

    // Original English.
    await page.getByTestId("channel-en").click();
    await expect(page.getByTestId("caption-tail")).toContainText(/moon/, { timeout: 5000 });

    // Pause.
    await page.getByTestId("replay-play").click();
    await expect(page.getByTestId("replay-play")).toHaveAttribute("data-state", "paused");
    await expect(page.getByTestId("listener-tally")).toHaveText("En pausa");
  });

  test("captions view shows the stage and the language sheet", async ({ page }) => {
    await page.goto("/replay");
    await page.getByRole("radio", { name: "Subtítulos" }).click();
    await page.getByTestId("listen-button").click();
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
    await page.getByRole("radio", { name: "Rows" }).click();
    await expect(page.getByTestId("rows-view")).toBeVisible();
  });
});
