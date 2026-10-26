import { test, expect } from "@playwright/test";
import { openViewerSettings } from "./helpers/viewer.js";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { formatBytes } from "../src/format.js";
import { compatibilityCode } from "../src/compatibility-report.js";

const demoRow = page => page.locator('[data-archive-id="builtin-demo"]');
async function catalog(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const value = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("archive-catalog-v1"); r.onsuccess = () => resolve(r.result); });
    db.close(); return value;
  });
}
async function app(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await expect(page.locator("#addArchiveButton")).toBeEnabled();
}
async function custom(page) {
  page.on("dialog", dialog => dialog.accept());
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("index.html", new TextReader('<!doctype html><h1>custom-site-marker</h1><p id="save"></p><script>document.querySelector("#save").textContent=localStorage.getItem("demo-test-save")||"EMPTY";</script>'));
  const chooser = page.waitForEvent("filechooser"); await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name: "custom-site.zip", mimeType: "application/zip", buffer: Buffer.from(await (await writer.close()).arrayBuffer()) });
  await expect(page.locator("#siteSummary")).toContainText("Установлен архив: custom-site.zip");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  return (await catalog(page)).activeId;
}
async function markDemoStale(page, { removeFiles = false } = {}) {
  await page.evaluate(async removeFiles => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const value = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("archive-catalog-v1"); r.onsuccess = () => resolve(r.result); });
    const demo = value.entries.find(entry => entry.id === "builtin-demo");
    if (removeFiles) {
      const parts = demo.state.revisionPath.split("/"); const last = parts.pop();
      let root = await navigator.storage.getDirectory();
      for (const name of parts) root = await root.getDirectoryHandle(name);
      await root.removeEntry(last, { recursive: true });
    } else {
      demo.state.builtinDemoVersion = "previous-release";
      await new Promise((resolve, reject) => {
        const tx = db.transaction("app", "readwrite"); tx.objectStore("app").put(value, "archive-catalog-v1");
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  }, removeFiles);
}

test("first app launch prepares demo without a prompt and records its import, size and files", async ({ page }, testInfo) => {
  let prompts = 0; page.on("dialog", async dialog => { prompts++; await dialog.dismiss(); });
  await app(page);
  expect(prompts).toBe(0);
  await expect(page.locator("#viewer")).toBeHidden();
  const data = await catalog(page); const demo = data.entries[0];
  expect(data.activeId).toBe("builtin-demo");
  expect(demo.state.files).toBeGreaterThan(0); expect(demo.state.writtenBytes).toBeGreaterThan(0);
  expect(demo.state.builtinDemoVersion).toBe(await page.locator("#appHeaderVersion").textContent());
  await expect(page.locator("#siteSummary")).toContainText("Установлен архив: Встроенное демо");
  await expect(page.locator("#storageManaged")).toHaveText(`Все архивы: ${formatBytes(demo.state.writtenBytes)}`);
  await expect(page.locator("#storageDemo")).toContainText(`${demo.state.files} файлов`);
  await expect(demoRow(page).locator('[data-archive-action="update"], [data-archive-action="remove"], [data-archive-action="replace"]')).toHaveCount(0);
  await expect(demoRow(page).locator(".archive-entry-status")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator("#storagePersistent")).toHaveCSS("border-top-width", "0px");
  await page.locator("#compatibilityButton").click();
  await expect(page.locator("#compatibilityStep_import")).toHaveText("выполнено");
  await expect(page.locator("#compatibilityStep_storefront")).toHaveText("пока не выполнено");
  await expect(page.locator("#compatibilityText")).toHaveValue(/Целостность текста: GS1-/);
  const text = await page.locator("#compatibilityText").inputValue();
  const split = text.lastIndexOf("Целостность текста: ");
  expect(text.slice(split + "Целостность текста: ".length)).toBe(await compatibilityCode(text.slice(0, split).trimEnd()));
  await page.locator("#compatibilityClose").click();
  await expect(page.locator("#viewerMenuTabSetting")).toBeChecked();
  await expect(page.locator("#compatibilityDialog")).toBeHidden();
  await page.locator("#viewerMenuTabSetting").press("Space");
  await expect(page.locator("#viewerMenuTabSetting")).not.toBeChecked();
  await page.locator("#viewerMenuTabSetting").press("Space");
  await expect(page.locator("#viewerMenuTabSetting")).toBeChecked();
  await expect(page.locator("#viewerMenuTabSetting")).toHaveCSS("appearance", "none");
  await expect(page.locator("#progressPanel")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("auto-demo-menu.png"), fullPage: true });
});

