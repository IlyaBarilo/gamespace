export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "неизвестно";
  if (value < 1024) return `${Math.round(value)} Б`;
  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unit]}`;
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes} мин ${remainder} с`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}

export function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

export function errorMessage(error) {
  if (!error) return "Неизвестная ошибка.";
  return error.message || String(error);
}
