import { test, expect, chromium } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function installedWindow(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  page.on("dialog", dialog => dialog.accept());
}
async function openApp(page) {
  await installedWindow(page); await page.goto("./");
  await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true });
}
async function runtime(page, type, data = {}) {
  return page.evaluate(async ({ type, data }) => {
    const worker = navigator.serviceWorker.controller || (await navigator.serviceWorker.ready).active;
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error(`Runtime did not answer ${type}`)); }, 15_000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage({ type, ...data }, [channel.port2]);
    });
  }, { type, data });
}
async function zipFiles(files) {
  const zip = new ZipWriter(new BlobWriter());
  for (const [name, value] of Object.entries(files)) await zip.add(name, new TextReader(value), { level: 0 });
  return Buffer.from(await (await zip.close()).arrayBuffer());
}
async function choose(page, button, buffer, name = "fixture.zip") {
  const chooser = page.waitForEvent("filechooser"); await page.locator(button).click();
  await (await chooser).setFiles({ name, mimeType: "application/octet-stream", buffer });
}

test("cold browser restart opens the built release and imported site without a network", async ({ browserName, baseURL }) => {
  expect(browserName).toBe("chromium");
  // Chromium's on-disk cache uses long nested paths on Windows. Keep its
  // disposable profile outside Playwright's long per-test artifact directory.
  const tempRoot = await realpath(tmpdir());
  const profile = await mkdtemp(path.join(tempRoot, "gs-pwa-e2e-"));
  let context = await chromium.launchPersistentContext(profile, { headless: true });
  try {
    const page = context.pages()[0]; await installedWindow(page); await page.goto(baseURL);
    await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true }).catch(async error => {
      throw new Error(`${error.message}\nInitialization detail: ${await page.locator("#errorText").textContent()}`);
    });
    await page.locator("#demoButton").click();
    await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
    expect((await runtime(page, "GET_RUNTIME_STATE")).state.activeVersion).not.toContain("dev");
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true });
    await context.setOffline(true);
    const restarted = context.pages()[0]; await installedWindow(restarted); await restarted.goto(baseURL);
    await expect(restarted.locator("#viewer")).toBeVisible();
    await expect(restarted.locator("#viewerLoading")).toBeHidden();
    expect(await restarted.evaluate(async () => (await fetch("./__gamespace_content__/index.html")).status)).toBe(200);
  } finally {
    await context.close();
    const resolved = await realpath(profile);
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith("gs-pwa-e2e-")) throw new Error("Unexpected browser profile path");
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("production UI installs a verified release and can roll back offline", async ({ page, request, context }) => {
  const versions = await (await request.get("/__e2e_versions__")).json();
  await openApp(page);
  expect(await page.locator("#e2eUpdateFixture").count()).toBe(0);
  await page.locator("#checkPwaUpdateButton").click();
  const card = page.locator("#pwaVersionsList .release-option").filter({ has: page.locator("strong", { hasText: `GameSpace ${versions.goodVersion}` }) });
  await card.locator("button").click();
  await expect(page.locator("#appHeaderVersion")).toHaveText(versions.goodVersion);
  await expect.poll(async () => (await runtime(page, "GET_RUNTIME_STATE")).state.pendingVersion).toBeNull();
  await context.setOffline(true);
  await page.locator("#rollbackPwaButton").click();
  await expect(page.locator("#appHeaderVersion")).toHaveText(versions.version);
});

test("a release with invalid SHA-256 leaves the working version active", async ({ page }) => {
  await openApp(page);
  const before = await runtime(page, "GET_RUNTIME_STATE");
  const result = await runtime(page, "INSTALL_RELEASE", { manifestUrl: "./releases/corrupt/release.json" });
  expect(result.ok).toBe(false); expect(result.error).toContain("SHA-256");
  expect((await runtime(page, "GET_RUNTIME_STATE")).state.activeVersion).toBe(before.state.activeVersion);
  await page.reload(); await expect(page.locator("#statusText")).toContainText("готово", { ignoreCase: true });
});

test("a fully downloaded release that fails its first startup rolls back on the next launch", async ({ page, request, context }) => {
  const { version, brokenVersion } = await (await request.get("/__e2e_versions__")).json();
  await openApp(page);
  expect((await runtime(page, "INSTALL_RELEASE", { manifestUrl: `./releases/${brokenVersion}/release.json` })).ok).toBe(true);
  expect((await runtime(page, "ACTIVATE_RELEASE", { version: brokenVersion })).ok).toBe(true);
  await context.setOffline(true);
  await page.reload(); await expect(page.locator("#broken-release")).toBeVisible();
  await page.reload(); await expect(page.locator("#appHeaderVersion")).toHaveText(version);
  await expect.poll(async () => (await runtime(page, "GET_RUNTIME_STATE")).state.pendingVersion).toBeNull();
});

