const STORAGE_KEY = "gamespace:runtime-history:v1";
const HISTORY_LIMIT = 20;

function safe(value, limit = 300) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, limit);
}

function isReducedVersion(version) {
  return /^\d+(?:\.0){1,3}$/.test(version);
}

function versionsMatch(left, right) {
  if (left === right) return true;
  const leftMajor = /^\d+/.exec(left)?.[0];
  const rightMajor = /^\d+/.exec(right)?.[0];
  if (!leftMajor || leftMajor !== rightMajor) return false;
  return isReducedVersion(left) || isReducedVersion(right) || left === leftMajor || right === rightMajor;
}

function preferredVersion(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (isReducedVersion(left) && !isReducedVersion(right)) return right;
  if (isReducedVersion(right) && !isReducedVersion(left)) return left;
  return right.length > left.length ? right : left;
}

function validEntries(raw) {
  if (raw?.schema !== 1 || !Array.isArray(raw.entries)) return [];
  return raw.entries.slice(0, HISTORY_LIMIT).flatMap((entry) => {
    const firstSeen = Number(entry?.firstSeen);
    const lastSeen = Number(entry?.lastSeen);
    if (!entry?.browser || !Number.isFinite(firstSeen) || !Number.isFinite(lastSeen)) return [];
    return [{
      browser: safe(entry.browser), version: safe(entry.version, 100), engine: safe(entry.engine, 100),
      firstSeen, lastSeen,
    }];
  });
}

export function createRuntimeHistoryStore(storage = () => globalThis.localStorage) {
  let memory = null;
  let warning = "";

  function load() {
    if (memory) return { entries: memory, warning };
    try {
      const raw = storage().getItem(STORAGE_KEY);
      memory = raw ? validEntries(JSON.parse(raw)) : [];
      if (raw && memory.length === 0) warning = "Сохранённая история браузера была повреждена и начата заново.";
    } catch {
      memory = [];
      warning = "Сохранённая история браузера недоступна.";
    }
    return { entries: memory, warning };
  }

  function save() {
    try {
      storage().setItem(STORAGE_KEY, JSON.stringify({ schema: 1, entries: memory }));
    } catch {
      warning = "История доступна до закрытия приложения: сохранить её на устройстве не удалось.";
    }
  }

  return {
    load,
    observe(environment, observedAt = Date.now()) {
      const entries = load().entries;
      const next = {
        browser: safe(environment?.browser || "Неизвестный браузер"),
        version: safe(environment?.version, 100),
        engine: safe(environment?.engine || "движок не определён", 100),
        firstSeen: observedAt,
        lastSeen: observedAt,
      };
      const current = entries[0];
      if (current && current.browser === next.browser && current.engine === next.engine
          && versionsMatch(current.version, next.version)) {
        current.version = preferredVersion(current.version, next.version);
        current.lastSeen = Math.max(current.lastSeen, observedAt);
      } else {
        entries.unshift(next);
        entries.length = Math.min(entries.length, HISTORY_LIMIT);
      }
      memory = entries;
      save();
      return { entries: memory, warning };
    },
  };
}

function formatObservedAt(timestamp) {
  return new Date(timestamp).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatRuntimeHistory(entries) {
  if (!entries?.length) return "История пока пуста.";
  return entries.map((entry, index) => {
    const version = entry.version ? ` ${entry.version}` : "";
    const engine = entry.engine ? ` · ${entry.engine}` : "";
    const until = index === 0 ? "сейчас" : formatObservedAt(entry.lastSeen);
    return `${entry.browser}${version}${engine}\n${formatObservedAt(entry.firstSeen)} — ${until}`;
  }).join("\n\n");
}
