import { test, expect } from "@playwright/test";

async function openDemo(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await page.locator('[data-archive-id="builtin-demo"] [data-archive-action="open"]').click();
  await expect(page.frameLocator("#siteFrame").locator("#demoMenuButton")).toBeVisible();
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  test(`demo opens the real app menu and keeps saves offline at ${viewport.width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    await openDemo(page);
    const frame = page.frameLocator("#siteFrame");
    await expect(frame.locator(".demo-note-title")).toHaveText("Встроенный демо-архив витрины игр");
    await expect(frame.locator(".demo-note p")).toHaveText("Свой архив можно загрузить через меню GameSpace.");
    expect(await frame.locator(".demo-note").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await frame.locator("#demoMenuButton").evaluate(() => localStorage.setItem("demo-menu-save", "LEVEL 5"));

    // Neither another window nor a foreign origin may close the content view.
    await page.evaluate(async () => {
      window.postMessage({ type: "gamespaceOpenMenu" }, location.origin);
      await new Promise(resolve => setTimeout(resolve, 0));
      window.dispatchEvent(new MessageEvent("message", {
        source: document.querySelector("#siteFrame").contentWindow,
        origin: "https://other.invalid",
        data: { type: "gamespaceOpenMenu" },
      }));
    });
    await expect(page.locator("#viewer")).toBeVisible();
    await page.locator("#siteFrame").screenshot({ path: testInfo.outputPath("demo-menu-entry.png") });

    await frame.locator("#demoMenuButton").click();
    await expect(page.locator("#viewer")).toBeHidden();
    await expect(page.locator("#appShell")).toBeVisible();
    await expect(page.locator("#addArchiveButton")).toBeEnabled();
    await expect(page.locator("#appMenuClose")).toBeEnabled();
    await expect(page.locator("#siteFrame")).toHaveAttribute("src", "about:blank");
    await page.locator("#compatibilityButton").click();
    await expect(page.locator("#compatibilityStep_game")).toHaveText("пока не выполнено");
    await page.locator("#compatibilityClose").click();

    await context.setOffline(true);
    await page.locator("#appMenuClose").click();
    await expect(page.frameLocator("#siteFrame").locator("#demoMenuButton")).toBeVisible();
    expect(await page.frameLocator("#siteFrame").locator("#demoMenuButton").evaluate(() => localStorage.getItem("demo-menu-save"))).toBe("LEVEL 5");
    await page.frameLocator("#siteFrame").locator("#demoMenuButton").click();
    await expect(page.locator("#viewer")).toBeHidden();
    await expect(page.locator("#addArchiveButton")).toBeEnabled();
    await expect(page.locator("#appMenuClose")).toBeEnabled();
  });
}

test("standalone demo keeps its explanation and hides the unavailable app menu", async ({ page, context }) => {
  await openDemo(page);
  const contentUrl = await page.locator("#siteFrame").getAttribute("src");
  await page.frameLocator("#siteFrame").locator("#demoMenuButton").click();
  const standalone = await context.newPage();
  await standalone.goto(contentUrl);
  await expect(standalone.locator(".game-card").first()).toBeVisible();
  await expect(standalone.locator(".demo-note-title")).toBeVisible();
  await expect(standalone.locator("#demoMenuButton")).toBeHidden();
  await standalone.close();
});
