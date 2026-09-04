import {
  clearOperationJournal,
  beginSiteRemoval,
  clearStateIfRevision,
  commitStateAndClearOperationJournal,
  readOperationJournal,
  readState,
  writeOperationJournal,
  writeState,
} from "./db.js";
import { extractSevenZip } from "./archive/sevenzip-client.js";
import { extractZip } from "./archive/zip-import.js";
import { addCleanupDiagnostic, OperationDiagnostics } from "./diagnostics.js";
import {
  fileExists,
  getDirectoryAt,
  getOpfsRoot,
  mergeDirectoryWithRollback,
  removePath,
  rollbackMergedDirectory,
  summarizeDirectory,
} from "./opfs.js";

const APP_ROOT = "gamespace";
const REVISIONS_ROOT = `${APP_ROOT}/revisions`;
const UPDATES_ROOT = `${APP_ROOT}/updates`;
const ROLLBACK_ROOT = `${APP_ROOT}/rollback`;

function jobId() {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}

async function detectArchiveType(file) {
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sevenZip = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
  if (sevenZip.every((value, index) => signature[index] === value)) return "7z";
  if (signature[0] === 0x50 && signature[1] === 0x4b) return "zip";
  const lowerName = file.name.toLocaleLowerCase("en-US");
  if (lowerName.endsWith(".7z")) return "7z";
  if (lowerName.endsWith(".zip")) return "zip";
  throw new Error("Поддерживаются только цельные архивы .7z и .zip/.zip64.");
}

function emitServiceWorkerStateChanged() {
  navigator.serviceWorker?.controller?.postMessage({ type: "STATE_CHANGED" });
  navigator.serviceWorker?.ready
    ?.then((registration) => registration.active?.postMessage({ type: "STATE_CHANGED" }))
    .catch(() => {});
}

async function extractArchive({ file, destination, requireIndex, onEvent }) {
  onEvent?.({ type: "phase", phase: "archive-read", label: "Читаю сигнатуру выбранного архива…" });
  const type = await detectArchiveType(file);
  onEvent?.({ type: "archive-format", format: type });
  const extract = type === "7z" ? extractSevenZip : extractZip;
  const result = await extract({ file, destination, requireIndex, onEvent });
  return { ...result, type };
}

function diagnosticEvents(diagnostics, onEvent) {
  return (event) => { diagnostics.observe(event); onEvent?.(event); };
}

async function diagnosticCleanup(error, label, action) {
  try {
    const completed = await action();
    addCleanupDiagnostic(error, label, completed === false ? new Error("Не все файлы удалось восстановить") : null);
    return completed !== false;
  }
  catch (cleanupError) { addCleanupDiagnostic(error, label, cleanupError); return false; }
}

