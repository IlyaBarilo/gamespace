export const DEMO_ARCHIVE_ID = "builtin-demo";
export const ARCHIVES_ROOT = "gamespace/archives";

export function createArchiveCatalog(state = null) {
  const catalog = { schema: 1, activeId: null, legacyRevision: null,
    entries: [{ id: DEMO_ARCHIVE_ID, kind: "demo", name: "Встроенное демо", createdAt: null, state: null }] };
  if (!state?.revisionPath) return catalog;
  const id = state.archiveId || (state.archiveName?.startsWith("Встроенный демо-сайт") ? DEMO_ARCHIVE_ID : `legacy-${state.activeRevision}`);
  const entry = { id, kind: id === DEMO_ARCHIVE_ID ? "demo" : "user", name: id === DEMO_ARCHIVE_ID ? "Встроенное демо" : state.archiveName || "Мой архив", createdAt: state.installedAt, state: normalizeArchiveState(state, id) };
  const demoIndex = catalog.entries.findIndex(item => item.id === id);
  if (demoIndex >= 0) catalog.entries[demoIndex] = entry;
  else catalog.entries.push(entry);
  catalog.activeId = id;
  if (state.revisionPath.startsWith("gamespace/revisions/")) catalog.legacyRevision = state.activeRevision;
  return catalog;
}

export function normalizeArchiveState(state, id) {
  return { ...state, archiveId: id, activeRevision: state.archiveRevision || state.activeRevision };
}

export function catalogContentState(catalog) {
  const entry = catalog.entries.find(item => item.id === catalog.activeId);
  if (!entry?.state?.revisionPath) return null;
  // Pin the legacy revision for the v1 shell's startup cleanup after rollback.
  return { ...entry.state, archiveId: entry.id, archiveDisplayName: entry.name,
    archiveRevision: entry.state.activeRevision,
    activeRevision: catalog.legacyRevision || entry.state.activeRevision };
}

export function storeArchiveInCatalog(catalog, state, { id = state.archiveId, name, kind = "user" } = {}) {
  if (!id) throw new Error("Не указан архив для сохранения.");
  const previous = catalog.entries.find(item => item.id === id);
  const entry = { id, kind: previous?.kind || kind,
    name: previous?.name || name || state.archiveName || "Мой архив",
    createdAt: previous?.createdAt || state.installedAt, state: normalizeArchiveState(state, id) };
  const entries = previous ? catalog.entries.map(item => item.id === id ? entry : item) : [...catalog.entries, entry];
  return { ...catalog, entries, activeId: id };
}

export function detachCatalogArchive(catalog, id) {
  const entries = catalog.entries.flatMap(item => item.id !== id ? [item]
    : item.kind === "demo" ? [{ ...item, state: null, createdAt: null }] : []);
  const activeId = catalog.activeId === id ? entries.find(item => item.state?.revisionPath)?.id || null : catalog.activeId;
  return { ...catalog, entries, activeId };
}

export function summarizeArchiveCatalog(catalog) {
  return catalog.entries.reduce((total, entry) => ({ bytes: total.bytes + (entry.state?.writtenBytes || 0),
    files: total.files + (entry.state?.files || 0), installed: total.installed + (entry.state?.revisionPath ? 1 : 0),
  }), { bytes: 0, files: 0, installed: 0 });
}

export function validateArchiveCatalog(catalog) {
  if (catalog?.schema !== 1 || !Array.isArray(catalog.entries)) throw new Error("Неизвестный формат списка архивов. Данные сохранены.");
  const ids = new Set(), paths = new Set();
  for (const entry of catalog.entries) {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)
      || !["demo", "user"].includes(entry.kind) || typeof entry.name !== "string") {
      throw new Error("Список архивов повреждён. Автоматическая очистка отменена.");
    }
    ids.add(entry.id);
    if (entry.state) {
      const path = entry.state.revisionPath;
      if (typeof path !== "string" || !/^gamespace\/(?:revisions|archives)\/[a-zA-Z0-9-]+$/.test(path) || paths.has(path)) {
        throw new Error("Некорректный каталог архива. Автоматическая очистка отменена.");
      }
      paths.add(path);
    }
  }
  if (!ids.has(DEMO_ARCHIVE_ID) || (catalog.activeId !== null && !ids.has(catalog.activeId))) {
    throw new Error("Список архивов неполный. Данные сохранены.");
  }
  return catalog;
}
