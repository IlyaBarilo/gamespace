import { expect } from "@playwright/test";

export async function openViewerSettings(page) {
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  const toolbar = page.locator("#viewerToolbar");
  if (await toolbar.getAttribute("aria-hidden") === "true") {
    await page.locator("#viewerMenuTab").click();
  }
  await expect(toolbar).toHaveAttribute("aria-hidden", "false");
  await page.locator("#viewerClose").click();
  await expect(page.locator("#viewer")).toBeHidden();
}
