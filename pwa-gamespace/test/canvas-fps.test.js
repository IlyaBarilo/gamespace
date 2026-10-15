import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../src/canvas-fps-runtime.js";

const { statistics } = globalThis.GameSpaceCanvasFps;
const frames = (fps, seconds) => Array.from({ length: fps * seconds }, (_, index) => (index + 1) * 1000 / fps);

for (const fps of [10, 30, 60]) {
  test(`FPS statistics at ${fps} use five seconds and consistent one-second bins`, () => {
    const result = statistics(frames(fps, 6), 6000, 0);
    assert.equal(result.current, fps);
    assert.equal(result.min, fps);
    assert.equal(result.average, fps);
    assert.equal(result.max, fps);
    assert.equal(result.windowMs, 5000);
  });
  test(`FPS average at ${fps} uses the available half-second during startup`, () => {
    const available = frames(fps, 1).filter(time => time <= 500);
    const result = statistics(available, 500, 0);
    assert.equal(result.average, fps);
    assert.equal(result.windowMs, 500);
    assert.equal(result.min, fps);
    assert.equal(result.max, fps);
  });
}
test("pause lowers the five-second average instead of retaining the last frame rate", () => {
  const result = statistics(frames(10, 6), 7300, 0);
  assert.equal(result.current, 0);
  assert.equal(result.min, 0);
  assert.equal(result.max, 10);
  assert.equal(result.average, 7.4);
});
test("an empty or reset window produces finite zero values", () => {
  assert.deepEqual(statistics([], 100, 100), { current: 0, min: 0, average: 0, max: 0, windowMs: 0 });
  assert.equal(statistics([10, 20], 1000, 1000).average, 0);
});
test("the APK packages the exact PWA monitor without a separate implementation", async () => {
  const pwa = await readFile(new URL("../src/canvas-fps-runtime.js", import.meta.url));
  const apk = await readFile(new URL("../../apk-gamespace/android-webview-loader/app/src/main/assets/canvas-fps-runtime.js", import.meta.url));
  assert.deepEqual(apk, pwa);
});
