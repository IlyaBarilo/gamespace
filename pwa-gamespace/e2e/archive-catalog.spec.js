import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

async function zip(entries) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [name, text] of Object.entries(entries)) await writer.add(name, new TextReader(text));
  return Buffer.from(await (await writer.close()).arrayBuffer());
}
async function app(page) {
  page.on("dialog", dialog => dialog.accept(dialog.type() === "prompt" ? "Работа студента — версия 1" : undefined));
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText(/готово|Локальный сайт пока не открыт/i);
}
async function upload(page, buffer, button = "#addArchiveButton", name = "work.zip") {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(button).click();
  await (await chooser).setFiles({ name, mimeType: "application/zip", buffer });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
}
const row = (page, id) => page.locator(`[data-archive-id="${id}"]`);
async function contents(page, path = "index.html") {
  return page.evaluate(async path => {
    const response = await fetch(`./__gamespace_content__/${path}`, { cache: "no-store" });
    return { status: response.status, text: await response.text() };
  }, path);
}
async function registry(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const catalog = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("archive-catalog-v1"); r.onsuccess = () => resolve(r.result); });
    db.close(); return catalog;
  });
}

test("archives with equal names switch offline, retain independent files and can be renamed/deleted", async ({ page, context }, testInfo) => {
  await app(page);
  await expect(row(page, "builtin-demo")).toBeVisible();
  await expect(page.locator("#archiveStorageNotice")).toContainText("Сохранения игр пока общие");
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Version A</h1>", "asset.txt": "A" }));
  const first = (await registry(page)).activeId;
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Version B</h1>", "asset.txt": "B" }));
  const second = (await registry(page)).activeId;
  expect(first).not.toBe(second);
  await expect(page.locator(".archive-entry")).toHaveCount(3);
  const catalog = await registry(page);
  const totalBytes = catalog.entries.reduce((total, entry) => total + (entry.state?.writtenBytes || 0), 0);
  await expect(page.locator("#storageFiles")).toContainText("архивов: 2");
  expect(totalBytes).toBeGreaterThan(catalog.entries.find(entry => entry.id === second).state.writtenBytes);
  await row(page, first).locator('[data-archive-action="rename"]').click();
  await expect(row(page, first).locator("h3")).toHaveText("Работа студента — версия 1");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator("#archiveCatalogPanel").scrollIntoViewIfNeeded();
  expect(await page.locator("#archiveCatalogPanel").evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.locator("#archiveCatalogPanel").screenshot({ path: testInfo.outputPath("archive-menu-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#archiveCatalogPanel").screenshot({ path: testInfo.outputPath("archive-menu-desktop.png") });
  await context.setOffline(true);
  await row(page, first).locator('[data-archive-action="open"]').click();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Version A");
  await page.frameLocator("#siteFrame").locator("h1").evaluate(() => localStorage.setItem("student-save", "shared-at-stage-one"));
  await page.locator("#viewerClose").click();
  await row(page, second).locator('[data-archive-action="open"]').click();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Version B");
  expect(await page.locator("#siteFrame").evaluate(e => e.contentWindow.localStorage.getItem("student-save"))).toBe("shared-at-stage-one");
  await page.locator("#viewerClose").click();
  await row(page, first).locator('[data-archive-action="remove"]').click();
  await expect(row(page, first)).toHaveCount(0);
  expect((await contents(page, "asset.txt")).text).toBe("B");
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Version B");
  await page.locator("#viewerClose").click();
  await row(page, second).locator('[data-archive-action="remove"]').click();
  await expect(page.locator("#emptyState")).toBeVisible();
  expect((await contents(page)).status).toBe(404);
  await expect(row(page, "builtin-demo")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("student-save"))).toBe("shared-at-stage-one");
});

test("full replacement and incremental update only change the selected archive; failed addition preserves the catalog", async ({ page }) => {
  await app(page);
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Original A</h1>" }));
  const first = (await registry(page)).activeId;
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Original B</h1>" }));
  const second = (await registry(page)).activeId;
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Replaced A</h1>" }), `[data-archive-id="${first}"] [data-archive-action="replace"]`);
  expect((await registry(page)).activeId).toBe(first);
  await upload(page, await zip({ "marker.txt": "updated A" }), "#fastUpdateButton", "update.zip");
  expect((await contents(page, "marker.txt")).text).toBe("updated A");
  await row(page, second).locator('[data-archive-action="open"]').click();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Original B");
  expect((await contents(page, "marker.txt")).status).toBe(404);
  await page.locator("#viewerClose").click();
  const before = await registry(page);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name: "corrupt.zip", mimeType: "application/zip", buffer: Buffer.from("not zip") });
  await expect(page.locator("#statusText")).toHaveText("Не удалось обработать архив");
  expect(await registry(page)).toEqual(before);
  expect((await contents(page)).text).toContain("Original B");
});

