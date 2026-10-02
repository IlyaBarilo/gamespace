import { test, expect, chromium } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compatibilityCode } from "../src/compatibility-report.js";

test("browser launch imports 7z, records a successful check and keeps its mode in fullscreen", async ({ page, context }, testInfo) => {
  page.on("dialog", dialog => dialog.accept());
  await page.goto("./");
  await expect(page.locator("#landingPage")).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator("#openBrowserButton")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("landing-mobile.png"), fullPage: true });
  await page.locator("#openBrowserButton").click();
  await expect(page).toHaveURL(/\?launch=browser$/);
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  await expect(page.locator("#browserLaunchHint")).toBeVisible();
  await expect(page.locator("#browserInstallLink")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("browser-settings-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("browser-settings-desktop.png"), fullPage: true });

  await page.locator("#demoButton").click();
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе", { timeout: 90_000 });
  await page.locator("#openSiteButton").click();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gamespace:compatibility-check:v1")).data.steps.storefront)).toBe("success");
  await page.locator("#viewerFullscreen").click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(page.locator("#viewerFullscreen")).toHaveAttribute("aria-pressed", "true");
  await page.frameLocator("#siteFrame").locator('a[href*="tictac"]').first().click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gamespace:compatibility-check:v1")).data.steps.game)).toBe("recorded");
  // Reveal the toolbar through the app's settings entry before its countdown expires.
  await page.locator("#viewerClose").click();
  await page.locator("#compatibilityButton").click();
  await expect(page.locator("#compatibilityText")).toHaveValue(/ИТОГ: базовая проверка пройдена/);
  const report = await page.locator("#compatibilityText").inputValue();
  expect(report).toContain("запуск: вкладка браузера");
  expect(report).not.toContain("запуск: установленное приложение");
  const split = report.lastIndexOf("Целостность текста: ");
  expect(report.slice(split + "Целостность текста: ".length)).toBe(await compatibilityCode(report.slice(0, split).trimEnd()));
  await expect(page.locator("#compatibilitySummary")).toHaveAttribute("data-state", "success");
  await page.locator("#compatibilityClose").click();
  await page.locator("#fullscreenButton").click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(async () => (await fetch("./demo.7z")).status)).toBe(200);
});

test("installed display and browser display share imported content and game saves in one Chromium profile", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.goto("./?launch=browser");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  const zip = new ZipWriter(new BlobWriter());
  await zip.add("index.html", new TextReader('<!doctype html><p id="saved"></p><script>document.querySelector("#saved").textContent=localStorage.getItem("browser-save")||"empty";</script>'));
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#chooseArchiveButton").click();
  await (await chooser).setFiles({ name: "browser-site.zip", mimeType: "application/zip", buffer });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await page.evaluate(() => localStorage.setItem("browser-save", "saved in browser"));
  await page.locator("#openSiteButton").click();
  await expect(page.frameLocator("#siteFrame").locator("#saved")).toHaveText("saved in browser");
  const revision = await page.evaluate(() => JSON.parse(localStorage.getItem("gamespace:compatibility-check:v1")).contentKey);
  // Headless Chromium cannot install an OS launcher; emulate only the display signal.
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.frameLocator("#siteFrame").locator("#saved")).toHaveText("saved in browser");
  await page.locator("#viewerClose").click();
  await expect(page.locator("#browserLaunchHint")).toBeHidden();
  await expect(page.locator("#installedState")).toBeVisible();
  expect(revision).not.toBe("");
  await page.locator("#compatibilityButton").click();
  await expect(page.locator("#compatibilityText")).toHaveValue(/запуск: установленное приложение/);
  // Changing launch mode requires new observations, even though the files are shared.
  await expect(page.locator("#compatibilityText")).toHaveValue(/импорт: не выполнено/);
});

test("fullscreen denial gives a fallback without preventing import", async ({ page }) => {
  await page.goto("./?launch=browser");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = () => Promise.reject(new Error("denied"));
  });
  let hint = "";
  page.once("dialog", async dialog => { hint = dialog.message(); await dialog.accept(); });
  await page.locator("#fullscreenButton").click();
  expect(hint).toContain("F11");
  await expect(page.locator("#fullscreenButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#chooseArchiveButton")).toBeEnabled();
});

test("a saved browser URL opens content after a cold offline browser restart", async ({ baseURL }) => {
  const tempRoot = await realpath(tmpdir());
  const profile = await mkdtemp(path.join(tempRoot, "gs-pwa-browser-"));
  const browserUrl = new URL("?launch=browser", baseURL).href;
  let context = await chromium.launchPersistentContext(profile, { headless: true });
  try {
    const page = context.pages()[0];
    page.on("dialog", dialog => dialog.accept());
    await page.goto(browserUrl);
    await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
    const zip = new ZipWriter(new BlobWriter());
    await zip.add("index.html", new TextReader("<!doctype html><h1>Browser offline content</h1>"));
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#chooseArchiveButton").click();
    await (await chooser).setFiles({ name: "offline.zip", mimeType: "application/zip", buffer: Buffer.from(await (await zip.close()).arrayBuffer()) });
    await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
    await page.evaluate(() => localStorage.setItem("cold-browser-save", "preserved"));
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true });
    await context.setOffline(true);
    const restarted = context.pages()[0];
    await restarted.goto(browserUrl);
    await expect(restarted.locator("#viewerLoading")).toBeHidden();
    await expect(restarted.frameLocator("#siteFrame").locator("h1")).toHaveText("Browser offline content");
    expect(await restarted.evaluate(() => localStorage.getItem("cold-browser-save"))).toBe("preserved");
    await restarted.locator("#viewerClose").click();
    await expect(restarted.locator("#browserLaunchHint")).toBeVisible();
    expect(await restarted.evaluate(() => navigator.standalone === true)).toBe(false);
  } finally {
    await context.close();
    const resolved = await realpath(profile);
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith("gs-pwa-browser-")) throw new Error("Unexpected browser profile path");
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
});
