import { test, expect } from "@playwright/test";

test("installs demo, applies update and opens the site offline", async ({ page, context }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/?gamespaceMode=app&gamespaceE2E=1");
  await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true });

  await page.locator("#demoButton").click();
  await expect(page.locator("#installedState")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");

  await page.locator("#e2eUpdateFixture").click();
  await expect(page.locator("#progressPanel")).toBeVisible();
  await expect(page.locator("#progressPhase")).toHaveText("Готово", { timeout: 90_000 });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе", { timeout: 90_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch("./__gamespace_content__/site/update-marker.txt", { cache: "no-store" });
    return response.ok ? response.text() : "";
  }), { timeout: 20_000 }).toContain("update archive applied successfully");

  await expect(page.locator("#progressPanel")).toBeHidden();
  await context.setOffline(true);
  await page.locator("#openSiteButton").click();
  await expect(page.locator("#viewer")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#siteFrame")).toBeVisible();
  await expect(page.locator("#viewerLoading")).toBeHidden();

  const gameFrame = page.frames().find((frame) => frame.url().includes("/__gamespace_content__/"));
  expect(gameFrame).toBeTruthy();
  await gameFrame.evaluate(() => localStorage.setItem("gamespace-e2e-save", "saved"));
  await Promise.all([
    gameFrame.waitForNavigation(),
    gameFrame.evaluate(() => location.reload()),
  ]);
  expect(await gameFrame.evaluate(() => localStorage.getItem("gamespace-e2e-save"))).toBe("saved");
});