test("one viewing window prevents another window from switching or deleting content", async ({ page, context }) => {
  await app(page);
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Window A</h1>" }));
  const first = (await registry(page)).activeId;
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Window B</h1>" }));
  const second = (await registry(page)).activeId;
  await row(page, first).locator('[data-archive-action="open"]').click();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Window A");
  const other = await context.newPage();
  await app(other);
  await expect(other.locator("#viewer")).toBeHidden();
  await expect(other.locator("#errorText")).toContainText("другом окне");
  await row(other, second).locator('[data-archive-action="open"]').click();
  await expect(other.locator("#errorText")).toContainText("другом окне");
  await row(other, first).locator('[data-archive-action="remove"]').click();
  await expect(other.locator("#errorText")).toContainText("другом окне");
  expect((await registry(page)).activeId).toBe(first);
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Window A");
  await page.locator("#viewerClose").click();
  await row(other, second).locator('[data-archive-action="open"]').click();
  await expect(other.frameLocator("#siteFrame").locator("h1")).toHaveText("Window B");
  await other.close();
});

test("legacy site migrates without copying files and survives inactive cleanup", async ({ page }) => {
  await app(page);
  await page.evaluate(async () => {
    let directory = await navigator.storage.getDirectory();
    for (const name of ["gamespace", "revisions", "legacy-test"]) directory = await directory.getDirectoryHandle(name, { create: true });
    const writer = await (await directory.getFileHandle("index.html", { create: true })).createWritable();
    await writer.write("<!doctype html><h1>Legacy preserved</h1>"); await writer.close();
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("app", "readwrite"); const store = tx.objectStore("app");
      store.delete("archive-catalog-v1");
      store.put({ schema: 1, activeRevision: "legacy-test", revisionPath: "gamespace/revisions/legacy-test", indexPath: "index.html", indexName: "index.html", archiveName: "legacy.zip", archiveType: "zip", installedAt: 123, files: 1, writtenBytes: 46, storageVerifiedAt: 123 }, "state");
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
    navigator.serviceWorker.controller.postMessage({ type: "STATE_CHANGED" });
  });
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Legacy preserved");
  await page.locator("#viewerClose").click();
  const legacy = (await registry(page)).activeId;
  await upload(page, await zip({ "index.html": "<!doctype html><h1>New site</h1>" }));
  const migrated = (await registry(page)).entries.find(entry => entry.id === legacy);
  expect(migrated.state.revisionPath).toBe("gamespace/revisions/legacy-test");
  // Exercise the old shell's exact cleanup rule before reopening the new shell.
  expect(await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const active = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("state"); r.onsuccess = () => resolve(r.result); }); db.close();
    const appRoot = await (await navigator.storage.getDirectory()).getDirectoryHandle("gamespace");
    const revisions = await appRoot.getDirectoryHandle("revisions");
    for await (const [name] of revisions.entries()) if (name !== active.activeRevision) await revisions.removeEntry(name, { recursive: true });
    return (await revisions.getDirectoryHandle("legacy-test")).kind;
  })).toBe("directory");
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("New site");
  await page.locator("#viewerClose").click();
  await row(page, legacy).locator('[data-archive-action="open"]').click();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Legacy preserved");
});


test("an archive whose files disappeared remains removable without affecting demo", async ({ page }) => {
  await app(page);
  await upload(page, await zip({ "index.html": "<!doctype html><h1>Removed externally</h1>" }));
  const id = (await registry(page)).activeId;
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const state = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("state"); r.onsuccess = () => resolve(r.result); }); db.close();
    const parts = state.revisionPath.split("/"); const name = parts.pop();
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    await dir.removeEntry(name, { recursive: true });
  });
  await page.reload();
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
  await expect(row(page, id)).toContainText("Файлы отсутствуют");
  await row(page, id).locator('[data-archive-action="remove"]').click();
  await expect(row(page, id)).toHaveCount(0);
  await expect(row(page, "builtin-demo")).toBeVisible();
  expect((await registry(page)).entries.length).toBe(1);
});
