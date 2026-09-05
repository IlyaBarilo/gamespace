import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

async function createZip(entries) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, content] of Object.entries(entries)) {
    await writer.add(path, new TextReader(content));
  }
  return Buffer.from(await (await writer.close()).arrayBuffer());
}

async function openApp(page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true });
}

async function installDemo(page) {
  await page.locator("#demoButton").click();
  await expect(page.locator("#installedState")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
}

async function chooseFile(page, button, file) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(button).click();
  await (await chooser).setFiles(file);
}

async function readContent(page, path) {
  return page.evaluate(async (value) => {
    const response = await fetch(`./__gamespace_content__/${value}`, { cache: "no-store" });
    return { status: response.status, text: response.ok ? await response.text() : "" };
  }, path);
}

test("a corrupt full archive keeps the previously installed site", async ({ page }) => {
  await openApp(page);
  await installDemo(page);
  const original = await readContent(page, "index.html");
  expect(original.status).toBe(200);

  await chooseFile(page, "#fullUpdateButton", {
    name: "corrupt.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("this is not a zip archive"),
  });

  await expect(page.locator("#statusText")).toHaveText("Не удалось обработать архив", { timeout: 30_000 });
  await expect(page.locator("#installedState")).toBeVisible();
  expect(await readContent(page, "index.html")).toEqual(original);
});

test("a known insufficient quota rejects an archive before extraction", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      configurable: true,
      value: async () => ({ usage: 0, quota: 64 * 1024 * 1024 }),
    });
  });
  const archive = await createZip({
    "index.html": "<!doctype html><title>Quota fixture</title>",
    "asset.txt": "small file",
  });

  await chooseFile(page, "#chooseArchiveButton", {
    name: "quota-fixture.zip",
    mimeType: "application/zip",
    buffer: archive,
  });

  await expect(page.locator("#statusText")).toHaveText("Не удалось обработать архив", { timeout: 30_000 });
  await expect(page.locator("#errorText")).toContainText("Недостаточно доступной квоты");
  await expect(page.locator("#emptyState")).toBeVisible();
});

test("startup recovery restores an interrupted update from its journal", async ({ page }) => {
  await openApp(page);
  await installDemo(page);
  const original = await readContent(page, "index.html");
  expect(original.status).toBe(200);

  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("gamespace-pwa", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const state = await new Promise((resolve, reject) => {
      const transaction = database.transaction("app", "readonly");
      const request = transaction.objectStore("app").get("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const root = await navigator.storage.getDirectory();
    const getDirectory = async (path, create) => {
      let directory = root;
      for (const part of path.split("/").filter(Boolean)) {
        directory = await directory.getDirectoryHandle(part, { create });
      }
      return directory;
    };
    const getFile = async (path, create) => {
      const parts = path.split("/");
      const name = parts.pop();
      return (await getDirectory(parts.join("/"), create)).getFileHandle(name, { create });
    };
    const write = async (path, value) => {
      const handle = await getFile(path, true);
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(value);
      await writable.close();
    };
    const activeIndex = await getFile(`${state.revisionPath}/index.html`, false);
    await write("gamespace/rollback/e2e/index.html", await activeIndex.getFile());
    await write(`${state.revisionPath}/index.html`, "<!doctype html><title>Interrupted update</title>");
    await write(`${state.revisionPath}/e2e-created.txt`, "must be removed");
    await write("gamespace/updates/e2e/staged.txt", "temporary update");
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("app", "readwrite");
      transaction.objectStore("app").put({
        schema: 1,
        type: "update-merge",
        startedAt: Date.now(),
        updatePath: "gamespace/updates/e2e",
        targetPath: state.revisionPath,
        rollbackPath: "gamespace/rollback/e2e",
        createdPaths: ["e2e-created.txt"],
        restoredPaths: ["index.html"],
      }, "operation-journal");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect(page.locator("#viewer")).toBeVisible({ timeout: 30_000 });
  expect(await readContent(page, "index.html")).toEqual(original);
  expect((await readContent(page, "e2e-created.txt")).status).toBe(404);
  expect(await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("gamespace-pwa", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const journal = await new Promise((resolve, reject) => {
      const transaction = database.transaction("app", "readonly");
      const request = transaction.objectStore("app").get("operation-journal");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return journal;
  })).toBeNull();
});

test("site removal clears metadata and makes content unavailable", async ({ page }) => {
  await openApp(page);
  await installDemo(page);
  await page.locator("#removeSiteButton").click();
  await expect(page.locator("#statusText")).toHaveText("Сайт удалён", { timeout: 30_000 });
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#installedState")).toBeHidden();
  expect((await readContent(page, "index.html")).status).toBe(404);
});

test("the cancel button aborts a running ZIP installation and removes partial data", async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const nativeRoot = await navigator.storage.getDirectory();
    const wait = () => new Promise((resolve) => setTimeout(resolve, 1_000));
    const wrapFile = (handle) => ({
      kind: handle.kind,
      name: handle.name,
      getFile: (...args) => handle.getFile(...args),
      async createWritable(options) {
        const writable = await handle.createWritable(options);
        const writer = writable.getWriter();
        return { getWriter: () => ({
          async write(chunk) { await wait(); return writer.write(chunk); },
          close: (...args) => writer.close(...args),
          abort: (...args) => writer.abort(...args),
          releaseLock: (...args) => writer.releaseLock(...args),
        }) };
      },
    });
    const wrapDirectory = (handle) => ({
      kind: handle.kind,
      name: handle.name,
      entries: (...args) => handle.entries(...args),
      removeEntry: (...args) => handle.removeEntry(...args),
      async getDirectoryHandle(name, options) {
        return wrapDirectory(await handle.getDirectoryHandle(name, options));
      },
      async getFileHandle(name, options) {
        return wrapFile(await handle.getFileHandle(name, options));
      },
    });
    Object.defineProperty(navigator.storage, "getDirectory", {
      configurable: true,
      value: async () => wrapDirectory(nativeRoot),
    });
  });
  const entries = { "index.html": "<!doctype html><title>Cancellation fixture</title>" };
  for (let index = 0; index < 40; index += 1) {
    entries[`assets/file-${index}.txt`] = `file ${index} `.repeat(8_192);
  }
  const archive = await createZip(entries);

  await chooseFile(page, "#chooseArchiveButton", {
    name: "cancellation-fixture.zip",
    mimeType: "application/zip",
    buffer: archive,
  });
  await expect(page.locator("#progressFile")).not.toHaveText("", { timeout: 30_000 });
  await page.evaluate(() => document.querySelector("#progressCancelButton").click());

  await expect(page.locator("#statusText")).toHaveText("Установка отменена", { timeout: 30_000 });
  await expect(page.locator("#errorPanel")).toBeHidden();
  await expect(page.locator("#emptyState")).toBeVisible();
});
