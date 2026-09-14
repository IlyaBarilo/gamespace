import { COMPATIBILITY_FORM_URL, createCompatibilityReport } from "./compatibility-report.js";

const LABELS = { success: "выполнено", recorded: "зафиксирован", not_performed: "пока не выполнено",
  not_checked: "пока не проверено", error: "ошибка", interrupted: "прервано" };

export function createCompatibilityUI(elements, { snapshot, buildInput, isBusy, reset, launchMode }) {
  const dialog = elements.compatibilityDialog;
  let report = "";
  let generating = false;
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
      element.dataset.state = steps[key];
    }
    const complete = installed && steps.launch === "success" && steps.import === "success" && steps.storefront === "success" && steps.game === "recorded";
    elements.compatibilitySummary.textContent = check.data.error
      ? "Проверка зафиксировала ошибку. Неполный отчёт тоже можно отправить."
      : complete ? "Базовая проверка пройдена. Можно сформировать и отправить отчёт."
        : "Базовая проверка пока не пройдена полностью. Отчёт можно сформировать и отправить уже сейчас.";
    elements.compatibilityWarning.textContent = [check.note, check.warning].filter(Boolean).join(" ");
    elements.compatibilityReset.disabled = isBusy() || generating;
    elements.compatibilityRefresh.disabled = generating;
    for (const button of [elements.compatibilityCopy, elements.compatibilitySave, elements.compatibilityForm]) button.disabled = !report || generating;
    if (report) elements.compatibilitySnapshotHint.textContent = "Показан сохранённый снимок. После выполнения действий нажмите «Обновить отчёт».";
  }
  async function generate() {
    if (generating) return;
    generating = true;
    refresh();
    status("Формирую отчёт…");
    try {
      const input = await buildInput();
      const next = await createCompatibilityReport(input);
      report = next;
      elements.compatibilityText.value = report;
      status("Отчёт сформирован. Текст доступен для копирования и сохранения.");
    } catch {
      status("Не удалось сформировать новый отчёт. Предыдущий снимок сохранён, если он был. Попробуйте ещё раз.");
    } finally { generating = false; refresh(); }
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
    if (!report) void generate();
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
  elements.compatibilityRefresh.addEventListener("click", () => { void generate(); });
  elements.compatibilityReset.addEventListener("click", () => {
    if (isBusy() || !window.confirm("Начать новую проверку? Её результаты будут сброшены. Установленный сайт и сохранения останутся на месте.")) return;
    reset();
    refresh();
    status("Новая проверка начата. Для нового текста нажмите «Обновить отчёт».");
  });
  elements.compatibilityCopy.addEventListener("click", () => { void copyReport(); });
  elements.compatibilityForm.addEventListener("click", () => {
    // Open synchronously during the click. Async clipboard work must not consume popup activation.
    let popup;
    try { popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null; }
    catch { /* A normal link remains available below the buttons. */ }
    if (!popup) { status("Браузер заблокировал открытие формы. Скопируйте отчёт и воспользуйтесь ссылкой «Открыть форму» ниже."); return; }
    void copyReport().then(copied => {
      if (!copied) { popup.close(); return; }
      try { popup.location.replace(COMPATIBILITY_FORM_URL); status("Форма открыта. Вставьте отчёт и нажмите «Отправить» в форме."); }
      catch { popup.close(); status("Отчёт скопирован, но форму открыть не удалось. Попробуйте снова."); }
    });
  });
  elements.compatibilitySave.addEventListener("click", () => {
    if (!report) return;
    try {
      const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = "GameSpace-compatibility.txt";
      try { document.body.append(link); link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      status("Текст передан браузеру для сохранения в файл.");
    } catch { status("Не удалось сохранить файл. Используйте копирование текста."); }
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
