import test from "node:test";
import assert from "node:assert/strict";
import { createScreenWakeLock } from "../src/screen-wake-lock.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(request) {
  const page = new EventTarget(); page.visibilityState = "visible";
  const messages = [];
  const lock = createScreenWakeLock({ document: page, navigator: { wakeLock: { request } }, onStatus: text => messages.push(text) });
  return { page, messages, lock };
}
function sentinel() {
  const value = new EventTarget(); value.releases = 0;
  value.release = async () => { value.releases++; value.dispatchEvent(new Event("release")); };
  return value;
}

test("screen lock is released after an operation and reacquired after returning to the page", async () => {
  const first = sentinel(), second = sentinel(); let requests = 0;
  const { page, lock } = setup(async type => { assert.equal(type, "screen"); return ++requests === 1 ? first : second; });
  lock.start(); await tick();
  page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange"));
  await first.release();
  page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange")); await tick();
  assert.equal(requests, 2);
  await lock.stop(); assert.equal(second.releases, 1);
  page.dispatchEvent(new Event("visibilitychange")); await tick(); assert.equal(requests, 2);
});

test("a screen-lock request that resolves after cancellation is immediately released", async () => {
  let resolve; const held = sentinel();
  const { lock } = setup(() => new Promise(done => { resolve = done; }));
  lock.start(); await lock.stop(); resolve(held); await tick();
  assert.equal(held.releases, 1);
});

test("a rejected screen-lock request never fails the operation", async () => {
  const { lock, messages } = setup(async () => { throw new DOMException("denied", "NotAllowedError"); });
  lock.start(); await tick(); assert.match(messages.at(-1), /Не удалось удержать экран/);
  await lock.stop(); assert.equal(messages.at(-1), "");
});

test("an older pending request cannot take over a new operation", async () => {
  let oldResolve; const old = sentinel(), current = sentinel(); let count = 0;
  const { lock } = setup(() => ++count === 1 ? new Promise(done => { oldResolve = done; }) : Promise.resolve(current));
  lock.start(); await lock.stop(); lock.start(); await tick();
  oldResolve(old); await tick(); assert.equal(old.releases, 1); assert.equal(current.releases, 0);
  await lock.stop(); assert.equal(current.releases, 1);
});