async function cleanupAfterCommit(action, onEvent, label) {
  try { await action(); }
  catch (error) { onEvent?.({ type: "cleanup-warning", label, error }); }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function installFullArchive(file, onEvent) {
  const diagnostics = new OperationDiagnostics("полная установка", { file });
  onEvent = diagnosticEvents(diagnostics, onEvent);
  let revisionPath = null;
  let committed = false;
  const startedAt = Date.now();

  try {
    onEvent({ type: "phase", phase: "storage-prepare", label: "Подготовка постоянного хранилища" });
    await requestPersistentStorage();
    onEvent({ type: "phase", phase: "recovery", label: "Проверка незавершённого обновления" });
    await recoverInterruptedOperation();
    onEvent({ type: "phase", phase: "state-read", label: "Чтение сведений об установленном сайте из IndexedDB" });
    const previousState = await readState();
    const revision = jobId();
    revisionPath = `${REVISIONS_ROOT}/${revision}`;
    const result = await extractArchive({ file, destination: revisionPath, requireIndex: true, onEvent });
    onEvent({ type: "phase", phase: "index-check", label: "Проверяю сохранённый index.html…" });
    const indexStoragePath = `${revisionPath}/${result.indexPath}`;
    const root = await getOpfsRoot();
    if (!await fileExists(root, indexStoragePath)) {
      throw new Error("Распаковка закончилась, но index.html отсутствует в OPFS.");
    }
    const revisionDirectory = await getDirectoryAt(root, revisionPath, false);
    onEvent({ type: "phase", phase: "site-verify", label: "Проверяю число и размер сохранённых файлов…" });
    const stored = await summarizeDirectory(revisionDirectory);
    if (stored.files !== result.files || stored.bytes !== result.uncompressedBytes) {
      throw new Error(`Проверка OPFS не пройдена: сохранено ${stored.files} файлов (${stored.bytes} байт), ожидалось ${result.files} файлов (${result.uncompressedBytes} байт).`);
    }

    const state = {
      schema: 1,
      activeRevision: revision,
      revisionPath,
      contentRoot: result.contentRoot || "",
      indexPath: result.indexPath,
      indexName: result.indexPath.split("/").at(-1),
      archiveName: file.name,
      archiveType: result.type,
      archiveBytes: file.size,
      installedAt: Date.now(),
      operation: "full",
      operationDurationMs: Date.now() - startedAt,
      writtenBytes: stored.bytes,
      files: stored.files,
      entries: result.entries,
      storageVerifiedAt: Date.now(),
    };
    onEvent({ type: "phase", phase: "state-save", label: "Сохраняю новую установленную ревизию…" });
    await writeState(state);
    committed = true;
    emitServiceWorkerStateChanged();

    if (previousState?.revisionPath && previousState.revisionPath !== revisionPath) {
      onEvent?.({ type: "phase", phase: "cleanup", label: "Удаляю предыдущую версию сайта…" });
      await cleanupAfterCommit(() => removePath(root, previousState.revisionPath), onEvent, "Очистка предыдущей ревизии после успешной установки");
    }
    await cleanupAfterCommit(() => cleanupOrphans(state), onEvent, "Очистка временных файлов после успешной установки");
    return state;
  } catch (error) {
    const failure = diagnostics.failure(error);
    if (revisionPath && !committed) {
      await diagnosticCleanup(failure, "Очистка неполной ревизии", async () => removePath(await getOpfsRoot(), revisionPath));
    } else if (committed) {
      addCleanupDiagnostic(failure, "Активная ревизия уже сохранена; её файлы оставлены на месте", null);
    }
    throw failure;
  }
}

export async function applyUpdateArchive(file, onEvent) {
  const diagnostics = new OperationDiagnostics("быстрое обновление", { file });
  onEvent = diagnosticEvents(diagnostics, onEvent);
  let state;
  let updatePath;
  let rollbackPath;
  let root;
  const startedAt = Date.now();
  let mergeJournal = null;
  let ownsJournal = false;

  try {
    onEvent({ type: "phase", phase: "storage-prepare", label: "Подготовка постоянного хранилища" });
    await requestPersistentStorage();
    onEvent({ type: "phase", phase: "recovery", label: "Проверка незавершённого обновления" });
    await recoverInterruptedOperation();
    onEvent({ type: "phase", phase: "state-read", label: "Чтение установленного сайта и подготовка обновления" });
    state = await readState();
    if (!state?.revisionPath) throw new Error("Сначала установите основной архив сайта.");
    const updateId = jobId();
    updatePath = `${UPDATES_ROOT}/${updateId}`;
    rollbackPath = `${ROLLBACK_ROOT}/${updateId}`;
    onEvent({ type: "phase", phase: "storage-open", label: "Открытие OPFS" });
    root = await getOpfsRoot();
    const result = await extractArchive({ file, destination: updatePath, requireIndex: false, onEvent });
    onEvent?.({ type: "phase", phase: "apply", label: "Применяю обновление с возможностью отката…" });
    const baseJournal = {
      schema: 1,
      type: "update-merge",
      startedAt,
      updatePath,
      targetPath: state.revisionPath,
      rollbackPath,
      createdPaths: [],
      restoredPaths: [],
    };
    onEvent({ type: "phase", phase: "journal-save", label: "Сохранение журнала отката обновления" });
    await writeOperationJournal(baseJournal);
    ownsJournal = true;
    const merge = await mergeDirectoryWithRollback({
      sourcePath: updatePath,
      targetPath: state.revisionPath,
      rollbackPath,
      onDiagnostic: onEvent,
      onProgress(progress) {
        onEvent?.({ type: "apply-progress", ...progress });
      },
      async onJournal(paths) {
        await writeOperationJournal({ ...baseJournal, ...paths });
      },
    });
    mergeJournal = merge;

    onEvent({ type: "phase", phase: "index-check", label: "Проверяю index.html после обновления…" });
    if (!await fileExists(root, `${state.revisionPath}/${state.indexPath}`)) {
      throw new Error("После обновления не найден установленный index.html.");
    }
    const targetDirectory = await getDirectoryAt(root, state.revisionPath, false);
    onEvent({ type: "phase", phase: "site-verify", label: "Проверяю файлы после обновления…" });
    const stored = await summarizeDirectory(targetDirectory);

    const updatedState = {
      ...state,
      archiveName: file.name,
      archiveType: result.type,
      archiveBytes: file.size,
      installedAt: Date.now(),
      operation: "fast",
      operationDurationMs: Date.now() - startedAt,
      writtenBytes: stored.bytes,
      files: stored.files,
      entries: result.entries,
      storageVerifiedAt: Date.now(),
    };
    onEvent({ type: "phase", phase: "state-save", label: "Сохраняю результат обновления…" });
    await commitStateAndClearOperationJournal(updatedState);
    ownsJournal = false;
    mergeJournal = null;
    emitServiceWorkerStateChanged();
    await cleanupAfterCommit(() => removePath(root, updatePath), onEvent, "Очистка временного обновления после успешной установки");
    await cleanupAfterCommit(() => removePath(root, rollbackPath), onEvent, "Очистка резервных файлов после успешной установки");
    return updatedState;
  } catch (error) {
    const failure = diagnostics.failure(error);
    let rollbackComplete = !error.rollbackIncomplete;
    if (mergeJournal) {
      rollbackComplete = await diagnosticCleanup(failure, "Откат обновления", () => rollbackMergedDirectory({
        targetPath: state.revisionPath,
        rollbackPath,
        createdPaths: mergeJournal.createdPaths,
        restoredPaths: mergeJournal.restoredPaths,
      }));
    }
    if (!rollbackComplete) {
      addCleanupDiagnostic(failure, "Журнал и резервные файлы сохранены для повторного восстановления", new Error("Откат не завершён. Не удаляйте данные приложения до получения отчёта."));
    } else if (root) {
      const journalCleared = !ownsJournal || await diagnosticCleanup(failure, "Очистка журнала операции", clearOperationJournal);
      if (!journalCleared) throw failure;
      await diagnosticCleanup(failure, "Очистка временного обновления", () => removePath(root, updatePath));
      await diagnosticCleanup(failure, "Очистка временных резервных файлов", () => removePath(root, rollbackPath));
    }
    throw failure;
  }
}

export async function removeInstalledSite() {
  const state = await readState();
  const pending = await readOperationJournal();
  if (pending?.type !== "site-delete") {
    // Detach the site and persist deletion intent atomically before removing files.
    await beginSiteRemoval({ schema: 1, type: "site-delete", startedAt: Date.now(), revisionPath: state?.revisionPath || null });
  }
  emitServiceWorkerStateChanged();
  await recoverInterruptedOperation();
}

export async function readInstalledSiteState() {
  const installed = await readState();
  if (!installed?.revisionPath) return installed;
  const root = await getOpfsRoot();
  try {
    const directory = await getDirectoryAt(root, installed.revisionPath, false);
    // An incomplete site with remaining contents must stay available for repair.
    for await (const entry of directory.entries()) return installed;
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
  // Older deletions could leave metadata pointing to a missing/empty revision.
  // Compare inside the transaction so a newer installation cannot be cleared.
  const result = await clearStateIfRevision(installed.revisionPath);
  if (result.cleared) emitServiceWorkerStateChanged();
  return result.state;
}

export async function refreshInstalledSiteStatistics(currentState = null) {
  const installedState = currentState || await readState();
  if (!installedState?.revisionPath) return { state: installedState, files: 0, bytes: 0 };
  const root = await getOpfsRoot();
  const directory = await getDirectoryAt(root, installedState.revisionPath, false);
  const stored = await summarizeDirectory(directory);
  if (!await fileExists(root, `${installedState.revisionPath}/${installedState.indexPath}`)) {
    throw new Error("В хранилище не найден стартовый файл установленного сайта.");
  }
  const updatedState = {
    ...installedState,
    files: stored.files,
    writtenBytes: stored.bytes,
    storageVerifiedAt: Date.now(),
  };
  await writeState(updatedState);
  return { state: updatedState, ...stored };
}

export async function cleanupOrphans(state = null) {
  await recoverInterruptedOperation();
  const currentState = state || await readState();
  const root = await getOpfsRoot();
  await removePath(root, UPDATES_ROOT);
  await removePath(root, ROLLBACK_ROOT);

  try {
    const revisions = await getDirectoryAt(root, REVISIONS_ROOT, false);
    for await (const [name] of revisions.entries()) {
      if (name !== currentState?.activeRevision) {
        await revisions.removeEntry(name, { recursive: true });
      }
    }
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}

export async function recoverInterruptedOperation() {
  const journal = await readOperationJournal();
  if (!journal) return false;
  const root = await getOpfsRoot();
  if (journal.type === "site-delete") {
    emitServiceWorkerStateChanged();
    if (journal.revisionPath) await removePath(root, journal.revisionPath);
    await removePath(root, UPDATES_ROOT);
    await removePath(root, ROLLBACK_ROOT);
    await clearOperationJournal();
    return true;
  }
  if (journal.type === "update-merge") {
    const completed = await rollbackMergedDirectory({
      targetPath: journal.targetPath,
      rollbackPath: journal.rollbackPath,
      createdPaths: journal.createdPaths || [],
      restoredPaths: journal.restoredPaths || [],
    });
    if (!completed) throw new Error("Восстановление незавершённого обновления не закончено. Журнал и резервные файлы сохранены.");
    // Clear the journal before deleting backups: a retained journal must remain replayable.
    await clearOperationJournal();
    await removePath(root, journal.updatePath);
    await removePath(root, journal.rollbackPath);
    return true;
  }
  throw new Error("Неизвестный журнал восстановления. Данные сохранены для диагностики.");
}
