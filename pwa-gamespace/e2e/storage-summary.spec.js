import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

test("storage indicator respects verified site bytes and retains raw estimates in reports", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => true });
    Object.defineProperty(navigator.storage, "estimate", {
      configurable: true, value: async () => ({ usage: 10 * 1024 ** 2, quota: 10 * 1024 ** 3 }),
    });
  });
  await page.goto("./");
  await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true });
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  await zip.add("index.html", new TextReader("<!doctype html><title>Storage fixture</title>"));
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#chooseArchiveButton").click();
  await (await chooser).setFiles({ name: "storage-fixture.zip", mimeType: "application/zip", buffer });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");

  // Simulate verified metadata for a large site without allocating 2 GB on disk.
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("gamespace-pwa", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("app", "readwrite");
        const store = transaction.objectStore("app");
        const request = store.get("state");
        request.onsuccess = () => store.put({ ...request.result, writtenBytes: 2 * 1024 ** 3 }, "state");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  await page.reload();
  await expect(page.locator("#storageBarText")).toHaveText("20%");
  await page.locator("#viewerClose").click();
  await expect(page.locator("#storageManaged")).toHaveText("Сайт GameSpace: 2,00 ГБ");
  await expect(page.locator("#storageQuota")).toHaveText("Квота браузера: 10,0 ГБ");
  await expect(page.locator("#storageUsage")).toContainText("не менее 2,00 ГБ");
  expect(await page.locator("#storageBar").evaluate(element => element.style.width)).toBe("20%");
  expect(await page.locator("#storageRing").evaluate(element => element.style.getPropertyValue("--fill"))).toBe("72deg");
  await page.locator("#manualReportButton").click();
  await expect(page.locator("#diagnosticText")).toHaveValue(/Последняя оценка использования, байт: 10485760/);
  await page.locator("#diagnosticClose").click();

  await page.locator("#removeSiteButton").click();
  await expect(page.locator("#statusText")).toHaveText("Сайт удалён");
  await expect(page.locator("#storageManaged")).toHaveText("Сайт GameSpace: не установлен");
  await expect(page.locator("#storageBarText")).toHaveText("<0,1%");
});

test("unavailable browser storage estimates do not fail app startup", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => true });
    for (const method of ["estimate", "persisted"]) {
      Object.defineProperty(navigator.storage, method, {
        configurable: true, value: async () => { throw new Error("Storage information unavailable"); },
      });
    }
  });
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  await expect(page.locator("#storageBarText")).toHaveText("—");
  await expect(page.locator("#storageQuota")).toHaveText("Квота браузера: не сообщается");
  await expect(page.locator("#storagePersistent")).toHaveText("Не определено");
  await expect(page.locator("#errorPanel")).toBeHidden();
});
