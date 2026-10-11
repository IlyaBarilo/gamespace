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


test("an active viewer rejects content changes in another window", async t => {
  const { withContentMutation } = await import("../src/site-operation-lock.js");
  browser(t, { locks: { request: async (name, options, action) => {
    assert.equal(name, "gamespace-content-view-v1");
    assert.equal(options.ifAvailable, true);
    return action(null);
  } } });
  let touched = false;
  await assert.rejects(withContentMutation(() => { touched = true; }), { code: "GS-VIEWER-BUSY" });
  assert.equal(touched, false);
});

test("viewer lease stays acquired until its owner releases it", async t => {
  const { acquireContentView } = await import("../src/site-operation-lock.js");
  let held = false;
  browser(t, { locks: { async request(_name, _options, action) {
    held = true;
    try { return await action({}); } finally { held = false; }
  } } });
  const release = await acquireContentView();
  await new Promise(done => setImmediate(done));
  assert.equal(held, true);
  release();
  await new Promise(done => setImmediate(done));
  assert.equal(held, false);
});
