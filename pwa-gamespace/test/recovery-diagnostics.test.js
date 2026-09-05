import test from "node:test";
import assert from "node:assert/strict";
import { recoverInterruptedOperation } from "../src/import-manager.js";

function setup(t, { denyDelete = false, denyBackup = false } = {}) {
  const journal = { type: "update-merge", targetPath: "site", updatePath: "updates/id", rollbackPath: "rollback/id", createdPaths: denyBackup ? [] : ["new.txt"], restoredPaths: denyBackup ? ["index.html"] : [] };
  const data = new Map([["operation-journal", journal]]);
  const removed = [];
  const root = {
    async getDirectoryHandle() { return root; },
    async getFileHandle() { throw new DOMException("backup unavailable", "NotAllowedError"); },
    async removeEntry(name) {
      if (denyDelete) throw new DOMException("delete denied", "NotAllowedError");
      removed.push({ name, journalStillPresent: data.has("operation-journal") });
    },
  };
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const transaction = { objectStore() { return {
          get(key) { const r = {}; queueMicrotask(() => { r.result = data.get(key); r.onsuccess(); }); return r; },
          delete(key) { data.delete(key); queueMicrotask(() => transaction.oncomplete?.()); },
        }; } };
        return transaction;
      } };
      request.onsuccess();
    });
    return request;
  } };
  for (const [name, value] of Object.entries({ indexedDB, navigator: { locks: { request: async (_name, _options, action) => action() }, storage: { getDirectory: async () => root } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  return { data, removed };
}

test("incomplete recovery preserves journal and backups when a created file cannot be removed", async (t) => {
  const { data, removed } = setup(t, { denyDelete: true });
  await assert.rejects(recoverInterruptedOperation(), /Журнал и резервные файлы сохранены/);
  assert.ok(data.has("operation-journal"));
  assert.equal(removed.length, 0);
});

test("backup read failure preserves the original exception and recovery journal", async (t) => {
  const { data, removed } = setup(t, { denyBackup: true });
  await assert.rejects(recoverInterruptedOperation(), { name: "NotAllowedError", message: "backup unavailable" });
  assert.ok(data.has("operation-journal"));
  assert.equal(removed.length, 0);
});

test("successful recovery clears journal before deleting now-unneeded backups", async (t) => {
  const { data, removed } = setup(t);
  assert.equal(await recoverInterruptedOperation(), true);
  assert.equal(data.has("operation-journal"), false);
  assert.deepEqual(removed.map((r) => r.journalStillPresent), [true, false, false]);
});
