import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

const controlKey = "archive-localstorage-v1";
const row = (page, id) => page.locator(`[data-archive-id="${id}"]`);
const toggle = page => page.locator("#sharedLocalStorageSetting");
async function app(page) {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
}
async function add(page, version) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("index.html", new TextReader(`<!doctype html><h1>${version}</h1><output id="first-read"></output><script>document.getElementById('first-read').textContent=localStorage.getItem('same-key')??'EMPTY';</script>`));
  const buffer = Buffer.from(await (await writer.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser"); await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name: "student-work.zip", mimeType: "application/zip", buffer });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  return page.locator(".archive-entry.is-active").getAttribute("data-archive-id");
}
async function open(page, id, initialValue) {
  await row(page, id).locator('[data-archive-action="open"]').click();
  await expect(page.locator("#viewerLoading")).toBeHidden();
  if (initialValue !== undefined) await expect(page.frameLocator("#siteFrame").locator("#first-read")).toHaveText(initialValue);
}
async function setSave(page, value) {
  await page.locator("#siteFrame").evaluate((frame, value) => frame.contentWindow.localStorage.setItem("same-key", value), value);
}
async function close(page) { await page.locator("#viewerClose").click(); await expect(page.locator("#viewer")).toBeHidden(); }
async function mode(page, shared) {
  await toggle(page).setChecked(shared);
  await expect(page.locator("#statusText")).toHaveText(shared ? "Включён единый localStorage" : "Включён раздельный localStorage");
}
async function record(page) {
  return page.evaluate(async key => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const result = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get(key); r.onsuccess = () => resolve(r.result); });
    db.close(); return result;
  }, controlKey);
}

test("restores archive saves before inline JS, keeps settings, honours game clear and persists live changes", async ({ page, context }) => {
  await app(page);
  await expect(toggle(page)).not.toBeChecked();
  await page.locator("#viewerMenuTabSetting").check();
  const a = await add(page, "A");
  await open(page, a, "EMPTY"); await setSave(page, "A save"); await close(page);
  const b = await add(page, "B");
  await open(page, b, "EMPTY"); await setSave(page, "B save"); await close(page);
  await open(page, a, "A save"); await close(page);
  await open(page, b, "B save");
  await page.locator("#siteFrame").evaluate(frame => frame.contentWindow.localStorage.clear());
  await expect.poll(() => page.evaluate(() => localStorage.getItem("gamespace:viewer-menu-tab:v1"))).toBe("1");
  await close(page);
  await open(page, a, "A save"); await close(page);
  await open(page, b, "EMPTY"); await setSave(page, "B live after snapshot");
  await context.setOffline(true);
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("#first-read")).toHaveText("B live after snapshot");
  await close(page);
  await expect(page.locator("#viewerMenuTabSetting")).toBeChecked();
  await expect(page.locator("#archiveStorageNotice")).toContainText("IndexedDB");
});

test("shared mode is durable and reversible; deletion preserves common saves and removes the selected individual set", async ({ page }, testInfo) => {
  await app(page);
  const a = await add(page, "A"); await open(page, a); await setSave(page, "own A"); await close(page);
  const b = await add(page, "B"); await open(page, b); await setSave(page, "own B"); await close(page);
  await open(page, a, "own A"); await close(page);
  await mode(page, true);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator("#archiveCatalogPanel").screenshot({ path: testInfo.outputPath("shared-localstorage-desktop.png") });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.locator("#archiveCatalogPanel").evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.locator("#archiveCatalogPanel").screenshot({ path: testInfo.outputPath("shared-localstorage-mobile.png") });
  await open(page, a, "own A"); await setSave(page, "latest common"); await close(page);
  await open(page, b, "latest common"); await close(page);
  await mode(page, false);
  await open(page, b, "own B"); await close(page);
  await open(page, a, "own A"); await close(page);
  await mode(page, true);
  await open(page, a, "latest common"); await close(page);
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("#first-read")).toHaveText("latest common"); await close(page);
  await expect(toggle(page)).toBeChecked();
  await row(page, b).locator('[data-archive-action="remove"]').click();
  await expect(row(page, b)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("same-key"))).toBe("latest common");
  await mode(page, false);
  await open(page, a, "own A"); await close(page);
  const replacement = await add(page, "B new");
  await open(page, replacement, "EMPTY"); await close(page);
  await mode(page, true); await open(page, replacement, "latest common");
});

test("failed native restoration rolls back both selection and saves; retry succeeds", async ({ page }) => {
  await app(page);
  const a = await add(page, "A"); await open(page, a); await setSave(page, "A save"); await close(page);
  const b = await add(page, "B"); await open(page, b); await setSave(page, "B save"); await close(page);
  await open(page, a, "A save"); await close(page);
  await page.evaluate(() => {
    const nativeSet = Storage.prototype.setItem;
    let fail = true;
    Storage.prototype.setItem = function(key, value) {
      if (fail && key === "same-key" && value === "B save") { fail = false; throw new DOMException("Simulated quota", "QuotaExceededError"); }
      return nativeSet.call(this, key, value);
    };
  });
  await row(page, b).locator('[data-archive-action="open"]').click();
  await expect(page.locator("#errorText")).toContainText("Предыдущие сохранения восстановлены");
  expect(await page.evaluate(() => localStorage.getItem("same-key"))).toBe("A save");
  expect((await record(page)).slot).toBe(`archive:${a}`);
  expect((await record(page)).pending).toBeNull();
  await expect(row(page, a)).toHaveClass(/is-active/);
  await page.locator("#diagnosticClose").click();
  await open(page, b, "B save");
});

test("upgrading the first-stage shared data and recovering an interrupted swap precede opening the game", async ({ page }) => {
  await app(page);
  const a = await add(page, "A"); const b = await add(page, "B");
  await open(page, a); await close(page);
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("app", "readwrite"); const store = tx.objectStore("app");
      const request = store.getAllKeys(); request.onsuccess = () => {
        for (const key of request.result) if (String(key).startsWith("archive-localstorage")) store.delete(key);
      }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close(); localStorage.setItem("same-key", "first-stage saves");
  });
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("#first-read")).toHaveText("first-stage saves"); await close(page);
  await open(page, b, "EMPTY"); await close(page);
  await open(page, a, "first-stage saves"); await close(page);
  await page.evaluate(async key => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("app", "readwrite"); const store = tx.objectStore("app");
      const request = store.get(key); request.onsuccess = () => {
        const control = request.result;
        store.put({ ...control, pending: { sourceSlot: control.slot, sourceEntries: [["same-key", "before interruption"]] } }, key);
      }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close(); localStorage.setItem("same-key", "partial wrong target"); localStorage.setItem("partial-key", "remove on recovery");
  }, controlKey);
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("#first-read")).toHaveText("before interruption");
  expect(await page.evaluate(() => localStorage.getItem("partial-key"))).toBeNull();
  expect((await record(page)).pending).toBeNull();
});
