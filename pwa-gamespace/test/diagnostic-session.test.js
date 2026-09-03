import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { DiagnosticSession, connectDiagnosticSessions } from "../src/diagnostic-session.js";
import { diagnosticPagePath, observeGameWindow } from "../src/game-diagnostics.js";
import { createDiagnosticReport } from "../src/diagnostics.js";

function memory() {
  const data = new Map();
  return { writes: 0, get length() { return data.size; }, key(i) { return [...data.keys()][i]; }, getItem(k) { return data.get(k) ?? null; }, setItem(k, v) { data.set(k, v); this.writes++; }, removeItem(k) { data.delete(k); } };
}

test("journal checkpoints are bounded and throttled, completion clears the active marker", () => {
  const storage = memory(); let time = 10000;
  const session = new DiagnosticSession({ storage: () => storage, now: () => time, owner: "test" });
  session.begin("import", "site.7z");
  session.observe({ phase: "write", label: "Запись", currentFile: "game.bin", processedBytes: 4096 });
  assert.equal(storage.writes, 1);
  time += 5000;
  session.observe({ processedBytes: 8192 });
  assert.equal(storage.writes, 2);
  assert.equal(session.records()[0].active.currentFile, "game.bin");
  assert.equal(session.records()[0].active.processedBytes, 8192);
  for (let i = 0; i < 100; i++) session.record("action", i);
  assert.equal(session.snapshot().trail.length, 20);
  session.finish();
  assert.equal(session.records()[0].active, null);
});

test("journal rejects overlapping operations and keeps working with denied storage", () => {
  const session = new DiagnosticSession({ storage() { throw new DOMException("blocked", "SecurityError"); } });
  session.begin("import", "https://private.test/?token=SECRET");
  assert.throws(() => session.begin("other"), /ещё выполняется/);
  assert.match(session.snapshot().journalWarning, /не сохраняется/);
  assert.doesNotMatch(JSON.stringify(session.snapshot()), /SECRET/);
  assert.deepEqual(session.records(), []);
});

test("unfinished marker is found once and a completed session is excluded", async () => {
  const storage = memory();
  const old = new DiagnosticSession({ storage: () => storage, owner: "old" }); old.begin("install", "site.7z");
  const finished = new DiagnosticSession({ storage: () => storage, owner: "finished" }); finished.begin("demo"); finished.finish();
  const session = new DiagnosticSession({ storage: () => storage, owner: "new" });
  const presence = connectDiagnosticSessions(session);
  try {
    const rows = await presence.unfinished();
    assert.deepEqual(rows.map((r) => r.owner), ["old"]);
    session.acknowledge(rows[0]);
    assert.deepEqual(await presence.unfinished(), []);
  } finally { presence.close(); }
});

test("another live window is not reported as an interrupted operation", async () => {
  const storage = memory();
  const old = new DiagnosticSession({ storage: () => storage, owner: "live" }); old.begin("install");
  const current = new DiagnosticSession({ storage: () => storage, owner: "current" });
  const a = connectDiagnosticSessions(old), b = connectDiagnosticSessions(current);
  try { assert.deepEqual(await b.unfinished(), []); } finally { a.close(); b.close(); }
});

test("manual report has a dedicated code and no invented exception", () => {
  const report = createDiagnosticReport(null, { trail: ["Выбор архива"] }, { manual: true });
  assert.equal(report.code, "GS-MANUAL");
  assert.match(report.text, /Выбор архива/);
  assert.doesNotMatch(report.text, /Неизвестная ошибка/);
});

test("context attached to an unwrapped error preserves its original message", () => {
  const error = new Error("HTTP 503"); error.diagnosticContext = { stage: "pwa-catalog", httpStatus: 503 };
  assert.match(createDiagnosticReport(error).text, /Ошибка: Error: HTTP 503/);
});

test("game paths strip queries and fragments", () => {
  assert.equal(diagnosticPagePath("https://host.test/game.html?token=SECRET#personal"), "/game.html");
});

test("game observer captures script, cross-realm Promise and resource errors with a cap", () => {
  const listeners = new Map(); const reports = [];
  const OtherError = vm.runInNewContext("Error");
  const frame = { Error: OtherError, location: { href: "https://host.test/game.html?token=SECRET" }, addEventListener(k, fn) { listeners.set(k, fn); }, removeEventListener(k) { listeners.delete(k); } };
  const detach = observeGameWindow(frame, (error, context) => reports.push({ error, context }));
  listeners.get("error")({ target: frame, message: "broken", filename: "https://host.test/a.js?private=1", lineno: 42, colno: 3 });
  listeners.get("unhandledrejection")({ reason: new OtherError("promise broke") });
  listeners.get("error")({ target: { src: "https://host.test/missing.png?token=SECRET", tagName: "IMG" } });
  assert.equal(reports[0].context.line, 42);
  assert.equal(reports[1].error.message, "promise broke");
  assert.equal(reports[2].context.resource, "/missing.png");
  assert.doesNotMatch(JSON.stringify(reports), /SECRET/);
  for (let i = 0; i < 30; i++) listeners.get("unhandledrejection")({ reason: "error " + i });
  assert.equal(reports.length, 10);
  detach(); assert.equal(listeners.size, 0);
});

test("arbitrary Promise rejection objects are not serialized", () => {
  const callbacks = {}; let failure;
  const frame = { location: { href: "https://host.test/game" }, addEventListener(k, fn) { callbacks[k] = fn; }, removeEventListener() {} };
  observeGameWindow(frame, (error) => { failure = error; });
  callbacks.unhandledrejection({ reason: { password: "SECRET", toString() { throw new Error("must not stringify"); } } });
  assert.match(failure.message, /объекта не записывается/);
});
