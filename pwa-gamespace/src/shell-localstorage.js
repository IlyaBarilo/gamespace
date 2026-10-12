const SHELL_KEYS = new Set([
  "gamespace:viewer-menu-tab:v1", "gamespace:last-error:v1", "gamespace:last-installed:v1",
  "gamespace:last-archive-statistics:v1", "gamespace:runtime-history:v1", "gamespace:compatibility-check:v1",
]);
export const isShellStorageKey = key => SHELL_KEYS.has(key) || key.startsWith("gamespace:activity:v1:");
let backend = null;
let remembered = new Map();

function currentStorage() {
  const storage = globalThis.localStorage;
  if (storage !== backend) {
    backend = storage;
    remembered = new Map();
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null && isShellStorageKey(key)) {
        const value = storage.getItem(key);
        if (value !== null) remembered.set(key, value);
      }
    }
  }
  return storage;
}

// Native localStorage.clear() in a game clears the whole origin. Keep the
// shell's known keys in memory and restore them without restoring game saves.
const shellStorage = {
  get length() { return currentStorage().length; },
  key(index) { return currentStorage().key(index); },
  getItem(key) {
    const storage = currentStorage();
    let value = storage.getItem(key);
    if (isShellStorageKey(key)) {
      if (value === null && remembered.has(key)) {
        value = remembered.get(key);
        storage.setItem(key, value);
      } else if (value !== null) remembered.set(key, value);
    }
    return value;
  },
  setItem(key, value) {
    const storage = currentStorage();
    if (isShellStorageKey(key)) remembered.set(key, String(value));
    storage.setItem(key, value);
  },
  removeItem(key) {
    const storage = currentStorage();
    remembered.delete(key);
    storage.removeItem(key);
  },
};
export function getShellLocalStorage() { currentStorage(); return shellStorage; }

if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("storage", event => {
  try {
    const storage = currentStorage();
    if (event.storageArea !== storage) return;
    if (event.key === null) {
      for (const [key, value] of remembered) if (storage.getItem(key) === null) storage.setItem(key, value);
    } else if (isShellStorageKey(event.key)) {
      if (event.newValue === null) remembered.delete(event.key);
      else remembered.set(event.key, event.newValue);
    }
  } catch { /* Shell stores retain their existing denied-storage fallbacks. */ }
});
