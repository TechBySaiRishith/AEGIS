import { test, expect } from "@playwright/test";

test("opens chat, sends a message, receives a mock reply, persists on reload", async ({ page }) => {
  // Navigate to the evaluations list and click the first evaluation
  await page.goto("/evaluations");
  await page.getByRole("link").first().click();

  // Wait for the page to finish loading (completed status unlocks the button)
  await page.waitForURL(/\/evaluations\//);

  // Click "Ask AEGIS" — only enabled when evaluation is completed
  await page.getByRole("button", { name: /Ask AEGIS/i }).click();

  // Fill the composer textarea and submit with ⌘↵
  await page.getByPlaceholder(/ask anything/i).fill("hello");
  await page.keyboard.press("Meta+Enter");

  // The mock provider streams "Mock reply" — wait for it to appear
  await expect(page.getByText(/Mock reply/i)).toBeVisible({ timeout: 15_000 });

  // Reload and reopen the drawer — messages should persist from the DB
  await page.reload();
  await page.getByRole("button", { name: /Ask AEGIS/i }).click();
  await expect(page.getByText(/Mock reply/i)).toBeVisible();
});
