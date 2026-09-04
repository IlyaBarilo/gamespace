const DB_NAME = "gamespace-pwa";
const DB_VERSION = 1;
const STORE_NAME = "app";
const STATE_KEY = "state";
const JOURNAL_KEY = "operation-journal";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть IndexedDB."));
  });
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let value;
      try {
        value = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error || new Error("Ошибка IndexedDB."));
      transaction.onabort = () => reject(transaction.error || new Error("Операция IndexedDB отменена."));
    });
  } finally {
    database.close();
  }
}

export async function readState() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Не удалось прочитать состояние приложения."));
    });
  } finally {
    database.close();
  }
}

export function writeState(state) {
  return withStore("readwrite", (store) => store.put(state, STATE_KEY));
}

export function commitStateAndClearOperationJournal(state) {
  return withStore("readwrite", (store) => {
    store.put(state, STATE_KEY);
    store.delete(JOURNAL_KEY);
  });
}

export function clearState() {
  return withStore("readwrite", (store) => store.delete(STATE_KEY));
}

export function beginSiteRemoval(journal) {
  return withStore("readwrite", (store) => {
    store.put(journal, JOURNAL_KEY);
    store.delete(STATE_KEY);
  });
}

export function clearStateIfRevision(revisionPath) {
  return withStore("readwrite", (store) => {
    const result = { state: null, cleared: false };
    const request = store.get(STATE_KEY);
    request.onsuccess = () => {
      result.state = request.result || null;
      if (result.state?.revisionPath === revisionPath) {
        store.delete(STATE_KEY);
        result.state = null;
        result.cleared = true;
      }
    };
    return result;
  });
}

export async function readOperationJournal() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(JOURNAL_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Не удалось прочитать журнал операции."));
    });
  } finally {
    database.close();
  }
}

export function writeOperationJournal(journal) {
  return withStore("readwrite", (store) => store.put(journal, JOURNAL_KEY));
}

export function clearOperationJournal() {
  return withStore("readwrite", (store) => store.delete(JOURNAL_KEY));
}
