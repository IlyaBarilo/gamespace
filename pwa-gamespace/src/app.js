import "./styles.css";
import { readState } from "./db.js";
import { formatBytes, formatDate, formatDuration, errorMessage } from "./format.js";
import { cleanupOrphans, installFullArchive, applyUpdateArchive, removeInstalledSite } from "./import-manager.js";
import { probeSevenZipSupport } from "./archive/sevenzip-client.js";

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);

let state = null;
let pendingMode = "full";
let installPrompt = null;
let busy = false;
let toolbarTimer = null;
let serviceWorkerRegistration = null;
let runtimeState = null;

const APP_VERSION = "0.3.0";
const RUNTIME_SCRIPT = "sw-runtime-v1.js";
const DEMO_REVISION = "apk-demo-v1";

const displayOverride = import.meta.env.DEV
  ? new URLSearchParams(location.search).get("gamespaceMode")
  : null;

function isRunningAsInstalledApp() {
  if (displayOverride === "app") return true;
  if (displayOverride === "landing") return false;
  return navigator.standalone === true
    || window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: fullscreen)").matches;
}

const runningAsInstalledApp = isRunningAsInstalledApp();
elements.installButton.hidden = runningAsInstalledApp;

function showLanding() {
  elements.landingPage.hidden = false;
  elements.appShell.hidden = true;
}

function showAppShell() {
  elements.landingPage.hidden = true;
  elements.appShell.hidden = false;
}

function finishBoot() {
  document.documentElement.classList.remove("gamespace-boot-pending");
}

function setStatus(text, tone = "neutral") {
  elements.statusText.textContent = text;
  elements.statusDot.dataset.tone = tone;
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("is-busy", value);
  for (const button of document.querySelectorAll("button")) {
    if (!button.closest("#viewer")) button.disabled = value;
  }
  elements.archiveInput.disabled = value;
  renderState();
}

function renderState() {
  const installed = Boolean(state?.revisionPath);
  elements.emptyState.hidden = installed;
  elements.installedState.hidden = !installed;
  elements.openSiteButton.disabled = !installed || busy;
  elements.fastUpdateButton.disabled = !installed || busy;
  elements.fullUpdateButton.disabled = busy;
  elements.removeSiteButton.disabled = !installed || busy;

  if (!installed) {
    elements.siteSummary.textContent = "Основной сайт ещё не установлен";
    return;
  }
  elements.siteSummary.textContent = `${state.archiveName || "Локальный сайт"} · ${formatBytes(state.writtenBytes || 0)}`;
  elements.infoArchive.textContent = state.archiveName || "—";
  elements.infoFormat.textContent = (state.archiveType || "—").toUpperCase();
  elements.infoFiles.textContent = Number(state.files || 0).toLocaleString("ru-RU");
  elements.infoWritten.textContent = formatBytes(state.writtenBytes || 0);
  elements.infoInstalled.textContent = formatDate(state.installedAt);
  elements.infoDuration.textContent = formatDuration(state.operationDurationMs);
  elements.infoMode.textContent = state.operation === "fast" ? "Быстрое обновление" : "Полная установка";
}

function showProgress(title) {
  elements.progressPanel.hidden = false;
  elements.progressTitle.textContent = title;
  elements.progressPhase.textContent = "Подготовка…";
  elements.progressFile.textContent = "";
  elements.progressBar.removeAttribute("value");
  elements.progressNumbers.textContent = "";
  elements.errorPanel.hidden = true;
}

function hideProgress() {
  elements.progressPanel.hidden = true;
}

function showError(error) {
  elements.errorText.textContent = errorMessage(error);
  elements.errorPanel.hidden = false;
}

function handleImportEvent(event) {
  if (!event) return;
  if (event.type === "phase") {
    elements.progressPhase.textContent = event.label;
  } else if (event.type === "archive-info") {
    elements.progressNumbers.textContent = `После распаковки: ${formatBytes(event.uncompressedBytes)} · нужно с резервом: ${formatBytes(event.requiredBytes)} · доступно: ${formatBytes(event.availableBytes)} · файлов: ${Number(event.files).toLocaleString("ru-RU")}`;
  } else if (event.type === "progress") {
    const total = Math.max(0, event.totalBytes || 0);
    const processed = Math.max(0, event.processedBytes || 0);
    if (total > 0) {
      elements.progressBar.max = total;
      elements.progressBar.value = Math.min(processed, total);
    }
    elements.progressNumbers.textContent = `${formatBytes(processed)} / ${formatBytes(total)}`;
    elements.progressFile.textContent = event.currentFile || "";
  } else if (event.type === "apply-progress") {
    elements.progressNumbers.textContent = `${event.current.toLocaleString("ru-RU")} / ${event.total.toLocaleString("ru-RU")} файлов`;
    elements.progressFile.textContent = event.path || "";
  }
}

