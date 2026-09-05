import SevenZipFactory from "../vendor/7zz.js";
import { dirname, findIndexEntry, parse7zSlt, summarizeEntries } from "./archive-plan.js";
import { OperationDiagnostics, serializeDiagnosticError } from "../diagnostics.js";
import { ArchiveMetrics } from "../archive-statistics.js";
import { instrumentSevenZip } from "./sevenzip-statistics.js";

const INPUT_DIRECTORY = "/input";
const ARCHIVE_PATH = `${INPUT_DIRECTORY}/archive.7z`;
const OUTPUT_MOUNT = "/opfs-out";
const READ_AHEAD_BYTES = 4 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 250;

class LazyFileContents {
  constructor(file, statistics) {
    this.file = file;
    this.statistics = statistics;
    this.reader = new FileReaderSync();
    this.cacheStart = 0;
    this.cache = new Uint8Array(0);
  }

  get length() {
    return this.file.size;
  }

  subarray(start, end) {
    const safeStart = Math.max(0, Math.min(this.file.size, Number(start)));
    const safeEnd = Math.max(safeStart, Math.min(this.file.size, Number(end)));
    const cacheEnd = this.cacheStart + this.cache.byteLength;
    if (safeStart >= this.cacheStart && safeEnd <= cacheEnd) {
      return this.cache.subarray(safeStart - this.cacheStart, safeEnd - this.cacheStart);
    }

    const readEnd = Math.min(this.file.size, Math.max(safeEnd, safeStart + READ_AHEAD_BYTES));
    this.cacheStart = safeStart;
    this.cache = this.statistics.sync("read", () => new Uint8Array(this.reader.readAsArrayBuffer(this.file.slice(safeStart, readEnd))), (bytes) => bytes.byteLength);
    return this.cache.subarray(0, safeEnd - safeStart);
  }
}

function mountLazyArchive(sevenZip, file, statistics) {
  sevenZip.FS.mkdir(INPUT_DIRECTORY);
  sevenZip.FS.writeFile(ARCHIVE_PATH, new Uint8Array(0));
  const stream = sevenZip.FS.open(ARCHIVE_PATH, "r");
  stream.node.contents = new LazyFileContents(file, statistics);
  stream.node.usedBytes = file.size;
  stream.node.timestamp = file.lastModified || Date.now();
  sevenZip.FS.close(stream);
}

function validateDestination(path) {
  if (typeof path !== "string" || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Некорректный каталог назначения OPFS.");
  }
}

async function probeCapabilities() {
  if (!navigator.storage?.getDirectory || typeof FileReaderSync === "undefined") {
    return { supported: false, reason: "Нет OPFS или FileReaderSync." };
  }

  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("gamespace-probe", { create: true });
  const fileHandle = await directory.getFileHandle("sync-access.tmp", { create: true });
  if (typeof fileHandle.createSyncAccessHandle !== "function") {
    await root.removeEntry("gamespace-probe", { recursive: true }).catch(() => {});
    return { supported: false, reason: "Нет синхронной записи OPFS в Worker." };
  }

  const access = await fileHandle.createSyncAccessHandle();
  access.write(new Uint8Array([71, 83]), { at: 0 });
  access.flush();
  access.close();
  await root.removeEntry("gamespace-probe", { recursive: true });
  await SevenZipFactory({ print() {}, printErr() {} });
  return { supported: true, reason: "" };
}

