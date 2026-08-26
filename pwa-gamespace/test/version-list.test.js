import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getVersionBatch,
  normalizeReleaseDescription,
  shouldExpandDescription,
} from "../src/version-list.js";

test("shows versions in groups of three", () => {
  const versions = ["7", "6", "5", "4", "3", "2", "1"];
  const first = getVersionBatch(versions, 0);
  assert.deepEqual(first, { items: ["7", "6", "5"], nextOffset: 3, remaining: 4 });
  const second = getVersionBatch(versions, first.nextOffset);
  assert.deepEqual(second, { items: ["4", "3", "2"], nextOffset: 6, remaining: 1 });
  const third = getVersionBatch(versions, second.nextOffset);
  assert.deepEqual(third, { items: ["1"], nextOffset: 7, remaining: 0 });
});

test("expands only versions newer than the active release", () => {
  assert.equal(shouldExpandDescription(0, 2), true);
  assert.equal(shouldExpandDescription(1, 2), true);
  assert.equal(shouldExpandDescription(2, 2), false);
  assert.equal(shouldExpandDescription(3, 2), false);
  assert.equal(shouldExpandDescription(0, -1), true);
  assert.equal(shouldExpandDescription(1, -1), false);
});

test("preserves release description line breaks", () => {
  assert.equal(normalizeReleaseDescription("Первая строка\r\n\r\n- пункт"), "Первая строка\n\n- пункт");
});

test("renders every release description above its install button", async () => {
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(appSource, /article\.append\(header, description, button\);/);
  assert.doesNotMatch(appSource, /header\.append\(copy, button\);/);
});
