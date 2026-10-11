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

const VIEW_LOCK_NAME = "gamespace-content-view-v1";

export async function withContentMutation(action, options = {}) {
  if (!globalThis.navigator?.locks?.request) return withSiteOperation(action, options);
  return navigator.locks.request(VIEW_LOCK_NAME, { mode: "shared", ifAvailable: true }, lock => {
    if (lock === null) throw viewerOccupiedError();
    return withSiteOperation(action, options);
  });
}

function viewerOccupiedError() {
  const error = new Error("В другом окне GameSpace открыт просмотр или выполняется операция. Закройте просмотр или дождитесь завершения операции и повторите действие.");
  error.code = "GS-VIEWER-BUSY";
  return error;
}

// The browser releases this lease if the owning window crashes or closes.
export async function acquireContentView() {
  if (!globalThis.navigator?.locks?.request) throw new Error("Просмотр архивов требует Web Locks.");
  return new Promise((resolve, reject) => {
    navigator.locks.request(VIEW_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, async lock => {
      if (lock === null) throw viewerOccupiedError();
      let release;
      const lifetime = new Promise(done => { release = done; });
      resolve(release);
      await lifetime;
    }).catch(reject);
  });
}
