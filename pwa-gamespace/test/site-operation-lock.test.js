import test from "node:test";
import assert from "node:assert/strict";
import { withSiteOperation } from "../src/site-operation-lock.js";

function browser(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
}
test("filesystem operations fail closed when cross-window locking is unavailable", async t => {
  browser(t, {});
  let touched = false;
  await assert.rejects(withSiteOperation(() => { touched = true; }), /Web Locks/);
  assert.equal(touched, false);
});
test("the exclusive lock covers the complete async operation and propagates cancellation", async t => {
  const controller = new AbortController();
  let acquired = false, waiting = false;
  browser(t, { locks: { async request(name, options, action) {
    assert.equal(name, "gamespace-site-operation-v1"); assert.equal(options.mode, "exclusive");
    assert.equal(options.signal, controller.signal); assert.ok(waiting);
    acquired = true; try { return await action(); } finally { acquired = false; }
  } } });
  assert.equal(await withSiteOperation(async () => {
    await new Promise(resolve => setImmediate(resolve)); assert.ok(acquired); return 42;
  }, { signal: controller.signal, onWait() { waiting = true; } }), 42);
  assert.equal(acquired, false);
});