async function chooseArchive(mode) {
  if (busy) return;
  pendingMode = mode;
  elements.archiveInput.value = "";
  elements.archiveInput.click();
}

async function importSelectedFile(file) {
  if (!file) return;
  const isUpdate = pendingMode === "fast";
  const confirmed = window.confirm(isUpdate
    ? `Применить локальное обновление «${file.name}»? Изменённые файлы будут защищены журналом отката.`
    : state
      ? `Полностью заменить установленный сайт архивом «${file.name}»? Новая версия станет активной только после успешной проверки.`
      : `Установить сайт из архива «${file.name}»? Архив не будет отправлен в сеть.`);
  if (!confirmed) return;

  setBusy(true);
  showProgress(isUpdate ? "Быстрое обновление сайта" : "Установка сайта");
  try {
    state = isUpdate
      ? await applyUpdateArchive(file, handleImportEvent)
      : await installFullArchive(file, handleImportEvent);
    renderState();
    elements.progressPhase.textContent = "Готово";
    elements.progressFile.textContent = "Сайт проверен и доступен без сети.";
    setStatus("Сайт готов к автономной работе", "good");
    setTimeout(hideProgress, 1600);
  } catch (error) {
    showError(error);
    elements.progressPhase.textContent = "Операция остановлена";
    setStatus("Не удалось обработать архив", "bad");
  } finally {
    setBusy(false);
  }
}

function contentIndexUrl() {
  const url = new URL(`./__gamespace_content__/${encodeURIComponent(state.indexName || "index.html")}`, location.href);
  url.searchParams.set("app", "");
  url.searchParams.set("gamespaceIndexSession", `${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`);
  return url.href;
}

function showViewerToolbar() {
  elements.viewerToolbar.classList.remove("is-hidden");
  elements.viewerToolbar.classList.remove("is-counting");
  void elements.viewerToolbar.offsetWidth;
  elements.viewerToolbar.classList.add("is-counting");
  clearTimeout(toolbarTimer);
  toolbarTimer = setTimeout(() => {
    elements.viewerToolbar.classList.remove("is-counting");
    elements.viewerToolbar.classList.add("is-hidden");
  }, 5000);
}

function openViewer() {
  if (!state) return;
  elements.viewer.hidden = false;
  elements.appShell.setAttribute("aria-hidden", "true");
  elements.appShell.inert = true;
  elements.siteFrame.src = contentIndexUrl();
  elements.viewerLoading.hidden = false;
  showViewerToolbar();
}

function closeViewer() {
  elements.viewer.hidden = true;
  elements.appShell.removeAttribute("aria-hidden");
  elements.appShell.inert = false;
  elements.siteFrame.src = "about:blank";
  clearTimeout(toolbarTimer);
}

function attachFrameGuards() {
  elements.viewerLoading.hidden = true;
  try {
    const frameWindow = elements.siteFrame.contentWindow;
    const frameDocument = elements.siteFrame.contentDocument;
    frameDocument?.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      const target = new URL(link.href, frameDocument.baseURI);
      if (target.origin !== location.origin) {
        event.preventDefault();
        window.open(target.href, "_blank", "noopener,noreferrer");
      }
    }, true);
    frameWindow?.addEventListener("error", () => {}, { once: true });
  } catch {
    // External pages are not expected, but a cross-origin frame must stay isolated.
  }
}

