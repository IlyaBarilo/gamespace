import {
  clearOperationJournal,
  clearState,
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
  }
  catch (cleanupError) { addCleanupDiagnostic(error, label, cleanupError); }
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
  const startedAt = Date.now();

  try {
    diagnostics.stage("storage-prepare", "Подготовка постоянного хранилища");
    await requestPersistentStorage();
    diagnostics.stage("state-read", "Чтение сведений об установленном сайте из IndexedDB");
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
    emitServiceWorkerStateChanged();

    if (previousState?.revisionPath && previousState.revisionPath !== revisionPath) {
      onEvent?.({ type: "phase", phase: "cleanup", label: "Удаляю предыдущую версию сайта…" });
      await removePath(root, previousState.revisionPath).catch(() => {});
    }
    await cleanupOrphans(state).catch(() => {});
    return state;
  } catch (error) {
    const failure = diagnostics.failure(error);
    if (revisionPath) {
      await diagnosticCleanup(failure, "Очистка неполной ревизии", async () => removePath(await getOpfsRoot(), revisionPath));
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

  try {
    diagnostics.stage("storage-prepare", "Подготовка постоянного хранилища");
    await requestPersistentStorage();
    diagnostics.stage("state-read", "Чтение установленного сайта и подготовка обновления");
    state = await readState();
    if (!state?.revisionPath) throw new Error("Сначала установите основной архив сайта.");
    const updateId = jobId();
    updatePath = `${UPDATES_ROOT}/${updateId}`;
    rollbackPath = `${ROLLBACK_ROOT}/${updateId}`;
    diagnostics.stage("storage-open", "Открытие OPFS");
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
    diagnostics.stage("journal-save", "Сохранение журнала отката обновления");
    await writeOperationJournal(baseJournal);
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
    mergeJournal = null;
    emitServiceWorkerStateChanged();
    await removePath(root, updatePath).catch(() => {});
    await removePath(root, rollbackPath).catch(() => {});
    return updatedState;
  } catch (error) {
    const failure = diagnostics.failure(error);
    if (mergeJournal) {
      await diagnosticCleanup(failure, "Откат обновления", () => rollbackMergedDirectory({
        targetPath: state.revisionPath,
        rollbackPath,
        createdPaths: mergeJournal.createdPaths,
        restoredPaths: mergeJournal.restoredPaths,
      }));
    }
    if (root) {
      await diagnosticCleanup(failure, "Очистка журнала операции", clearOperationJournal);
      await diagnosticCleanup(failure, "Очистка временного обновления", () => removePath(root, updatePath));
      await diagnosticCleanup(failure, "Очистка временных резервных файлов", () => removePath(root, rollbackPath));
    }
    throw failure;
  }
}

export async function removeInstalledSite() {
  const state = await readState();
  const root = await getOpfsRoot();
  if (state?.revisionPath) await removePath(root, state.revisionPath);
  await removePath(root, UPDATES_ROOT).catch(() => {});
  await removePath(root, ROLLBACK_ROOT).catch(() => {});
  await clearState();
  emitServiceWorkerStateChanged();
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
  await removePath(root, UPDATES_ROOT).catch(() => {});
  await removePath(root, ROLLBACK_ROOT).catch(() => {});

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
  if (journal.type === "update-merge") {
    await rollbackMergedDirectory({
      targetPath: journal.targetPath,
      rollbackPath: journal.rollbackPath,
      createdPaths: journal.createdPaths || [],
      restoredPaths: journal.restoredPaths || [],
    });
    await removePath(root, journal.updatePath).catch(() => {});
    await removePath(root, journal.rollbackPath).catch(() => {});
  }
  await clearOperationJournal();
  return true;
}
