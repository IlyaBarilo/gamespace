import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_WORKER_RELOAD_MARKER,
  ensureServiceWorkerControlsPage,
  waitForServiceWorkerController,
} from "../src/service-worker-control.js";

class FakeServiceWorkerContainer extends EventTarget {
  controller = null;

  claim() {
    this.controller = { scriptURL: "https://example.test/sw-runtime-v1.js" };
    this.dispatchEvent(new Event("controllerchange"));
  }
}

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("accepts a page already controlled by the Service Worker", async () => {
  const serviceWorker = new FakeServiceWorkerContainer();
  serviceWorker.controller = { scriptURL: "https://example.test/sw-runtime-v1.js" };
  const storage = fakeStorage({ [SERVICE_WORKER_RELOAD_MARKER]: "1" });

  const result = await ensureServiceWorkerControlsPage({
    serviceWorker,
    storage,
    reload() {
      assert.fail("reload must not be called for a controlled page");
    },
  });

  assert.equal(result, "controlled");
  assert.equal(storage.getItem(SERVICE_WORKER_RELOAD_MARKER), null);
});

test("waits for controllerchange before opening local content", async () => {
  const serviceWorker = new FakeServiceWorkerContainer();
  const waiting = waitForServiceWorkerController(serviceWorker, 100);
  queueMicrotask(() => serviceWorker.claim());
  assert.equal(await waiting, true);
});

test("reloads an uncontrolled page once", async () => {
  const serviceWorker = new FakeServiceWorkerContainer();
  const storage = fakeStorage();
  let reloads = 0;

  const result = await ensureServiceWorkerControlsPage({
    serviceWorker,
    storage,
    reload() {
      reloads += 1;
    },
    timeoutMs: 0,
  });

  assert.equal(result, "reloading");
  assert.equal(reloads, 1);
  assert.equal(storage.getItem(SERVICE_WORKER_RELOAD_MARKER), "1");
});

test("stops a repeated reload when the page is still uncontrolled", async () => {
  const serviceWorker = new FakeServiceWorkerContainer();
  const storage = fakeStorage({ [SERVICE_WORKER_RELOAD_MARKER]: "1" });

  await assert.rejects(() => ensureServiceWorkerControlsPage({
    serviceWorker,
    storage,
    reload() {
      assert.fail("a repeated reload must not be started");
    },
    timeoutMs: 0,
  }), /не управляет страницей/);
  assert.equal(storage.getItem(SERVICE_WORKER_RELOAD_MARKER), null);
});
