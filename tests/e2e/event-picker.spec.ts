import { expect, test } from "@playwright/test";

const LIVE = {
  event: "demo",
  configured: true,
  languages: [
    { code: "en", label: "English", room: "demo-en" },
    { code: "es", label: "Español", room: "demo-es" },
  ],
};

test.describe("event page without LiveKit credentials", () => {
  test("the API reports no live languages", async ({ request }) => {
    const resp = await request.get("/api/event-languages?event=demo");
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    test.skip(body.configured, "LiveKit credentials are configured here");
    expect(body).toEqual({ event: "demo", configured: false, languages: [] });
  });

  test("the picker shows a clear empty state", async ({ page, request }) => {
    const body = await (
      await request.get("/api/event-languages?event=demo")
    ).json();
    test.skip(body.configured, "LiveKit credentials are configured here");

    await page.goto("/e/demo");
    await expect(page.getByRole("heading", { name: "Language selection" })).toBeVisible();
    await expect(page.getByTestId("no-live-languages")).toContainText("No live languages");
    await expect(page.getByTestId("language-list")).toHaveCount(0);
  });
});

test.describe("event page with live languages (mocked endpoint)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/event-languages?**", (route) =>
      route.fulfill({ json: LIVE }),
    );
  });

  test("lists the live languages with links to the listener page", async ({ page }) => {
    await page.goto("/e/demo");
    const list = page.getByTestId("language-list");
    await expect(list.getByRole("link")).toHaveCount(2);
    await expect(list.getByRole("link", { name: /English/ })).toHaveAttribute(
      "href",
      "/listen/demo-en?event=demo",
    );
    await expect(list.getByRole("link", { name: /Español/ })).toHaveAttribute(
      "href",
      "/listen/demo-es?event=demo",
    );
    await expect(page.getByTestId("no-live-languages")).toHaveCount(0);
  });

  test("picking a language and switching back to the picker", async ({ page }) => {
    await page.goto("/e/demo");
    await page.getByRole("link", { name: /Español/ }).click();
    await expect(page).toHaveURL(/\/listen\/demo-es\?event=demo$/);
    // The Spanish room speaks Spanish; the room name is never shown.
    await expect(page.getByTestId("language-button")).toContainText("Español");
    await expect(page.getByText("demo-es")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Escuchar" })).toBeVisible();

    // The language button switches language; one tap on Listen starts the audio.
    await page.getByTestId("language-button").click();
    await page.getByTestId("channel-en").click();
    await expect(page).toHaveURL(/\/listen\/demo-en\?event=demo$/);
    await expect(page.getByRole("button", { name: "Listen" })).toBeVisible();

    // The language sheet goes back to the event page.
    await page.getByTestId("language-button").click();
    await page.getByRole("link", { name: "Language selection" }).click();
    await expect(page).toHaveURL(/\/e\/demo$/);
    await page.getByRole("link", { name: /English/ }).click();
    await expect(page.getByTestId("caption-stage")).toBeVisible();
  });

  test("a failed refresh keeps the last list and shows a plain notice", async ({ page }) => {
    await page.goto("/e/demo");
    await expect(page.getByTestId("language-list").getByRole("link")).toHaveCount(2);
    await page.unroute("**/api/event-languages?**");
    await page.route("**/api/event-languages?**", (route) =>
      route.fulfill({ status: 502, json: { error: "Could not reach the translation server." } }),
    );
    // The list refreshes on its own (every 15 s and when the tab comes back).
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByTestId("languages-error")).toContainText("List not updated");
    await expect(page.getByText("Could not reach the translation server.")).toHaveCount(0);
    await expect(page.getByTestId("language-list").getByRole("link")).toHaveCount(2);
  });

  test("languages carry their status from the operator", async ({ page }) => {
    await page.unroute("**/api/event-languages?**");
    await page.route("**/api/event-languages?**", (route) =>
      route.fulfill({
        json: {
          ...LIVE,
          title: "Rice University address",
          languages: [
            { ...LIVE.languages[0], status: { state: "live", mode: "original", listeners: 6 } },
            { ...LIVE.languages[1], status: { state: "paused", mode: "translate", listeners: 38 } },
          ],
        },
      }),
    );
    await page.goto("/e/demo");
    await expect(page.getByText("Rice University address")).toBeVisible();
    await expect(page.getByRole("link", { name: /Español/ })).toContainText("Paused");
    await expect(page.getByRole("link", { name: /English/ })).toContainText("Live");
  });
});

test.describe("existing routes are unchanged", () => {
  test("a direct listener link has no event link", async ({ page }) => {
    await page.goto("/listen/demo-en");
    await expect(page.getByTestId("language-current")).toContainText("English");
    await expect(page.getByRole("button", { name: "Listen" })).toBeVisible();
    await expect(page.getByTestId("language-button")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Language selection" })).toHaveCount(0);
  });

  test("an event parameter from another event is ignored", async ({ page }) => {
    await page.goto("/listen/demo-en?event=other");
    await expect(page.getByTestId("language-current")).toContainText("English");
    await expect(page.getByTestId("language-button")).toHaveCount(0);
  });

  test("the operator dashboard still loads", async ({ page }) => {
    await page.goto("/operator");
    await expect(page.getByTestId("setup")).toBeVisible();
    await expect(page.getByTestId("event-link")).toHaveCount(0);
  });

  test("operator links prefill event, language and title", async ({ page }) => {
    await page.goto("/operator?event=rice-1962&lang=pt&title=Rice%20address");
    await expect(page.getByText("Room rice-1962-pt")).toBeVisible();
    await expect(page.getByPlaceholder("Rice University address")).toHaveValue("Rice address");
  });
});

test.describe("event languages API guards", () => {
  test("requires an event", async ({ request }) => {
    const resp = await request.get("/api/event-languages");
    expect(resp.status()).toBe(400);
  });

  test("rate limits a single client", async ({ request }, testInfo) => {
    const headers = { "x-forwarded-for": `203.0.113.${testInfo.workerIndex + 10}-${testInfo.project.name}` };
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      const resp = await request.get("/api/event-languages?event=demo", { headers });
      statuses.push(resp.status());
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});
