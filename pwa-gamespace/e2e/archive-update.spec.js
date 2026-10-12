import { test, expect, devices } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

const row = (page, id) => page.locator(`[data-archive-id="${id}"]`);
async function zip(entries) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [name, text] of Object.entries(entries)) await writer.add(name, new TextReader(text));
  return Buffer.from(await (await writer.close()).arrayBuffer());
}
async function app(page) {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
}
async function choose(page, button, entries, name = "update.zip") {
  const chooser = page.waitForEvent("filechooser"); await page.locator(button).click();
  await (await chooser).setFiles({ name, mimeType: "application/zip", buffer: await zip(entries) });
}
async function add(page, label) {
  await choose(page, "#addArchiveButton", {
    "index.html": `<!doctype html><h1>${label}</h1><p id="saved"></p><script>document.getElementById('saved').textContent=localStorage.getItem('same-key')||'EMPTY';</script>`,
    "keep.txt": `Keep ${label}`, "asset.txt": `Original ${label}`,
  }, `${label}.zip`);
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  return page.locator(".archive-entry.is-active").getAttribute("data-archive-id");
}
async function open(page, id) {
  await row(page, id).locator('[data-archive-action="open"]').click();
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.frameLocator("#siteFrame").locator("#saved")).toBeVisible();
  await expect(page.locator("#viewerLoading")).toBeHidden();
}
async function save(page, value) { await page.locator("#siteFrame").evaluate((frame, value) => frame.contentWindow.localStorage.setItem("same-key", value), value); }
async function close(page) { await page.locator("#viewerClose").click(); await expect(page.locator("#viewer")).toBeHidden(); }
async function catalog(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const result = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("archive-catalog-v1"); r.onsuccess = () => resolve(r.result); });
    db.close(); return result;
  });
}
async function content(page, file) {
  return page.evaluate(async file => { const r = await fetch(`./__gamespace_content__/${file}`, { cache: "no-store" }); return { status: r.status, text: await r.text() }; }, file);
}
async function seeded(page) {
  await app(page);
  const a = await add(page, "Учебная работа — версия 1");
  await open(page, a); await save(page, "SAVE A"); await close(page);
  const b = await add(page, "Учебная работа — версия 2");
  await open(page, b); await save(page, "SAVE B"); await close(page);
  return { a, b };
}
async function screenshotPanels(page, testInfo, name) {
  const clip = await page.evaluate(() => {
    const a = document.getElementById("archiveCatalogPanel").getBoundingClientRect();
    const b = document.getElementById("archiveStoragePanel").getBoundingClientRect();
    return { x: a.left + scrollX, y: a.top + scrollY, width: a.width, height: b.bottom - a.top };
  });
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true, clip });
}

test("row update merges an inactive archive, selects it with its saves and leaves other archives intact", async ({ page }, testInfo) => {
  const { a, b } = await seeded(page);
  await expect(page.locator("#archiveList")).toHaveRole("list");
  await expect(page.locator("#archiveList > li")).toHaveCount(3);
  await expect(row(page, b)).toHaveAttribute("aria-current", "true");
  await expect(row(page, b).locator(".archive-entry-status")).toHaveText("Текущий архив");
  await expect(page.locator("#archiveList #sharedLocalStorageSetting")).toHaveCount(0);
  await expect(page.locator("#archiveStoragePanel #sharedLocalStorageSetting")).toBeVisible();
  await choose(page, `[data-archive-id="${a}"] [data-archive-action="update"]`, { "asset.txt": "Updated A", "new.txt": "Added A" });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await expect(row(page, a)).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#archiveList [aria-current='true']")).toHaveCount(1);
  const updated = await catalog(page);
  expect(updated.activeId).toBe(a);
  expect(updated.entries.find(entry => entry.id === a).state.files).toBe(4);
  expect((await content(page, "keep.txt")).text).toBe("Keep Учебная работа — версия 1");
  expect((await content(page, "asset.txt")).text).toBe("Updated A");
  expect((await content(page, "new.txt")).text).toBe("Added A");
  await open(page, a);
  await expect(page.frameLocator("#siteFrame").locator("#saved")).toHaveText("SAVE A"); await close(page);
  await open(page, b);
  await expect(page.frameLocator("#siteFrame").locator("#saved")).toHaveText("SAVE B");
  expect((await content(page, "asset.txt")).text).toContain("Original Учебная работа — версия 2");
  expect((await content(page, "new.txt")).status).toBe(404); await close(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator("#archiveCatalogPanel").scrollIntoViewIfNeeded();
  const height = await row(page, a).locator('[data-archive-action="update"]').evaluate(element => element.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(36);
  await screenshotPanels(page, testInfo, "compact-archive-list-desktop.png");
});

for (const failure of ["native saves", "catalog commit"]) {
  test(`failed inactive row update restores files, selection and saves after ${failure} failure`, async ({ page }) => {
    const { a, b } = await seeded(page);
    const before = await catalog(page);
    await page.evaluate(({ a, failure }) => {
      if (failure === "native saves") {
        const original = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function(key, value) {
          if (!failed && key === "same-key" && value === "SAVE A") { failed = true; throw new DOMException("fixture quota", "QuotaExceededError"); }
          return original.call(this, key, value);
        };
      } else {
        const original = IDBObjectStore.prototype.put;
        let failed = false;
        IDBObjectStore.prototype.put = function(value, key, ...rest) {
          const result = original.call(this, value, key, ...rest);
          if (!failed && key === "archive-catalog-v1" && value.activeId === a && value.entries.some(entry => entry.id === a && entry.state?.operation === "fast")) {
            failed = true;
            const tx = this.transaction; queueMicrotask(() => tx.abort());
          }
          return result;
        };
      }
    }, { a, failure });
    const button = `[data-archive-id="${a}"] [data-archive-action="update"]`;
    await choose(page, button, { "asset.txt": "Must roll back", "new.txt": "Must be removed" });
    await expect(page.locator("#statusText")).toHaveText("Не удалось обработать архив");
    if (await page.locator("#diagnosticDialog").isVisible()) await page.locator("#diagnosticClose").click();
    expect(await catalog(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem("same-key"))).toBe("SAVE B");
    expect((await content(page, "asset.txt")).text).toContain("Original Учебная работа — версия 2");
    await open(page, a);
    expect((await content(page, "asset.txt")).text).toContain("Original Учебная работа — версия 1");
    expect((await content(page, "new.txt")).status).toBe(404); await close(page);
    await open(page, b); await close(page);
    await choose(page, button, { "asset.txt": "Retry A", "new.txt": "Retry new" });
    await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
    expect((await catalog(page)).activeId).toBe(a);
    expect((await content(page, "asset.txt")).text).toBe("Retry A");
  });
}

test.describe("compact list on a phone", () => {
  const { defaultBrowserType, ...phone } = devices["Pixel 7"];
  test.use(phone);
  test("keeps touch buttons usable and storage settings outside the list", async ({ page }, testInfo) => {
    const { b } = await seeded(page);
    await expect(row(page, b)).toHaveAttribute("aria-current", "true");
    expect(await page.locator("#archiveCatalogPanel").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator("#archiveStoragePanel").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const height = await row(page, b).locator('[data-archive-action="update"]').evaluate(element => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
    await screenshotPanels(page, testInfo, "compact-archive-list-mobile.png");
  });
});
