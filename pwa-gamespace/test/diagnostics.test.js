import test from "node:test";
import assert from "node:assert/strict";
import {
  addCleanupDiagnostic, copyDiagnosticReport, createDiagnosticReport, createLastReportStore,
  diagnosticErrorCode, MAX_REPORT_CHARS, OperationDiagnostics, restoreDiagnosticError,
  safeDiagnosticText, serializeDiagnosticError, shareDiagnosticReport,
} from "../src/diagnostics.js";

test("diagnostics freeze the original phase before cleanup and retain the actual file", () => {
  const tracker = new OperationDiagnostics("полная установка", { file: new File(["private contents"], "site.zip"), startedAt: 1 });
  tracker.observe({ type: "file-stage", phase: "file-create", label: "Создание файла", currentFile: "site/index.html" });
  tracker.observe({ type: "progress", processedBytes: 1024, totalBytes: 4096 });
  const failure = tracker.failure(new DOMException("No space", "QuotaExceededError"));
  tracker.stage("cleanup", "Удаление");
  addCleanupDiagnostic(failure, "Очистка", new Error("EACCES"));
  const report = createDiagnosticReport(failure, {
    version: "0.3.0", browser: "Firefox 142.0 · Gecko", engine: "Gecko",
    runtimeHistory: "Firefox 142.0 · Gecko\n04.09.2026 10:00 — сейчас",
  }, { previousSite: "не установлен" });
  assert.equal(report.code, "GS-NO-SPACE");
  assert.match(report.text, /Этап сбоя: Создание файла/);
  assert.match(report.text, /site\/index.html/);
  assert.match(report.text, /Обработано данных, байт: 1024/);
  assert.match(report.text, /Очистка: не завершено/);
  assert.match(report.text, /Среда запуска: Firefox 142\.0 · Gecko/);
  assert.match(report.text, /Движок: Gecko/);
  assert.match(report.text, /История браузера \(новые версии сверху\)/);
  assert.doesNotMatch(report.text, /private contents/);
  assert.equal(failure.cause.name, "QuotaExceededError");
});

test("nested Worker diagnostics retain stderr, original cause and outer demo mode", () => {
  const inner = new OperationDiagnostics("7z");
  inner.stage("list", "Чтение заголовка 7z");
  inner.observe({ type: "diagnostic", message: "ERROR: Headers Error" });
  const outer = new OperationDiagnostics("полная установка");
  const failure = outer.failure(inner.failure(new Error("broken header")));
  const report = createDiagnosticReport(failure, {}, { operation: "встроенное демо", previousSite: "встроенное демо" });
  assert.match(report.text, /Этап сбоя: Чтение заголовка 7z/);
  assert.match(report.text, /ERROR: Headers Error/);
  assert.match(report.text, /Операция: встроенное демо/);
  assert.equal(failure.cause.message, "broken header");
});

test("metadata access failure does not replace the original operation error", () => {
  const report = createDiagnosticReport(new Error("broken archive"), () => {
    throw new DOMException("browser metadata blocked", "SecurityError");
  }, { stage: "list", operation: "полная установка" });
  assert.equal(report.code, "GS-LIST");
  assert.match(report.text, /Ошибка: Error: broken archive/);
  assert.match(report.text, /Сведения недоступны: SecurityError/);
});

test("unknown quota is not presented as zero free space", () => {
  const report = createDiagnosticReport(new Error("test"), {}, { stage: "storage-open" });
  assert.match(report.text, /Последняя оценка квоты браузера, байт: неизвестно/);
  assert.match(report.text, /Доступная квота при проверке архива, байт: неизвестно/);
  assert.equal(report.code, "GS-STORAGE-OPEN");
});

test("error codes identify permission, unreadable files and missing index", () => {
  assert.equal(diagnosticErrorCode(new DOMException("denied", "NotAllowedError")), "GS-ACCESS");
  assert.equal(diagnosticErrorCode(new DOMException("removed", "NotReadableError")), "GS-FILE-READ");
  assert.equal(diagnosticErrorCode(new Error("missing"), "index-check"), "GS-INDEX-CHECK");
});

