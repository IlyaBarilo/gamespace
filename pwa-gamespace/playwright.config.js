import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.js",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "line",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    // Loopback remains a secure context; .2 avoids the immutable runtime's
    // localhost / 127.0.0.1 development fallback without modifying that runtime.
    baseURL: "http://127.0.0.2:4177/gamespace/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node scripts/serve-e2e-release.mjs",
    url: "http://127.0.0.2:4177/gamespace/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
