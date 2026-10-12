import {
  readArchiveCatalog, readGameLocalStorageControl, readGameLocalStorageProfile,
  saveGameLocalStorage, writeArchiveCatalog,
} from "./db.js";

import { isShellStorageKey } from "./shell-localstorage.js";
export { isShellStorageKey } from "./shell-localstorage.js";

const SHARED_SLOT = "shared";
const UNASSIGNED_SLOT = "unassigned";
export const archiveStorageSlot = id => id ? `archive:${id}` : UNASSIGNED_SLOT;

export function snapshotGameLocalStorage(storage = globalThis.localStorage) {
  const entries = new Map();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === null || isShellStorageKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) entries.set(key, value);
  }
  return [...entries];
}

export function validateGameStorageEntries(entries) {
  if (!Array.isArray(entries)) throw new Error("Сохранённый набор localStorage повреждён. Данные оставлены на месте.");
  const keys = new Set();
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string"
      || isShellStorageKey(pair[0]) || keys.has(pair[0])) {
      throw new Error("Сохранённый набор localStorage повреждён. Данные оставлены на месте.");
    }
    keys.add(pair[0]);
  }
  return entries;
}

export function restoreGameLocalStorage(entries, storage = globalThis.localStorage) {
  validateGameStorageEntries(entries);
  const oldKeys = snapshotGameLocalStorage(storage).map(([key]) => key);
  for (const key of oldKeys) storage.removeItem(key);
  for (const [key, value] of entries) storage.setItem(key, value);
}

function validateControl(control) {
  const validSlot = slot => typeof slot === "string" && (slot === SHARED_SLOT || slot === UNASSIGNED_SLOT || slot.startsWith("archive:"));
  if (control?.schema !== 1 || typeof control.shared !== "boolean" || typeof control.sharedInitialized !== "boolean"
    || !validSlot(control.slot) || (control.ownerId !== null && typeof control.ownerId !== "string")
    || (control.shared && control.slot !== SHARED_SLOT) || (!control.shared && control.slot === SHARED_SLOT)) {
    throw new Error("Неизвестный формат сохранений игр. Переключение отменено.");
  }
  if (!control.shared && control.slot !== archiveStorageSlot(control.ownerId)) throw new Error("Владелец сохранений localStorage не совпадает с набором. Данные сохранены.");
  if (control.pending) {
    if (control.pending.sourceSlot !== control.slot) throw new Error("Журнал сохранений повреждён. Данные сохранены.");
    validateGameStorageEntries(control.pending.sourceEntries);
  }
  return control;
}

async function profileEntries(slot, { required = false } = {}) {
  const profile = await readGameLocalStorageProfile(slot);
  if (!profile) {
    if (required) throw new Error("Общий набор localStorage отсутствует. Переключение отменено, текущие данные сохранены.");
    return [];
  }
  if (profile.schema !== 1) throw new Error("Неизвестный формат набора localStorage. Данные сохранены.");
  return validateGameStorageEntries(profile.entries);
}

async function initializeControl(catalog) {
  const existing = await readGameLocalStorageControl();
  if (existing) return validateControl(existing);
  // Adopt the first-stage shared data for the currently selected archive.
  const ownerId = catalog?.activeId || null;
  const control = { schema: 1, shared: false, sharedInitialized: false, ownerId,
    slot: archiveStorageSlot(ownerId), pending: null };
  // Current values remain durable in native localStorage. Snapshot on departure.
  snapshotGameLocalStorage(); // Verify access before recording ownership.
  await saveGameLocalStorage({ control });
  return control;
}

// Must run under the site-operation lock with no live content viewer.
export async function recoverGameLocalStorage() {
  const control = await readGameLocalStorageControl();
  if (!control) return false;
  validateControl(control);
  if (!control.pending) return false;
  restoreGameLocalStorage(control.pending.sourceEntries);
  await saveGameLocalStorage({ control: { ...control, pending: null },
    profiles: [{ slot: control.slot, entries: control.pending.sourceEntries }] });
  return true;
}

export async function readGameLocalStorageMode() {
  const control = await readGameLocalStorageControl();
  if (!control) return { shared: false, initialized: false };
  validateControl(control);
  return { shared: control.shared, initialized: true, pending: Boolean(control.pending) };
}

// The caller owns content-view exclusion and the site-operation lock. Native
// localStorage and IndexedDB cannot form a single transaction: persist a rollback
// journal first, then swap native values, finally commit profiles + catalog.
export async function activateCatalogWithLocalStorage(catalog, { shared, discardId, ...catalogOptions } = {}) {
  await recoverGameLocalStorage();
  const beforeCatalog = await readArchiveCatalog();
  const control = await initializeControl(beforeCatalog);
  const sourceEntries = snapshotGameLocalStorage();
  const nextShared = shared ?? control.shared;
  const targetSlot = nextShared ? SHARED_SLOT : archiveStorageSlot(catalog.activeId);
  const ownerId = catalog.activeId || null;
  let targetEntries;
  if (targetSlot === control.slot) targetEntries = sourceEntries;
  else if (nextShared && !control.sharedInitialized) targetEntries = sourceEntries;
  else if (!nextShared && control.slot === UNASSIGNED_SLOT && ownerId && sourceEntries.length) targetEntries = sourceEntries;
  else targetEntries = await profileEntries(targetSlot, { required: nextShared && control.sharedInitialized });
  const after = { ...control, shared: nextShared, sharedInitialized: control.sharedInitialized || nextShared,
    ownerId, slot: targetSlot, pending: null };
  const profiles = [{ slot: control.slot, entries: sourceEntries }, { slot: targetSlot, entries: targetEntries }];
  const deleteProfiles = discardId ? [archiveStorageSlot(discardId)] : [];
  if (control.slot === UNASSIGNED_SLOT && ownerId && control.slot !== targetSlot) deleteProfiles.push(UNASSIGNED_SLOT);
  const commit = () => writeArchiveCatalog(catalog, { ...catalogOptions,
    localStorageCommit: { control: after, profiles, deleteProfiles } });
  if (targetSlot === control.slot) {
    // No native change is needed. Do not copy a live 5 MB dataset on every open,
    // update or inactive deletion; native values are the latest active saves.
    await writeArchiveCatalog(catalog, { ...catalogOptions,
      localStorageCommit: { control: after, deleteProfiles } });
    return after;
  }
  await saveGameLocalStorage({ control: { ...control, pending: { sourceSlot: control.slot, sourceEntries } },
    profiles: [{ slot: control.slot, entries: sourceEntries }] });
  try {
    restoreGameLocalStorage(targetEntries);
    await commit();
    return after;
  } catch (error) {
    try { await recoverGameLocalStorage(); }
    catch {
      const failure = new Error("Переключение localStorage прервано. Сохранения защищены журналом; закройте другие окна и повторно откройте GameSpace для восстановления.", { cause: error });
      failure.code = "GS-STORAGE-RECOVERY";
      throw failure;
    }
    const failure = new Error("Не удалось переключить localStorage. Предыдущие сохранения восстановлены; архивы не переключались.", { cause: error });
    failure.code = "GS-STORAGE-SWITCH";
    throw failure;
  }
}
