import { COMPATIBILITY_FORM_URL, createCompatibilityReport } from "./compatibility-report.js";

const LABELS = { success: "выполнено", recorded: "выполнено", not_performed: "пока не выполнено",
  not_checked: "пока не проверено", error: "ошибка", interrupted: "прервано" };

export function createCompatibilityUI(elements, { snapshot, buildInput, isBusy, reset, launchMode }) {
  const dialog = elements.compatibilityDialog;
  let report = "";
  let generating = false;
  let generation = 0;
  let previousFocus = null;
  let fallbackInert = [];
  const status = text => { elements.compatibilityActionStatus.textContent = text; };
  elements.compatibilityFormLink.href = COMPATIBILITY_FORM_URL;
  function refresh() {
    const check = snapshot();
    const steps = check.data.steps;
    const installed = launchMode() === "installed";
    for (const key of ["launch", "import", "storefront", "game"]) {
      const element = elements[`compatibilityStep_${key}`];
      element.textContent = key === "launch" && !installed ? "открыто во вкладке; установка пока не проверена" : LABELS[steps[key]];
      element.dataset.state = key === "launch" && !installed ? "not_checked" : steps[key];
    }
    const complete = installed && steps.launch === "success" && steps.import === "success" && steps.storefront === "success" && steps.game === "recorded";
    elements.compatibilitySummary.textContent = check.data.error
      ? "Проверка зафиксировала ошибку. Неполный отчёт тоже можно отправить."
      : complete ? "Базовая проверка пройдена. Можно сформировать и отправить отчёт."
        : "Базовая проверка пока не пройдена полностью. Отчёт можно сформировать и отправить уже сейчас.";
    elements.compatibilityWarning.textContent = [check.note, check.warning].filter(Boolean).join(" ");
    elements.compatibilitySummary.dataset.state = check.data.error ? "error" : complete ? "success" : "not_performed";
    elements.compatibilityReset.disabled = isBusy() || generating;
    for (const button of [elements.compatibilityCopy, elements.compatibilityForm]) button.disabled = !report || generating;
  }
  async function generate() {
    const request = ++generation;
    generating = true;
    report = "";
    elements.compatibilityText.value = "";
    refresh();
    status("Формирую отчёт…");
    try {
      const input = await buildInput();
      const next = await createCompatibilityReport(input);
      if (request !== generation) return;
      report = next;
      elements.compatibilityText.value = report;
      status("Отчёт сформирован. Текст доступен для копирования.");
    } catch {
      if (request === generation) status("Не удалось сформировать отчёт. Закройте окно и откройте его снова.");
    } finally { if (request === generation) { generating = false; refresh(); } }
  }
  function restoreFocus() {
    for (const [element, inert] of fallbackInert) element.inert = inert;
    fallbackInert = [];
    previousFocus?.focus?.();
    previousFocus = null;
  }
  function close() {
    if (typeof dialog.close === "function") dialog.close();
    else { dialog.removeAttribute("open"); restoreFocus(); }
  }
  function open() {
    previousFocus = document.activeElement;
    refresh();
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else {
        dialog.setAttribute("open", "");
        fallbackInert = [elements.appShell, elements.landingPage, elements.viewer].map(element => [element, element.inert]);
        for (const [element] of fallbackInert) element.inert = true;
      }
    }
    elements.compatibilityClose.focus();
    void generate();
  }
  async function copyReport() {
    if (!report) return false;
    try {
      await navigator.clipboard.writeText(report);
      status("Отчёт скопирован.");
      return true;
    } catch {
      elements.compatibilityText.focus();
      elements.compatibilityText.select();
      status("Автоматическое копирование недоступно. Текст выделен: скопируйте его через меню браузера или Ctrl+C.");
      return false;
    }
  }
  for (const button of [elements.compatibilityButton, elements.landingCompatibilityButton]) button.addEventListener("click", open);
  elements.compatibilityClose.addEventListener("click", close);
  dialog.addEventListener("close", restoreFocus);
  elements.compatibilityReset.addEventListener("click", () => {
    if (isBusy() || !window.confirm("Начать новую проверку? Её результаты будут сброшены. Установленный сайт и сохранения останутся на месте.")) return;
    reset();
    void generate();
  });
  elements.compatibilityCopy.addEventListener("click", () => { void copyReport(); });
  elements.compatibilityForm.addEventListener("click", () => {
    if (!report) return;
    // Navigate directly during the gesture: Android must never wait on an empty popup
    // for a clipboard permission/result. Copy denial does not prevent opening the form.
    void copyReport();
    try {
      window.open(COMPATIBILITY_FORM_URL, "_blank", "noopener,noreferrer");
    } catch { status("Не удалось открыть форму. Используйте ссылку «Открыть форму» ниже."); }
  });
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape" && typeof dialog.close !== "function") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll("button, textarea, a[href]")].filter(element => !element.disabled);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  return { open, refresh };
}
