import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("installs demo, applies update and opens the site offline", async ({ page, context }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true });

  await page.locator("#demoButton").click();
  await expect(page.locator("#installedState")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");

  const chooser = page.waitForEvent("filechooser");
  await page.locator("#fastUpdateButton").click();
  await (await chooser).setFiles(fileURLToPath(new URL("../test/fixtures/gamespace-update.zip", import.meta.url)));
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

  // Reports remain accessible through the menu after removing the viewer shortcut.
  await gameFrame.evaluate(() => window.dispatchEvent(new ErrorEvent("error", {
    message: "Viewer menu diagnostic fixture", error: new Error("Viewer menu diagnostic fixture"),
  })));
  await page.locator("#viewerClose").click();
  await expect(page.locator("#viewer")).toBeHidden();
  await page.locator("#lastErrorButton").click();
  await expect(page.locator("#diagnosticText")).toHaveValue(/Viewer menu diagnostic fixture/);
  await page.locator("#diagnosticClose").click();

  // Hiding the toolbar leaves no shortcut; returning to the app reveals it.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator("#openSiteButton").click();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
  await expect(page.locator("#viewerMenuToggle")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  await expect(page.locator("#viewerToolbar")).not.toHaveClass(/is-hidden/);
  await page.locator("#viewerClose").click();
  await expect(page.locator("#viewer")).toBeHidden();
  await page.locator("#manualReportButton").click();
  await expect(page.locator("#diagnosticText")).toHaveValue(/Viewer menu diagnostic fixture/);
  await page.locator("#diagnosticClose").click();
});
