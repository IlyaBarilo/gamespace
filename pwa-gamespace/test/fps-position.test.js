import test from "node:test";
import assert from "node:assert/strict";
import { fpsPlacement, normalizeFpsPosition, toolbarFpsWidth } from "../src/fps-position.js";

test("FPS positions accept only known values and default to the toolbar", () => {
  for (const value of ["toolbar", "top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "black-field"]) {
    assert.equal(normalizeFpsPosition(value), value);
  }
  for (const value of [null, undefined, "", "constructor", "top-right';alert(1)"]) assert.equal(normalizeFpsPosition(value), "toolbar");
});

test("toolbar output follows the controls and falls back only for content fullscreen", () => {
  assert.deepEqual(fpsPlacement("toolbar"), { position: "top-left", external: true, inline: true });
  assert.deepEqual(fpsPlacement(null), { position: "top-left", external: true, inline: true });
  assert.deepEqual(fpsPlacement("toolbar", { contentFullscreen: true }), { position: "top-left", external: false });
});

test("toolbar FPS uses spare width, caps its size and disappears below the readable minimum", () => {
  const layout = { titleWidth: 200, controlsWidth: 155 };
  assert.equal(toolbarFpsWidth({ ...layout, width: 1280 }), 260);
  assert.equal(toolbarFpsWidth({ ...layout, width: 600 }), 205);
  assert.equal(toolbarFpsWidth({ ...layout, width: 475 }), 80);
  assert.equal(toolbarFpsWidth({ ...layout, width: 474 }), 0);
  assert.equal(toolbarFpsWidth({ ...layout, width: 320 }), 0);
  assert.equal(toolbarFpsWidth({ ...layout, width: 1280, sidePanel: true }), 0);
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
