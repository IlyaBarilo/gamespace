import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

async function getSiteFrame(page) {
  await expect.poll(async () => {
    const frameElement = await page.locator("#siteFrame").elementHandle();
    if (!frameElement) return "";
    const frame = await frameElement.contentFrame();
    return frame?.url() ?? "";
  }, { timeout: 30_000 }).toContain("/__gamespace_content__/");

  const frameElement = await page.locator("#siteFrame").elementHandle();
  return frameElement.contentFrame();
}

async function expectViewerFrameGeometry(page, landscape) {
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator(".viewer-content-frame")).toBeVisible();
  // Reopening waits for storage/worker preparation. A hidden loading indicator
  // alone is not readiness: it also remains hidden before the viewer is shown.
  await expect.poll(async () => page.locator(".viewer-content-frame").evaluate((element, landscape) => {
    const rect = element.getBoundingClientRect();
    const expectedWidth = landscape ? window.innerHeight * 10 / 16 : window.innerWidth;
    const expectedLeft = landscape ? (window.innerWidth - expectedWidth) / 2 : 0;
    return Math.max(Math.abs(rect.height - window.innerHeight), Math.abs(rect.width - expectedWidth), Math.abs(rect.left - expectedLeft));
  }, landscape)).toBeLessThanOrEqual(1);
}

test("installs demo, applies update and opens the site offline", async ({ page, context }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true });

  await page.locator("[data-archive-id=\"builtin-demo\"] [data-archive-action=\"open\"]").click();
  await expect(page.locator("#installedState")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  await page.locator("#viewerClose").click();

  const chooser = page.waitForEvent("filechooser");
  await page.locator(".archive-entry.is-active [data-archive-action=\"update\"]").click();
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
  await expect(page.locator("html")).toHaveClass(/is-viewing-site/);
  await expect(page.locator("body")).toHaveClass(/is-viewing-site/);
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("#viewerBack")).toBeDisabled();
  await expect(page.locator("#viewer")).toHaveClass(/is-portrait-frame-mode/);
  await expect(page.locator("#viewerToolbarTitle")).toBeHidden();
  await expect(page.locator("#viewerToolbar")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expectViewerFrameGeometry(page, true);

  const gameFrame = await getSiteFrame(page);
  const catalogPath = new URL(gameFrame.url()).pathname;
  await gameFrame.evaluate(() => localStorage.setItem("gamespace-e2e-save", "saved"));
  await Promise.all([
    gameFrame.waitForNavigation(),
    gameFrame.evaluate(() => location.reload()),
  ]);
  expect(await gameFrame.evaluate(() => localStorage.getItem("gamespace-e2e-save"))).toBe("saved");

  await gameFrame.evaluate(() => {
    location.href = new URL("smallgames/bashnya-oblakov.html", location.href).href;
  });
  await expect.poll(() => gameFrame.url()).toContain("smallgames/bashnya-oblakov.html");
  await gameFrame.locator("#exitButton").click();
  await expect.poll(() => new URL(gameFrame.url()).pathname).toBe(catalogPath);
  await expect(gameFrame.locator(".game-card").first()).toBeVisible();
  await expect(page.locator("#viewerBack")).toBeDisabled();
  await gameFrame.locator(".game-card").first().click();
  await expect(page.locator("#viewerBack")).toBeEnabled();
  await page.locator("#viewerBack").click();
  await expect.poll(() => new URL(gameFrame.url()).pathname).toBe(catalogPath);
  await expect(page.locator("#viewerBack")).toBeDisabled();
  await page.waitForTimeout(5_500);
  await expect(page.locator("#viewerToolbar")).toBeVisible();
  await expect(page.locator("#viewerToolbar")).not.toHaveClass(/is-hidden/);
  await expect(page.locator("#viewerMenuTab")).toBeHidden();
  await gameFrame.locator(".game-card").first().click();
  await expect(page.locator("#viewerBack")).toBeEnabled();
  await page.locator("#viewerBack").click();
  await expect.poll(() => new URL(gameFrame.url()).pathname).toBe(catalogPath);
  await expect(page.locator("#viewerBack")).toBeDisabled();

  // Reports remain accessible through the menu after removing the viewer shortcut.
  await gameFrame.evaluate(() => window.dispatchEvent(new ErrorEvent("error", {
    message: "Viewer menu diagnostic fixture", error: new Error("Viewer menu diagnostic fixture"),
  })));
  await page.locator("#viewerClose").click();
  await expect(page.locator("#viewer")).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/is-viewing-site/);
  await expect(page.locator("body")).not.toHaveClass(/is-viewing-site/);
  await page.locator("#diagnosticsTitle").click();
  await page.locator("#lastErrorButton").click();
  await expect(page.locator("#diagnosticText")).toHaveValue(/Viewer menu diagnostic fixture/);
  await page.locator("#diagnosticClose").click();

  // The optional tab is disabled by default and opens the menu directly when enabled.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#viewerMenuTabSetting")).not.toBeChecked();
  await page.locator("#viewerMenuTabSetting").check();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("gamespace:viewer-menu-tab:v1"))).toBe("1");
  await page.locator("#openSiteButton").click();
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator("#siteFrame")).toBeVisible();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  await expect(page.locator("#viewer")).not.toHaveClass(/is-portrait-frame-mode/);
  await expectViewerFrameGeometry(page, false);
  const mobileFrame = await getSiteFrame(page);
  const mobileCatalogPath = new URL(mobileFrame.url()).pathname;
  expect(new URL(mobileFrame.url()).searchParams.get("ui")).toBe("mobile");
  await mobileFrame.locator(".game-card").first().click();
  await expect.poll(() => new URL(mobileFrame.url()).searchParams.get("ui")).toBe("mobile");
  await mobileFrame.evaluate(() => window.parent.postMessage({ type: "gameExit" }, "*"));
  await expect.poll(() => new URL(mobileFrame.url()).pathname).toBe(mobileCatalogPath);
  await expect(mobileFrame.locator(".game-card").first()).toBeVisible();
  await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
  await expect(page.locator("#viewerMenuTab")).toBeVisible();
  await page.locator("#viewerMenuTab").click();
  await expect(page.locator("#viewer")).toBeHidden();
  await page.locator("#manualReportButton").click();
  await expect(page.locator("#diagnosticText")).toHaveValue(/Viewer menu diagnostic fixture/);
  await page.locator("#diagnosticClose").click();
});
