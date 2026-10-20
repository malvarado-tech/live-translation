import { expect, test } from "@playwright/test";
import { expectContrast, expectNoEmDash, expectNoHorizontalScroll, setPrefs, smallTargets } from "./helpers";

const LIVE = {
  event: "demo",
  configured: true,
  title: "Rice University address",
  languages: [
    { code: "es", label: "Español", room: "demo-es", status: { state: "live", mode: "translate", listeners: 38 } },
    { code: "pt", label: "Português", room: "demo-pt", status: { state: "paused", mode: "translate", listeners: 12 } },
    { code: "en", label: "English", room: "demo-en", status: { state: "live", mode: "original", listeners: 6 } },
  ],
};

test.describe("QR page", () => {
  test("without keys: the code, the short URL and a clear empty state", async ({ page, request }) => {
    const cfg = await (await request.get("/api/event-languages?event=demo")).json();
    test.skip(cfg.configured, "a room server is configured in this build");
    await page.goto("/e/demo/qr");
    await expect(page.getByTestId("qr-code").locator("svg")).toBeVisible();
    await expect(page.getByTestId("qr-url")).toHaveText(/^127\.0\.0\.1:\d+\/e\/demo$/);
    await expect(page.getByTestId("qr-title")).toHaveText("Traducción en vivo · Live translation");
    await expect(page.getByTestId("qr-empty")).toContainText("Sin idiomas en vivo · No live languages");
    await expect(page.getByTestId("qr-empty")).toContainText("Room server not configured.");
    await expect(page.getByTestId("qr-back")).toHaveAttribute("href", "/e/demo");
    // No controls besides the back link.
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(1);
  });

  for (const theme of ["light", "night"] as const) {
    test(`${theme} theme: title, live languages, contrast and layout`, async ({ page }, info) => {
      await setPrefs(page, { "lt.theme": theme });
      await page.route("**/api/event-languages?**", (route) => route.fulfill({ json: LIVE }));
      await page.goto("/e/demo/qr");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByTestId("qr-title")).toHaveText("Rice University address");
      const list = page.getByTestId("qr-languages");
      await expect(list.getByRole("listitem")).toHaveCount(3);
      await expect(list).toContainText("Español");
      await expect(list).toContainText("Paused");
      await expect(page).toHaveTitle("QR · Rice University address");
      // The code is the largest thing on the screen.
      const qr = (await page.getByTestId("qr-code").boundingBox())!;
      const vp = page.viewportSize()!;
      expect(Math.min(qr.width, qr.height)).toBeGreaterThan(Math.min(vp.width, vp.height) * 0.6);
      await expectContrast(page);
      await expectNoEmDash(page);
      await expectNoHorizontalScroll(page);
      if (info.project.name === "mobile") {
        const small = await smallTargets(page, "button, a[href]");
        expect(small, small.join("\n")).toEqual([]);
      }
    });
  }

  test("a language code and a listener base URL", async ({ page }) => {
    await page.route("**/api/event-languages?**", (route) => route.fulfill({ json: LIVE }));
    await page.goto("/e/demo/qr?lang=es&base=http%3A%2F%2F192.168.1.50%3A3000");
    await expect(page.getByTestId("qr-url")).toHaveText("192.168.1.50:3000/listen/demo-es?event=demo");
    await page.goto("/e/demo/qr?base=javascript%3Aalert(1)");
    await expect(page.getByTestId("qr-url")).toHaveText(/^127\.0\.0\.1:\d+\/e\/demo$/);
  });

  test("no horizontal scroll at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.route("**/api/event-languages?**", (route) => route.fulfill({ json: LIVE }));
    await page.goto("/e/demo/qr");
    await expect(page.getByTestId("qr-languages")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("opens from the operator in a new tab", async ({ page, context }) => {
    await page.goto("/operator?event=demo");
    const link = page.getByTestId("qr-page-link");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    await expect(link).toHaveAttribute("href", "/e/demo/qr");
    const [tab] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe("/e/demo/qr");
    await expect(tab.getByTestId("qr-page")).toBeVisible();
    await expect(tab.getByTestId("qr-code").locator("svg")).toBeVisible();
    // The operator tab stays where it was.
    await expect(page.getByTestId("setup")).toBeVisible();
  });
});
