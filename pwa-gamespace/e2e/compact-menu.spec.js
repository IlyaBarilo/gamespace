import { test, expect, devices } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

async function openApp(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Приложение готово к импорту");
}
async function addArchive(page, name) {
  const zip = new ZipWriter(new BlobWriter());
  await zip.add("index.html", new TextReader(`<!doctype html><h1>${name}</h1>`));
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name, mimeType: "application/zip", buffer });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
}
async function catalogRoute(page, latest) {
  const catalog = await (await page.request.get("versions.json")).json();
  const current = catalog.versions.find(v => v.version === catalog.latest);
  catalog.latest = latest || current.version;
  const newest = catalog.versions.find(v => v.version === catalog.latest) || { ...current, version: catalog.latest };
  catalog.versions = [newest, current, ...["0.2.9", "0.2.8", "0.2.7", "0.2.6"].map(version => ({ ...current, version }))]
    .filter((release, i, all) => all.findIndex(v => v.version === release.version) === i);
  // SW-controlled fetches bypass page routes. Override only the page's explicit catalog fetch.
  await page.addInitScript(catalog => {
    const original = window.fetch.bind(window);
    window.catalogChecks = 0;
    window.fetch = (...args) => {
      if (new URL(String(args[0]), location.href).pathname.endsWith("/versions.json")) {
        window.catalogChecks++;
        return Promise.resolve(new Response(JSON.stringify(catalog), { headers: { "Content-Type": "application/json" } }));
      }
      return original(...args);
    };
  }, catalog);
  return () => page.evaluate(() => window.catalogChecks);
}

test("update control changes to the latest version; paging replaces cards and keeps descriptions above installation", async ({ page, request }) => {
  const { goodVersion } = await (await request.get("/__e2e_versions__")).json();
  const count = await catalogRoute(page, goodVersion);
  await openApp(page);
  expect(await count()).toBe(0);
  await expect(page.locator("#checkPwaUpdateButton")).toHaveText("Проверить обновление программы");
  await page.locator("#checkPwaUpdateButton").click();
  const list = page.locator("#pwaVersionsList");
  await expect(page.locator("#checkPwaUpdateButton")).toHaveText(`Обновить до версии ${goodVersion}`);
  await expect(list.locator(".release-option")).toHaveCount(1);
  await expect(list.locator("details")).not.toHaveAttribute("open", "");
  await expect(list.locator(".release-install-button")).toHaveCount(1);
  const assertOrder = async () => expect(await list.locator(".release-option").evaluate(card => {
    const children = [...card.children];
    return children.indexOf(card.querySelector(".release-description-panel")) < children.indexOf(card.querySelector(".release-install-button"));
  })).toBe(true);
  await assertOrder();
  await list.locator(".release-previous-button").click();
  await expect(list.locator(".release-option")).toHaveCount(1);
  await expect(list.locator("strong")).not.toContainText(goodVersion);
  await assertOrder();
  await list.locator(".release-previous-button").click();
  await expect(list.locator("strong")).toContainText("0.2.9");
  await expect(list.locator("details")).not.toHaveAttribute("open", "");
  await list.locator(".release-latest-button").click();
  await expect(list.locator("strong")).toContainText(goodVersion);
  expect(await count()).toBe(1);
  await page.locator("#recheckPwaUpdateButton").click();
  await expect.poll(count).toBe(2);
  await expect(page.locator("#checkPwaUpdateButton")).toBeEnabled();
});

test("the current latest stays a check action", async ({ page }) => {
  await catalogRoute(page);
  await openApp(page);
  await page.locator("#checkPwaUpdateButton").click();
  await expect(page.locator("#pwaUpdateStatus")).toContainText("актуальная версия");
  await expect(page.locator("#checkPwaUpdateButton")).toHaveText("Проверить обновление программы");
  await expect(page.locator("#recheckPwaUpdateButton")).toBeHidden();
});

test("landing release history uses one collapsed card without installing on navigation", async ({ page }) => {
  const count = await catalogRoute(page);
  await page.goto("./");
  await page.locator("#landingVersionsButton").click();
  const list = page.locator("#landingVersionsList");
  await expect(list.locator(".release-option")).toHaveCount(1);
  await expect(list.locator("details")).not.toHaveAttribute("open", "");
  await list.locator(".release-previous-button").click();
  await expect(list.locator("strong")).toContainText("0.2.9");
  await list.locator(".release-latest-button").click();
  await expect(list.locator(".release-option")).toHaveCount(1);
  expect(await count()).toBe(1);
});

for (const phone of [false, true]) {
  test.describe(phone ? "phone menu" : "desktop menu", () => {
    if (phone) { const { defaultBrowserType, ...options } = devices["Pixel 7"]; test.use({ ...options, deviceScaleFactor: 1 }); }
    else test.use({ viewport: { width: 1280, height: 1000 } });
    test("four compact blocks keep archive actions, storage and help reachable", async ({ page }, testInfo) => {
      page.on("dialog", dialog => dialog.accept());
      await openApp(page);
      await expect(page.locator("#compatibilityButton")).toBeEnabled();
      await expect(page.locator("#appShell > .panel")).toHaveCount(4);
      await addArchive(page, "Учебная работа — версия 1.zip");
      await addArchive(page, "Учебная работа — версия 2.zip");
      const active = page.locator(".archive-entry.is-active");
      await expect(active).toHaveAttribute("aria-current", "true");
      await active.locator(".archive-entry-info > summary").click();
      await expect(active.locator(".archive-info-fields")).toContainText("ZIP");
      await expect(active.locator(".archive-info-fields")).toContainText("Полная установка");
      await active.locator(".archive-entry-info > summary").click();
      await expect(page.locator("#archiveList #sharedLocalStorageSetting")).toHaveCount(0);
      await expect(page.locator("#archiveStoragePanel #storageRetention")).toBeVisible();
      await expect(page.locator("#archiveStoragePanel #sharedLocalStorageSetting")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator("#downloadApkLink")).toBeVisible();
      await expect(page.locator("#openLicensesButton")).toBeVisible();
      await page.locator("#compatibilityButton").click();
      await expect(page.locator("#compatibilityText")).toHaveValue(/Целостность текста: GS1-/);
      await page.locator("#compatibilityClose").click();
      await expect(page.locator("#progressPanel")).toBeHidden();
      await page.locator("#appShell").screenshot({ path: testInfo.outputPath(phone ? "compact-menu-mobile.png" : "compact-menu-desktop.png") });
    });
  });
}

test("missing browser capabilities remain visible outside folded program details", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "Worker", { configurable: true, value: undefined }));
  await openApp(page);
  await expect(page.locator("#programDetails")).not.toHaveAttribute("open", "");
  await expect(page.locator("#capabilityNotice")).toBeVisible();
  await expect(page.locator("#capabilityNotice")).toContainText("не поддерживает");
  await expect(page.locator("#compatibilityButton")).toBeEnabled();
});

test("an older official catalog keeps manual installation but does not offer an automatic downgrade", async ({ page }) => {
  await catalogRoute(page, "0.2.9");
  await openApp(page);
  await page.locator("#checkPwaUpdateButton").click();
  await expect(page.locator("#checkPwaUpdateButton")).toHaveText("Проверить обновление программы");
  await expect(page.locator("#recheckPwaUpdateButton")).toBeHidden();
  await expect(page.locator("#pwaVersionsList .release-install-button")).toHaveText("Установить версию 0.2.9");
  await expect(page.locator("#pwaVersionsList .release-install-button")).toBeEnabled();
});
