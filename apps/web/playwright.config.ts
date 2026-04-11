import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for ProviderStatusBadge end-to-end verification.
 *
 * Spawns `next dev` on an ephemeral port, then runs the spec files
 * under `e2e/`. Requests to `/api/health` are intercepted inside each
 * test (see `e2e/provider-status-badge.spec.ts`) so no real backend
 * is needed.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4411",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec next dev -H 127.0.0.1 -p 4411",
    url: "http://127.0.0.1:4411",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
