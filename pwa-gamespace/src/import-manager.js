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
import {
  fileExists,
  getDirectoryAt,
  getOpfsRoot,
  mergeDirectoryWithRollback,
  removePath,
  rollbackMergedDirectory,
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
  const type = await detectArchiveType(file);
  const extract = type === "7z" ? extractSevenZip : extractZip;
  const result = await extract({ file, destination, requireIndex, onEvent });
  return { ...result, type };
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
  await requestPersistentStorage();
  const previousState = await readState();
  const revision = jobId();
  const revisionPath = `${REVISIONS_ROOT}/${revision}`;
  const startedAt = Date.now();

  try {
    const result = await extractArchive({ file, destination: revisionPath, requireIndex: true, onEvent });
    const indexStoragePath = `${revisionPath}/${result.indexPath}`;
    const root = await getOpfsRoot();
    if (!await fileExists(root, indexStoragePath)) {
      throw new Error("Распаковка закончилась, но index.html отсутствует в OPFS.");
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
      writtenBytes: result.writtenBytes,
      files: result.files,
      entries: result.entries,
    };
    await writeState(state);
    emitServiceWorkerStateChanged();

    if (previousState?.revisionPath && previousState.revisionPath !== revisionPath) {
      onEvent?.({ type: "phase", phase: "cleanup", label: "Удаляю предыдущую версию сайта…" });
      await removePath(root, previousState.revisionPath).catch(() => {});
    }
    await cleanupOrphans(state).catch(() => {});
    return state;
  } catch (error) {
    const root = await getOpfsRoot().catch(() => null);
    if (root) await removePath(root, revisionPath).catch(() => {});
    throw error;
  }
}

export async function applyUpdateArchive(file, onEvent) {
  await requestPersistentStorage();
  const state = await readState();
  if (!state?.revisionPath) throw new Error("Сначала установите основной архив сайта.");

  const updateId = jobId();
  const updatePath = `${UPDATES_ROOT}/${updateId}`;
  const rollbackPath = `${ROLLBACK_ROOT}/${updateId}`;
  const startedAt = Date.now();
  const root = await getOpfsRoot();
  let mergeJournal = null;

  try {
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
    await writeOperationJournal(baseJournal);
    const merge = await mergeDirectoryWithRollback({
      sourcePath: updatePath,
      targetPath: state.revisionPath,
      rollbackPath,
      onProgress(progress) {
        onEvent?.({ type: "apply-progress", ...progress });
      },
      async onJournal(paths) {
        await writeOperationJournal({ ...baseJournal, ...paths });
      },
    });
    mergeJournal = merge;

    if (!await fileExists(root, `${state.revisionPath}/${state.indexPath}`)) {
      throw new Error("После обновления не найден установленный index.html.");
    }

    const updatedState = {
      ...state,
      archiveName: file.name,
      archiveType: result.type,
      archiveBytes: file.size,
      installedAt: Date.now(),
      operation: "fast",
      operationDurationMs: Date.now() - startedAt,
      writtenBytes: result.writtenBytes,
      files: merge.files,
      entries: result.entries,
    };
    await commitStateAndClearOperationJournal(updatedState);
    mergeJournal = null;
    emitServiceWorkerStateChanged();
    await removePath(root, updatePath).catch(() => {});
    await removePath(root, rollbackPath).catch(() => {});
    return updatedState;
  } catch (error) {
    if (mergeJournal) {
      await rollbackMergedDirectory({
        targetPath: state.revisionPath,
        rollbackPath,
        createdPaths: mergeJournal.createdPaths,
        restoredPaths: mergeJournal.restoredPaths,
      }).catch(() => {});
    }
    await clearOperationJournal().catch(() => {});
    await removePath(root, updatePath).catch(() => {});
    await removePath(root, rollbackPath).catch(() => {});
    throw error;
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
