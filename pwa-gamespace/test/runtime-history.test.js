import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeHistoryStore, formatRuntimeHistory } from "../src/runtime-history.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("records version periods with the current version first", () => {
  const storage = memoryStorage();
  const store = createRuntimeHistoryStore(() => storage);
  store.observe({ browser: "Google Chrome", version: "142.0.1", engine: "Chromium" }, 1_000);
  store.observe({ browser: "Google Chrome", version: "142.0.1", engine: "Chromium" }, 2_000);
  store.observe({ browser: "Google Chrome", version: "143.0.1", engine: "Chromium" }, 3_000);
  const entries = store.load().entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].version, "143.0.1");
  assert.equal(entries[1].lastSeen, 2_000);
  const text = formatRuntimeHistory(entries);
  assert.match(text, /Google Chrome 143\.0\.1 · Chromium[\s\S]+— сейчас/);
  assert.ok(text.indexOf("143.0.1") < text.indexOf("142.0.1"));
});

test("does not invent a new version when Chromium temporarily reports only its major version", () => {
  const storage = memoryStorage();
  const store = createRuntimeHistoryStore(() => storage);
  store.observe({ browser: "Google Chrome", version: "143.0.7499.40", engine: "Chromium" }, 1_000);
  store.observe({ browser: "Google Chrome", version: "143", engine: "Chromium" }, 2_000);
  store.observe({ browser: "Google Chrome", version: "143.0.0.0", engine: "Chromium" }, 3_000);
  const entries = store.load().entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].version, "143.0.7499.40");
  assert.equal(entries[0].lastSeen, 3_000);
});

test("retains only twenty changed versions and survives a new store instance", () => {
  const storage = memoryStorage();
  const store = createRuntimeHistoryStore(() => storage);
  for (let version = 120; version <= 143; version++) {
    store.observe({ browser: "Firefox", version: String(version), engine: "Gecko" }, version * 1_000);
  }
  const entries = createRuntimeHistoryStore(() => storage).load().entries;
  assert.equal(entries.length, 20);
  assert.equal(entries[0].version, "143");
  assert.equal(entries.at(-1).version, "124");
});
