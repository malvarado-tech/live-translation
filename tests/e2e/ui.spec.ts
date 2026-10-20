import { expect, test, type Page } from "@playwright/test";
import {
  expectContrast,
  expectNoEmDash,
  expectNoHorizontalScroll,
  roomServerConfigured,
  setPrefs,
  smallTargets,
  type Theme,
} from "./helpers";

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

type Surface = {
  name: string;
  path: string;
  viewKey: string;
  views: Array<{ value: string; label: string; testId: string }>;
  switchLabel: string;
  ready: (page: Page) => Promise<void>;
  /** Opens the control that holds view and theme. */
  openSettings: (page: Page) => Promise<void>;
  themeSwitch: string;
};

const openOperatorSettings = async (page: Page) => {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-menu")).toBeVisible();
};

const openListenerOptions = async (page: Page) => {
  await page.getByTestId("options-button").click();
  await expect(page.getByTestId("options-sheet")).toBeVisible();
};

const SURFACES: Surface[] = [
  {
    name: "operator",
    path: "/operator",
    viewKey: "lt.view.operator",
    switchLabel: "View",
    views: [
      { value: "desk", label: "Desk", testId: "operator" },
      { value: "rows", label: "Rows", testId: "operator" },
    ],
    ready: async (page) => {
      await expect(page.getByTestId("setup")).toBeVisible();
    },
    openSettings: openOperatorSettings,
    themeSwitch: "operator-theme-switch",
  },
  {
    name: "listener",
    path: "/listen/demo-es?event=demo",
    viewKey: "lt.view.listener",
    switchLabel: "Vista",
    views: [
      { value: "captions", label: "Subtítulos", testId: "listener-surface" },
      { value: "receiver", label: "Receptor", testId: "listener-surface" },
    ],
    ready: async (page) => {
      await expect(page.getByTestId("listen-button")).toBeVisible();
    },
    openSettings: openListenerOptions,
    themeSwitch: "theme-switch",
  },
  {
    name: "picker",
    path: "/e/demo",
    viewKey: "lt.view.listener",
    switchLabel: "View",
    views: [
      { value: "captions", label: "Captions", testId: "picker" },
      { value: "receiver", label: "Receiver", testId: "picker" },
    ],
    ready: async (page) => {
      await expect(page.getByTestId("language-list").getByRole("link")).toHaveCount(3);
    },
    openSettings: openListenerOptions,
    themeSwitch: "theme-switch",
  },
  {
    name: "replay",
    path: "/replay",
    viewKey: "lt.view.listener",
    switchLabel: "Vista",
    views: [
      { value: "captions", label: "Subtítulos", testId: "listener-surface" },
      { value: "receiver", label: "Receptor", testId: "listener-surface" },
    ],
    ready: async (page) => {
      await expect(page.getByTestId("replay-attribution")).toBeVisible();
    },
    openSettings: openListenerOptions,
    themeSwitch: "theme-switch",
  },
  {
    name: "operator replay",
    path: "/replay/operator",
    viewKey: "lt.view.operator",
    switchLabel: "View",
    views: [
      { value: "desk", label: "Desk", testId: "operator-replay" },
      { value: "rows", label: "Rows", testId: "operator-replay" },
    ],
    ready: async (page) => {
      await expect(page.getByTestId(/strip-es|row-es/)).toBeVisible();
    },
    openSettings: openOperatorSettings,
    themeSwitch: "operator-theme-switch",
  },
];

const THEMES: Theme[] = ["light", "night"];