async function extractArchive({ file, destination, requireIndex }, emit, diagnostics, statistics) {
  emit({ type: "phase", phase: "worker-start", label: "Запускаю обработчик 7z/WASM…" });
  validateDestination(destination);
  if (!(file instanceof File)) throw new Error("7z Worker не получил выбранный файл.");

  let phase = "list";
  let currentFile = null;
  const listLines = [];
  const sevenZip = await SevenZipFactory({
    print(line) {
      if (phase === "list") {
        listLines.push(line);
      } else {
        const match = /-\s(.+)$/.exec(line);
        if (match) {
          currentFile = match[1];
          emit({ type: "file-stage", phase: "file-extract", label: "Распаковка 7z-записи в OPFS", currentFile });
        }
      }
    },
    printErr(line) {
      if (line) emit({ type: "diagnostic", message: String(line) });
    },
  });

  emit({ type: "phase", phase: "archive-open", label: "Подключаю локальный 7z и хранилище OPFS…" });
  mountLazyArchive(sevenZip, file, statistics);
  sevenZip.FS.mkdir(OUTPUT_MOUNT);
  sevenZip.FS.mount(sevenZip.OPFS, {}, OUTPUT_MOUNT);
  instrumentSevenZip(sevenZip, statistics);
  statistics.details.readAheadBytes = READ_AHEAD_BYTES;

  emit({ type: "phase", phase: "list", label: "Проверяю структуру 7z…" });
  const listExit = await statistics.async("engine", () => sevenZip.callMain(["l", "-slt", ARCHIVE_PATH]));
  if (listExit !== 0) throw new Error(`Не удалось прочитать 7z (код ${listExit}). Архив может быть повреждён или зашифрован.`);

  const entries = parse7zSlt(listLines);
  statistics.details.method = listLines.find((line) => line.startsWith("Method = "))?.slice(9) || "";
  const summary = summarizeEntries(entries);
  emit({ type: "phase", phase: "index-check", label: "Проверяю стартовую страницу в 7z…" });
  const indexEntry = findIndexEntry(entries);
  if (requireIndex && !indexEntry) {
    throw new Error("В архиве не найден index.html. Поддерживается файл в корне, в site/ или в одном верхнем каталоге.");
  }

  emit({ type: "phase", phase: "quota-check", label: "Проверяю доступную квоту хранилища…" });
  const storage = await navigator.storage.estimate();
  const quotaKnown = Number.isFinite(storage.quota) && storage.quota > 0;
  const availableBytes = quotaKnown ? Math.max(0, storage.quota - (storage.usage || 0)) : null;
  const reserveBytes = Math.max(512 * 1024 * 1024, Math.ceil(summary.uncompressedBytes * 0.1));
  const requiredBytes = summary.uncompressedBytes + reserveBytes;
  emit({
    type: "archive-info",
    archiveBytes: file.size,
    availableBytes,
    reserveBytes,
    requiredBytes,
    ...summary,
    indexPath: indexEntry?.path || null,
  });
  if (quotaKnown && requiredBytes > availableBytes) {
    throw new Error("Недостаточно доступной квоты: размер распакованных данных вместе с резервом превышает свободное место PWA.");
  }

  let processedBytes = 0;
  let lastProgressAt = 0;
  sevenZip.OPFS.onWrite = (_path, bytesWritten) => {
    processedBytes += bytesWritten;
    diagnostics.observe({ type: "progress", processedBytes, totalBytes: summary.uncompressedBytes, currentFile });
    const now = performance.now();
    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now;
      emit({
        type: "progress",
        processedBytes,
        totalBytes: summary.uncompressedBytes,
        currentFile,
      });
    }
  };

  phase = "extract";
  emit({ type: "phase", phase: "extract", label: "Распаковываю 7z в защищённое хранилище…" });
  const outputPath = `${OUTPUT_MOUNT}/${destination}`;
  const extractExit = await statistics.async("engine", () => sevenZip.callMain(["x", ARCHIVE_PATH, `-o${outputPath}`, "-y", "-bb1", "-bso1"]));
  if (extractExit !== 0) throw new Error(`Распаковка 7z завершилась с кодом ${extractExit}.`);

  emit({
    type: "progress",
    processedBytes,
    totalBytes: summary.uncompressedBytes,
    currentFile: null,
  });
  return {
    ...summary,
    writtenBytes: processedBytes,
    indexPath: indexEntry?.path || null,
    contentRoot: indexEntry ? dirname(indexEntry.path) : null,
  };
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message) return;
  const diagnostics = new OperationDiagnostics("обработка 7z", { file: message.file });
  const statistics = message.type === "extract" ? new ArchiveMetrics("7z") : null;
  const emit = (event) => { diagnostics.observe(event); self.postMessage(event); };
  try {
    if (message.type === "probe") {
      self.postMessage({ type: "probe-result", ...await probeCapabilities() });
      return;
    }
    if (message.type !== "extract") return;
    const result = await extractArchive(message, emit, diagnostics, statistics);
    emit({ type: "archive-statistics", statistics: statistics.snapshot() });
    self.postMessage({ type: "done", result });
  } catch (error) {
    if (statistics) emit({ type: "archive-statistics", statistics: statistics.snapshot() });
    const rawMessage = error?.message;
    const message = typeof rawMessage === "string"
      ? rawMessage
      : typeof error === "string"
        ? error
        : `${error?.name || error?.constructor?.name || "Ошибка 7z"}${error?.errno ? ` (errno ${error.errno})` : ""}`;
    self.postMessage({
      type: "error", message,
      error: serializeDiagnosticError(error),
      diagnosticContext: diagnostics.failure(error).diagnosticContext,
    });
  }
};
