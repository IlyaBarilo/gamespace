// GS1 is shared as a text contract with the APK, not as a shared build dependency.
export const COMPATIBILITY_FORM_URL = "https://forms.yandex.ru/u/6aa7f1166d2d732f54bbcdc3/";
const SPACE = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g;
const STATES = Object.freeze({
  success: "успешно", recorded: "зафиксирован", not_performed: "не выполнено",
  not_checked: "не проверено", error: "ошибка", interrupted: "прервано",
});
const STAGES = Object.freeze({
  launch: "запуск приложения", import: "импорт архива",
  storefront: "загрузка витрины", game: "переход в игру",
});
// Only these descriptions may enter a compatibility report. Never pass error.message here.
const ERRORS = Object.freeze({
  demo: ["GS-DEMO", "не удалось получить встроенный демо-архив", "повторите загрузку встроенного демо или выберите свой архив"],
  page: ["GS-PAGE", "не удалось загрузить страницу витрины или игры", "повторите открытие страницы, затем начните новую проверку"],
  script: ["GS-SCRIPT", "зафиксирована ошибка JavaScript страницы", "повторите действие, подробности доступны в отдельном отчёте о проблеме"],
  resource: ["GS-RESOURCE", "не удалось загрузить ресурс страницы", "проверьте полноту архива или повторите проверку со встроенным демо"],
  timeout: ["GS-LOAD-TIMEOUT", "страница не завершила загрузку за 30 секунд", "дождитесь загрузки или повторите открытие, затем начните новую проверку"],
  quota: ["QuotaExceededError", "превышена квота хранилища браузера", "проверьте доступное хранилище в GameSpace и повторите импорт после освобождения места"],
  space: ["GS-STORAGE-SPACE", "недостаточно места для операции", "освободите место на устройстве и повторите импорт"],
  archive: ["GS-ARCHIVE", "не удалось прочитать или распаковать архив", "проверьте архив и повторите импорт, для базовой проверки можно использовать встроенное демо"],
  index: ["GS-INDEX-CHECK", "не найдена стартовая HTML-страница", "проверьте структуру архива или установите встроенное демо"],
  access: ["GS-ACCESS", "нет доступа к необходимым данным", "проверьте доступ к архиву и хранилищу и повторите действие"],
  other: ["GS-CHECK-ERROR", "зафиксирован сбой на указанном этапе", "повторите указанный этап, подробности доступны в отдельном отчёте о проблеме"],
});

function validUnicode(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("Некорректный Unicode в GS1.");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError("Некорректный Unicode в GS1.");
  }
  return text;
}

export function normalizeCompatibilityText(text) {
  if (typeof text !== "string") throw new TypeError("Ожидается текст GS1.");
  return validUnicode(text).replace(SPACE, "");
}

