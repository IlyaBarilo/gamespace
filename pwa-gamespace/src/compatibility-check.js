import { getShellLocalStorage } from "./shell-localstorage.js";

import { formatCompatibilityBody } from "./compatibility-report.js";

const KEY = "gamespace:compatibility-check:v1";
export const COMPATIBILITY_ARCHIVE_PREFIX = "gamespace:compatibility-check:archive:v1:";
const archiveKey = id => `${COMPATIBILITY_ARCHIVE_PREFIX}${id === null ? "unassigned" : `id:${encodeURIComponent(id)}`}`;
const ORDER = ["launch", "import", "storefront", "game"];
const copy = value => JSON.parse(JSON.stringify(value));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function compatibilityContentKey(state) {
  const revision = state?.archiveRevision || state?.activeRevision;
  return revision ? `${revision}:${state.installedAt}` : "";
}

export function createCompatibilityCheck({ version, storage = () => getShellLocalStorage(), now = Date.now } = {}) {
  let context = null;
  let archiveId = null;
  const memories = new Map();
  let warning = "";
  const memoryOnlyKeys = new Set();
  let lastPageWasStorefront = false;
  function fresh(note = "") {
    return { schema: 1, archiveId, context, token: `${now()}-${Math.random()}`, contentKey: "", pending: false, attempt: false, note,
      data: { variant: "PWA", appVersion: version, launchMode: "browser", steps: {
        launch: "success", import: "not_performed", storefront: "not_performed", game: "not_performed",
      } } };
  }
  function readStored(key) {
    if (memoryOnlyKeys.has(key)) return null;
    try {
      const text = storage().getItem(key);
      if (!text) return null;
      if (text.length > 16000) throw new Error("size");
      const parsed = JSON.parse(text);
      if (parsed.schema !== 1 || typeof parsed.token !== "string" || typeof parsed.contentKey !== "string"
        || (parsed.archiveId !== undefined && parsed.archiveId !== null && typeof parsed.archiveId !== "string")) throw new Error("schema");
      formatCompatibilityBody({ ...parsed.data, formedAtMs: 0, utcOffsetMinutes: 0 });
      return parsed;
    } catch {
      memoryOnlyKeys.add(key);
      warning = "Сохранённая проверка недоступна. Текущие результаты доступны до закрытия окна.";
      return null;
    }
  }
  // Keep the old key as the current-view mirror for older shells. Archive keys
  // are authoritative: another window's mirror cannot replace this archive's result.
  const mirror = readStored(KEY);
  let legacy = mirror && !mirror.archiveId && !mirror.attempt && mirror.contentKey ? copy(mirror) : null;
  if (mirror) {
    archiveId = mirror.archiveId ?? null;
    memories.set(archiveId, mirror);
  }
  function load() {
    const stored = readStored(archiveKey(archiveId));
    if (stored && stored.archiveId !== archiveId) {
      memoryOnlyKeys.add(archiveKey(archiveId));
      warning = "Сохранённая проверка недоступна. Текущие результаты доступны до закрытия окна.";
    } else if (stored) memories.set(archiveId, stored);
    let current = memories.get(archiveId);
    if (!current || current.data.appVersion !== version || (context !== null && current.context !== null && current.context !== context)) {
      current = fresh(current ? "Версия приложения или среда запуска изменилась. Нужна новая проверка." : "");
    }
    current.archiveId = archiveId;
    memories.set(archiveId, current);
    return current;
  }
  function save(next) {
    next.archiveId = archiveId;
    memories.set(archiveId, next);
    try {
      storage().setItem(archiveKey(archiveId), JSON.stringify(next));
      storage().setItem(KEY, JSON.stringify(next));
      memoryOnlyKeys.delete(archiveKey(archiveId));
      memoryOnlyKeys.delete(KEY);
    } catch {
      memoryOnlyKeys.add(archiveKey(archiveId));
      warning = "Проверку не удалось сохранить на устройстве. Скопируйте отчёт до закрытия окна.";
    }
    return next;
  }
  function removeRecord(id) {
    memories.delete(id);
    try { storage().removeItem(archiveKey(id)); memoryOnlyKeys.delete(archiveKey(id)); }
    catch { memoryOnlyKeys.add(archiveKey(id)); warning = "Сохранённую проверку не удалось удалить. Её очистка повторится при запуске приложения."; }
  }
  const api = {
    snapshot() { return { ...copy(load()), warning }; },
    selectArchive(state) {
      const id = state?.archiveId || null;
      const stored = readStored(archiveKey(id));
      const hasRecord = Boolean(stored || memories.has(id));
      archiveId = id;
      lastPageWasStorefront = false;
      // Adopt a pre-catalog check only when its observed content is exactly the
      // selected revision; never infer a successful import from installed files.
      if (!hasRecord && legacy?.contentKey && legacy.contentKey === compatibilityContentKey(state)) {
        memories.set(id, { ...copy(legacy), archiveId: id });
        legacy = null;
      }
      api.reconcileContent(state);
      const next = load();
      next.context = context;
      return save(next);
    },
    forgetArchive(id, expectedContentKey = null) {
      if (!id) return;
      const stored = readStored(archiveKey(id)) || memories.get(id);
      if (expectedContentKey !== null && stored?.contentKey && stored.contentKey !== expectedContentKey) return;
      removeRecord(id);
      if (archiveId === id) {
        archiveId = null;
        lastPageWasStorefront = false;
        save(fresh("Архив удалён. Выберите содержимое для проверки."));
      }
    },
    retainArchives(ids) {
      const allowed = new Set(ids);
      const obsolete = new Set([...memories.keys()].filter(id => id !== null && !allowed.has(id)));
      try {
        const source = storage();
        for (let index = 0; index < source.length; index++) {
          const key = source.key(index);
          if (!key?.startsWith(`${COMPATIBILITY_ARCHIVE_PREFIX}id:`)) continue;
          const id = decodeURIComponent(key.slice(`${COMPATIBILITY_ARCHIVE_PREFIX}id:`.length));
          if (!allowed.has(id)) obsolete.add(id);
        }
      } catch { warning = "Историю проверок пока не удалось очистить. Очистка повторится при запуске приложения."; }
      for (const id of obsolete) api.forgetArchive(id);
    },
    bindEnvironment(signature) {
      const next = `${version}|${signature}`;
      if (context === next) return;
      context = next;
      const current = load();
      current.context = context;
      save(current);
    },
    reset(note = "Новая проверка начата. Ранее выполненные действия не учитываются.") {
      const attempt = archiveId === null && load().attempt === true;
      lastPageWasStorefront = false;
      const next = fresh(note);
      next.attempt = attempt;
      return save(next);
    },
    beginImport({ source, bytes, format } = {}) {
      // A pending or failed replacement must not overwrite the installed
      // archive's previous observations. Associate it only after commit succeeds.
      archiveId = null;
      const next = fresh();
      next.attempt = true;
      next.pending = true;
      next.startedAt = now();
      next.data.archiveSource = source === "demo" ? "demo" : "user";
      next.data.archiveBytes = count(bytes);
      next.data.archiveFormat = ["7z", "ZIP", "ZIP64"].includes(format) ? format : null;
      next.data.steps.import = "not_checked";
      next.data.steps.storefront = next.data.steps.game = "not_checked";
      next.note = "Начало импорта зафиксировано. Его успешное завершение пока не подтверждено.";
      lastPageWasStorefront = false;
      save(next);
      return next.token;
    },
    archiveFormat(token, format) {
      const next = load();
      if (next.token !== token || !next.pending) return;
      next.data.archiveFormat = format === "7z" ? "7z" : format === "zip" ? "ZIP" : null;
      save(next);
    },
    finishImport(token, state, isUpdate = false) {
      const next = load();
      if (next.token !== token || !next.pending) return;
      archiveId = state?.archiveId || null;
      next.archiveId = archiveId;
      next.attempt = false;
      if (archiveId !== null) removeRecord(null);
      if (isUpdate) { api.reset("Сайт обновлён. Для базовой проверки выполните полную установку демо или своего архива."); return; }
      next.pending = false;
      next.contentKey = compatibilityContentKey(state);
      next.data.archiveFiles = count(state?.files);
      next.data.importDurationMs = count(now() - next.startedAt);
      next.data.steps.import = "success";
      next.data.steps.storefront = next.data.steps.game = "not_performed";
      next.note = "Импорт завершён. Откройте витрину и перейдите в игру.";
      save(next);
    },
    fail(stage, category = "other", { token, interrupted = false } = {}) {
      const next = load();
      if (token && next.token !== token) return;
      const index = ORDER.indexOf(stage);
      if (index < 0) return;
      const earlier = ORDER.findIndex(key => next.data.steps[key] === "error");
      if (earlier >= 0 && earlier < index) return;
      next.pending = false;
      if (stage === "import") next.data.importDurationMs = count(now() - next.startedAt);
      next.data.steps[stage] = interrupted ? "interrupted" : "error";
      for (let i = index + 1; i < ORDER.length; i++) next.data.steps[ORDER[i]] = "not_checked";
      if (interrupted) delete next.data.error;
      else next.data.error = ["quota", "space", "archive", "index", "access", "demo", "page", "script", "resource", "timeout"].includes(category) ? category : "other";
      next.note = interrupted ? "Операция прервана. Её успешное завершение не подтверждено." : "Зафиксирована ошибка. Её этап и краткое описание включены в отчёт.";
      save(next);
    },
    reconcileContent(state) {
      const next = load();
      if (archiveId !== (state?.archiveId || null)) {
        if (next.attempt || next.pending) return;
        api.selectArchive(state);
        return;
      }
      if (!next.pending && next.contentKey && next.contentKey !== compatibilityContentKey(state)) {
        api.reset("Установленное содержимое изменилось или удалено. Нужна новая проверка.");
      }
    },
    pageLoaded(isStorefront, state) {
      const next = load();
      if (next.attempt || archiveId !== (state?.archiveId || null) || next.contentKey !== compatibilityContentKey(state) || next.data.steps.import !== "success" || next.data.error) return;
      if (isStorefront) { next.data.steps.storefront = "success"; lastPageWasStorefront = true; }
      else if (lastPageWasStorefront && next.data.steps.storefront === "success") { next.data.steps.game = "recorded"; lastPageWasStorefront = false; }
      next.note = "";
      save(next);
    },
  };
  load();
  return api;
}

export function compatibilityErrorCategory(error, diagnosticCode = "") {
  if (error?.name === "QuotaExceededError" || diagnosticCode === "GS-NO-SPACE") return "quota";
  if (diagnosticCode === "GS-ACCESS") return "access";
  if (diagnosticCode === "GS-INDEX-CHECK") return "index";
  if (diagnosticCode === "GS-ARCHIVE") return "archive";
  return "other";
}
