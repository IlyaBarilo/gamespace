import { formatBytes, formatDate, formatDuration } from "./format.js";

export function renderArchiveCatalog(container, catalog, { busy, open, update, replace, rename, remove, restoreDemo }) {
  const fragment = document.createDocumentFragment();
  for (const entry of catalog.entries) {
    const row = document.createElement("li");
    row.className = "archive-entry";
    row.dataset.archiveId = entry.id;
    const active = entry.id === catalog.activeId;
    row.classList.toggle("is-active", active);
    if (active) row.setAttribute("aria-current", "true");
    const heading = document.createElement("div");
    heading.className = "archive-entry-heading";
    const title = document.createElement("h3");
    title.textContent = entry.name;
    title.id = `archive-title-${entry.id}`;
    row.setAttribute("aria-labelledby", title.id);
    const badge = document.createElement("span");
    badge.className = "storage-badge";
    badge.textContent = active ? "Текущий архив" : entry.kind === "demo" ? "Демо" : entry.state ? "Загружен" : "Нет файлов";
    heading.append(title, badge);
    const details = document.createElement("p");
    details.className = "archive-entry-details";
    details.textContent = entry.state
      ? `${formatBytes(entry.state.writtenBytes || 0)} · ${Number(entry.state.files || 0).toLocaleString("ru-RU")} файлов · ${formatDate(entry.state.installedAt)}`
      : entry.kind === "demo" ? "Доступно без интернета. Файлы будут подготовлены при первом открытии." : "Файлы отсутствуют. Замените архив для восстановления.";
    const actions = document.createElement("div");
    actions.className = "archive-entry-actions";
    const add = (text, action, name, disabled = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = name === "remove" ? "danger-button" : "version-secondary-button";
      button.dataset.archiveAction = name;
      button.textContent = text;
      button.disabled = busy || disabled;
      if (name === "update") button.title = "Добавить новые и заменить совпадающие файлы; остальные сохранятся.";
      if (name === "replace") button.title = "Полностью заменить содержимое этого архива.";
      button.addEventListener("click", () => action(entry));
      actions.append(button);
    };
    add(entry.state ? "Открыть" : entry.kind === "demo" ? "Подготовить и открыть" : "Открыть", open, "open", !entry.state && entry.kind !== "demo");
    if (entry.state) add("Обновить", update, "update");
    if (entry.kind === "demo") {
      if (entry.state) add("Восстановить демо", restoreDemo, "restore");
    } else {
      add("Заменить", replace, "replace");
      add("Переименовать", rename, "rename");
    }
    if (entry.state || entry.kind !== "demo") add(entry.kind === "demo" ? "Удалить файлы" : "Удалить", remove, "remove");
    row.append(heading, details, actions);
    if (entry.state) {
      const info = document.createElement("details");
      info.className = "archive-entry-info menu-disclosure";
      const summary = document.createElement("summary");
      summary.textContent = "Сведения";
      const fields = document.createElement("dl");
      fields.className = "archive-info-fields";
      for (const [label, value] of [
        ["Последний файл", entry.state.archiveName || "—"],
        ["Формат", (entry.state.archiveType || "—").toUpperCase()],
        ["Операция", entry.state.operation === "fast" ? "Обновление без удаления" : "Полная установка"],
        ["Время обработки", formatDuration(entry.state.operationDurationMs)],
      ]) {
        const field = document.createElement("div");
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        field.append(term, description);
        fields.append(field);
      }
      info.append(summary, fields);
      row.append(info);
    }
    fragment.append(row);
  }
  container.replaceChildren(fragment);
}
