import test from "node:test";
import assert from "node:assert/strict";
import { mergeDirectoryWithRollback, rollbackMergedDirectory } from "../src/opfs.js";
import { updatedSiteStatistics } from "../src/import-manager.js";
import { memoryOpfs } from "../test-support/memory-opfs.js";

const paths = { sourcePath: "staging", targetPath: "active", rollbackPath: "backup" };

test("many-file update writes one legacy-compatible journal and visits only changed files", async t => {
  const fs = memoryOpfs(t);
  for (let i = 0; i < 1000; i++) fs.write(`staging/f${i}`, "new");
  fs.write("active/f0", "old-longer");
  fs.write("active/untouched/keep", "keep");
  let journals = 0;
  fs.hooks.list = path => assert.notEqual(path, "active", "must not enumerate installed site");
  fs.hooks.read = path => assert.notEqual(path, "active/untouched/keep");
  const merged = await mergeDirectoryWithRollback({ ...paths, async onJournal(journal) {
    journals++;
    assert.equal(await fs.read("active/f0"), "old-longer", "journal precedes every replacement");
    assert.equal(await fs.read("backup/f0"), "old-longer", "backup is complete before journal");
    assert.equal(journal.createdPaths.length, 999);
    assert.deepEqual(journal.restoredPaths, ["f0"]);
  } });
  assert.equal(journals, 1);
  assert.deepEqual(updatedSiteStatistics({ files: 2, writtenBytes: 14 }, merged), { files: 1001, bytes: 3004 });
  // Older releases can replay these same arrays after process death.
  await rollbackMergedDirectory({ ...paths, ...merged });
  assert.equal(await fs.read("active/f0"), "old-longer");
  assert.equal(await fs.read("active/untouched/keep"), "keep");
  assert.equal(fs.files.has("active/f999"), false);
});

test("failure during backup never publishes a journal or modifies active content", async t => {
  const fs = memoryOpfs(t);
  fs.write("staging/index.html", "new"); fs.write("active/index.html", "original");
  fs.hooks.write = path => { if (path === "backup/index.html") throw new Error("backup write failed"); };
  let journalSaved = false;
  await assert.rejects(mergeDirectoryWithRollback({ ...paths, onJournal() { journalSaved = true; } }), /backup write failed/);
  assert.equal(journalSaved, false);
  assert.equal(await fs.read("active/index.html"), "original");
});

test("journal write failure preserves the installed site", async t => {
  const fs = memoryOpfs(t);
  fs.write("staging/index.html", "new"); fs.write("active/index.html", "original");
  await assert.rejects(mergeDirectoryWithRollback({ ...paths, onJournal() { throw new Error("IDB commit failed"); } }), /IDB commit failed/);
  assert.equal(await fs.read("active/index.html"), "original");
});

test("cancellation after replacement restores originals and removes new files", async t => {
  const fs = memoryOpfs(t);
  fs.write("staging/index.html", "new"); fs.write("staging/new.txt", "new file");
  fs.write("active/index.html", "original");
  const controller = new AbortController();
  await assert.rejects(mergeDirectoryWithRollback({ ...paths, signal: controller.signal, onJournal() {},
    onProgress() { controller.abort(); },
  }), { name: "AbortError" });
  assert.equal(await fs.read("active/index.html"), "original");
  assert.equal(fs.files.has("active/new.txt"), false);
});
