import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

test("aspect ratio selection controls content width and survives reload", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  const select = page.locator("#viewerAspectRatio");
  await expect(select).toHaveValue("auto");
  for (const [value, width] of [["auto", 1920], ["9:16", 607.5], ["10:16", 675], ["16:9", 1920], ["16:10", 1728]]) {
    await select.selectOption(value);
    await page.locator("#appMenuClose").click();
    await expect(page.locator("#viewer")).toBeVisible();
    await expect.poll(async () => page.locator(".viewer-content-frame").evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(width, 0);
    const box = await page.locator(".viewer-content-frame").boundingBox();
    expect(box.x).toBeCloseTo((1920 - width) / 2, 0);
    await page.locator("#viewerClose").click();
  }
  await page.reload();
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await expect(select).toHaveValue("16:10");
  await expect(page.locator("#viewer")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.locator(".viewer-content-frame").evaluate(el => el.getBoundingClientRect().width)).toBe(390);
  await expect(page.locator("#viewer")).not.toHaveClass(/is-portrait-frame-mode/);
});

test("per-game display restores the catalog and does not leak to the next game", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  await zip.add("index.html", new TextReader('<style>body{padding-top:100px}</style><a href="game.html?gamespaceDisplay=portrait">Portrait</a><a href="game.html">Auto</a>'));
  await zip.add("game.html", new TextReader('<style>body{padding-top:100px}</style><button onclick="parent.postMessage({type:\'gameExit\'}, location.origin)">Exit</button>'));
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name: "display.zip", mimeType: "application/zip", buffer });
  await expect(page.locator(".archive-entry")).toHaveCount(2);
  await expect(page.locator("#appMenuClose")).toBeEnabled();
  await page.locator("#viewerAspectRatio").selectOption("16:10");
  await page.locator("#appMenuClose").click();
  const frame = page.frameLocator("#siteFrame");
  const width = () => page.locator(".viewer-content-frame").evaluate(el => el.getBoundingClientRect().width);
  await expect.poll(width).toBe(1728);
  await frame.getByText("Portrait", { exact: true }).click();
  await expect(frame.getByText("Exit", { exact: true })).toBeVisible();
  await expect.poll(width).toBe(675);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(width).toBe(390);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(width).toBe(675);
  await frame.getByText("Exit", { exact: true }).click();
  await expect.poll(width).toBe(1728);
  await frame.getByText("Auto", { exact: true }).click();
  await expect(frame.getByText("Exit", { exact: true })).toBeVisible();
  await expect.poll(width).toBe(1728);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.locator("#viewerBack").click();
  await expect(frame.getByText("Portrait", { exact: true })).toBeVisible();
  await expect.poll(width).toBe(1728);
});