test("Worker serialization preserves name, code, errno, stack and bounded causes", () => {
  const cause = Object.assign(new Error("Disk error"), { code: "EIO", errno: 5 });
  const error = new DOMException("Quota full", "QuotaExceededError");
  error.cause = cause;
  cause.cause = error;
  const restored = restoreDiagnosticError(serializeDiagnosticError(error));
  assert.equal(restored.name, "QuotaExceededError");
  assert.equal(restored.cause.errno, 5);
  assert.equal(restored.cause.code, "EIO");
  assert.match(restored.stack, /QuotaExceededError/);
  assert.equal(restored.cause.cause, undefined);
});

test("reports redact URI, credentials and query tokens but keep script line numbers", () => {
  const safe = safeDiagnosticText("content://provider/private?token=secret https://user:password@example.test/private?key=secret file:///private/site.zip blob://private\n at f (https://example.test/assets/app-123.js:10:20)");
  assert.doesNotMatch(safe, /secret|password|private|example\.test/);
  assert.match(safe, /app-123\.js:10:20/);
  assert.equal(safeDiagnosticText("site/игра.html"), "site/игра.html");
  assert.doesNotMatch(safeDiagnosticText("x\u0000\u202ey"), /[\u0000\u202e]/);
});

test("log ring and final report are bounded independently of archive size", () => {
  const tracker = new OperationDiagnostics("import");
  for (let i = 0; i < 3000; i++) tracker.observe({ type: "diagnostic", message: `${i}: ${"x".repeat(10000)}` });
  assert.equal(tracker.data.messages.length, 20);
  assert.ok(tracker.data.messages.every((value) => value.length <= 500));
  const report = createDiagnosticReport(tracker.failure(new Error("x".repeat(100000))));
  assert.ok(report.text.length <= MAX_REPORT_CHARS);
});

test("latest report survives a new store instance and only one record is retained", () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key) };
  const first = createDiagnosticReport(new Error("first"));
  const second = createDiagnosticReport(new Error("second"));
  const store = createLastReportStore(() => storage);
  assert.equal(store.save(first).warning, "");
  store.save(second);
  assert.equal(values.size, 1);
  assert.equal(createLastReportStore(() => storage).load().report.text, second.text);
});

test("unavailable report storage still retains the latest error in memory", () => {
  const store = createLastReportStore(() => { throw new DOMException("denied", "SecurityError"); });
  assert.equal(store.load().report, null);
  const report = createDiagnosticReport(new Error("test"));
  assert.match(store.save(report).warning, /не удалось сохранить/);
  assert.equal(store.load().report, report);
});

test("corrupt and oversized saved reports do not prevent application initialization", () => {
  for (const raw of ["{broken", '{"schema":1}', "x".repeat(100000)]) {
    const loaded = createLastReportStore(() => ({ getItem: () => raw })).load();
    assert.equal(loaded.report, null);
    assert.match(loaded.warning, /недоступен/);
  }
});

test("clipboard denial or absence permits manual-copy fallback", async () => {
  let text;
  assert.equal(await copyDiagnosticReport("report", { clipboard: { writeText: async (value) => { text = value; } } }), true);
  assert.equal(text, "report");
  assert.equal(await copyDiagnosticReport("report", {}), false);
  assert.equal(await copyDiagnosticReport("report", { clipboard: { writeText: async () => { throw new Error("denied"); } } }), false);
});

test("share sends text only and cancellation is not a new application error", async () => {
  let payload;
  assert.equal(await shareDiagnosticReport("report", { share: async (value) => { payload = value; } }), "opened");
  assert.deepEqual(payload, { title: "Ошибка GameSpace PWA", text: "report" });
  assert.equal(await shareDiagnosticReport("report", {}), "unavailable");
  assert.equal(await shareDiagnosticReport("report", { share: async () => { throw new DOMException("cancel", "AbortError"); } }), "cancelled");
  assert.equal(await shareDiagnosticReport("report", { share: async () => { throw new Error("denied"); } }), "failed");
});
