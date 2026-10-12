import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { compatibilityCode } from "../src/compatibility-report.js";

const recordKey = id => `gamespace:compatibility-check:archive:v1:id:${encodeURIComponent(id)}`;
const row = (page, id) => page.locator(`[data-archive-id="${id}"]`);
async function app(page) {
  page.on("dialog", dialog => dialog.accept(dialog.type() === "prompt" ? "Renamed A" : undefined));
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
}
async function upload(page, name, button = "#addArchiveButton", entries = null) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, text] of Object.entries(entries || {
    "index.html": `<!doctype html><h1>${name}</h1><a href="game.html">Play</a>`,
    "game.html": `<!doctype html><h1>${name} game</h1>`,
  })) await writer.add(path, new TextReader(text));
  const buffer = Buffer.from(await (await writer.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser"); await page.locator(button).click();
  await (await chooser).setFiles({ name: `${name}.zip`, mimeType: "application/zip", buffer });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  return page.locator(".archive-entry.is-active").getAttribute("data-archive-id");
}
async function open(page, id) {
  await row(page, id).locator('[data-archive-action="open"]').click();
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toBeVisible();
  await expect(page.locator("#viewerLoading")).toBeHidden();
}
async function close(page) { if (await page.locator("#diagnosticDialog").isVisible()) await page.locator("#diagnosticClose").click(); await page.locator("#viewerClose").click(); await expect(page.locator("#viewer")).toBeHidden(); }
async function record(page, id) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), recordKey(id)); }
async function report(page) {
  if (await page.locator("#diagnosticDialog").isVisible()) await page.locator("#diagnosticClose").click();
  await page.locator("#compatibilityButton").click();
  await expect(page.locator("#compatibilityText")).toHaveValue(/Целостность текста: GS1-/);
  const text = await page.locator("#compatibilityText").inputValue();
  const split = text.lastIndexOf("Целостность текста: ");
  expect(text.slice(split + "Целостность текста: ".length)).toBe(await compatibilityCode(text.slice(0, split).trimEnd()));
  return text;
}
async function closeReport(page) { await page.locator("#compatibilityClose").click(); }

test("archive reports survive switching, shared saves, game clear, rename, reset and offline restart", async ({ page, context }, testInfo) => {
  await app(page);
  const a = await upload(page, "A");
  await open(page, a);
  await page.frameLocator("#siteFrame").getByRole("link", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await record(page, a))?.data.steps.game).toBe("recorded");
  await close(page);
  const b = await upload(page, "B");
  await open(page, b);
  await page.frameLocator("#siteFrame").locator("h1").evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "private path", error: new Error("private path") })));
  await expect.poll(async () => (await record(page, b))?.data.error).toBe("script");
  await close(page);
  await page.locator("#sharedLocalStorageSetting").check();
  await expect(page.locator("#statusText")).toHaveText("Включён единый localStorage");
  await row(page, a).locator('[data-archive-action="rename"]').click();
  await expect(row(page, a).locator("h3")).toHaveText("Renamed A");
  await open(page, a);
  await page.locator("#siteFrame").evaluate(frame => frame.contentWindow.localStorage.clear());
  await close(page);
  expect(await report(page)).toContain("ИТОГ: базовая проверка пройдена");
  await expect(page.locator("#compatibilityScope")).toContainText("Renamed A");
  await page.locator("#compatibilityDialog").screenshot({ path: testInfo.outputPath("archive-compatibility-report.png") });
  await closeReport(page);
  await open(page, b); await close(page);
  expect(await report(page)).toContain("код: GS-SCRIPT;");
  await expect(page.locator("#compatibilityScope")).toContainText("B.zip");
  await page.locator("#compatibilityReset").click();
  await expect(page.locator("#compatibilityText")).toHaveValue(/импорт: не выполнено/);
  await closeReport(page);
  await open(page, a); await close(page);
  expect(await report(page)).toContain("ИТОГ: базовая проверка пройдена");
  await closeReport(page);
  await context.setOffline(true); await page.reload();
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("A");
  await close(page);
  expect(await report(page)).toContain("ИТОГ: базовая проверка пройдена");
});

test("failed replacement preserves a passed report; successful updates and deletion affect only their archive", async ({ page }) => {
  await app(page);
  const a = await upload(page, "A");
  await open(page, a); await page.frameLocator("#siteFrame").getByRole("link", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await record(page, a))?.data.steps.game).toBe("recorded");
  await close(page);
  const b = await upload(page, "B");
  const chooser = page.waitForEvent("filechooser");
  await row(page, a).locator('[data-archive-action="replace"]').click();
  await (await chooser).setFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("invalid archive") });
  await expect(page.locator("#statusText")).toHaveText("Не удалось обработать архив");
  expect(await report(page)).toContain("этап: импорт архива;");
  await expect(page.locator("#compatibilityScope")).toContainText("Последняя попытка импорта");
  await closeReport(page);
  await open(page, a); await close(page);
  expect(await report(page)).toContain("ИТОГ: базовая проверка пройдена");
  await closeReport(page);
  await upload(page, "Update", "#fastUpdateButton", { "asset.txt": "new asset" });
  expect(await report(page)).toContain("импорт: не выполнено");
  await closeReport(page);
  await open(page, b); await close(page);
  expect(await report(page)).toContain("импорт: успешно");
  await closeReport(page);
  await row(page, a).locator('[data-archive-action="remove"]').click();
  await expect(row(page, a)).toHaveCount(0);
  expect(await record(page, a)).toBeNull();
  expect(await report(page)).toContain("импорт: успешно");
});


test("denied report writes retain live errors and do not discard an untouched archive's persisted success", async ({ page }) => {
  await app(page);
  const a = await upload(page, "A");
  const b = await upload(page, "B");
  await open(page, b); await page.frameLocator("#siteFrame").getByRole("link", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await record(page, b))?.data.steps.game).toBe("recorded");
  await close(page);
  await upload(page, "C");
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("C");
  await close(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("gamespace:compatibility-check")) throw new DOMException("fixture report quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await open(page, a);
  await page.frameLocator("#siteFrame").locator("h1").evaluate(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("fixture script error") })));
  await close(page);
  expect(await report(page)).toContain("код: GS-SCRIPT;");
  await expect(page.locator("#compatibilityWarning")).toContainText("не удалось сохранить");
  await closeReport(page);
  await open(page, b); await close(page);
  expect(await report(page)).toContain("ИТОГ: базовая проверка пройдена");
});
