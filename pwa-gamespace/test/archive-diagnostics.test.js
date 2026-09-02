import test from "node:test";
import assert from "node:assert/strict";
import { BlobWriter, configure, TextReader, ZipWriter } from "@zip.js/zip.js";
import { extractZip } from "../src/archive/zip-import.js";
import { createDiagnosticReport } from "../src/diagnostics.js";
import { applyUpdateArchive, installFullArchive } from "../src/import-manager.js";

configure({ useWebWorkers: false });

function mockNavigator(t, { quota = 2 ** 31, createError = null, writeError = null, closeError = null } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const written = [];
  const directory = {
    async getDirectoryHandle() { return directory; },
    async getFileHandle() {
      if (createError) throw createError;
      return { async createWritable() {
        return new WritableStream({
          write(chunk) { if (writeError) throw writeError; written.push(chunk); },
          close() { if (closeError) throw closeError; },
        });
      } };
    },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: {
    estimate: async () => ({ quota, usage: 0 }), getDirectory: async () => directory, persist: async () => false,
  } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
  return written;
}

async function archive(name = "site/index.html") {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add(name, new TextReader("<!doctype html><title>test</title>"), { level: 0 });
  return new File([await writer.close()], "fixture.zip", { type: "application/zip" });
}

test("ZIP diagnostics do not change successful extraction", async (t) => {
  const written = mockNavigator(t);
  const events = [];
  const result = await extractZip({ file: await archive(), destination: "test", requireIndex: true, onEvent: (event) => events.push(event) });
  assert.equal(result.files, 1);
  assert.equal(result.indexPath, "site/index.html");
  assert.ok(written.length > 0);
  assert.equal(events.findLast((event) => event.type === "progress").completedFiles, 1);
});

test("ZIP with no index reports index-check instead of generic extraction", async (t) => {
  mockNavigator(t);
  await assert.rejects(extractZip({ file: await archive("site/asset.txt"), destination: "test", requireIndex: true }), (error) => {
    assert.equal(error.diagnosticContext.stage, "index-check");
    assert.equal(createDiagnosticReport(error).code, "GS-INDEX-CHECK");
    return true;
  });
});

test("ZIP quota preflight reports required and available bytes", async (t) => {
  mockNavigator(t, { quota: 100 });
  await assert.rejects(extractZip({ file: await archive(), destination: "test", requireIndex: true }), (error) => {
    assert.equal(error.diagnosticContext.stage, "quota-check");
    assert.equal(error.diagnosticContext.availableBytes, 100);
    assert.ok(error.diagnosticContext.requiredBytes > 100);
    assert.equal(createDiagnosticReport(error).code, "GS-NO-SPACE");
    return true;
  });
});

test("ZIP destination creation error identifies filename before any progress", async (t) => {
  mockNavigator(t, { createError: new DOMException("denied", "NotAllowedError") });
  await assert.rejects(extractZip({ file: await archive(), destination: "test", requireIndex: true }), (error) => {
    assert.equal(error.diagnosticContext.stage, "file-create");
    assert.equal(error.diagnosticContext.currentFile, "site/index.html");
    assert.equal(createDiagnosticReport(error).code, "GS-ACCESS");
    return true;
  });
});

test("ZIP write error retains the original failure through reader cleanup", async (t) => {
  mockNavigator(t, { writeError: new DOMException("quota exceeded", "QuotaExceededError") });
  await assert.rejects(extractZip({ file: await archive(), destination: "test", requireIndex: true }), (error) => {
    assert.equal(error.diagnosticContext.stage, "file-extract");
    assert.equal(error.cause.name, "QuotaExceededError");
    return true;
  });
});

test("invalid ZIP header retains the listing phase", async (t) => {
  mockNavigator(t);
  await assert.rejects(extractZip({ file: new File(["not a zip"], "broken.zip"), destination: "test", requireIndex: true }), (error) => {
    assert.equal(error.diagnosticContext.stage, "list");
    return true;
  });
});

test("ZIP commit error retains file-close phase and the original storage failure", async (t) => {
  mockNavigator(t, { closeError: new DOMException("disk full on commit", "QuotaExceededError") });
  await assert.rejects(extractZip({ file: await archive(), destination: "test", requireIndex: true }), (error) => {
    assert.equal(error.diagnosticContext.stage, "file-close");
    assert.equal(error.diagnosticContext.currentFile, "site/index.html");
    assert.equal(error.cause.name, "QuotaExceededError");
    assert.equal(createDiagnosticReport(error).code, "GS-NO-SPACE");
    return true;
  });
});

test("full and incremental import capture IndexedDB failure before archive extraction", async (t) => {
  mockNavigator(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { throw new DOMException("blocked", "SecurityError"); } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "indexedDB", previous) : delete globalThis.indexedDB);
  for (const install of [installFullArchive, applyUpdateArchive]) {
    await assert.rejects(install(await archive()), (error) => {
      assert.equal(error.diagnosticContext.stage, "state-read");
      assert.equal(error.diagnosticContext.archive.name, "fixture.zip");
      assert.equal(createDiagnosticReport(error).code, "GS-ACCESS");
      return true;
    });
  }
});
