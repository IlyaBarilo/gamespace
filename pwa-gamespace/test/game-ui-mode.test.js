import test from "node:test";
import assert from "node:assert/strict";
import { detectGameUiMode, normalizeGameUiMode } from "../src/game-ui-mode.js";

test("normalizes only supported explicit UI modes", () => {
  assert.equal(normalizeGameUiMode(" MOBILE "), "mobile");
  assert.equal(normalizeGameUiMode("tv"), "tv");
  assert.equal(normalizeGameUiMode("large"), "");
});

test("uses explicit UI mode before automatic detection", () => {
  assert.equal(detectGameUiMode({ width: 390, height: 844, coarsePointer: true, requested: "tv" }), "tv");
  assert.equal(detectGameUiMode({ width: 3840, height: 2160, requested: "mobile" }), "mobile");
});

test("detects phones, tablets, large touch displays and large desktop displays", () => {
  assert.equal(detectGameUiMode({ width: 390, height: 844, coarsePointer: true }), "mobile");
  assert.equal(detectGameUiMode({ width: 1024, height: 1366, coarsePointer: true }), "mobile");
  assert.equal(detectGameUiMode({ width: 1920, height: 1080, coarsePointer: true }), "tv");
  assert.equal(detectGameUiMode({ width: 3840, height: 2160, coarsePointer: false }), "tv");
  assert.equal(detectGameUiMode({ width: 1920, height: 1080, coarsePointer: false }), "");
});
