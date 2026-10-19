import { defineConfig, devices } from "@playwright/test";

// Runs against a production build: `npm run build` first, then `npm run test:e2e`.
// The room-server suite (tests/e2e/livekit.spec.ts) runs only with
// E2E_LIVEKIT=1 and a build made with a LiveKit dev server configured.
const PORT = Number(process.env.E2E_PORT ?? 3100);

const media = {
  locale: "en-US",
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...media } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...media } },
  ],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
