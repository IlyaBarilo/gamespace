import { safeDiagnosticText } from "./diagnostics.js";

const PREFIX = "gamespace:activity:v1:";
const SITE_KEY = "gamespace:last-installed:v1";
const LIMIT = 20;
const INTERVAL = 5000;

// A separate record per page prevents a second window from erasing an active operation.
// These are diagnostic hints, never an installation/rollback source of truth.
export class DiagnosticSession {
  constructor({ storage = () => globalThis.localStorage, now = Date.now, owner = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` } = {}) {
    this.storage = storage;
    this.now = now;
    this.owner = owner;
    this.data = { schema: 1, owner, updatedAt: now(), trail: [], active: null };
    this.lastSaved = 0;
    this.warning = "";
  }

  record(action, detail = "", force = false) {
    this.data.trail.push(`${new Date(this.now()).toISOString()} · ${safeDiagnosticText(action, 100)}${detail ? ` · ${safeDiagnosticText(detail, 400)}` : ""}`);
    this.data.trail = this.data.trail.slice(-LIMIT);
    this.flush(force);
  }

  begin(operation, detail = "") {
    if (this.data.active) throw new Error("Предыдущая операция в этом окне ещё выполняется.");
    this.data.active = { operation: safeDiagnosticText(operation, 100), detail: safeDiagnosticText(detail, 400), startedAt: this.now(), stage: "prepare", stageLabel: "Подготовка операции" };
    this.record("Начало операции", `${operation}: ${detail}`, true);
  }

  observe(event) {
    const active = this.data.active;
    if (!active || !event) return;
    if (event.phase) { active.stage = safeDiagnosticText(event.phase, 80); active.stageLabel = safeDiagnosticText(event.label, 300); }
    if (typeof event.currentFile === "string" || typeof event.path === "string") active.currentFile = safeDiagnosticText(event.currentFile ?? event.path, 400);
    for (const key of ["processedBytes", "totalBytes", "completedFiles", "current", "total"]) {
      if (Number.isFinite(event[key]) && event[key] >= 0) active[key] = event[key];
    }
    this.flush();
  }

  finish(result = "завершено") {
    if (!this.data.active) return;
    const operation = this.data.active.operation;
    this.data.active = null;
    this.record("Конец операции", `${operation}: ${result}`, true);
  }

  flush(force = false) {
    if (!force && this.now() - this.lastSaved < INTERVAL) return;
    this.data.updatedAt = this.now();
    this.lastSaved = this.now();
    try { this.storage().setItem(PREFIX + this.owner, JSON.stringify(this.data)); }
    catch { this.warning = "Журнал действий не сохраняется на устройстве; доступен только в текущем окне."; }
  }

  records() {
    try {
      const storage = this.storage();
      const rows = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        const raw = storage.getItem(key);
        if (!raw || raw.length > 20000) continue;
        try {
          const data = JSON.parse(raw);
          if (data.schema === 1 && typeof data.owner === "string" && key === PREFIX + data.owner && Array.isArray(data.trail)) rows.push(data);
        } catch { /* Ignore malformed diagnostic data, not application data. */ }
      }
      return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch { return []; }
  }

  acknowledge(record) {
    try {
      const key = PREFIX + record.owner;
      const current = JSON.parse(this.storage().getItem(key) || "null");
      if (current?.updatedAt === record.updatedAt) this.storage().removeItem(key);
    } catch { /* Reporting must still work if storage is denied. */ }
  }

  prune(liveOwners = new Set()) {
    const records = this.records();
    for (const record of records.slice(8)) if (record.owner !== this.owner && !liveOwners.has(record.owner)) this.acknowledge(record);
  }

  site(state) {
    try {
      if (state) this.storage().setItem(SITE_KEY, JSON.stringify({ revision: state.activeRevision, indexPath: state.indexPath, files: state.files, at: this.now() }));
      else this.storage().removeItem(SITE_KEY);
    } catch { this.warning = "Не удалось сохранить диагностические сведения об установке."; }
  }

  previousSite() {
    try { return JSON.parse(this.storage().getItem(SITE_KEY) || "null"); }
    catch { return null; }
  }

  snapshot() {
    return { trail: [...this.data.trail], activeOperation: this.data.active ? { ...this.data.active, updatedAt: this.data.updatedAt } : null, journalWarning: this.warning };
  }
}

export function connectDiagnosticSessions(session) {
  let channel;
  const live = new Set();
  try {
    channel = new BroadcastChannel("gamespace-diagnostic-presence-v1");
    channel.onmessage = ({ data }) => {
      if (data?.type === "ping") channel.postMessage({ type: "alive", owner: session.owner });
      if (data?.type === "alive" && typeof data.owner === "string") live.add(data.owner);
    };
  } catch { /* Without presence information, do not claim an actual crash. */ }
  return {
    async unfinished() {
      const records = session.records().filter((row) => row.owner !== session.owner && row.active);
      if (records.length && channel) {
        channel.postMessage({ type: "ping" });
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      session.prune(live);
      return records.filter((row) => !live.has(row.owner)).slice(0, 8);
    },
    close() { channel?.close(); },
  };
}