async function refreshStorage() {
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  elements.storageUsage.textContent = formatBytes(estimate.usage || 0);
  elements.storageQuota.textContent = formatBytes(estimate.quota || 0);
  const percent = estimate.quota ? Math.min(100, Math.round((estimate.usage || 0) / estimate.quota * 100)) : 0;
  elements.storageBar.style.width = `${percent}%`;
  elements.storageRing.style.setProperty("--fill", `${percent * 3.6}deg`);
  elements.storageBarText.textContent = `${percent}%`;
  const persisted = await navigator.storage.persisted?.().catch(() => false);
  elements.storagePersistent.textContent = persisted ? "Постоянное" : "По решению браузера";
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker не поддерживается.");
  if (serviceWorkerRegistration) return serviceWorkerRegistration;
  const scope = new URL("./", location.href).href;
  serviceWorkerRegistration = await navigator.serviceWorker.getRegistration(scope);
  if (!serviceWorkerRegistration) {
    const workerUrl = new URL(`./${RUNTIME_SCRIPT}`, location.href);
    serviceWorkerRegistration = await navigator.serviceWorker.register(workerUrl, {
      scope: "./",
      updateViaCache: "none",
    });
    serviceWorkerRegistration = await navigator.serviceWorker.ready;
  }

  const worker = serviceWorkerRegistration.active
    || serviceWorkerRegistration.waiting
    || serviceWorkerRegistration.installing;
  if (worker) {
    const scriptName = new URL(worker.scriptURL).pathname.split("/").at(-1);
    if (scriptName !== RUNTIME_SCRIPT) {
      throw new Error("Установлена тестовая версия GameSpace со старым Service Worker. Удалите её и установите текущую PWA заново.");
    }
  }
  return serviceWorkerRegistration;
}

function waitForWorkerInstalled(worker, timeoutMs = 30_000) {
  if (!worker || ["installed", "activating", "activated"].includes(worker.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Проверка обновления заняла слишком много времени.")), timeoutMs);
    const handleState = () => {
      if (["installed", "activating", "activated"].includes(worker.state)) {
        clearTimeout(timeout);
        worker.removeEventListener("statechange", handleState);
        resolve();
      } else if (worker.state === "redundant") {
        clearTimeout(timeout);
        worker.removeEventListener("statechange", handleState);
        reject(new Error("Новая версия Service Worker не установлена."));
      }
    };
    worker.addEventListener("statechange", handleState);
  });
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

async function runtimeMessage(type, data = {}, timeoutMs = 300_000) {
  const registration = await ensureServiceWorker();
  const worker = navigator.serviceWorker.controller || registration.active || registration.waiting;
  if (!worker) throw new Error("Активный Service Worker не найден.");
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => reject(new Error("Service Worker не завершил операцию вовремя.")), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      if (event.data?.ok) resolve(event.data);
      else reject(new Error(event.data?.error || "Service Worker сообщил об ошибке."));
    };
    worker.postMessage({ type, ...data }, [channel.port2]);
  });
}

function waitForControllerChange(timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function refreshRuntimeState({ confirmHealth = false } = {}) {
  const reply = await runtimeMessage("GET_RUNTIME_STATE", {}, 15_000);
  runtimeState = reply.state;
  if (confirmHealth && runtimeState?.pendingVersion === APP_VERSION) {
    const confirmed = await runtimeMessage("CONFIRM_RELEASE_HEALTH", { version: APP_VERSION }, 15_000);
    runtimeState = confirmed.state;
  }
  if (elements.pwaCurrentVersion) {
    const active = runtimeState?.activeVersion || APP_VERSION;
    elements.pwaCurrentVersion.textContent = `Активная версия: ${active}. Версия открытой оболочки: ${APP_VERSION}.`;
  }
  if (elements.rollbackPwaButton) {
    elements.rollbackPwaButton.disabled = !runtimeState?.previousVersion;
    elements.rollbackPwaButton.textContent = runtimeState?.previousVersion
      ? `Вернуться к версии ${runtimeState.previousVersion}`
      : "Предыдущая версия не сохранена";
  }
  return runtimeState;
}

async function fetchVersionCatalog() {
  const catalogUrl = new URL("./versions.json", location.href);
  catalogUrl.searchParams.set("gamespace-check", Date.now().toString(36));
  let response;
  try {
    response = await withTimeout(
      fetch(catalogUrl, { cache: "no-store" }),
      15_000,
      "Сервер версий не ответил за 15 секунд.",
    );
  } catch (error) {
    if (error?.message?.includes("15 секунд")) throw error;
    throw new Error("Сервер версий недоступен. Локальная версия продолжает работать.");
  }
  if (!response.ok) throw new Error(`Сервер версий ответил HTTP ${response.status}.`);
  const data = await response.json();
  if (data?.schema !== 1 || !Array.isArray(data.versions) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(data.latest || "")) {
    throw new Error("Сервер вернул некорректный каталог версий.");
  }
  const versions = data.versions.map((release) => {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release?.version || "")) {
      throw new Error("В каталоге найден некорректный номер версии.");
    }
    if (!/^sw-runtime-v\d+\.js$/.test(release.runtime || "")) {
      throw new Error(`Некорректный runtime версии ${release.version}.`);
    }
    const manifest = new URL(release.manifest, catalogUrl);
    if (manifest.origin !== location.origin) throw new Error("Манифест версии находится на другом сайте.");
    return {
      version: release.version,
      runtime: release.runtime,
      manifest: manifest.href,
      size: Number.isSafeInteger(release.size) ? release.size : 0,
      date: release.date || "",
      description: release.description || "Стабильный выпуск GameSpace",
    };
  });
  if (!versions.some((release) => release.version === data.latest)) {
    throw new Error("Последняя версия отсутствует в каталоге выпусков.");
  }
  return { latest: data.latest, versions };
}

