const INDEX_NAME = "index.html";
const IGNORED_ROOT_NAMES = new Set(["__macosx", ".ds_store", "thumbs.db", "desktop.ini"]);

export function normalizeArchivePath(input) {
  if (typeof input !== "string") {
    throw new Error("В архиве обнаружен путь без имени.");
  }

  let normalized = input.replaceAll("\\", "/").trim();
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`Абсолютный путь в архиве запрещён: ${input}`);
  }

  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Небезопасный путь в архиве: ${input}`);
  }
  if (parts.some((part) => /[\0-\x1f]/.test(part))) {
    throw new Error(`Управляющий символ в пути архива: ${input}`);
  }

  return parts.join("/");
}

export function isIgnoredArchivePath(path) {
  return path === "__MACOSX" || path.startsWith("__MACOSX/") || path.endsWith("/.DS_Store");
}

export function validateEntries(entries, { includeIgnored = false } = {}) {
  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    const path = normalizeArchivePath(entry.path);
    if (!path || (!includeIgnored && isIgnoredArchivePath(path))) {
      continue;
    }
    if (seen.has(path)) {
      throw new Error(`Повторяющийся путь в архиве: ${path}`);
    }
    seen.add(path);
    result.push({ ...entry, path });
  }

  return result;
}

function normalizedName(name) {
  return name.toLocaleLowerCase("en-US");
}

function isIgnoredRootName(name) {
  const normalized = normalizedName(name);
  return normalized.startsWith(".") || IGNORED_ROOT_NAMES.has(normalized);
}

function isHtmlName(name) {
  return !isIgnoredRootName(name) && normalizedName(name).endsWith(".html");
}

function chooseStartEntry(files) {
  const exactIndex = files.find((entry) => entry.path.split("/").at(-1) === INDEX_NAME);
  if (exactIndex) return exactIndex;

  const caseInsensitiveIndexes = files.filter(
    (entry) => normalizedName(entry.path.split("/").at(-1)) === INDEX_NAME,
  );
  if (caseInsensitiveIndexes.length === 1) return caseInsensitiveIndexes[0];
  if (caseInsensitiveIndexes.length > 1) return null;

  const htmlFiles = files.filter((entry) => isHtmlName(entry.path.split("/").at(-1)));
  return htmlFiles.length === 1 ? htmlFiles[0] : null;
}

export function findIndexEntry(entries) {
  const visibleEntries = entries.filter((entry) => {
    const [rootName] = entry.path.split("/");
    return rootName && !isIgnoredRootName(rootName);
  });
  const rootFiles = visibleEntries.filter((entry) => !entry.directory && !entry.path.includes("/"));

  if (rootFiles.length) {
    return chooseStartEntry(rootFiles);
  }

  const topDirectories = new Set();
  for (const entry of visibleEntries) {
    const parts = entry.path.split("/");
    if (parts.length > 1 || (entry.directory && parts.length === 1)) {
      topDirectories.add(parts[0]);
    }
  }
  if (topDirectories.size !== 1) return null;

  const [onlyDirectory] = topDirectories;
  const directoryFiles = visibleEntries.filter((entry) => {
    const parts = entry.path.split("/");
    return !entry.directory && parts.length === 2 && parts[0] === onlyDirectory;
  });
  return chooseStartEntry(directoryFiles);
}

export function dirname(path) {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

export function parse7zSlt(lines, options) {
  const entries = [];
  let inEntries = false;
  let current = {};

  const flush = () => {
    if (!inEntries || current.Path === undefined) {
      current = {};
      return;
    }
    const attributes = (current.Attributes || "").trim();
    const directory = current.Folder === "+" || attributes.startsWith("D");
    const size = Number.parseInt(current.Size || "0", 10);
    entries.push({
      path: current.Path,
      directory,
      size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
      modified: current.Modified || "",
      attributes,
    });
    current = {};
  };

  for (const rawLine of lines) {
    const line = String(rawLine);
    if (line.trim() === "----------") {
      flush();
      inEntries = true;
      continue;
    }
    if (!inEntries) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    const separator = line.indexOf(" = ");
    if (separator !== -1) {
      current[line.slice(0, separator)] = line.slice(separator + 3);
    }
  }
  flush();

  return validateEntries(entries, options);
}

export function summarizeEntries(entries) {
  return entries.reduce(
    (summary, entry) => {
      summary.entries += 1;
      if (!entry.directory) {
        summary.files += 1;
        summary.uncompressedBytes += entry.size || 0;
      }
      return summary;
    },
    { entries: 0, files: 0, uncompressedBytes: 0 },
  );
}
