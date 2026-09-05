import { BlobReader, ZipReader } from "@zip.js/zip.js";
import { dirname, findIndexEntry, summarizeEntries, validateEntries } from "./archive-plan.js";
import { getFileHandleAt, getOpfsRoot } from "../opfs.js";
import { addCleanupDiagnostic, OperationDiagnostics } from "../diagnostics.js";
import { ArchiveMetrics } from "../archive-statistics.js";
import { measuredBlob } from "./zip-statistics.js";

const RESERVE_MINIMUM = 512 * 1024 * 1024;

export async function extractZip({ file, destination, requireIndex, onEvent }) {
  const statistics = new ArchiveMetrics("ZIP / ZIP64");
  const diagnostics = new OperationDiagnostics("распаковка ZIP", { file });
  const callback = onEvent;
  onEvent = (event) => { diagnostics.observe(event); callback?.(event); };
  const source = new BlobReader(measuredBlob(file, statistics));
  const reader = new ZipReader(source, { checkAmbiguity: true });
  let failure = null;
  try {
    onEvent?.({ type: "phase", phase: "list", label: "Проверяю структуру ZIP/ZIP64…" });
    const zipEntries = await statistics.async("engine", () => reader.getEntries());
    const entries = validateEntries(zipEntries.map((entry) => ({
      path: entry.filename,
      directory: entry.directory,
      size: Number(entry.uncompressedSize || 0),
      modified: entry.lastModDate?.toISOString?.() || "",
      source: entry,
    })));
    const summary = summarizeEntries(entries);
    onEvent({ type: "phase", phase: "index-check", label: "Проверяю стартовую страницу в ZIP…" });
    const indexEntry = findIndexEntry(entries);
    if (requireIndex && !indexEntry) {
      throw new Error("В архиве не найден index.html. Поддерживается файл в корне, в site/ или в одном верхнем каталоге.");
    }

    onEvent({ type: "phase", phase: "quota-check", label: "Проверяю доступную квоту хранилища…" });
    const storage = await navigator.storage.estimate();
    const quotaKnown = Number.isFinite(storage.quota) && storage.quota > 0;
    const availableBytes = quotaKnown ? Math.max(0, storage.quota - (storage.usage || 0)) : null;
    const reserveBytes = Math.max(RESERVE_MINIMUM, Math.ceil(summary.uncompressedBytes * 0.1));
    const requiredBytes = summary.uncompressedBytes + reserveBytes;
    onEvent?.({
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

    onEvent?.({ type: "phase", phase: "extract", label: "Распаковываю ZIP/ZIP64…" });
    const root = await getOpfsRoot();
    let completedBytes = 0;
    let completedFiles = 0;
    for (const entry of entries) {
      if (entry.directory) continue;
      onEvent({ type: "file-stage", phase: "file-create", label: "Создание файла назначения OPFS", currentFile: entry.path, completedFiles });
      const writable = await statistics.async("open", async () => {
        const output = await getFileHandleAt(root, `${destination}/${entry.path}`, true);
        return output.createWritable({ keepExistingData: false });
      });
      onEvent({ type: "file-stage", phase: "file-extract", label: "Чтение ZIP-записи и запись файла OPFS", currentFile: entry.path });
      let entryProgress = 0;
      const writer = writable.getWriter();
      let destinationError = null;
      // Preserve the original OPFS error even if the ZIP library subsequently fails
      // while closing an already-errored stream. Writes still use bounded backpressure.
      const destinationStream = new WritableStream({
        async write(chunk) {
          try { await statistics.async("write", () => writer.write(chunk), () => chunk.byteLength); }
          catch (error) { destinationError = error; throw error; }
        },
      });
      try {
        await statistics.async("engine", () => entry.source.getData(destinationStream, {
          preventClose: true,
          onprogress(index) {
            entryProgress = index;
            onEvent?.({
              type: "progress",
              processedBytes: completedBytes + entryProgress,
              totalBytes: summary.uncompressedBytes,
              currentFile: entry.path,
            });
          },
        }));
        if (destinationError) throw destinationError;
        onEvent({ type: "file-stage", phase: "file-close", label: "Завершение записи файла OPFS", currentFile: entry.path });
        await statistics.async("close", () => writer.close());
        statistics.files++;
      } catch (error) {
        const entryFailure = diagnostics.failure(destinationError || error);
        try { await writer.abort(); }
        catch (abortError) { addCleanupDiagnostic(entryFailure, "Отмена записи неполного файла", abortError); }
        throw entryFailure;
      } finally {
        writer.releaseLock();
      }
      completedBytes += entry.size;
      completedFiles += 1;
      onEvent?.({
        type: "progress",
        processedBytes: completedBytes,
        completedFiles,
        totalBytes: summary.uncompressedBytes,
        currentFile: entry.path,
      });
    }

    return {
      ...summary,
      files: completedFiles,
      writtenBytes: completedBytes,
      indexPath: indexEntry?.path || null,
      contentRoot: indexEntry ? dirname(indexEntry.path) : null,
    };
  } catch (error) {
    failure = diagnostics.failure(error);
    throw failure;
  } finally {
    if (!failure) diagnostics.stage("archive-close", "Закрытие ZIP-потока");
    try { await statistics.async("archiveClose", () => reader.close()); }
    catch (closeError) {
      if (failure) addCleanupDiagnostic(failure, "Закрытие ZIP-потока", closeError);
      else throw diagnostics.failure(closeError);
    }
    finally { onEvent({ type: "archive-statistics", statistics: statistics.snapshot() }); }
  }
}
