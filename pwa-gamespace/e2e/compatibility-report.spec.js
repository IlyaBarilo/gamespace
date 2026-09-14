import { test, expect, devices } from "@playwright/test";
import { compatibilityCode, COMPATIBILITY_FORM_URL } from "../src/compatibility-report.js";

async function openReport(page) {
  await page.locator("#compatibilityButton").click();
  await expect(page.locator("#compatibilityText")).toHaveValue(/Целостность текста: GS1-/);
  return page.locator("#compatibilityText").inputValue();
}
async function refreshReport(page) {
  await page.locator("#compatibilityClose").click();
  const text = await openReport(page);
  const split = text.lastIndexOf("Целостность текста: ");
  expect(text.slice(split + "Целостность текста: ".length)).toBe(await compatibilityCode(text.slice(0, split).trimEnd()));
  return text;
}

test("report is available before install, readonly, colored and sent only via the form", async ({ page, context }) => {
  await page.goto("./");
  await page.locator("#landingCompatibilityButton").click();
  await expect(page.locator("#compatibilityText")).toHaveValue(/Целостность текста: GS1-/);
  const frozen = await page.locator("#compatibilityText").inputValue();
  expect(frozen).toContain("ФОРМАТ: 1");
  expect(frozen).toContain("импорт: не выполнено");
  await expect(page.locator("#compatibilityStep_launch")).toContainText("установка пока не проверена");
  await expect(page.locator("#compatibilityText")).toHaveAttribute("readonly", "");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.locator("#compatibilityDialog").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await expect(page.getByRole("button", { name: "Обновить отчёт", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Сохранить текст", exact: true })).toHaveCount(0);
  await expect(page.locator("#compatibilityStep_launch")).toHaveCSS("color", "rgb(255, 212, 124)");
  await expect(page.locator("#compatibilityStep_import")).toHaveCSS("color", "rgb(255, 212, 124)");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route("https://forms.yandex.ru/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Test form destination</h1>" }));
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#compatibilityForm").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(COMPATIBILITY_FORM_URL);
  await popup.close();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(frozen);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.locator("#compatibilityCopy").click();
  await expect(page.locator("#compatibilityActionStatus")).toContainText("скопируйте его через меню");
  await expect(page.locator("#compatibilityFormLink")).toHaveAttribute("href", COMPATIBILITY_FORM_URL);
});

test.describe("Android form fallback", () => {
  const { defaultBrowserType, ...androidOptions } = devices["Pixel 7"];
  test.use(androidOptions);
  for (const mode of ["denied", "pending"]) {
    test(`opens the actual form when clipboard is ${mode}`, async ({ page, context }) => {
      await context.route("https://forms.yandex.ru/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Test form destination</h1>" }));
      await page.goto("./");
      await page.locator("#landingCompatibilityButton").click();
      await expect(page.locator("#compatibilityForm")).toBeEnabled();
      await page.evaluate(mode => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: () => mode === "pending" ? new Promise(() => {}) : Promise.reject(new Error("denied")),
      } }), mode);
      const popupPromise = page.waitForEvent("popup");
      await page.locator("#compatibilityForm").click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(COMPATIBILITY_FORM_URL);
      await expect(popup.locator("h1")).toHaveText("Test form destination");
      await popup.close();
      await expect(page.locator("#compatibilityText")).toHaveValue(/Целостность текста: GS1-/);
      await expect(page.locator("#compatibilityCopy")).toBeEnabled();
    });
  }
});

test("demo failure is brief; compatibility remains accessible during download and after failure", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  const frozen = await openReport(page);
  await page.locator("#compatibilityClose").click();
  // The Service Worker serves demo.7z from its cache, bypassing Playwright network routes.
  // Hold the page's fetch result to exercise the real UI and failure handler deterministically.
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (...args) => new URL(String(args[0]), location.href).pathname.endsWith("/demo.7z")
      ? new Promise(resolve => { window.finishDemoFixture = () => resolve(new Response("private diagnostic detail", { status: 503 })); })
      : original(...args);
  });
  await page.locator("#demoButton").click();
  try {
    await expect(page.locator("#compatibilityButton")).toBeEnabled();
    const pending = await openReport(page);
    expect(pending).not.toBe(frozen);
    expect(pending).toContain("импорт: не проверено");
    await expect(page.locator("#compatibilityReset")).toBeDisabled();
    expect(await refreshReport(page)).toContain("импорт: не проверено");
  } finally { await page.evaluate(() => window.finishDemoFixture?.()); }
  await expect(page.locator("#compatibilityStep_import")).toHaveText("ошибка");
  const text = await refreshReport(page);
  expect(text).toContain("этап: импорт архива; код: GS-DEMO;");
  expect(text).not.toContain("private diagnostic detail");
});

test("full demo and game transition pass; a recorded game error downgrades a refreshed report and persists", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  await page.locator("#demoButton").click();
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе", { timeout: 90_000 });
  await page.locator("#openSiteButton").click();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gamespace:compatibility-check:v1")).data.steps.storefront)).toBe("success");
  const frame = page.frameLocator("#siteFrame");
  await frame.locator('a[href*="tictac"]').first().click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gamespace:compatibility-check:v1")).data.steps.game)).toBe("recorded");
  await page.locator("#viewerClose").click();
  const success = await openReport(page);
  expect(success).toContain("ИТОГ: базовая проверка пройдена");
  await expect(page.locator("#compatibilityStep_game")).toHaveText("выполнено");
  for (const step of ["launch", "import", "storefront", "game"]) {
    await expect(page.locator(`#compatibilityStep_${step}`)).toHaveCSS("color", "rgb(110, 231, 183)");
  }
  await page.locator("#compatibilityClose").click();
  await page.locator("#openSiteButton").click();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  await frame.locator('a[href*="tictac"]').first().click();
  await expect.poll(() => page.frames().some(value => value.url().includes("/games/tictac/"))).toBe(true);
  const game = page.frames().find(value => value.url().includes("/games/tictac/"));
  await game.waitForLoadState("load");
  await expect(page.locator("#viewerLoading")).toBeHidden();
  await game.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "private /device/path", error: new Error("private /device/path") })));
  await page.locator("#viewerClose").click();
  const failed = await openReport(page);
  expect(failed).not.toBe(success);
  expect(failed).toContain("этап: переход в игру; код: GS-SCRIPT;");
  expect(failed).not.toContain("private /device/path");
  await page.reload();
  await expect(page.locator("#viewer")).toBeVisible();
  await page.locator("#viewerClose").click();
  expect(await openReport(page)).toContain("код: GS-SCRIPT;");
  await page.locator("#compatibilityReset").click();
  await expect(page.locator("#compatibilityText")).toHaveValue(/импорт: не выполнено/);
  await expect(page.locator("#compatibilityStep_game")).toHaveCSS("color", "rgb(255, 212, 124)");
});
