const INDEX_NAMES = ["index.html", "index.htm"];

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

export function validateEntries(entries) {
  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    const path = normalizeArchivePath(entry.path);
    if (!path || isIgnoredArchivePath(path)) {
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

function isIndexName(name) {
  return INDEX_NAMES.includes(name.toLocaleLowerCase("en-US"));
}

function indexPriority(path) {
  const name = path.split("/").at(-1).toLocaleLowerCase("en-US");
  if (name === "index.html") return 0;
  if (name === "index.htm") return 1;
  return 2;
}

export function findIndexEntry(entries) {
  const files = entries.filter((entry) => !entry.directory && isIndexName(entry.path.split("/").at(-1)));
  const direct = files
    .filter((entry) => !entry.path.includes("/"))
    .sort((left, right) => indexPriority(left.path) - indexPriority(right.path));
  if (direct.length) return direct[0];

  const inSite = files
    .filter((entry) => entry.path.split("/").length === 2 && entry.path.split("/")[0].toLocaleLowerCase("en-US") === "site")
    .sort((left, right) => indexPriority(left.path) - indexPriority(right.path));
  if (inSite.length) return inSite[0];

  const topLevelIndexes = files.filter((entry) => entry.path.split("/").length === 2);
  const topDirectories = new Set(
    entries
      .map((entry) => entry.path.split("/")[0])
      .filter((name) => name && name !== "__MACOSX" && !name.startsWith(".")),
  );

  if (topLevelIndexes.length === 1) return topLevelIndexes[0];
  if (topDirectories.size === 1) {
    const [onlyDirectory] = topDirectories;
    const candidates = topLevelIndexes
      .filter((entry) => entry.path.startsWith(`${onlyDirectory}/`))
      .sort((left, right) => indexPriority(left.path) - indexPriority(right.path));
    if (candidates.length) return candidates[0];
  }

  return null;
}

export function dirname(path) {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

export function parse7zSlt(lines) {
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

  return validateEntries(entries);
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
