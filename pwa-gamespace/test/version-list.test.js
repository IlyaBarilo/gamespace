import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareReleaseVersions, isNewerRelease, orderedReleases, normalizeReleaseDescription } from "../src/version-list.js";

test("catalog traversal starts at the official latest without changing its source", () => {
  const catalog = { latest: "0.4.0", versions: ["0.3.9", "0.3.10", "0.4.0"].map(version => ({ version })) };
  assert.deepEqual(orderedReleases(catalog).map(r => r.version), ["0.4.0", "0.3.10", "0.3.9"]);
  assert.equal(catalog.versions[0].version, "0.3.9");
});

test("update action compares version numbers and never offers a downgrade", () => {
  assert.equal(isNewerRelease("0.3.10", "0.3.9"), true);
  assert.equal(isNewerRelease("1.0.0", "0.99.99"), true);
  assert.equal(isNewerRelease("0.3.9", "0.3.10"), false);
  assert.equal(isNewerRelease("0.3.10", "0.3.10"), false);
  assert.equal(compareReleaseVersions("1.0.0-rc.10", "1.0.0-rc.2"), 1);
  assert.equal(compareReleaseVersions("1.0.0", "1.0.0-rc.10"), 1);
});

test("preserves release description line breaks", () => {
  assert.equal(normalizeReleaseDescription("Первая строка\r\n\r\n- пункт"), "Первая строка\n\n- пункт");
});

test("renders every release description above its install button", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /article\.append\(header, description, button\);/);
  assert.doesNotMatch(source, /header\.append\(copy, button\);/);
});
