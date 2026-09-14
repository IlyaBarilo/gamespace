import { formatCompatibilityBody } from "./compatibility-report.js";

const KEY = "gamespace:compatibility-check:v1";
const ORDER = ["launch", "import", "storefront", "game"];
const copy = value => JSON.parse(JSON.stringify(value));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function compatibilityContentKey(state) {
  return state?.activeRevision ? `${state.activeRevision}:${state.installedAt}` : "";
}

export function createCompatibilityCheck({ version, storage = () => globalThis.localStorage, now = Date.now } = {}) {
  let context = null;
  let memory = null;
  let warning = "";
  let storageFailed = false;
  let lastPageWasStorefront = false;
  function fresh(note = "") {
    return { schema: 1, context, token: `${now()}-${Math.random()}`, contentKey: "", pending: false, note,
      data: { variant: "PWA", appVersion: version, launchMode: "browser", steps: {
        launch: "success", import: "not_performed", storefront: "not_performed", game: "not_performed",
      } } };
  }
  function load() {
    try {
      const text = storageFailed ? null : storage().getItem(KEY);
      if (text && text.length > 16000) throw new Error("size");
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.schema !== 1 || typeof parsed.token !== "string" || typeof parsed.contentKey !== "string") throw new Error("schema");
        formatCompatibilityBody({ ...parsed.data, formedAtMs: 0, utcOffsetMinutes: 0 });
        memory = parsed;
      }
    } catch { storageFailed = true; warning = "Сохранённая проверка недоступна. Текущие результаты доступны до закрытия окна."; }
    if (!memory || memory.data.appVersion !== version || (context !== null && memory.context !== null && memory.context !== context)) memory = fresh(memory ? "Версия приложения или среда запуска изменилась. Нужна новая проверка." : "");
    return memory;
  }
  function save(next) {
    memory = next;
    try { storage().setItem(KEY, JSON.stringify(next)); }
    catch { storageFailed = true; warning = "Проверку не удалось сохранить на устройстве. Скопируйте отчёт до закрытия окна."; }
    return next;
  }
  const api = {
    snapshot() { return { ...copy(load()), warning }; },
    bindEnvironment(signature) {
      const next = `${version}|${signature}`;
      if (context === next) return;
      context = next;
      const current = load();
      current.context = context;
      save(current);
    },
    reset(note = "Новая проверка начата. Ранее выполненные действия не учитываются.") {
      lastPageWasStorefront = false;
      return save(fresh(note));
    },
    beginImport({ source, bytes, format } = {}) {
      const next = fresh();
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
      if (!next.pending && next.contentKey && next.contentKey !== compatibilityContentKey(state)) {
        api.reset("Установленное содержимое изменилось или удалено. Нужна новая проверка.");
      }
    },
    pageLoaded(isStorefront, state) {
      const next = load();
      if (next.contentKey !== compatibilityContentKey(state) || next.data.steps.import !== "success" || next.data.error) return;
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
