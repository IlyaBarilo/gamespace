import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

test("bundled demo remains installable offline after a custom archive", async ({ page, context }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  await expect(page.locator("#restoreDemoButton")).toBeHidden();

  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("index.html", new TextReader("<!doctype html><title>Custom archive</title><h1>custom-site-marker</h1>"));
  const buffer = Buffer.from(await (await writer.close()).arrayBuffer());
  page.once("dialog", dialog => dialog.accept());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#chooseArchiveButton").click();
  await (await chooser).setFiles({ name: "custom-site.zip", mimeType: "application/zip", buffer });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#viewer")).toBeVisible();
  await page.locator("#viewerClose").click();
  await expect(page.locator("#restoreDemoButton")).toBeVisible();
  await expect(page.locator("#restoreDemoButton")).toBeEnabled();
  await expect(page.locator("#demoButton")).toBeHidden();

  async function requestReplacement(accept) {
    const pendingDialog = page.waitForEvent("dialog");
    const click = page.locator("#restoreDemoButton").click();
    const dialog = await pendingDialog;
    expect(dialog.message()).toContain("Полностью заменить установленный сайт");
    expect(dialog.message()).toContain("Встроенный демо-сайт");
    if (accept) await dialog.accept();
    else await dialog.dismiss();
    await click;
  }

  await requestReplacement(false);
  await expect(page.locator("#restoreDemoButton")).toBeEnabled();
  await expect(page.locator("#infoArchive")).toHaveText("custom-site.zip");
  expect(await page.evaluate(async () => (await fetch("./__gamespace_content__/index.html")).text()))
    .toContain("custom-site-marker");

  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator("#restoreDemoButton").scrollIntoViewIfNeeded();
  const actions = page.locator(".action-stack");
  expect(await actions.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await actions.screenshot({ path: testInfo.outputPath("demo-action-mobile.png") });

  await requestReplacement(true);
  await expect(page.locator("#infoArchive")).toHaveText("Встроенный демо-сайт (demo.7z)", { timeout: 90_000 });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await expect(page.locator("#restoreDemoButton")).toBeEnabled();
  await expect(page.locator("#errorPanel")).toBeHidden();
  expect(await page.evaluate(async () => (await fetch("./__gamespace_content__/games/tictac/game.html")).ok)).toBe(true);
  const demo = await page.evaluate(async () => {
    const response = await fetch("./demo.7z");
    return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
  });
  expect(demo.ok).toBe(true);
  expect(demo.bytes).toBeGreaterThan(0);
});
