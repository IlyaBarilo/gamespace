import test from "node:test";
import assert from "node:assert/strict";
import {
  formatReleaseTag,
  normalizeVersion,
  parseReleaseTag,
} from "../scripts/release-utils.mjs";

test("normalizes shortened release versions", () => {
  assert.equal(normalizeVersion("1"), "1.0.0");
  assert.equal(normalizeVersion("0.5"), "0.5.0");
  assert.equal(normalizeVersion("0.6.22"), "0.6.22");
});

test("formats canonical shortened release tags", () => {
  assert.equal(formatReleaseTag("1.0.0"), "v1");
  assert.equal(formatReleaseTag("0.5.0"), "v0.5");
  assert.equal(formatReleaseTag("0.6.22"), "v0.6.22");
});

test("accepts only canonical release tag spelling", () => {
  assert.deepEqual(parseReleaseTag("v1"), {
    tag: "v1",
    tagVersion: "1",
    version: "1.0.0",
  });
  assert.equal(parseReleaseTag("v0.5").version, "0.5.0");
  assert.equal(parseReleaseTag("v0.6.22").version, "0.6.22");
  assert.throws(() => parseReleaseTag("v0.5.0"), /Используйте v0\.5/);
  assert.throws(() => parseReleaseTag("v1.0"), /Используйте v1/);
  assert.throws(() => parseReleaseTag("v10.10.11.2"), /Некорректная версия/);
  assert.throws(() => parseReleaseTag("v01"), /Некорректная версия/);
});
