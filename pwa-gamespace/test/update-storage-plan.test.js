import test from "node:test";
import assert from "node:assert/strict";
import { calculateUpdateStorageRequirement } from "../src/import-manager.js";
import { summarizeMergeStorage } from "../src/opfs.js";

function file(size) {
  return { kind: "file", async getFile() { return { size }; } };
}

function directory(entries = {}) {
  return {
    kind: "directory",
    entries,
    async *[Symbol.asyncIterator]() { yield* Object.entries(entries); },
    async *entriesIterator() { yield* Object.entries(entries); },
    async getDirectoryHandle(name) {
      const handle = entries[name];
      if (!handle) throw new DOMException(`Missing directory: ${name}`, "NotFoundError");
      if (handle.kind !== "directory") throw new DOMException(`Not a directory: ${name}`, "TypeMismatchError");
      return handle;
    },
    async getFileHandle(name) {
      const handle = entries[name];
      if (!handle) throw new DOMException(`Missing file: ${name}`, "NotFoundError");
      if (handle.kind !== "file") throw new DOMException(`Not a file: ${name}`, "TypeMismatchError");
      return handle;
    },
  };
}

function opfsDirectory(entries = {}) {
  const handle = directory(entries);
  handle.entries = async function* () { yield* Object.entries(entries); };
  return handle;
}

test("exact update plan counts staged bytes and only backups that will be replaced", async (t) => {
  const root = opfsDirectory({
    updates: opfsDirectory({
      job: opfsDirectory({
        "index.html": file(120),
        assets: opfsDirectory({ "new.bin": file(900) }),
      }),
    }),
    revisions: opfsDirectory({
      active: opfsDirectory({
        "index.html": file(5_000),
        "unrelated.bin": file(50_000),
      }),
    }),
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => root } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);

  assert.deepEqual(await summarizeMergeStorage({
    sourcePath: "updates/job",
    targetPath: "revisions/active",
  }), {
    files: 2,
    sourceBytes: 1_020,
    backupBytes: 5_000,
    replacedFiles: 1,
    newFiles: 1,
  });
});

test("update requirement includes staged copy, exact rollback copy and safety reserve", () => {
  const small = calculateUpdateStorageRequirement({ sourceBytes: 1_020, backupBytes: 5_000 });
  assert.equal(small.reserveBytes, 512 * 1024 * 1024);
  assert.equal(small.requiredBytes, 512 * 1024 * 1024 + 6_020);

  const large = calculateUpdateStorageRequirement({ sourceBytes: 10 * 1024 ** 3, backupBytes: 3 * 1024 ** 3 });
  assert.equal(large.reserveBytes, 1024 ** 3);
  assert.equal(large.requiredBytes, 14 * 1024 ** 3);
});

test("update plan rejects a file-to-directory conflict before rollback journaling", async (t) => {
  const preserved = file(200);
  const root = opfsDirectory({
    updates: opfsDirectory({ job: opfsDirectory({ folder: file(100) }) }),
    revisions: opfsDirectory({ active: opfsDirectory({ folder: opfsDirectory({ "keep.txt": preserved }) }) }),
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => root } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);

  await assert.rejects(summarizeMergeStorage({
    sourcePath: "updates/job",
    targetPath: "revisions/active",
  }), /конфликтует с существующим каталогом/);
  assert.equal(preserved.kind, "file");
});
