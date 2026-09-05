export async function getOpfsRoot() {
  if (!navigator.storage?.getDirectory) {
    throw new Error("Браузер не поддерживает OPFS.");
  }
  return navigator.storage.getDirectory();
}

export function splitSafePath(path) {
  if (!path) return [];
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Небезопасный внутренний путь: ${path}`);
  }
  return parts;
}

export async function getDirectoryAt(root, path, create = false) {
  let directory = root;
  for (const part of splitSafePath(path)) {
    directory = await directory.getDirectoryHandle(part, { create });
  }
  return directory;
}

export async function getFileHandleAt(root, path, create = false) {
  const parts = splitSafePath(path);
  const fileName = parts.pop();
  if (!fileName) throw new Error("Не указан путь к файлу.");
  const directory = await getDirectoryAt(root, parts.join("/"), create);
  return directory.getFileHandle(fileName, { create });
}

export async function fileExists(root, path) {
  try {
    const handle = await getFileHandleAt(root, path, false);
    const file = await handle.getFile();
    return file.size >= 0;
  } catch (error) {
    if (error?.name === "NotFoundError" || error?.name === "TypeMismatchError") return false;
    throw error;
  }
}

export async function removePath(root, path) {
  const parts = splitSafePath(path);
  const name = parts.pop();
  if (!name) return;
  try {
    const parent = await getDirectoryAt(root, parts.join("/"), false);
    await parent.removeEntry(name, { recursive: true });
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}

export async function copyFile(sourceFileHandle, targetFileHandle) {
  const source = await sourceFileHandle.getFile();
  const writable = await targetFileHandle.createWritable({ keepExistingData: false });
  await source.stream().pipeTo(writable);
}

export async function collectFiles(directory, prefix = "") {
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      files.push(...await collectFiles(handle, path));
    } else {
      files.push({ path, handle });
    }
  }
  return files;
}

export async function summarizeDirectory(directory) {
  const summary = { files: 0, bytes: 0 };
  for await (const [, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      const nested = await summarizeDirectory(handle);
      summary.files += nested.files;
      summary.bytes += nested.bytes;
    } else {
      const file = await handle.getFile();
      summary.files += 1;
      summary.bytes += file.size;
    }
  }
  return summary;
}

async function getUpdateTargetFile(root, path) {
  try {
    return await getFileHandleAt(root, path, false);
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    if (error?.name === "TypeMismatchError") {
      throw new Error(`Update-архив конфликтует с существующим каталогом или файлом в пути: ${path}`, { cause: error });
    }
    throw error;
  }
}

export async function summarizeMergeStorage({ sourcePath, targetPath }) {
  const root = await getOpfsRoot();
  const sourceDirectory = await getDirectoryAt(root, sourcePath, false);
  const sourceFiles = await collectFiles(sourceDirectory);
  const summary = { files: sourceFiles.length, sourceBytes: 0, backupBytes: 0, replacedFiles: 0, newFiles: 0 };
  for (const item of sourceFiles) {
    const source = await item.handle.getFile();
    summary.sourceBytes += source.size;
    const targetFilePath = `${targetPath}/${item.path}`;
    const target = await getUpdateTargetFile(root, targetFilePath);
    if (target) {
      summary.backupBytes += (await target.getFile()).size;
      summary.replacedFiles += 1;
    } else {
      summary.newFiles += 1;
    }
  }
  return summary;
}

export async function mergeDirectoryWithRollback({ sourcePath, targetPath, rollbackPath, onProgress, onJournal, onDiagnostic }) {
  onDiagnostic?.({ type: "phase", phase: "update-list", label: "Читаю файлы подготовленного обновления…" });
  const root = await getOpfsRoot();
  const sourceDirectory = await getDirectoryAt(root, sourcePath, false);
  const sourceFiles = await collectFiles(sourceDirectory);
  const createdPaths = [];
  const restoredPaths = [];

  try {
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const item = sourceFiles[index];
      const targetFilePath = `${targetPath}/${item.path}`;
      const rollbackFilePath = `${rollbackPath}/${item.path}`;
      onDiagnostic?.({ type: "file-stage", phase: "update-backup", label: "Проверка и резервное копирование заменяемого файла", path: item.path });
      const existing = await getUpdateTargetFile(root, targetFilePath);
      if (existing) {
        const backup = await getFileHandleAt(root, rollbackFilePath, true);
        await copyFile(existing, backup);
        restoredPaths.push(item.path);
      } else {
        createdPaths.push(item.path);
      }

      onDiagnostic?.({ type: "file-stage", phase: "journal-save", label: "Сохранение журнала перед заменой файла", path: item.path });
      await onJournal?.({ createdPaths: [...createdPaths], restoredPaths: [...restoredPaths] });

      onDiagnostic?.({ type: "file-stage", phase: "update-write", label: "Запись обновлённого файла в OPFS", path: item.path });
      const target = await getFileHandleAt(root, targetFilePath, true);
      await copyFile(item.handle, target);
      onProgress?.({ current: index + 1, total: sourceFiles.length, path: item.path });
    }
  } catch (error) {
    try {
      const complete = await rollbackMergedDirectory({ targetPath, rollbackPath, createdPaths, restoredPaths });
      if (!complete) error.rollbackIncomplete = true;
      onDiagnostic?.({ type: "cleanup-result", label: "Откат изменённых файлов", error: complete ? null : new Error("Не все созданные файлы удалось удалить") });
    } catch (rollbackError) {
      error.rollbackIncomplete = true;
      onDiagnostic?.({ type: "cleanup-result", label: "Откат изменённых файлов", error: rollbackError });
    }
    throw error;
  }

  return { files: sourceFiles.length, createdPaths, restoredPaths };
}

export async function rollbackMergedDirectory({ targetPath, rollbackPath, createdPaths, restoredPaths }) {
  const root = await getOpfsRoot();
  let completed = true;
  for (const path of [...createdPaths].reverse()) {
    await removePath(root, `${targetPath}/${path}`).catch(() => { completed = false; });
  }
  for (const path of [...restoredPaths].reverse()) {
    const backup = await getFileHandleAt(root, `${rollbackPath}/${path}`, false);
    const target = await getFileHandleAt(root, `${targetPath}/${path}`, true);
    await copyFile(backup, target);
  }
  return completed;
}
