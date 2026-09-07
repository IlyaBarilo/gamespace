import test from "node:test";
import assert from "node:assert/strict";
import { summarizeStorage, formatStoragePercent } from "../src/storage-summary.js";

const GB = 1024 ** 3;

test("a 2 GB site occupies 20% of a 10 GB quota even with a smaller browser estimate", () => {
  const summary = summarizeStorage(2 * GB, { usage: 10 * 1024 ** 2, quota: 10 * GB });
  assert.equal(summary.percent, 20);
  assert.equal(formatStoragePercent(summary.percent), "20%");
  assert.equal(summary.usedBytes, 2 * GB);
  assert.equal(summary.usesManagedSize, true);
  assert.equal(summary.usage, 10 * 1024 ** 2, "retain the raw estimate for diagnostics");
});

test("a higher browser estimate includes other app data without counting the site twice", () => {
  const summary = summarizeStorage(2 * GB, { usage: 3 * GB, quota: 10 * GB });
  assert.equal(summary.percent, 30);
  assert.equal(summary.usedBytes, 3 * GB);
  assert.equal(summary.usesManagedSize, false);
});

test("known files remain counted when reported usage is missing or invalid", () => {
  for (const usage of [undefined, null, -1, NaN, Infinity, "2147483648"]) {
    const summary = summarizeStorage(2 * GB, { usage, quota: 10 * GB });
    assert.equal(summary.percent, 20);
    assert.equal(summary.usage, null);
    assert.equal(summary.usesManagedSize, true);
  }
});

test("an unavailable quota is unknown instead of a misleading zero percent", () => {
  for (const quota of [undefined, null, 0, -1, NaN, Infinity, "10737418240"]) {
    const summary = summarizeStorage(2 * GB, { usage: 2 * GB, quota });
    assert.equal(summary.usedBytes, 2 * GB);
    assert.equal(summary.percent, null);
    assert.equal(formatStoragePercent(summary.percent), "—");
  }
});

test("unknown usage differs from a measured zero and removed files are not retained", () => {
  assert.equal(summarizeStorage(0, undefined).percent, null);
  assert.equal(summarizeStorage(0, { quota: 10 * GB }).percent, null);
  const empty = summarizeStorage(0, { usage: 0, quota: 10 * GB });
  assert.equal(formatStoragePercent(empty.percent), "0%");
  const removed = summarizeStorage(0, { usage: 10 * 1024 ** 2, quota: 10 * GB });
  assert.equal(removed.usesManagedSize, false);
  assert.equal(formatStoragePercent(removed.percent), "<0,1%");
});

test("large archives preserve the ratio and a changed quota cannot overfill the ring", () => {
  assert.equal(summarizeStorage(40 * GB, { usage: 0, quota: 200 * GB }).percent, 20);
  assert.equal(summarizeStorage(20 * GB, { usage: 0, quota: 10 * GB }).percent, 100);
});

test("small percentages remain honest when the quota really is large", () => {
  const summary = summarizeStorage(2 * GB, { usage: 2 * GB, quota: 2048 * GB });
  assert.equal(formatStoragePercent(summary.percent), "<0,1%");
  assert.equal(formatStoragePercent(12.34), "12,3%");
});
