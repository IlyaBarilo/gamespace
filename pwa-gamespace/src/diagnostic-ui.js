import {
  copyDiagnosticReport,
  createDiagnosticReport,
  createLastReportStore,
  shareDiagnosticReport,
  safeDiagnosticText,
  MAX_REPORT_CHARS,
} from "./diagnostics.js";

export function createDiagnosticUI(elements, getEnvironment) {
  const defaultPrivacy = elements.diagnosticPrivacy?.textContent;
  const store = createLastReportStore();
  let previousFocus = null;
  let fallbackInert = [];
  const status = (text) => { elements.diagnosticActionStatus.textContent = text; };
  const summarize = ({ report, warning }) => {
    elements.lastErrorSummary.textContent = report
      ? `${new Date(report.timestamp).toLocaleString("ru-RU")} · ${report.summary}`
      : warning || "Сохранённых ошибок пока нет.";
  };
  summarize(store.load());

  function open(override = null) {
    const { report, warning } = override?.text ? { report: override, warning: override.persistence ?? "Ручной отчёт не заменяет сохранённую последнюю ошибку. Скопируйте его перед закрытием." } : store.load();
    if (!elements.diagnosticDialog.open) previousFocus = document.activeElement;
    if (elements.diagnosticTitle) elements.diagnosticTitle.textContent = override?.title || (override?.text ? "Отчёт о проблеме" : "Отчёт об ошибке");
    if (elements.diagnosticPrivacy) elements.diagnosticPrivacy.textContent = override?.privacy || defaultPrivacy;
    elements.diagnosticText.value = report?.text || warning || "Сохранённых ошибок пока нет.";
    elements.diagnosticPersistence.textContent = warning || (report ? "Хранится только последний отчёт, отдельно от установленного сайта." : "");
    elements.diagnosticCopy.disabled = !report;
    elements.diagnosticShare.disabled = !report;
    status("");
    if (!elements.diagnosticDialog.open) {
      if (typeof elements.diagnosticDialog.showModal === "function") {
        elements.diagnosticDialog.showModal();
      } else {
        elements.diagnosticDialog.setAttribute("open", "");
        fallbackInert = [elements.appShell, elements.landingPage, elements.viewer, elements.licenseModal].map((element) => [element, element.inert]);
        for (const [element] of fallbackInert) element.inert = true;
      }
    }
    elements.diagnosticClose.focus();
  }

  function restoreFocus() {
    for (const [element, inert] of fallbackInert) element.inert = inert;
    fallbackInert = [];
    previousFocus?.focus?.();
    previousFocus = null;
  }

  function close() {
    if (typeof elements.diagnosticDialog.close === "function") elements.diagnosticDialog.close();
    else { elements.diagnosticDialog.removeAttribute("open"); restoreFocus(); }
  }

  function selectText() {
    elements.diagnosticText.focus();
    elements.diagnosticText.select();
    elements.diagnosticText.setSelectionRange(0, elements.diagnosticText.value.length);
  }

  elements.diagnosticClose.addEventListener("click", close);
  elements.diagnosticDialog.addEventListener("close", restoreFocus);
  elements.diagnosticDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && typeof elements.diagnosticDialog.close !== "function") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const controls = [...elements.diagnosticDialog.querySelectorAll("button, textarea")].filter((element) => !element.disabled);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  elements.diagnosticCopy.addEventListener("click", async () => {
    const copied = await copyDiagnosticReport(elements.diagnosticText.value);
    if (!copied) selectText();
    status(copied ? "Отчёт скопирован. Вставьте его в сообщение разработчику." : "Автоматическое копирование недоступно. Текст выделен: выберите «Копировать» в меню браузера или нажмите Ctrl+C.");
  });
  elements.diagnosticShare.addEventListener("click", async () => {
    elements.diagnosticShare.disabled = true;
    const result = await shareDiagnosticReport(elements.diagnosticText.value, undefined, elements.diagnosticTitle?.textContent);
    elements.diagnosticShare.disabled = false;
    const messages = {
      opened: "Отчёт передан системному меню. Завершите отправку в выбранном приложении.",
      cancelled: "Отправка отменена. Отчёт сохранён без изменений.",
      unavailable: "Браузер не поддерживает отправку. Скопируйте отчёт в сообщение вручную.",
      failed: "Не удалось открыть отправку. Используйте кнопку «Копировать».",
    };
    status(messages[result]);
  });
  for (const button of [elements.lastErrorButton, elements.landingLastErrorButton, elements.errorDetailsButton]) button.addEventListener("click", open);
  return {
    capture(error, context = {}, { reveal = true } = {}) {
      const report = createDiagnosticReport(error, getEnvironment, context);
      summarize(store.save(report));
      if (reveal) open();
      return report;
    },
    manual(context = {}) {
      const report = createDiagnosticReport(null, getEnvironment, { ...context, manual: true, stage: "manual", stageLabel: "Состояние приложения по запросу пользователя" });
      const latest = store.load().report;
      if (latest) report.text = safeDiagnosticText(`${report.text}\n\nПоследняя сохранённая ошибка (возможно, более ранняя):\n${latest.text.slice(0, 8000)}`, MAX_REPORT_CHARS);
      open(report);
      return report;
    },
    open,
  };
}
