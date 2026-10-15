import test from "node:test";
import assert from "node:assert/strict";
import { activateCatalogWithLocalStorage, archiveStorageSlot, recoverGameLocalStorage, restoreGameLocalStorage, snapshotGameLocalStorage } from "../src/archive-localstorage.js";
import { createArchiveCatalog, storeArchiveInCatalog, DEMO_ARCHIVE_ID } from "../src/archive-catalog.js";

function setup(t) {
  const first = { archiveId: "a", activeRevision: "a", revisionPath: "gamespace/archives/a", archiveName: "work.zip", installedAt: 1 };
  let catalog = storeArchiveInCatalog(createArchiveCatalog(), first);
  catalog = storeArchiveInCatalog(catalog, { ...first, archiveId: "b", activeRevision: "b", revisionPath: "gamespace/archives/b" });
  catalog = { ...catalog, activeId: "a" };
  const data = new Map([["archive-catalog-v1", structuredClone(catalog)]]);
  const values = new Map([["score", "A"], ["gamespace:viewer-menu-tab:v1", "1"], ["gamespace:activity:v1:owner", "common"]]);
  const controls = { failCommit: false, failKey: null, permanentlyDenied: false };
  const storage = {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (controls.permanentlyDenied || key === controls.failKey) { controls.failKey = null; throw new DOMException("native storage denied", "QuotaExceededError"); }
      values.set(key, String(value));
    }, removeItem: key => values.delete(key),
  };
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction(_name, mode) {
        const draft = new Map(data); let failed = false;
        const tx = { objectStore() { return {
          get(key) { const r = {}; queueMicrotask(() => { r.result = structuredClone(draft.get(key)); r.onsuccess?.(); }); return r; },
          put(value, key) { if (controls.failCommit && key === "archive-catalog-v1") { failed = true; controls.failCommit = false; } draft.set(key, structuredClone(value)); },
          delete(key) { draft.delete(key); },
        }; } };
        setImmediate(() => {
          if (failed) { tx.error = new DOMException("transaction denied", "QuotaExceededError"); tx.onabort?.(); }
          else {
            if (mode === "readwrite") { data.clear(); for (const entry of draft) data.set(...entry); }
            tx.oncomplete?.();
          }
        });
        return tx;
      } }; request.onsuccess();
    }); return request;
  } };
  for (const [name, value] of Object.entries({ indexedDB, localStorage: storage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const select = (id, options) => activateCatalogWithLocalStorage({ ...catalog, activeId: id }, options);
  return { data, values, controls, storage, catalog, select };
}
const gameValues = () => new Map(snapshotGameLocalStorage());
const controlKey = "archive-localstorage-v1";

test("old saves belong to the selected archive; different archives restore their own native keys", async t => {
  const { select, storage, values } = setup(t);
  await select("a");
  storage.setItem("gamespace:compatibility-check:archive:v1:id:a", "observed A");
  storage.setItem("gamespace:viewer-fps:v1", "1");
  storage.setItem("gamespace:viewer-fps-position:v1", "middle-left");
  storage.setItem("score", "latest A");
  await select("b");
  assert.equal(storage.getItem("score"), null);
  storage.setItem("score", "B"); storage.setItem("__proto__", "safe value"); storage.setItem("", "empty key");
  await select("a");
  assert.deepEqual(gameValues(), new Map([["score", "latest A"]]));
  await select("b");
  assert.deepEqual(gameValues(), new Map([["score", "B"], ["__proto__", "safe value"], ["", "empty key"]]));
  assert.equal(values.get("gamespace:viewer-menu-tab:v1"), "1");
  assert.equal(values.get("gamespace:viewer-fps:v1"), "1");
  assert.equal(values.get("gamespace:viewer-fps-position:v1"), "middle-left");
  assert.equal(values.get("gamespace:activity:v1:owner"), "common");
  assert.equal(values.get("gamespace:compatibility-check:archive:v1:id:a"), "observed A");
});

test("shared mode seeds once, preserves individual sets and reuses the saved common set", async t => {
  const { select, storage } = setup(t);
  await select("a");
  await select("a", { shared: true });
  assert.equal(storage.getItem("score"), "A");
  storage.setItem("score", "shared latest");
  await select("b");
  assert.equal(storage.getItem("score"), "shared latest");
  await select("b", { shared: false });
  assert.equal(storage.getItem("score"), null);
  storage.setItem("score", "own B");
  await select("a");
  assert.equal(storage.getItem("score"), "A");
  await select("a", { shared: true });
  assert.equal(storage.getItem("score"), "shared latest");
  await select("b", { shared: false });
  assert.equal(storage.getItem("score"), "own B");
});

test("startup uses live native data, including intentional removals, instead of an old snapshot", async t => {
  const { select, storage } = setup(t);
  await select("a"); await select("b"); await select("a");
  storage.removeItem("score"); storage.setItem("new", "after snapshot");
  await select("a");
  assert.deepEqual(gameValues(), new Map([["new", "after snapshot"]]));
});

test("a quota failure while restoring the target rolls back native data and leaves the selection unchanged", async t => {
  const { select, data, storage, controls } = setup(t);
  await select("a"); await select("b"); storage.setItem("target", "B"); await select("a");
  controls.failKey = "target";
  await assert.rejects(select("b"), { code: "GS-STORAGE-SWITCH" });
  assert.equal(data.get("archive-catalog-v1").activeId, "a");
  assert.deepEqual(gameValues(), new Map([["score", "A"]]));
  assert.equal(data.get(controlKey).pending, null);
  await select("b"); assert.equal(storage.getItem("target"), "B");
});

test("an aborted final IndexedDB commit restores the previous dataset without mixing archives", async t => {
  const { select, data, storage, controls } = setup(t);
  await select("a"); storage.setItem("score", "latest A");
  controls.failCommit = true;
  await assert.rejects(select("b"), { code: "GS-STORAGE-SWITCH" });
  assert.equal(data.get("archive-catalog-v1").activeId, "a");
  assert.equal(storage.getItem("score"), "latest A");
  assert.equal(data.get(controlKey).pending, null);
});

test("an interrupted swap restores the source; failed recovery retains a replayable journal", async t => {
  const { select, data, storage, controls } = setup(t);
  await select("a");
  const record = data.get(controlKey);
  data.set(controlKey, { ...record, pending: { sourceSlot: record.slot, sourceEntries: [["score", "before crash"]] } });
  storage.removeItem("score"); storage.setItem("partial target", "wrong archive");
  controls.permanentlyDenied = true;
  await assert.rejects(recoverGameLocalStorage(), { name: "QuotaExceededError" });
  assert.ok(data.get(controlKey).pending);
  controls.permanentlyDenied = false;
  assert.equal(await recoverGameLocalStorage(), true);
  assert.deepEqual(gameValues(), new Map([["score", "before crash"]]));
  assert.equal(data.get(controlKey).pending, null);
});

test("deleting an individual profile preserves the shared set and prevents save resurrection", async t => {
  const { select, data, storage, catalog } = setup(t);
  await select("a"); await select("a", { shared: true }); storage.setItem("score", "common");
  const remaining = { ...catalog, entries: catalog.entries.filter(entry => entry.id !== "a"), activeId: "b" };
  await activateCatalogWithLocalStorage(remaining, { discardId: "a" });
  assert.equal(storage.getItem("score"), "common");
  assert.equal(data.has(`archive-localstorage-profile-v1:${archiveStorageSlot("a")}`), false);
  await activateCatalogWithLocalStorage(remaining, { shared: false });
  assert.equal(storage.getItem("score"), null);
});

test("a missing shared profile or a corrupt dataset fails before native data is changed", async t => {
  const { select, data, storage } = setup(t);
  await select("a"); await select("a", { shared: true }); await select("a", { shared: false });
  data.delete("archive-localstorage-profile-v1:shared");
  await assert.rejects(select("a", { shared: true }), /отсутствует/);
  assert.equal(storage.getItem("score"), "A");
  assert.throws(() => restoreGameLocalStorage([["gamespace:viewer-menu-tab:v1", "0"]]), /повреждён/);
  assert.throws(() => restoreGameLocalStorage([["score", "1"], ["score", "2"]]), /повреждён/);
  assert.equal(storage.getItem("score"), "A");
});

test("preparing an inactive demo preserves native saves, ownership and the shared-mode setting", async t => {
  const { catalog, select, values, data } = setup(t);
  await select("a");
  values.set("score", "latest native save");
  const before = new Map(values);
  const demo = { archiveId: DEMO_ARCHIVE_ID, activeRevision: "demo", revisionPath: "gamespace/archives/demo", installedAt: 2 };
  const prepared = storeArchiveInCatalog({ ...catalog, activeId: "a" }, demo, { kind: "demo", makeActive: false });
  await activateCatalogWithLocalStorage(prepared);
  assert.deepEqual(values, before);
  assert.equal(data.get(controlKey).ownerId, "a");
  assert.equal(data.get(controlKey).shared, false);
  assert.equal(data.get("archive-catalog-v1").activeId, "a");
});
