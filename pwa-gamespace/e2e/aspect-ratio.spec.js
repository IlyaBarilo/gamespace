import { test, expect } from "@playwright/test";

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