function value(text) {
  if (text == null) return "?";
  if (typeof text !== "string" || text.length > 512) throw new TypeError("Некорректное поле GS1.");
  // Clean external field values before making the immutable text snapshot, never during hashing.
  const single = validUnicode(text).replace(SPACE, " ")
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f\u202a-\u202e\u2066-\u2069]/g, "\ufffd")
    .replace(/ +/g, " ").replace(/^ | $/g, "");
  if (!single) return "?";
  return /[;"]/.test(single) ? `"${single.replace(/"/g, '""')}"` : single;
}

function integer(number, optional = true) {
  if (optional && number == null) return null;
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError("Некорректное число GS1.");
  return number;
}

function choice(key, options, fallback) {
  if (key == null && fallback !== undefined) return fallback;
  if (typeof key !== "string" || !Object.hasOwn(options, key)) throw new TypeError("Неизвестное значение GS1.");
  return options[key];
}

function decimalTenths(number) {
  return `${Math.floor(number / 10)}${number % 10 ? `,${number % 10}` : ""}`;
}

export function formatCompatibilityBytes(number) {
  if (integer(number) == null) return "?";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let divisor = 1;
  let unit = 0;
  while (number >= divisor * 1024 && unit < units.length - 1) { divisor *= 1024; unit += 1; }
  if (!unit) return `${number} Б`;
  // Integer remainder keeps Java and JS rounding identical, including large archives.
  const tenths = Math.floor(number / divisor) * 10 + Math.floor(((number % divisor) * 10 + divisor / 2) / divisor);
  return `${decimalTenths(tenths)} ${units[unit]}`;
}

function duration(number) {
  if (integer(number) == null) return "?";
  if (number > 0 && number < 100) return "<0,1 с";
  const tenths = Math.floor(number / 100) + (number % 100 >= 50 ? 1 : 0);
  return `${decimalTenths(tenths)} с`;
}

function timestamp(milliseconds, offset) {
  integer(milliseconds, false);
  if (!Number.isInteger(offset) || Math.abs(offset) > 840) throw new TypeError("Некорректное смещение UTC.");
  const date = new Date(milliseconds + offset * 60_000);
  if (!(date.getUTCFullYear() >= 1970 && date.getUTCFullYear() <= 9999)) throw new TypeError("Некорректная дата GS1.");
  const pad = number => String(number).padStart(2, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} (UTC${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)})`;
}

export function formatCompatibilityBody(input) {
  if (input.steps != null && (typeof input.steps !== "object" || Array.isArray(input.steps))) throw new TypeError("Некорректные шаги GS1.");
  const variant = choice(input.variant, { APK: "APK", PWA: "PWA" });
  const launchMode = choice(input.launchMode, { installed: "установленное приложение", browser: "вкладка браузера" });
  if (variant === "APK" && input.launchMode !== "installed") throw new TypeError("APK не запускается во вкладке.");
  if (typeof input.appVersion !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(input.appVersion)) throw new TypeError("Некорректная версия GameSpace.");
  const keys = ["launch", "import", "storefront", "game"];
  const steps = keys.map(key => input.steps?.[key] ?? "not_performed");
  let previousCompleted = true;
  steps.forEach((state, i) => {
    choice(state, STATES);
    const completed = state === (i === 3 ? "recorded" : "success");
    if ((state === "recorded" && i !== 3) || (state === "success" && i === 3) || (completed && !previousCompleted)) throw new TypeError("Несогласованные шаги GS1.");
    previousCompleted = previousCompleted && completed;
  });
  const failures = keys.filter((key, i) => steps[i] === "error");
  if (failures.length > 1 || (failures.length === 0 && input.error != null)) throw new TypeError("Несогласованная ошибка GS1.");
  const error = failures.length ? choice(input.error ?? "other", ERRORS) : null;
  integer(input.archiveFiles);
  const lines = [
    "GameSpace — базовая проверка совместимости",
    "ФОРМАТ: 1",
    `СФОРМИРОВАН: ${timestamp(input.formedAtMs, input.utcOffsetMinutes)}`,
    `ПРИЛОЖЕНИЕ: вариант: ${variant}; версия: ${input.appVersion}; запуск: ${launchMode}`,
    `УСТРОЙСТВО: производитель: ${value(input.manufacturer)}; модель: ${value(input.model)}`,
    `СИСТЕМА: название: ${value(input.systemName)}; версия: ${value(input.systemVersion)}; базовая ОС: ${value(input.baseOs)}; версия базовой ОС: ${value(input.baseOsVersion)}`,
    `СРЕДА: название: ${value(input.environmentName)}; версия: ${value(input.environmentVersion)}`,
    `ХРАНИЛИЩЕ: режим: ${variant === "APK" ? "-" : choice(input.storageMode, { persistent: "постоянное", ordinary: "обычное" }, "?")}`,
    `АРХИВ: источник: ${choice(input.archiveSource, { demo: "демо-архив", user: "пользовательский архив" }, "?")}; формат: ${choice(input.archiveFormat, { "7z": "7z", ZIP: "ZIP", ZIP64: "ZIP64" }, "?")}; размер: ${formatCompatibilityBytes(input.archiveBytes)}; файлов: ${steps[1] === "success" && input.archiveFiles != null ? input.archiveFiles : "?"}; время импорта: ${duration(input.importDurationMs)}`,
    `ПРОВЕРКА: запуск приложения: ${STATES[steps[0]]}; импорт: ${STATES[steps[1]]}; загрузка витрины: ${STATES[steps[2]]}; переход в игру внутри GameSpace: ${STATES[steps[3]]}`,
  ];
  if (error) lines.push(`ОШИБКА: этап: ${STAGES[failures[0]]}; код: ${error[0]}; описание: ${error[1]}`);
  const complete = previousCompleted && input.launchMode === "installed";
  lines.push(`ИТОГ: ${error ? "базовая проверка завершилась ошибкой" : complete ? "базовая проверка пройдена" : "базовая проверка не завершена"}`);
  if (!complete || error) {
    const next = input.launchMode !== "installed" || steps[0] !== "success"
      ? "запустите установленное приложение и начните новую проверку"
      : steps[1] !== "success" ? "импортируйте встроенное демо или свой архив в рамках текущей проверки"
        : steps[2] !== "success" ? "откройте витрину установленного сайта в GameSpace"
          : "перейдите из витрины в одну из игр внутри GameSpace";
    lines.push(`ДЕЙСТВИЯ: ${error ? error[2] : next}`);
  }
  return lines.join("\r\n");
}

export async function compatibilityCode(body) {
  const bytes = new TextEncoder().encode(normalizeCompatibilityText(body));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `GS1-${hex.slice(29, 35).toUpperCase()}`;
}

export async function createCompatibilityReport(input) {
  // Build the whole body before the first await: later input changes cannot mutate this snapshot.
  const body = formatCompatibilityBody(input);
  return `${body}\r\nЦелостность текста: ${await compatibilityCode(body)}`;
}