for (const s of SURFACES) {
  test.describe(`${s.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.route("**/api/event-languages?**", (route) => route.fulfill({ json: LIVE }));
    });

    for (const theme of THEMES) {
      for (const v of s.views) {
        test(`${v.value} view, ${theme} theme: contrast, layout, copy`, async ({ page }, info) => {
          await setPrefs(page, { "lt.theme": theme, [s.viewKey]: v.value });
          await page.goto(s.path);
          await s.ready(page);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          if (s.name === "operator" || s.name === "operator replay") {
            await s.openSettings(page);
            await expect(page.getByTestId("operator-view-switch").getByRole("radio", { name: v.label })).toHaveAttribute("aria-checked", "true");
            await page.keyboard.press("Escape");
            await expect(page.getByTestId("settings-menu")).toHaveCount(0);
          } else {
            await expect(page.getByTestId(s.name === "picker" ? "picker" : "listener-surface")).toHaveAttribute("data-view", v.value);
          }
          await page.waitForTimeout(300);
          await expectContrast(page);
          await expectNoEmDash(page);
          await expectNoHorizontalScroll(page);
          if (info.project.name === "mobile") {
            const small = await smallTargets(page, "button, a[href], [role=radio]");
            expect(small, small.join("\n")).toEqual([]);
          }
        });
      }
    }

    test("view and theme sit in one settings control; open, it passes contrast and target size", async ({ page }, info) => {
      for (const theme of THEMES) {
        await setPrefs(page, { "lt.theme": theme });
        await page.goto(s.path);
        await s.ready(page);
        // Not on the main screen until the control is opened.
        await expect(page.getByRole("radiogroup", { name: s.switchLabel })).toHaveCount(0);
        await s.openSettings(page);
        await expect(page.getByRole("radiogroup", { name: s.switchLabel })).toBeVisible();
        await expectContrast(page);
        await expectNoEmDash(page);
        await expectNoHorizontalScroll(page);
        if (info.project.name === "mobile") {
          const scope = s.name.startsWith("operator") ? "[data-testid=settings-menu]" : "[data-testid=options-sheet]";
          const small = await smallTargets(page, `${scope} button, ${scope} a[href], ${scope} [role=radio]`);
          expect(small, small.join("\n")).toEqual([]);
        }
      }
    });

    test("the view switch is labelled and remembered on this device", async ({ page }) => {
      await page.goto(s.path);
      await s.ready(page);
      await s.openSettings(page);
      const group = page.getByRole("radiogroup", { name: s.switchLabel });
      await expect(group).toBeVisible();
      const second = s.views[1];
      await group.getByRole("radio", { name: second.label }).click();
      await page.reload();
      await s.ready(page);
      await s.openSettings(page);
      await expect(
        page.getByRole("radiogroup", { name: s.switchLabel }).getByRole("radio", { name: second.label }),
      ).toHaveAttribute("aria-checked", "true");
    });

    test("light is the default theme and Night is remembered", async ({ page }) => {
      await page.goto(s.path);
      await s.ready(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await s.openSettings(page);
      await page.getByTestId(s.themeSwitch).getByRole("radio").nth(1).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    });

    test("no horizontal scroll at 320 px", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      for (const v of s.views) {
        await setPrefs(page, { [s.viewKey]: v.value });
        await page.goto(s.path);
        await s.ready(page);
        await expectNoHorizontalScroll(page);
      }
    });
  });
}

test.describe("storage blocked", () => {
  test("switches still work without localStorage", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      });
    });
    await page.goto("/listen/demo-en");
    await expect(page.getByTestId("listener-surface")).toHaveAttribute("data-view", "captions");
    await openListenerOptions(page);
    await page.getByRole("radio", { name: "Receiver" }).click();
    await expect(page.getByTestId("listener-surface")).toHaveAttribute("data-view", "receiver");
    await page.getByTestId("theme-switch").getByRole("radio", { name: "Night" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await page.getByTestId("text-size-switch").getByRole("radio", { name: "Large", exact: true }).click();
    await expect(page.getByTestId("text-size-switch").getByRole("radio", { name: "Large", exact: true })).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("operator without keys", () => {
  test("a failed start shows one consistent fault with its fix", async ({ page, request }) => {
    const cfg = await (await request.get("/api/event-languages?event=demo")).json();
    test.skip(cfg.configured, "a room server is configured in this build");
    await page.goto("/operator");
    await page.getByTestId("setup-primary").click();
    await expect(page.getByTestId("session-tally")).toHaveText("Fault");
    const alert = page.getByTestId("alert-slot");
    await expect(alert).toContainText("Translation engine not configured");
    await expect(alert).toContainText("OPENAI_API_KEY");
    // No contradictory controls: nothing claims translation is running.
    await expect(page.getByRole("button", { name: /Stop|Pause/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "End session" })).toHaveCount(0);
    await expect(page.getByTestId("operator-status-live")).toContainText("Fault");
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("session-tally")).toHaveText("Off air");
  });

  test("the input test shows a moving meter", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "desktop operator");
    await page.goto("/operator");
    await page.getByTestId("test-input").click();
    await expect
      .poll(async () => Number(await page.getByTestId("setup-meter").getAttribute("data-level")), { timeout: 5000 })
      .toBeGreaterThan(0.05);
  });

  test("original audio mode needs no translation key and runs locally", async ({ page, request }) => {
    const cfg = await (await request.get("/api/event-languages?event=demo")).json();
    test.skip(cfg.configured, "a room server is configured in this build");
    await page.goto("/operator?mode=original");
    await page.getByTestId("setup-primary").click();
    await expect(page.getByTestId("session-tally")).toHaveText("On air");
    await expect(page.getByTestId("tally-en")).toHaveText("Original");
    await expect
      .poll(async () => Number(await page.getByTestId("meter-input").getAttribute("data-level")), { timeout: 5000 })
      .toBeGreaterThan(0.01);
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("session-tally")).toHaveText("Off air");
  });
});

test.describe("operator audio section", () => {
  for (const view of ["desk", "rows"]) {
    for (const theme of THEMES) {
      test(`${view} view, ${theme} theme: input, output, level, monitor and refresh stay on the live screen`, async ({ page, request }, info) => {
        test.skip(await roomServerConfigured(request, info), "a room server is configured in this build");
        await setPrefs(page, { "lt.view.operator": view, "lt.theme": theme });
        await page.goto("/operator?mode=original");
        await page.getByTestId("setup-primary").click();
        await expect(page.getByTestId("session-tally")).toHaveText("On air");
        await expect(page.getByTestId(`${view}-view`)).toBeVisible();

        const audio = page.getByTestId("audio-section");
        await expect(audio).toBeVisible();
        // Not behind a toggle or a collapsed panel.
        expect(await audio.evaluate((el) => el.closest("details") === null)).toBe(true);
        await expect(page.getByRole("button", { name: "Change input" })).toHaveCount(0);

        await expect(audio.getByTestId("audio-input")).toBeEnabled();
        await expect(audio.getByTestId("audio-input").locator("option").first()).toHaveText("System default microphone");
        const output = audio.getByTestId("audio-output");
        await expect(output).toBeVisible();
        const sinkSupported = await page.evaluate(() => "setSinkId" in HTMLMediaElement.prototype);
        if (sinkSupported) await expect(output).toBeEnabled();
        else await expect(audio).toContainText("not supported in this browser");
        await expect
          .poll(async () => Number(await audio.getByTestId("audio-meter").getAttribute("data-level")), { timeout: 5000 })
          .toBeGreaterThan(0.01);

        const monitor = audio.getByTestId("audio-monitor");
        await expect(monitor.getByRole("radio", { name: "Program" })).toHaveAttribute("aria-checked", "true");
        await monitor.getByRole("radio", { name: "Mute" }).click();
        await expect(monitor.getByRole("radio", { name: "Mute" })).toHaveAttribute("aria-checked", "true");
        await expect(page.getByTestId("monitor-local")).toHaveAttribute("aria-pressed", "false");
        await monitor.getByRole("radio", { name: "Input" }).click();
        await expect(monitor.getByRole("radio", { name: "Input" })).toHaveAttribute("aria-checked", "true");
        await expect(audio.getByTestId("audio-refresh")).toBeEnabled();
        await audio.getByTestId("audio-refresh").click();
        await expect(audio.getByTestId("audio-refresh")).toHaveText("Refresh devices");

        // Room controls in the bar; without a room server, Stop ends the local session.
        await expect(page.getByTestId("primary-action")).toBeVisible();
        await page.waitForTimeout(300);
        await expectContrast(page);
        await expectNoEmDash(page);
        await expectNoHorizontalScroll(page);
      });
    }
  }
});

test.describe("listener without keys", () => {
  test("an unavailable server reads as a plain sentence", async ({ page, request }) => {
    const cfg = await (await request.get("/api/event-languages?event=demo")).json();
    test.skip(cfg.configured, "a room server is configured in this build");
    await page.goto("/listen/demo-es");
    await page.getByTestId("listen-button").click();
    await expect(page.getByTestId("listener-status-live")).toHaveText(
      "Traducción no disponible. El personal del evento puede ayudar.",
    );
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/LIVEKIT|API_KEY|error|500/i);
    await expect(page.getByTestId("listen-button")).toBeVisible();
  });

  test("status lives in a polite live region; controls sit in the thumb zone", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "phone layout");
    await page.goto("/listen/demo-es");
    await expect(page.getByRole("status")).toHaveText("Audio sin iniciar.");
    const box = await page.getByTestId("listen-button").boundingBox();
    const vh = page.viewportSize()!.height;
    expect(box!.height).toBeGreaterThanOrEqual(56);
    expect(box!.y).toBeGreaterThan(vh * 0.6);
  });

  test("the interface language can be switched by hand", async ({ page }) => {
    await page.goto("/listen/demo-es");
    await expect(page.getByTestId("listen-button")).toHaveText("Escuchar");
    await openListenerOptions(page);
    await page.getByTestId("ui-lang-switch").getByRole("radio", { name: "English" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("options-sheet")).toBeHidden();
    await expect(page.getByTestId("listen-button")).toHaveText("Listen");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("the main screen keeps only title, language, captions, status and the primary control", async ({ page }) => {
    await page.route("**/api/event-languages?**", (route) => route.fulfill({ json: LIVE }));
    await page.goto("/listen/demo-es?event=demo");
    await expect(page.getByTestId("language-button")).toContainText("Español");
    await expect(page.getByTestId("caption-stage")).toBeVisible();
    await expect(page.getByTestId("listener-status-line")).toHaveText("Audio sin iniciar.");
    // No duplicate level indicator, channel grid or inline switches in Captions.
    await expect(page.getByTestId("listener-meter")).toHaveCount(0);
    await expect(page.getByTestId("channel-buttons")).toHaveCount(0);
    await expect(page.getByRole("radiogroup")).toHaveCount(0);
    // The language button lists the event's languages with their state.
    await page.getByTestId("language-button").click();
    await expect(page.getByTestId("channel-pt")).toContainText("En pausa");
    await expect(page.getByTestId("channel-es")).toHaveAttribute("aria-current", "true");
  });
});