test("bundled demo remains a protected offline entry after importing and deleting a custom archive", async ({ page, context }) => {
  await app(page); const id = await custom(page);
  const before = await catalog(page);
  const bytes = before.entries.reduce((total, entry) => total + entry.state.writtenBytes, 0);
  await expect(page.locator("#storageManaged")).toHaveText(`Все архивы: ${formatBytes(bytes)}`);
  await context.setOffline(true); await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("custom-site-marker");
  await openViewerSettings(page);
  await demoRow(page).locator('[data-archive-action="open"]').click();
  await expect(page.frameLocator("#siteFrame").locator(".game-card").first()).toBeVisible();
  await openViewerSettings(page);
  await page.locator(`[data-archive-id="${id}"] [data-archive-action="remove"]`).click();
  await expect(page.locator(".archive-entry")).toHaveCount(1);
  await expect(demoRow(page)).toHaveAttribute("aria-current", "true");
  await expect(demoRow(page).locator('[data-archive-action="remove"], [data-archive-action="update"]')).toHaveCount(0);
  await expect(page.locator("#errorPanel")).toBeHidden();
});

for (const removeFiles of [false, true]) {
  test(`automatic demo ${removeFiles ? "recovery" : "refresh"} preserves selected content, native saves and its compatibility report`, async ({ page }) => {
    await app(page); const id = await custom(page);
    await page.locator("#openSiteButton").click();
    await expect(page.locator("#viewer")).toBeVisible();
    await page.frameLocator("#siteFrame").locator("h1").evaluate(() => localStorage.setItem("demo-test-save", "LEVEL 17"));
    await openViewerSettings(page);
    const before = await catalog(page); const demoRevision = before.entries[0].state.activeRevision;
    const checkBefore = await page.evaluate(id => JSON.parse(localStorage.getItem(`gamespace:compatibility-check:archive:v1:id:${id}`)), id);
    await markDemoStale(page, { removeFiles });
    await page.reload();
    await expect(page.frameLocator("#siteFrame").locator("#save")).toHaveText("LEVEL 17");
    const after = await catalog(page);
    expect(after.activeId).toBe(id); expect(after.entries[0].state.activeRevision).not.toBe(demoRevision);
    expect(after.entries.find(entry => entry.id === id)).toEqual(before.entries.find(entry => entry.id === id));
    const checkAfter = await page.evaluate(id => JSON.parse(localStorage.getItem(`gamespace:compatibility-check:archive:v1:id:${id}`)), id);
    expect(checkAfter.token).toBe(checkBefore.token); expect(checkAfter.data.steps.import).toBe("success");
    expect(await page.evaluate(() => localStorage.getItem("demo-test-save"))).toBe("LEVEL 17");
  });
}

test("a failed automatic demo refresh retains its files and user content and saves", async ({ page }) => {
  await app(page); const id = await custom(page);
  await page.evaluate(() => localStorage.setItem("demo-test-save", "KEEP"));
  await markDemoStale(page);
  const before = await catalog(page);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (...args) => new URL(String(args[0]), location.href).pathname.endsWith("/demo.7z")
      ? Promise.resolve(new Response("demo unavailable", { status: 503 })) : original(...args);
  });
  await page.reload();
  await expect(page.frameLocator("#siteFrame").locator("#save")).toHaveText("KEEP");
  const after = await catalog(page);
  expect(after).toEqual(before); expect(after.activeId).toBe(id);
  if (await page.locator("#diagnosticDialog").isVisible()) await page.locator("#diagnosticClose").click();
  await openViewerSettings(page);
  await expect(page.locator("#errorPanel")).toBeVisible();
});
