const STORAGE_KEY = "gamespace:last-error:v1";
export const MAX_REPORT_CHARS = 24_000;
const MAX_MESSAGES = 20;
const NUMBER_FIELDS = ["archiveBytes", "uncompressedBytes", "availableBytes", "requiredBytes", "reserveBytes", "files", "processedBytes", "totalBytes", "completedFiles", "current", "total"];

export function safeDiagnosticText(value, limit = 1500) {
  const text = String(value ?? "").replace(/\r\n/g, "\n")
    .replace(/(?:https?|file|content|blob):\/\/[^\s"'<>]+/gi, (url) => {
      // Keep only the script name and line/column of stack frames, never origin or query tokens.
      const frame = /\/([^/?#]+:\d+:\d+)\)?$/.exec(url);
      return frame ? `[скрипт ${frame[1]}]` : "[URL скрыт]";
    })
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "?");
  return text.length > limit ? `${text.slice(0, limit - 20)}\n[Текст сокращён]` : text;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function serializeDiagnosticError(error) {
  const seen = new Set();
  function visit(current, depth = 0) {
    if (current == null || depth >= 6 || seen.has(current)) return null;
    seen.add(current);
    const result = {
      name: safeDiagnosticText(current?.name || (typeof current === "object" ? "Error" : typeof current), 100),
      message: safeDiagnosticText(current?.message ?? (typeof current === "object" ? "Ошибка без сообщения" : current)),
      stack: safeDiagnosticText(current?.stack || "", 2500),
    };
    if (typeof current?.code === "string" || typeof current?.code === "number") result.code = safeDiagnosticText(current.code, 100);
    if (typeof current?.errno === "number") result.errno = current.errno;
    const cause = visit(current?.cause, depth + 1);
    if (cause) result.cause = cause;
    return result;
  }
  return visit(error) || { name: "Error", message: "Неизвестная ошибка", stack: "" };
}

export function restoreDiagnosticError(data, depth = 0) {
  const error = new Error(safeDiagnosticText(data?.message || "Ошибка обработчика архива"));
  error.name = safeDiagnosticText(data?.name || "Error", 100);
  if (data?.stack) error.stack = safeDiagnosticText(data.stack, 2500);
  if (data?.code != null) error.code = safeDiagnosticText(data.code, 100);
  if (typeof data?.errno === "number") error.errno = data.errno;
  if (data?.cause && depth < 5) error.cause = restoreDiagnosticError(data.cause, depth + 1);
  return error;
}

export function diagnosticErrorCode(error, stage = "operation") {
  const details = JSON.stringify(serializeDiagnosticError(error)).toLowerCase();
  if (/quotaexceedederror|enospc|edquot|no space|недостаточно.*квот/.test(details)) return "GS-NO-SPACE";
  if (/notallowederror|securityerror|eacces|permission denied/.test(details)) return "GS-ACCESS";
  if (/notreadableerror/.test(details)) return "GS-FILE-READ";
  if (/notsupportederror/.test(details)) return "GS-NOT-SUPPORTED";
  return `GS-${String(stage).toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 48)}`;
}

export class OperationDiagnostics {
  constructor(operation, { file, startedAt = Date.now() } = {}) {
    this.data = { operation, startedAt, stage: "prepare", stageLabel: "Подготовка операции", messages: [], cleanup: [] };
    if (file) this.data.archive = { name: safeDiagnosticText(file.name), bytes: finite(file.size), type: safeDiagnosticText(file.type, 100) };
  }

  stage(stage, label) {
    this.observe({ type: "phase", phase: stage, label });
  }

  observe(event) {
    if (!event) return;
    if (event.type === "archive-format") this.data.format = safeDiagnosticText(event.format, 100);
    if (event.type === "phase") {
      this.data.stage = safeDiagnosticText(event.phase, 80);
      this.data.stageLabel = safeDiagnosticText(event.label);
    }
    if (["archive-info", "progress", "apply-progress", "file-stage"].includes(event.type)) {
      for (const name of NUMBER_FIELDS) {
        if (finite(event[name]) !== null) this.data[name] = event[name];
      }
      if (typeof event.currentFile === "string" || typeof event.path === "string") {
        this.data.currentFile = safeDiagnosticText(event.currentFile ?? event.path);
      }
      if (event.type === "file-stage") {
        this.data.stage = safeDiagnosticText(event.phase, 80);
        this.data.stageLabel = safeDiagnosticText(event.label);
      }
    }
    if (event.type === "diagnostic") {
      this.data.messages.push(safeDiagnosticText(event.message, 500));
      this.data.messages = this.data.messages.slice(-MAX_MESSAGES);
    }
    if (event.type === "cleanup-result") {
      this.data.cleanup.push(safeDiagnosticText(`${event.label}: ${event.error ? `не завершено — ${event.error.name || "Error"}: ${event.error.message || event.error}` : "завершено"}`));
      this.data.cleanup = this.data.cleanup.slice(-8);
    }
  }

  failure(error) {
    const original = error?.diagnosticContext && error.cause ? error.cause : error;
    const wrapped = new Error(original?.message || String(original ?? "Неизвестная ошибка"), { cause: original });
    wrapped.name = original?.name || "Error";
    wrapped.diagnosticContext = {
      ...this.data,
      ...error?.diagnosticContext,
      startedAt: Math.min(this.data.startedAt, error?.diagnosticContext?.startedAt || this.data.startedAt),
      failedAt: error?.diagnosticContext?.failedAt || Date.now(),
      messages: [...(error?.diagnosticContext?.messages || this.data.messages)],
      cleanup: [...(error?.diagnosticContext?.cleanup || this.data.cleanup)],
    };
    return wrapped;
  }
}

export function addCleanupDiagnostic(error, label, cleanupError = null) {
  const context = error?.diagnosticContext;
  if (!context) return;
  context.cleanup.push(safeDiagnosticText(`${label}: ${cleanupError ? `не завершено — ${cleanupError.name || "Error"}: ${cleanupError.message || cleanupError}` : "завершено"}`));
  context.cleanup = context.cleanup.slice(-8);
}

export function createDiagnosticReport(error, environment = {}, fallback = {}) {
  // Restricted browser contexts can reject even metadata access. The report must
  // still preserve the operation error instead of failing while diagnosing it.
  if (typeof environment === "function") {
    try { environment = environment(); }
    catch (metadataError) {
      environment = { capabilities: `Сведения недоступны: ${metadataError?.name || "Error"}: ${metadataError?.message || metadataError}` };
    }
  }
  environment ||= {};
  const context = { ...fallback, ...error?.diagnosticContext };
  const original = error?.diagnosticContext && error.cause ? error.cause : error;
  const exception = serializeDiagnosticError(original);
  const timestamp = context.failedAt || Date.now();
  const id = `PWA-${timestamp.toString(36)}`;
  const code = context.manual ? "GS-MANUAL" : diagnosticErrorCode(original, context.stage);
  const lines = [context.manual ? "GameSpace PWA — ручной диагностический отчёт, формат 1" : "GameSpace PWA — отчёт об ошибке, формат 1"];
  const line = (label, value) => lines.push(`${label}: ${value == null || value === "" ? "неизвестно" : safeDiagnosticText(value).replace(/\n/g, " ")}`);
  line("Код", code);
  line("Этап сбоя", context.stageLabel || context.stage);
  line(context.manual ? "Причина создания" : "Ошибка", context.manual ? "Пользователь сообщил о проблеме; исключение не требуется" : `${exception.name}: ${exception.message}`);
  line("Номер отчёта", id);
  line("Время", new Date(timestamp).toISOString());
  line("Версия PWA", environment.version);
  line("Активная версия", environment.activeVersion);
  line("Service Worker", environment.runtime);
  line("Контроль Service Worker", environment.controlled);
  line("Среда запуска", environment.browser);
  line("Движок", environment.engine);
  line("Браузер / ОС (сообщает браузер)", environment.userAgent);
  line("Режим запуска", environment.displayMode);
  line("Онлайн по данным браузера", environment.online);
  line("Возможности", environment.capabilities);
  for (const [key, label] of Object.entries({ page: "Страница", resource: "Ресурс", script: "Скрипт", line: "Строка", column: "Столбец", command: "Команда runtime", targetVersion: "Выбранная версия", expectedBytes: "Ожидаемый размер загрузки, байт", httpStatus: "HTTP-статус", revision: "Ревизия сайта", storageCheck: "Проверка сайта", severity: "Уровень" })) line(label, context[key] ?? environment[key]);
  line("Операция", fallback.operation && fallback.operation !== "операция приложения" ? fallback.operation : context.operation);
  line("Сайт до операции", fallback.previousSite);
  line("Архив", context.archive?.name);
  line("Размер архива, байт", context.archive?.bytes);
  line("Формат архива", context.format || context.archive?.type);
  line("Время до ошибки, мс", context.startedAt ? Math.max(0, timestamp - context.startedAt) : null);
  line("Последний файл в архиве", context.currentFile);
  for (const [key, label] of Object.entries({
    uncompressedBytes: "Размер после распаковки, байт", availableBytes: "Доступная квота при проверке архива, байт",
    requiredBytes: "Требуется с резервом, байт", processedBytes: "Обработано данных, байт", totalBytes: "Всего данных, байт",
    files: "Файлов в архиве", completedFiles: "Файлов записано", current: "Применено файлов обновления", total: "Всего файлов обновления",
  })) line(label, finite(context[key]));
  line("Последняя оценка квоты браузера, байт", finite(environment.storage?.quota));
  line("Последняя оценка использования, байт", finite(environment.storage?.usage));
  line("Время оценки хранилища", environment.storage?.measuredAt);
  lines.push("Примечание: квота браузера — не свободное место на всём устройстве.");
  if (environment.journalWarning) line("Журнал", environment.journalWarning);
  const active = context.activeOperation || environment.activeOperation;
  if (active) {
    lines.push("", "Операция без отметки о завершении:");
    for (const key of ["operation", "detail", "stage", "stageLabel", "currentFile", "processedBytes", "totalBytes", "completedFiles", "startedAt", "updatedAt"]) line(key, active[key]);
    lines.push("Это последний сохранённый этап, а не доказательство причины сбоя. Другая вкладка могла продолжить операцию.");
  }
  const trail = context.trail || environment.trail;
  if (trail?.length) lines.push("", "Последние действия:", ...trail.slice(-20).map((item) => safeDiagnosticText(item, 600)));
  if (environment.runtimeHistory) lines.push("", "История браузера (новые версии сверху):", safeDiagnosticText(environment.runtimeHistory, 6000));
  if (context.cleanup?.length) lines.push("", "Очистка / откат:", ...context.cleanup);
  if (context.messages?.length) lines.push("", "Последние сообщения обработчика:", ...context.messages);
  lines.push("", "Технические подробности:");
  for (let current = context.manual ? null : exception; current; current = current.cause) {
    lines.push(`${current.name}: ${current.message}`, current.stack || "Стек не предоставлен браузером");
    if (current.code != null) lines.push(`code: ${current.code}`);
    if (current.errno != null) lines.push(`errno: ${current.errno}`);
  }
  return { schema: 1, id, timestamp, code, summary: `${code} · ${context.manual ? "Ручной отчёт о проблеме" : exception.message}`, text: safeDiagnosticText(lines.join("\n"), MAX_REPORT_CHARS) };
}

// Diagnostics are intentionally device-local, independent of IndexedDB/OPFS and site deletion.
export function createLastReportStore(getStorage = () => globalThis.localStorage) {
  let memory = null;
  let warning = "";
  return {
    save(report) {
      memory = report;
      warning = "";
      try { getStorage().setItem(STORAGE_KEY, JSON.stringify(report)); }
      catch { warning = "Отчёт не удалось сохранить на устройстве. Скопируйте его до закрытия приложения."; }
      return { report: memory, warning };
    },
    load() {
      if (memory) return { report: memory, warning };
      try {
        const raw = getStorage().getItem(STORAGE_KEY);
        if (!raw) return { report: null, warning: "" };
        if (raw.length > MAX_REPORT_CHARS * 3) throw new Error("Report is too large");
        const parsed = JSON.parse(raw);
        if (parsed.schema !== 1 || typeof parsed.text !== "string" || typeof parsed.summary !== "string" || !Number.isFinite(parsed.timestamp)) throw new Error("Invalid report");
        memory = { ...parsed, text: safeDiagnosticText(parsed.text, MAX_REPORT_CHARS), summary: safeDiagnosticText(parsed.summary) };
        return { report: memory, warning: "" };
      } catch {
        return { report: null, warning: "Сохранённый отчёт недоступен. При следующей ошибке появится новый." };
      }
    },
  };
}

export async function copyDiagnosticReport(text, navigatorObject = globalThis.navigator) {
  try {
    if (!navigatorObject?.clipboard?.writeText) return false;
    await navigatorObject.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

export async function shareDiagnosticReport(text, navigatorObject = globalThis.navigator, title = "Ошибка GameSpace PWA") {
  if (!navigatorObject?.share) return "unavailable";
  try {
    await navigatorObject.share({ title, text });
    return "opened";
  } catch (error) {
    return error?.name === "AbortError" ? "cancelled" : "failed";
  }
}