function renderVersionCatalog(catalog, list) {
  list.replaceChildren();
  for (const release of catalog.versions) {
    const article = document.createElement("article");
    article.className = "release-option";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const current = release.version === runtimeState?.activeVersion;
    title.textContent = `GameSpace ${release.version}${release.version === catalog.latest ? " · последняя" : ""}${current ? " · установлена" : ""}`;
    const details = document.createElement("small");
    const parts = [release.description];
    if (release.date) parts.push(release.date);
    if (release.size) parts.push(formatBytes(release.size));
    if (release.runtime !== RUNTIME_SCRIPT) parts.push(`требуется ${release.runtime}`);
    details.textContent = parts.join(" · ");
    copy.append(title, details);
    const button = document.createElement("button");
    button.className = "version-secondary-button";
    button.type = "button";
    button.disabled = current;
    button.textContent = current ? "Установлена" : "Установить";
    const target = list === elements.landingVersionsList ? "landing" : "app";
    button.addEventListener("click", () => installPwaRelease(release, target));
    article.append(copy, button);
    list.append(article);
  }
  list.hidden = false;
}

async function installNewRuntime(release) {
  const confirmation = window.confirm(
    `Версия ${release.version} требует новый системный компонент ${release.runtime}. Он будет установлен только после этого подтверждения. Продолжить?`,
  );
  if (!confirmation) return false;
  const workerUrl = new URL(release.runtime, location.href);
  const controllerChanged = waitForControllerChange();
  const registration = await navigator.serviceWorker.register(workerUrl, {
    scope: "./",
    updateViaCache: "none",
  });
  serviceWorkerRegistration = registration;
  if (registration.installing) await waitForWorkerInstalled(registration.installing, 120_000);
  await controllerChanged;
  location.reload();
  return true;
}

async function installPwaRelease(release, target = "app") {
  if (busy) return;
  const status = target === "landing" ? elements.installAvailability : elements.pwaUpdateStatus;
  if (!navigator.onLine) {
    status.textContent = "Нет подключения к интернету. Локальная версия продолжает работать.";
    return;
  }

  const action = release.version === APP_VERSION ? "переустановить" : "установить";
  const size = release.size ? ` Размер загрузки: ${formatBytes(release.size)}.` : "";
  if (!window.confirm(`Действительно ${action} GameSpace ${release.version}?${size} Текущая версия останется для отката.`)) return;

  setBusy(true);
  status.textContent = `Подготавливаю GameSpace ${release.version}…`;
  try {
    if (release.runtime !== RUNTIME_SCRIPT) {
      await installNewRuntime(release);
      return;
    }
    const result = await runtimeMessage("INSTALL_RELEASE", { manifestUrl: release.manifest });
    if (result.requiresRuntime) {
      await installNewRuntime({ ...release, runtime: result.requiresRuntime });
      return;
    }
    status.textContent = `Версия ${release.version} проверена. Переключаю оболочку…`;
    await runtimeMessage("ACTIVATE_RELEASE", { version: release.version }, 30_000);
    location.reload();
  } catch (error) {
    status.textContent = `Не удалось установить PWA: ${errorMessage(error)}`;
  } finally {
    setBusy(false);
  }
}

