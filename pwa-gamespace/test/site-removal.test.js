import test from "node:test";
import assert from "node:assert/strict";
import { readInstalledSiteState, recoverInterruptedOperation, removeInstalledSite } from "../src/import-manager.js";

function setup(t, options = {}) {
  const installed = { activeRevision: "id", revisionPath: "gamespace/revisions/id", indexPath: "index.html" };
  const data = new Map([["state", installed]]);
  const removed = [];
  const controls = { exists: true, hasFiles: true, ...options };
  const root = {
    async getDirectoryHandle(name) {
      if (name === "id") {
        controls.onDirectory?.(data);
        if (controls.accessError) throw controls.accessError;
        if (!controls.exists) throw new DOMException("missing revision", "NotFoundError");
      }
      return root;
    },
    async *entries() { if (controls.hasFiles) yield ["remaining-asset.txt", { kind: "file" }]; },
    async removeEntry(name) {
      if (name === controls.failDelete) throw new DOMException("cleanup denied", "NotAllowedError");
      removed.push({ name, state: data.get("state"), journal: data.get("operation-journal") });
      if (name === "id") controls.exists = false;
    },
  };
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction(name, mode) {
        const draft = new Map(data);
        const transaction = { objectStore() { return {
          get(key) { const result = {}; queueMicrotask(() => { result.result = draft.get(key); result.onsuccess?.(); }); return result; },
          put(value, key) { draft.set(key, value); },
          delete(key) { draft.delete(key); },
        }; } };
        setImmediate(() => {
          if (mode === "readwrite" && controls.abortWrite) {
            transaction.error = new DOMException("transaction aborted", "AbortError");
            transaction.onabort?.();
          } else {
            if (mode === "readwrite") { data.clear(); for (const entry of draft) data.set(...entry); }
            transaction.oncomplete?.();
          }
        });
        return transaction;
      } };
      request.onsuccess();
    });
    return request;
  } };
  for (const [name, value] of Object.entries({ indexedDB, navigator: { storage: { getDirectory: async () => root } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  return { data, removed, installed, controls };
}

test("deletion detaches the active site and persists intent before touching files", async t => {
  const { data, removed } = setup(t);
  await removeInstalledSite();
  assert.equal(data.has("state"), false);
  assert.equal(data.has("operation-journal"), false);
  assert.deepEqual(removed.map(item => item.name), ["id", "updates", "rollback"]);
  for (const item of removed) {
    assert.equal(item.state, undefined);
    assert.equal(item.journal.type, "site-delete");
  }
});

test("failure after deleting the revision leaves a replayable journal and no active site", async t => {
  const { data, controls } = setup(t, { failDelete: "updates" });
  await assert.rejects(removeInstalledSite(), { name: "NotAllowedError" });
  assert.equal(controls.exists, false);
  assert.equal(data.has("state"), false);
  assert.equal(data.get("operation-journal").revisionPath, "gamespace/revisions/id");
  controls.failDelete = null;
  assert.equal(await recoverInterruptedOperation(), true);
  assert.equal(data.has("operation-journal"), false);
  assert.equal(await readInstalledSiteState(), null);
});

test("an aborted deletion transaction preserves both metadata and files", async t => {
  const { data, installed, removed } = setup(t, { abortWrite: true });
  await assert.rejects(removeInstalledSite(), { name: "AbortError" });
  assert.deepEqual(data.get("state"), installed);
  assert.equal(data.has("operation-journal"), false);
  assert.deepEqual(removed, []);
});

test("old metadata for a missing revision is cleared without deleting other files", async t => {
  const { data, removed } = setup(t, { exists: false });
  assert.equal(await readInstalledSiteState(), null);
  assert.equal(data.has("state"), false);
  assert.deepEqual(removed, []);
});

test("old metadata for an empty revision returns the import menu state", async t => {
  const { data, removed } = setup(t, { hasFiles: false });
  assert.equal(await readInstalledSiteState(), null);
  assert.equal(data.has("state"), false);
  assert.deepEqual(removed, []);
});

test("storage access errors retain the installed site metadata", async t => {
  const { data, installed } = setup(t, { accessError: new DOMException("denied", "NotAllowedError") });
  await assert.rejects(readInstalledSiteState(), { name: "NotAllowedError" });
  assert.deepEqual(data.get("state"), installed);
});

test("a revision with remaining files is preserved even without an index", async t => {
  const { data, installed, removed } = setup(t);
  assert.deepEqual(await readInstalledSiteState(), installed);
  assert.deepEqual(data.get("state"), installed);
  assert.deepEqual(removed, []);
});

test("missing-revision cleanup cannot clear a newer installation", async t => {
  const newer = { activeRevision: "new", revisionPath: "gamespace/revisions/new" };
  const { data } = setup(t, { exists: false, onDirectory: store => store.set("state", newer) });
  assert.deepEqual(await readInstalledSiteState(), newer);
  assert.deepEqual(data.get("state"), newer);
});
