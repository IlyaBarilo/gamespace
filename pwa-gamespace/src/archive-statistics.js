import { safeDiagnosticText } from "./diagnostics.js";

const now = () => performance.now();
const LABELS = {
  engine: "Работа распаковщика, включая чтение и запись",
  read: "Чтение исходного архива",
  directory: "Подготовка каталогов",
  open: "Открытие и подготовка файлов назначения",
  write: "Запись распакованных данных",
  flush: "Принудительный сброс записи",
  close: "Закрытие файлов назначения",
  archiveClose: "Закрытие архива",
};

// Constant-size counters only: no per-file log or retained data buffers.
export class ArchiveMetrics {
  constructor(format, clock = now) {
    this.clock = clock;
    this.started = clock();
    this.format = format;
    this.timings = {};
    this.files = 0;
    this.details = {};
  }

  add(name, started, bytes = 0, failed = false) {
    const item = this.timings[name] ||= { ms: 0, calls: 0, bytes: 0, failures: 0 };
    item.ms += Math.max(0, this.clock() - started);
    item.calls++;
    item.bytes += Math.max(0, Number(bytes) || 0);
    if (failed) item.failures++;
  }

  sync(name, action, byteCount = () => 0) {
    const started = this.clock();
    let result;
    let failed = true;
    try { result = action(); failed = false; return result; }
    finally { this.add(name, started, failed ? 0 : byteCount(result), failed); }
  }

  async async(name, action, byteCount = () => 0) {
    const started = this.clock();
    let result;
    let failed = true;
    try { result = await action(); failed = false; return result; }
    finally { this.add(name, started, failed ? 0 : byteCount(result), failed); }
  }

  snapshot() {
    return {
      format: this.format, durationMs: Math.max(0, this.clock() - this.started),
      files: this.files, timings: structuredClone(this.timings), details: { ...this.details },
    };
  }
}

export class ArchiveStatistics {
  constructor(file, operation, clock = now) {
    this.clock = clock;
    this.started = clock();
    this.phaseAt = this.started;
    this.phase = "Подготовка операции";
    this.data = {
      schema: 1, timestamp: Date.now(), archive: safeDiagnosticText(file.name, 300),
      archiveBytes: file.size, operation, phases: {}, extraction: null,
    };
  }

  observe(event) {
    if (event?.type === "archive-statistics") {
      this.data.extraction = event.statistics;
      this.nextPhase("Завершение обработки и очистка");
    }
    if (event?.type === "archive-format") this.data.format = event.format;
    if (event?.type === "phase") {
      this.nextPhase(safeDiagnosticText(event.label || event.phase, 160));
    }
  }

  nextPhase(label) {
    const at = this.clock();
    this.data.phases[this.phase] = (this.data.phases[this.phase] || 0) + Math.max(0, at - this.phaseAt);
    this.phaseAt = at;
    this.phase = label;
  }

  finish(outcome, environment = {}) {
    this.nextPhase("Завершено");
    return { ...this.data, outcome, durationMs: Math.max(0, this.clock() - this.started), environment };
  }
}

const number = (value, digits = 0) => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: digits });
const seconds = (ms) => `${number(ms / 1000, 3)} с`;

export function formatArchiveStatistics(report) {
  const extraction = report.extraction;
  const lines = [
    "GameSpace PWA — статистика архива, формат 1",
    `Архив: ${report.archive}`,
    `Размер архива: ${number(report.archiveBytes)} байт`,
    `Формат: ${extraction?.format || report.format || "не определён"}`,
    `Операция: ${report.operation}`,
    `Результат: ${report.outcome}`,
    `Общее время операции: ${seconds(report.durationMs)}`,
  ];
  if (extraction) {
    const written = extraction.timings.write?.bytes || 0;
    lines.push(`Обработка архива: ${seconds(extraction.durationMs)}`,
      `Закрыто файлов назначения: ${number(extraction.files)}`,
      `Записано данных: ${number(written)} байт`);
    if (extraction.durationMs > 0) lines.push(`Средняя скорость обработки: ${number(written / 1048576 / (extraction.durationMs / 1000), 2)} МиБ/с`);
    if (extraction.details.method) lines.push(`Метод: ${safeDiagnosticText(extraction.details.method, 200)}`);
    if (extraction.details.readAheadBytes) lines.push(`Буфер чтения вперёд: ${number(extraction.details.readAheadBytes)} байт`);
    lines.push("", "Замеры вызовов (время; количество; переданные байты; ошибки):");
    for (const [key, label] of Object.entries(LABELS)) {
      const item = extraction.timings[key];
      lines.push(item
        ? `${label}: ${seconds(item.ms)}; ${number(item.calls)}; ${number(item.bytes)}; ${number(item.failures)}`
        : `${label}: не вызывалось / отдельно не измеряется`);
    }
  } else lines.push("Подробные замеры распаковщика недоступны: обработчик не запустился или завершился аварийно.");
  lines.push("", "Этапы всей операции (последовательно):");
  for (const [label, ms] of Object.entries(report.phases)) lines.push(`${label}: ${seconds(ms)}`);
  lines.push("", "Условия замера:",
    `Дата: ${new Date(report.timestamp).toISOString()}`,
    `Версия: ${safeDiagnosticText(report.environment?.version || "неизвестна")}`,
    `Браузер / ОС: ${safeDiagnosticText(report.environment?.userAgent || "неизвестно")}`);
  lines.push("", "Как читать статистику:",
    "Время распаковщика включает вложенные операции чтения и записи. Эти строки не складываются.",
    "В ZIP чтение и запись могут перекрываться; вычитать их сумму для вычисления чистого времени декодирования нельзя.",
    "Открытие файлов включает подготовку родительских каталогов и получение доступа к записи.",
    "Чтение учитывает вызовы браузера, повторные чтения и буферизацию; это не физический счётчик USB.",
    "Скорость рассчитана по записанным данным и времени обработки архива, включая его предварительную проверку.",
    "Счётчики при ошибке относятся к выполненной части работы. Измерения добавляют небольшие накладные расходы.");
  return lines.join("\n");
}

export function createArchiveStatisticsStore(storage = () => globalThis.localStorage) {
  const key = "gamespace:last-archive-statistics:v1";
  let memory = null;
  let warning = "";
  return {
    save(report) {
      memory = report;
      warning = "";
      try { storage().setItem(key, JSON.stringify(report)); }
      catch { warning = "Статистика доступна до закрытия приложения: сохранить её на устройстве не удалось."; }
      return { report: memory, warning };
    },
    load() {
      if (memory) return { report: memory, warning };
      try {
        const raw = storage().getItem(key);
        if (raw && raw.length <= 32000) {
          const report = JSON.parse(raw);
          if (report.schema === 1 && Number.isFinite(report.timestamp) && report.phases && typeof report.archive === "string") memory = report;
        }
      } catch { warning = "Сохранённая статистика недоступна."; }
      return { report: memory, warning };
    },
  };
}
