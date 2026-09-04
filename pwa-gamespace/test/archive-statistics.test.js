import test from "node:test";
import assert from "node:assert/strict";
import { ArchiveMetrics, ArchiveStatistics, createArchiveStatisticsStore, formatArchiveStatistics } from "../src/archive-statistics.js";
import { instrumentSevenZip } from "../src/archive/sevenzip-statistics.js";
import { measuredBlob } from "../src/archive/zip-statistics.js";

test("timers retain byte counts and the original asynchronous error", async () => {
  let clock = 0;
  const metrics = new ArchiveMetrics("7z", () => clock);
  assert.equal(metrics.sync("write", () => { clock += 3; return 8; }, (bytes) => bytes), 8);
  const failure = new Error("read failed");
  await assert.rejects(metrics.async("read", async () => { clock += 5; throw failure; }), (error) => error === failure);
  assert.deepEqual(metrics.snapshot().timings, {
    write: { ms: 3, calls: 1, bytes: 8, failures: 0 },
    read: { ms: 5, calls: 1, bytes: 0, failures: 1 },
  });
});

test("7z instrumentation preserves handles, partial writes and flush failures", async () => {
  const statistics = new ArchiveMetrics("7z");
  let closeCount = 0;
  let failFlush = false;
  const failure = new Error("flush failed");
  const native = {
    read() { assert.equal(this, native); return 1; },
    write() { assert.equal(this, native); return 3; },
    flush() { assert.equal(this, native); if (failFlush) throw failure; },
    close() { assert.equal(this, native); closeCount++; },
  };
  const OPFS = {
    fileHandles: new Map(), async prepareDir() {},
    async prepareFile(path) { if (!this.fileHandles.has(path)) this.fileHandles.set(path, native); },
  };
  instrumentSevenZip({ OPFS }, statistics);
  await OPFS.prepareFile("file");
  const handle = OPFS.fileHandles.get("file");
  await OPFS.prepareFile("file");
  assert.equal(OPFS.fileHandles.get("file"), handle);
  assert.equal(handle.write(new Uint8Array(8), { at: 0 }), 3);
  handle.flush();
  failFlush = true;
  assert.throws(() => handle.flush(), (error) => error === failure);
  handle.close();
  assert.equal(closeCount, 1);
  assert.equal(statistics.snapshot().timings.write.bytes, 3);
  assert.equal(statistics.snapshot().timings.flush.failures, 1);
});

test("ZIP Blob instrumentation counts ranged streaming and buffer reads", async () => {
  const statistics = new ArchiveMetrics("ZIP");
  const blob = measuredBlob(new Blob([new Uint8Array([1, 2, 3, 4, 5])]), statistics);
  assert.deepEqual([...new Uint8Array(await blob.slice(0, 2).arrayBuffer())], [1, 2]);
  const output = await new Response(blob.slice(2).stream()).arrayBuffer();
  assert.deepEqual([...new Uint8Array(output)], [3, 4, 5]);
  assert.equal(statistics.snapshot().timings.read.bytes, 5);
});

test("operation phases persist separately from errors and survive storage failure", () => {
  let clock = 0;
  const operation = new ArchiveStatistics(new File(["x"], "site.zip"), "обновление", () => clock);
  clock = 10;
  operation.observe({ type: "phase", label: "Распаковка" });
  clock = 25;
  operation.observe({ type: "archive-statistics", statistics: { format: "ZIP", files: 0, durationMs: 15, timings: {}, details: {} } });
  clock = 30;
  const report = operation.finish("ошибка", { browser: "Firefox 142.0 · Gecko", engine: "Gecko" });
  assert.equal(report.durationMs, 30);
  assert.equal(Object.values(report.phases).reduce((sum, ms) => sum + ms, 0), 30);
  const values = new Map([["gamespace:last-error:v1", "previous error"]]);
  const storage = { setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key) };
  createArchiveStatisticsStore(() => storage).save(report);
  assert.deepEqual(createArchiveStatisticsStore(() => storage).load().report, report);
  assert.equal(values.get("gamespace:last-error:v1"), "previous error");
  const blocked = createArchiveStatisticsStore(() => { throw new Error("blocked"); });
  assert.ok(blocked.save(report).warning);
  assert.equal(blocked.load().report, report);
  const text = formatArchiveStatistics(report);
  assert.match(text, /Результат: ошибка/);
  assert.match(text, /Среда запуска: Firefox 142\.0 · Gecko/);
  assert.match(text, /Движок: Gecko/);
  assert.match(text, /могут перекрываться/);
});
