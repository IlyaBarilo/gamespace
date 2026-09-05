const LOCK_NAME = "gamespace-site-operation-v1";

// One lock covers the complete filesystem transaction, including recovery and
// cleanup. Internal calls must use the unlocked helpers to avoid nested locks.
export async function withSiteOperation(action, { signal, onWait } = {}) {
  if (!globalThis.navigator?.locks?.request) {
    throw new Error("Безопасная работа с хранилищем требует Web Locks. Обновите браузер и снова откройте GameSpace.");
  }
  onWait?.();
  const options = { mode: "exclusive" };
  if (signal) options.signal = signal;
  return navigator.locks.request(LOCK_NAME, options, action);
}