test("7z system files are removed before installed-content verification", async ({ page, request }) => {
  const archive = await (await request.get("/__e2e_archive__")).body();
  await openApp(page);
  await choose(page, "#chooseArchiveButton", archive, "system-files.7z");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const state = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("state"); r.onsuccess = () => resolve(r.result); }); db.close();
    let dir = root; for (const part of state.revisionPath.split("/")) dir = await dir.getDirectoryHandle(part);
    const top = []; for await (const [name] of dir.entries()) top.push(name);
    const site = await dir.getDirectoryHandle("site");
    return { files: state.files, mac: top.includes("__MACOSX"), siteEntries: (await Array.fromAsync(site.entries())).length };
  })).toEqual({ files: 1, mac: false, siteEntries: 0 });
});

test("another window waits for an active import instead of deleting its staging files", async ({ page, context }) => {
  await openApp(page);
  await page.evaluate(async () => {
    window.operationHeld = new Promise(resolve => {
      navigator.locks.request("gamespace-site-operation-v1", async () => {
        let root = await navigator.storage.getDirectory();
        for (const name of ["gamespace", "revisions", "in-progress"]) root = await root.getDirectoryHandle(name, { create: true });
        resolve(); await new Promise(done => { window.finishOperation = done; });
      });
    }); await window.operationHeld;
  });
  const second = await context.newPage(); await installedWindow(second); await second.goto("./");
  await expect.poll(async () => page.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThan(0);
  expect(await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const revisions = await (await root.getDirectoryHandle("gamespace")).getDirectoryHandle("revisions");
    return (await revisions.getDirectoryHandle("in-progress")).kind;
  })).toBe("directory");
  await page.evaluate(() => window.finishOperation());
  await expect(second.locator("#statusText")).toContainText("готово", { ignoreCase: true });
  await second.close();
});

test("corrupt ZIP update preserves the installed content", async ({ page }) => {
  await openApp(page);
  await choose(page, "#chooseArchiveButton", await zipFiles({ "index.html": "ORIGINAL" }));
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  const changed = await zipFiles({ "index.html": "CHANGED!" }); changed[changed.indexOf(Buffer.from("CHANGED!"))] ^= 1;
  await choose(page, "#fastUpdateButton", changed);
  await expect(page.locator("#statusText")).toHaveText("Не удалось обработать архив");
  expect(await page.evaluate(async () => (await fetch("./__gamespace_content__/index.html")).text())).toBe("ORIGINAL");
});

test("fast update preserves exact totals without visiting unrelated content and releases the screen lock", async ({ page }) => {
  await openApp(page);
  await choose(page, "#chooseArchiveButton", await zipFiles({ "index.html": "old", "untouched/keep.txt": "keep" }));
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await page.evaluate(async () => {
    const originalRoot = await navigator.storage.getDirectory();
    function wrap(handle, path = "") {
      return {
        kind: handle.kind, name: handle.name,
        async *entries() {
          if (path.endsWith("/untouched")) throw new Error("Unrelated content must not be scanned during fast update");
          for await (const [name, nested] of handle.entries()) yield [name, nested.kind === "directory" ? wrap(nested, `${path}/${name}`) : nested];
        },
        getFileHandle: (...args) => handle.getFileHandle(...args),
        removeEntry: (...args) => handle.removeEntry(...args),
        async getDirectoryHandle(name, options) { return wrap(await handle.getDirectoryHandle(name, options), `${path}/${name}`); },
      };
    }
    Object.defineProperty(navigator.storage, "getDirectory", { configurable: true, value: async () => wrap(originalRoot) });
    window.screenRequests = 0; window.screenReleases = 0;
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { async request(type) {
      if (type !== "screen") throw new Error("Unexpected lock");
      window.screenRequests++;
      const sentinel = new EventTarget();
      sentinel.release = async () => { window.screenReleases++; sentinel.dispatchEvent(new Event("release")); };
      return sentinel;
    } } });
  });
  await choose(page, "#fastUpdateButton", await zipFiles({ "index.html": "new", "added.txt": "added" }));
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open("gamespace-pwa", 1); r.onsuccess = () => resolve(r.result); });
    const state = await new Promise(resolve => { const r = db.transaction("app").objectStore("app").get("state"); r.onsuccess = () => resolve(r.result); }); db.close();
    return { files: state.files, bytes: state.writtenBytes, requests: window.screenRequests, releases: window.screenReleases };
  })).toEqual({ files: 3, bytes: 12, requests: 1, releases: 1 });
});
