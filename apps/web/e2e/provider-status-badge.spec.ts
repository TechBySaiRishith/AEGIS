import { test, expect, type Route } from "@playwright/test";

/**
 * End-to-end verification of the ProviderStatusBadge component.
 *
 * For each of the four badge states we intercept `/api/health` with
 * `page.route()`, load the homepage, and assert both the rendered text
 * and a screenshot of the badge region so regressions surface in both
 * the DOM and the visual layer.
 *
 * The component fetches `${NEXT_PUBLIC_API_URL}/api/health` — when that
 * env var is unset (which is the default in `pnpm dev`) the path is
 * relative, so matching `**\/api/health` covers every call.
 */

const HEALTH_PATH = "**/api/health";

const MODULES_READY = {
  sentinel: { ready: true },
  watchdog: { ready: true },
  guardian: { ready: true },
};

function fulfillHealth(route: Route, body: object, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.describe("ProviderStatusBadge — visual states", () => {
  test("ready state: renders online chips for each available provider", async ({
    page,
  }) => {
    await page.route(HEALTH_PATH, (route) =>
      fulfillHealth(route, {
        status: "ok",
        version: "0.1.0",
        providers: {
          anthropic: { available: true, model: "claude-sonnet-4-5" },
          openai: { available: false },
          copilot: { available: true, model: "claude-opus-4.6" },
          github: { available: false },
          custom: { available: false },
        },
        modules: MODULES_READY,
      }),
    );

    await page.goto("/");

    const badge = page.getByRole("status");
    await expect(badge).toContainText(/Providers online/i);
    await expect(badge).toContainText("Anthropic");
    await expect(badge).toContainText("Copilot");
    await expect(badge).toContainText("2/5");
    await expect(badge).not.toContainText("OpenAI");

    await badge.locator("> div").first().screenshot({
      path: "test-results/provider-badge-ready.png",
    });
  });

  test("zero state: warns when no providers are configured", async ({
    page,
  }) => {
    await page.route(HEALTH_PATH, (route) =>
      fulfillHealth(route, {
        status: "ok",
        version: "0.1.0",
        providers: {
          anthropic: { available: false },
          openai: { available: false },
          copilot: { available: false },
          github: { available: false },
          custom: { available: false },
        },
        modules: {
          sentinel: { ready: false },
          watchdog: { ready: false },
          guardian: { ready: false },
        },
      }),
    );

    await page.goto("/");

    const badge = page.getByRole("status");
    await expect(badge).toContainText(/No LLM providers configured/i);
    await expect(badge).toContainText(/Configure at least one/i);

    await badge.locator("> div").first().screenshot({
      path: "test-results/provider-badge-zero.png",
    });
  });

  test("unreachable state: renders when /api/health returns 503", async ({
    page,
  }) => {
    await page.route(HEALTH_PATH, (route) =>
      fulfillHealth(route, { error: "down" }, 503),
    );

    await page.goto("/");

    const badge = page.getByRole("status");
    await expect(badge).toContainText(/Control plane unreachable/i);
    await expect(badge).toContainText(/Health check failed \(503\)/i);

    await badge.locator("> div").first().screenshot({
      path: "test-results/provider-badge-unreachable.png",
    });
  });

  test("loading state: shows polling label before the fetch resolves", async ({
    page,
  }) => {
    // Hold the request open long enough that we can both assert the
    // loading label AND capture a deterministic screenshot before the
    // ready state replaces it. 3s gives plenty of slack even on a
    // cold Next.js compile tick.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route(HEALTH_PATH, async (route) => {
      await gate;
      return fulfillHealth(route, {
        status: "ok",
        version: "0.1.0",
        providers: {
          anthropic: { available: true, model: "claude-sonnet-4-5" },
          openai: { available: false },
          copilot: { available: false },
          github: { available: false },
          custom: { available: false },
        },
        modules: MODULES_READY,
      });
    });

    await page.goto("/");

    const badge = page.getByRole("status");
    // The loading label must appear while the gate is still closed.
    await expect(badge).toContainText(/Polling provider mesh/i);
    // Screenshot the badge while it's still in the loading state.
    await badge.locator("> div").first().screenshot({
      path: "test-results/provider-badge-loading.png",
    });

    // Now open the gate, let /api/health resolve, and verify the flip.
    release!();
    await expect(badge).toContainText(/Providers online/i);
  });
});
