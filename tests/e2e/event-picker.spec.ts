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
    await expect(page.getByRole("heading", { name: "Choose a language" })).toBeVisible();
    await expect(page.getByTestId("no-live-languages")).toContainText(
      "No live languages right now.",
    );
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
    await expect(page.getByText("room: demo-es")).toBeVisible();
    await expect(page.getByRole("button", { name: "Listen" })).toBeVisible();

    await page.getByRole("link", { name: "Change language" }).click();
    await expect(page).toHaveURL(/\/e\/demo$/);
    await page.getByRole("link", { name: /English/ }).click();
    await expect(page.getByText("room: demo-en")).toBeVisible();
  });

  test("a failed refresh keeps the last list and shows the error", async ({ page }) => {
    await page.goto("/e/demo");
    await expect(page.getByTestId("language-list").getByRole("link")).toHaveCount(2);
    await page.unroute("**/api/event-languages?**");
    await page.route("**/api/event-languages?**", (route) =>
      route.fulfill({ status: 502, json: { error: "Could not reach the translation server." } }),
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByTestId("languages-error")).toContainText("Could not reach the translation server.");
    await expect(page.getByTestId("language-list").getByRole("link")).toHaveCount(2);
  });
});

test.describe("existing routes are unchanged", () => {
  test("a direct listener link has no event link", async ({ page }) => {
    await page.goto("/listen/demo-en");
    await expect(page.getByText("room: demo-en")).toBeVisible();
    await expect(page.getByRole("button", { name: "Listen" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Change language" })).toHaveCount(0);
  });

  test("an event parameter from another event is ignored", async ({ page }) => {
    await page.goto("/listen/demo-en?event=other");
    await expect(page.getByText("room: demo-en")).toBeVisible();
    await expect(page.getByRole("link", { name: "Change language" })).toHaveCount(0);
  });

  test("the operator dashboard still loads", async ({ page }) => {
    await page.goto("/operator");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Event link · all languages")).toHaveCount(0);
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