async function checkForPwaUpdate(target = "app") {
  if (busy) return;
  const status = target === "landing" ? elements.installAvailability : elements.pwaUpdateStatus;
  if (!navigator.onLine) {
    status.textContent = "Нет подключения к интернету. Локальная версия продолжает работать.";
    return;
  }
  setBusy(true);
  status.textContent = "Загружаю каталог опубликованных версий…";
  try {
    await refreshRuntimeState();
    const catalog = await fetchVersionCatalog();
    renderVersionCatalog(catalog, target === "landing" ? elements.landingVersionsList : elements.pwaVersionsList);
    status.textContent = catalog.latest === runtimeState?.activeVersion
      ? `Установлена последняя версия ${catalog.latest}. Можно выбрать прошлый выпуск.`
      : `Последняя версия — ${catalog.latest}. Установка начнётся только после вашего выбора.`;
  } catch (error) {
    status.textContent = `Не удалось проверить версии: ${errorMessage(error)}`;
  } finally {
    setBusy(false);
  }
}

async function rollbackPwaRelease() {
  if (busy || !runtimeState?.previousVersion) return;
  if (!window.confirm(`Вернуться к локально сохранённой версии ${runtimeState.previousVersion}? Текущая версия останется доступной для обратного переключения.`)) return;
  setBusy(true);
  try {
    const reply = await runtimeMessage("ROLLBACK_RELEASE", {}, 30_000);
    elements.pwaUpdateStatus.textContent = `Восстановлена версия ${reply.state.activeVersion}. Перезапускаю…`;
    location.reload();
  } catch (error) {
    elements.pwaUpdateStatus.textContent = `Не удалось выполнить откат: ${errorMessage(error)}`;
  } finally {
    setBusy(false);
  }
}

async function initializeCapabilities() {
  const required = Boolean(window.isSecureContext && navigator.storage?.getDirectory && window.WebAssembly && window.Worker);
  if (!required) {
    elements.capabilityLabel.textContent = "Браузер не поддерживает обязательные функции";
    elements.capabilityLabel.dataset.tone = "bad";
    setStatus("Полный режим недоступен", "bad");
    return;
  }
  const sevenZip = await probeSevenZipSupport();
  elements.capabilityLabel.textContent = sevenZip.supported
    ? "7z, ZIP64, OPFS и автономный запуск доступны"
    : `ZIP64 доступен; 7z недоступен: ${sevenZip.reason}`;
  elements.capabilityLabel.dataset.tone = sevenZip.supported ? "good" : "warn";
}

async function initialize() {
  if (!runningAsInstalledApp) {
    showLanding();
    elements.installAvailability.textContent = navigator.onLine
      ? "Подготовка к установке и автономной работе…"
      : "Страница уже доступна без сети. Откройте меню браузера для установки.";
    finishBoot();
    try {
      await ensureServiceWorker();
      await initializeCapabilities();
      await refreshRuntimeState({ confirmHealth: true });
      if (!installPrompt) {
        elements.installAvailability.textContent = "Если браузер не покажет окно автоматически, используйте инструкцию под кнопкой.";
      }
    } catch (error) {
      elements.installAvailability.textContent = `Автономный режим пока не подготовлен: ${errorMessage(error)}`;
    }
    return;
  }

  showAppShell();
  setStatus(navigator.onLine ? "Подготовка автономного режима" : "Автономный режим", "neutral");
  let initialViewerOpened = false;
  try {
    state = await readState();
    renderState();

    if (state && navigator.serviceWorker?.controller) {
      openViewer();
      initialViewerOpened = true;
      finishBoot();
    } else if (!state) {
      finishBoot();
    }

    await ensureServiceWorker();
    await refreshRuntimeState({ confirmHealth: true });
    if (state && !initialViewerOpened) {
      openViewer();
      initialViewerOpened = true;
      finishBoot();
    }

    await Promise.all([refreshStorage(), initializeCapabilities()]);
    cleanupOrphans(state).then(refreshStorage).catch(() => {});
    setStatus(state ? "Сайт готов к автономной работе" : "Приложение готово к импорту", "good");
  } catch (error) {
    finishBoot();
    showError(error);
    setStatus("Ошибка инициализации", "bad");
  }
}

