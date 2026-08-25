import test from "node:test";
import assert from "node:assert/strict";
import {
  dirname,
  findIndexEntry,
  normalizeArchivePath,
  parse7zSlt,
  summarizeEntries,
  validateEntries,
} from "../src/archive/archive-plan.js";

test("normalizes safe archive paths", () => {
  assert.equal(normalizeArchivePath("./site\\games/index.html"), "site/games/index.html");
  assert.equal(normalizeArchivePath("site/"), "site");
  assert.equal(dirname("site/index.html"), "site");
});

test("rejects zip-slip and absolute paths", () => {
  for (const path of ["../secret", "site/../secret", "/etc/passwd", "C:/Windows/file", "site//file"]) {
    assert.throws(() => normalizeArchivePath(path), /путь/i);
  }
});

test("rejects duplicate normalized entries", () => {
  assert.throws(() => validateEntries([
    { path: "site/index.html", directory: false, size: 1 },
    { path: "./site/index.html", directory: false, size: 1 },
  ]), /Повторяющийся/);
});

test("finds APK-compatible index layouts", () => {
  assert.equal(findIndexEntry([{ path: "index.htm", directory: false }]).path, "index.htm");
  assert.equal(findIndexEntry([{ path: "site/index.html", directory: false }]).path, "site/index.html");
  assert.equal(findIndexEntry([
    { path: "bundle", directory: true },
    { path: "bundle/index.html", directory: false },
  ]).path, "bundle/index.html");
  assert.equal(findIndexEntry([
    { path: "one/index.html", directory: false },
    { path: "two/index.html", directory: false },
  ]), null);
});

test("parses 7z technical listing without counting archive header", () => {
  const entries = parse7zSlt([
    "Path = source.7z",
    "Type = 7z",
    "Physical Size = 120",
    "----------",
    "Path = site",
    "Size = 0",
    "Folder = +",
    "Attributes = D....",
    "",
    "Path = site/index.html",
    "Size = 42",
    "Modified = 2026-08-24 10:00:00",
    "Attributes = A....",
    "",
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(summarizeEntries(entries), { entries: 2, files: 1, uncompressedBytes: 42 });
  assert.equal(findIndexEntry(entries).path, "site/index.html");
});
