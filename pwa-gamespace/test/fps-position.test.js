import test from "node:test";
import assert from "node:assert/strict";
import { fpsPlacement, normalizeFpsPosition } from "../src/fps-position.js";

test("FPS positions accept only known values and default to top left", () => {
  for (const value of ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "black-field"]) {
    assert.equal(normalizeFpsPosition(value), value);
  }
  for (const value of [null, undefined, "", "constructor", "top-right';alert(1)"]) assert.equal(normalizeFpsPosition(value), "top-left");
});

test("black field fits only when a usable gutter is visible; normal anchors remain available", () => {
  assert.deepEqual(fpsPlacement("black-field", { landscape: true, gutterWidth: 600 }), { position: "top-left", external: true, maxWidth: 280 });
  assert.deepEqual(fpsPlacement("black-field", { landscape: true, gutterWidth: 140 }), { position: "top-left", external: true, maxWidth: 124 });
  for (const layout of [{ landscape: false, gutterWidth: 400 }, { landscape: true, gutterWidth: 139 },
    { landscape: true, gutterWidth: 600, contentFullscreen: true }, {}]) {
    assert.deepEqual(fpsPlacement("black-field", layout), { position: "top-left", external: false });
  }
  assert.deepEqual(fpsPlacement("middle-left", { landscape: true, gutterWidth: 600 }), { position: "middle-left", external: false });
});
