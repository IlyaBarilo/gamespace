import test from "node:test";
import assert from "node:assert/strict";

import { formatBytes } from "../src/format.js";

test("formatBytes uses the shared binary units and Russian precision rules", () => {
  assert.equal(formatBytes(0), "0 Б");
  assert.equal(formatBytes(1024), "1,00 КБ");
  assert.equal(formatBytes(10 * 1024), "10,0 КБ");
  assert.equal(formatBytes(100 * 1024), "100 КБ");
  assert.equal(formatBytes(Math.round(2.47 * 1024 ** 3)), "2,47 ГБ");
  assert.equal(formatBytes(2.5 * 1024 ** 3), "2,50 ГБ");
});

test("formatBytes rejects invalid byte counts", () => {
  assert.equal(formatBytes(-1), "неизвестно");
  assert.equal(formatBytes(Number.NaN), "неизвестно");
});
