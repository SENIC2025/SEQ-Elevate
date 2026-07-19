import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E + accessibility (axe) config.
 *
 * Runs against a local Next dev server (the demo flows are client-state
 * driven and need no database). Run: `pnpm test:e2e`
 * (after `npx playwright install chromium`).
 *
 * Port: defaults to 3000, override with E2E_PORT. `reuseExistingServer` will
 * happily attach to whatever already holds the port — if another project's
 * dev server is on 3000, run `E2E_PORT=3100 pnpm test:e2e` instead of killing it.
 */
const PORT = process.env.E2E_PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The DB-backed tests mutate a shared database; keep worker contention low
  // so they don't race each other or starve the single dev server.
  workers: process.env.CI ? 2 : 3,
  reporter: "list",
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Production server starts instantly (no per-request compilation).
    // Build first: `pnpm build`. CI builds before the e2e step.
    command: `pnpm start --port ${PORT}`,
    url: `${BASE_URL}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
