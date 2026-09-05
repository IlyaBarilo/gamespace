import test from "node:test";
import assert from "node:assert/strict";
import { extractSevenZip, probeSevenZipSupport } from "../src/archive/sevenzip-client.js";

function mockWorker(t, callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const instances = [];
  class FakeWorker {
    constructor() { instances.push(this); }
    terminate() { this.terminated = true; }
    postMessage(message) { callback(this, message); }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  t.after(() => previous ? Object.defineProperty(globalThis, "Worker", previous) : delete globalThis.Worker);
  return instances;
}

test("7z client retains structured Worker cause and stderr diagnostics", async (t) => {
  const instances = mockWorker(t, (worker) => queueMicrotask(() => worker.onmessage({ data: {
    type: "error", error: { name: "QuotaExceededError", message: "no quota", stack: "worker stack", errno: 28 },
    diagnosticContext: { stage: "file-extract", stageLabel: "Запись", messages: ["7z error"] },
  } })));
  await assert.rejects(extractSevenZip({ file: new File([], "site.7z"), destination: "test" }), (error) => {
    assert.equal(error.cause.name, "QuotaExceededError");
    assert.equal(error.cause.errno, 28);
    assert.equal(error.cause.stack, "worker stack");
    assert.equal(error.diagnosticContext.stage, "file-extract");
    assert.deepEqual(error.diagnosticContext.messages, ["7z error"]);
    return true;
  });
  assert.equal(instances[0].terminated, true);
});

test("7z client terminates Worker if file transfer throws", async (t) => {
  const instances = mockWorker(t, () => { throw new DOMException("transfer", "DataCloneError"); });
  await assert.rejects(extractSevenZip({ file: new File([], "site.7z") }), { name: "DataCloneError" });
  assert.equal(instances[0].terminated, true);
});

test("7z client reports unreadable Worker response and terminates it", async (t) => {
  const instances = mockWorker(t, (worker) => queueMicrotask(() => worker.onmessageerror()));
  await assert.rejects(extractSevenZip({ file: new File([], "site.7z") }), /ответ 7z Worker/);
  assert.equal(instances[0].terminated, true);
});

test("7z client terminates Worker and reports cancellation when the signal aborts", async (t) => {
  const instances = mockWorker(t, () => {});
  const controller = new AbortController();
  const extraction = extractSevenZip({
    file: new File([], "site.7z"),
    destination: "test",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(extraction, { name: "AbortError" });
  assert.equal(instances[0].terminated, true);
});

test("7z probe reports a structured Worker failure without waiting for a timeout", async (t) => {
  const instances = mockWorker(t, (worker) => queueMicrotask(() => worker.onmessage({ data: {
    type: "error", error: { name: "SecurityError", message: "OPFS blocked" },
  } })));
  assert.deepEqual(await probeSevenZipSupport(), { supported: false, reason: "OPFS blocked" });
  assert.equal(instances[0].terminated, true);
});