elements.chooseArchiveButton.addEventListener("click", () => chooseArchive("full"));
elements.demoButton.addEventListener("click", async () => {
  try {
    const demoUrl = new URL("./demo.7z", location.href);
    demoUrl.searchParams.set("gamespace-demo", DEMO_REVISION);
    const response = await fetch(demoUrl);
    if (!response.ok) throw new Error("Встроенный demo.7z недоступен.");
    const blob = await response.blob();
    pendingMode = "full";
    await importSelectedFile(new File([blob], "Встроенный демо-сайт (demo.7z)", {
      type: "application/x-7z-compressed",
      lastModified: Date.now(),
    }));
  } catch (error) {
    showError(error);
  }
});
elements.fullUpdateButton.addEventListener("click", () => chooseArchive("full"));
elements.fastUpdateButton.addEventListener("click", () => chooseArchive("fast"));
elements.checkPwaUpdateButton.addEventListener("click", () => checkForPwaUpdate("app"));
elements.landingVersionsButton.addEventListener("click", () => checkForPwaUpdate("landing"));
elements.rollbackPwaButton.addEventListener("click", rollbackPwaRelease);
elements.archiveInput.addEventListener("change", () => importSelectedFile(elements.archiveInput.files?.[0]));
elements.openSiteButton.addEventListener("click", openViewer);
elements.viewerClose.addEventListener("click", closeViewer);
elements.viewerHome.addEventListener("click", () => {
  elements.siteFrame.src = contentIndexUrl();
  elements.viewerLoading.hidden = false;
  showViewerToolbar();
});
elements.viewerBack.addEventListener("click", () => {
  elements.siteFrame.contentWindow?.history.back();
  showViewerToolbar();
});
elements.siteFrame.addEventListener("load", attachFrameGuards);
elements.errorClose.addEventListener("click", () => { elements.errorPanel.hidden = true; });
elements.removeSiteButton.addEventListener("click", async () => {
  if (!state || !window.confirm("Удалить распакованный сайт и его локальные данные из хранилища PWA?")) return;
  setBusy(true);
  try {
    await removeInstalledSite();
    state = null;
    renderState();
    await refreshStorage();
    setStatus("Сайт удалён", "neutral");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
});
elements.installButton.addEventListener("click", async () => {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    const result = await prompt.prompt();
    if (result.outcome === "accepted") {
      elements.installButton.hidden = true;
      elements.installHelp.hidden = true;
      elements.installResult.hidden = false;
      elements.installResult.textContent = "Установка началась. После завершения откройте GameSpace с нового значка на экране.";
    } else {
      elements.installHelp.hidden = false;
      elements.installAvailability.textContent = "Установка отменена. Можно повторить или добавить приложение через меню браузера.";
    }
  } else {
    elements.installHelp.hidden = !elements.installHelp.hidden;
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (isRunningAsInstalledApp()) return;
  installPrompt = event;
  elements.installButton.hidden = false;
  elements.installAvailability.textContent = "Приложение готово к установке на это устройство.";
});
window.addEventListener("appinstalled", () => {
  elements.installButton.hidden = true;
  elements.installHelp.hidden = true;
  elements.installResult.hidden = false;
  elements.installResult.textContent = "GameSpace установлен. Откройте его с нового значка на главном экране.";
});
window.addEventListener("online", () => {
  if (!runningAsInstalledApp) {
    elements.installAvailability.textContent = installPrompt
      ? "Приложение готово к установке на это устройство."
      : "Подключение восстановлено. Можно установить приложение.";
    return;
  }
  setStatus(state ? "Сайт готов к автономной работе" : "Приложение готово к импорту", "good");
});
window.addEventListener("offline", () => {
  if (!runningAsInstalledApp) {
    elements.installAvailability.textContent = "Автономная оболочка доступна. Для установки используйте меню браузера.";
    return;
  }
  setStatus("Автономный режим", "good");
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !elements.viewer.hidden) showViewerToolbar();
});

if (import.meta.env.DEV && new URLSearchParams(location.search).has("gamespaceE2E")) {
  const updateFixtureButton = document.createElement("button");
  updateFixtureButton.id = "e2eUpdateFixture";
  updateFixtureButton.type = "button";
  updateFixtureButton.textContent = "E2E: применить update-архив";
  updateFixtureButton.addEventListener("click", async () => {
    try {
      const response = await fetch("/test/fixtures/gamespace-update.zip");
      if (!response.ok) throw new Error("Тестовый update-архив недоступен.");
      const blob = await response.blob();
      pendingMode = "fast";
      await importSelectedFile(new File([blob], "gamespace-update.zip", {
        type: "application/zip",
        lastModified: Date.now(),
      }));
    } catch (error) {
      showError(error);
    }
  });
  elements.appShell.append(updateFixtureButton);
}

initialize();
