import { expect, test } from "@playwright/test";
import { expectContrast } from "./helpers";

// Needs a LiveKit dev server and a build made with it, for example:
//   docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
//     livekit/livekit-server --dev --bind 0.0.0.0 --node-ip 127.0.0.1
//   NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey \
//     LIVEKIT_API_SECRET=secret npm run build
//   E2E_LIVEKIT=1 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npx playwright test livekit
// The original audio channel needs no translation key, so the whole chain
// (operator, room, event page, listener) runs with the fake microphone.

test.skip(!process.env.E2E_LIVEKIT, "set E2E_LIVEKIT=1 with a LiveKit dev server");
test.describe.configure({ mode: "serial" });

function decodeGrants(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).video;
}

test("listener tokens are subscribe-only; operator tokens may publish status", async ({ request }) => {
  const listen = await (await request.get("/api/listen-token?room=e2e-es")).json();
  const lg = decodeGrants(listen.token);
  expect(lg).toMatchObject({ room: "e2e-es", canSubscribe: true, canPublish: false, canPublishData: false });
  expect(lg.canUpdateOwnMetadata).toBeFalsy();
  const pub = await (await request.post("/api/publish-token", { data: { room: "e2e-es" } })).json();
  expect(decodeGrants(pub.token)).toMatchObject({ canPublish: true, canSubscribe: false, canUpdateOwnMetadata: true });
});

test("operator to listener: live, paused, ended", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium", "one run drives both surfaces");
  const event = `e2e-${Date.now().toString(36)}`;
  const opCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  const op = await opCtx.newPage();
  await op.goto(`/operator?event=${event}&lang=es&mode=original&title=E2E%20talk`);
  await op.getByTestId("setup-primary").click();
  await expect(op.getByTestId("session-tally")).toHaveText("Room open");
  await expect(op.getByTestId("event-url")).toContainText(`/e/${event}`);

  const lisCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-MX" });
  // The level meter lives in the Receiver view.
  await lisCtx.addInitScript(() => localStorage.setItem("lt.view.listener", "receiver"));
  const lis = await lisCtx.newPage();
  // The event page polls every 15 s; give the first poll time to see the status.
  await expect.poll(async () => (await (await lis.request.get(`/api/event-languages?event=${event}`)).json()).title, { timeout: 10_000 }).toBe("E2E talk");
  await lis.goto(`/e/${event}`);
  await expect(lis.getByText("E2E talk")).toBeVisible({ timeout: 10_000 });
  await expect(lis.getByRole("link", { name: /Español/ })).toContainText("En espera");
  await lis.getByRole("link", { name: /Español/ }).click();
  await lis.getByTestId("listen-button").click();
  await expect(lis.getByTestId("listener-status-live")).toHaveText(
    "Transmisión sin iniciar; el audio comienza automáticamente.",
  );
  await expect(op.getByTestId("session-bar")).toContainText("1");

  await op.getByTestId("primary-action").click();
  await expect(op.getByTestId("session-tally")).toHaveText("On air");
  await expect(lis.getByTestId("listener-tally")).toHaveText("En vivo", { timeout: 10_000 });
  await expect
    .poll(async () => Number(await lis.getByTestId("listener-meter").getAttribute("data-level")), { timeout: 8000 })
    .toBeGreaterThan(0.01);
  await expectContrast(lis);

  await op.getByTestId("primary-action").click();
  await expect(lis.getByTestId("listener-tally")).toHaveText("En pausa entre ponentes.", { timeout: 10_000 });

  await op.getByTestId("end-session").click();
  await op.getByTestId("confirm-end").click();
  await expect(lis.getByTestId("listener-tally")).toHaveText("Sesión finalizada.", { timeout: 10_000 });
  await expect(op.getByTestId("session-tally")).toHaveText("Off air");
  await opCtx.close();
  await lisCtx.close();
});

test("the operator desk reads the event's other languages", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium", "desktop operator");
  const event = `e2e-${Date.now().toString(36)}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  const en = await ctx.newPage();
  await en.goto(`/operator?event=${event}&lang=en&mode=original`);
  await en.getByTestId("setup-primary").click();
  await en.getByTestId("primary-action").click();
  await expect(en.getByTestId("session-tally")).toHaveText("On air");

  const es = await ctx.newPage();
  await es.goto(`/operator?event=${event}&lang=es&mode=original`);
  await es.getByTestId("setup-primary").click();
  await expect(es.getByTestId("strip-en")).toBeVisible({ timeout: 15_000 });
  // Up to one 5 s server cache plus one 5 s poll.
  await expect(es.getByTestId("tally-en")).toHaveText("Original", { timeout: 15_000 });
  await expect(es.getByTestId("strip-en")).toContainText("Other tab");
  await expect(es.getByTestId("source-note")).toContainText("room server");
  await es.getByTestId("settings-button").click();
  await es.getByRole("radio", { name: "Rows" }).click();
  await expect(es.getByTestId("row-en")).toContainText("Other tab");
  await ctx.close();
});
