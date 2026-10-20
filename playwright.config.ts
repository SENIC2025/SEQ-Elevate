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
 *
 * A second server runs past the 1 December cut-off (D67): the same build
 * and database with RESTRUCTURE_CLOSED_FROM in the past, on its own port
 * (E2E_CUTOFF_PORT, else E2E_PORT + 10). Only the `cutoff` project
 * (r2-cutoff.spec.ts) uses it; every other spec runs before the cut-off.
 */
const PORT = process.env.E2E_PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;
const CUTOFF_PORT = process.env.E2E_CUTOFF_PORT ?? String(Number(PORT) + 10);
const CUTOFF_URL = `http://localhost:${CUTOFF_PORT}`;
const CUTOFF_SPEC = /r2-cutoff\.spec\.ts$/;

// Demo login now requires an explicit access code off the demo host
// (safe-by-default on real prod); set it so the demo-access E2E can sign in.
// ADMIN_EMAILS lists the one address the workspace-hub spec uses to prove
// the self-healing admin bootstrap (D26); it elevates no one else.
// RESEND_API_KEY is forced to the placeholder so tests can NEVER send real
// email (sign-in links / invitations are logged instead) — even when a
// developer's .env.local holds the real key.
const SERVER_ENV = {
  ...process.env,
  DEMO_ACCESS_CODE: "elevate-demo",
  ADMIN_EMAILS: "e2e-bootstrap-admin@example.com",
  RESEND_API_KEY: "re_placeholder",
};

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
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: CUTOFF_SPEC },
    { name: "cutoff", use: { ...devices["Desktop Chrome"], baseURL: CUTOFF_URL }, testMatch: CUTOFF_SPEC },
  ],
  webServer: [
    {
      // Production server starts instantly (no per-request compilation).
      // Build first: `pnpm build`. CI builds before the e2e step.
      command: `pnpm start --port ${PORT}`,
      env: SERVER_ENV,
      url: `${BASE_URL}/en`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm start --port ${CUTOFF_PORT}`,
      env: { ...SERVER_ENV, RESTRUCTURE_CLOSED_FROM: "2020-01-01T00:00:00Z" },
      url: `${CUTOFF_URL}/en`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
