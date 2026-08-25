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

export async function mergeDirectoryWithRollback({ sourcePath, targetPath, rollbackPath, onProgress, onJournal }) {
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
      const targetExisted = await fileExists(root, targetFilePath);
      if (targetExisted) {
        const existing = await getFileHandleAt(root, targetFilePath, false);
        const backup = await getFileHandleAt(root, rollbackFilePath, true);
        await copyFile(existing, backup);
        restoredPaths.push(item.path);
      } else {
        createdPaths.push(item.path);
      }

      await onJournal?.({ createdPaths: [...createdPaths], restoredPaths: [...restoredPaths] });

      const target = await getFileHandleAt(root, targetFilePath, true);
      await copyFile(item.handle, target);
      onProgress?.({ current: index + 1, total: sourceFiles.length, path: item.path });
    }
  } catch (error) {
    await rollbackMergedDirectory({ targetPath, rollbackPath, createdPaths, restoredPaths }).catch(() => {});
    throw error;
  }

  return { files: sourceFiles.length, createdPaths, restoredPaths };
}

export async function rollbackMergedDirectory({ targetPath, rollbackPath, createdPaths, restoredPaths }) {
  const root = await getOpfsRoot();
  for (const path of [...createdPaths].reverse()) {
    await removePath(root, `${targetPath}/${path}`).catch(() => {});
  }
  for (const path of [...restoredPaths].reverse()) {
    const backup = await getFileHandleAt(root, `${rollbackPath}/${path}`, false);
    const target = await getFileHandleAt(root, `${targetPath}/${path}`, true);
    await copyFile(backup, target);
  }
}
