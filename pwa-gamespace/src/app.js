import "./styles.css";
import { readState } from "./db.js";
import { formatBytes, formatDate, formatDuration, errorMessage } from "./format.js";
import {
  cleanupOrphans,
  installFullArchive,
  applyUpdateArchive,
  refreshInstalledSiteStatistics,
  removeInstalledSite,
} from "./import-manager.js";
import { probeSevenZipSupport } from "./archive/sevenzip-client.js";
import { ensureServiceWorkerControlsPage } from "./service-worker-control.js";
import { ProgressEstimator } from "./progress-estimator.js";
import {
  getVersionBatch,
  normalizeReleaseDescription,
  shouldExpandDescription,
} from "./version-list.js";
import {
  fetchLicenseDocument,
  licenseDocumentGroups,
} from "./license-documents.js";

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);

let state = null;
let pendingMode = "full";
let installPrompt = null;
let busy = false;
let toolbarTimer = null;
let bootWatchdog = null;
let serviceWorkerRegistration = null;
let runtimeState = null;
let siteInterfaceRefreshTimer = null;
let licenseModalPreviousFocus = null;
let licenseDocumentRequest = 0;
const progressEstimator = new ProgressEstimator();
let progressUnit = null;

const APP_VERSION = "0.3.0";
const RUNTIME_SCRIPT = "sw-runtime-v1.js";
const DEMO_REVISION = "apk-demo-v1";

elements.appHeaderVersion.textContent = APP_VERSION;
elements.viewerToolbarTitle.textContent = `GameSpace PWA ${APP_VERSION}`;

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
  if (bootWatchdog !== null) {
    clearTimeout(bootWatchdog);
    bootWatchdog = null;
  }
  document.documentElement.classList.remove("gamespace-boot-pending");
}

function setStatus(text, tone = "neutral") {
  elements.statusText.textContent = text;
  elements.statusDot.dataset.tone = tone;
}

bootWatchdog = window.setTimeout(() => {
  if (!document.documentElement.classList.contains("gamespace-boot-pending")) return;
  showAppShell();
  finishBoot();
  setStatus("Подготавливаю автономный запуск…", "neutral");
}, 10_000);

function setBusy(value) {
  busy = value;
  document.body.classList.toggle("is-busy", value);
  for (const button of document.querySelectorAll("button")) {
    if (button.closest("#viewer")) continue;
    button.disabled = value || button.dataset.fixedDisabled === "true";
  }
  elements.archiveInput.disabled = value;
  renderState();
  elements.rollbackPwaButton.disabled = value || !runtimeState?.previousVersion;
}

function renderLicenseDocumentList() {
  if (elements.licenseDocumentList.childElementCount) return;
  for (const group of licenseDocumentGroups) {
    const heading = document.createElement("p");
    heading.className = "license-group-title";
    heading.textContent = group.title;
    elements.licenseDocumentList.append(heading);
    for (const licenseDocument of group.documents) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "license-document-button";
      button.textContent = licenseDocument.title;
      button.addEventListener("click", () => { void showLicenseDocument(licenseDocument, button); });
      elements.licenseDocumentList.append(button);
    }
  }
}

async function showLicenseDocument(licenseDocument, button) {
  const request = ++licenseDocumentRequest;
  for (const item of elements.licenseDocumentList.querySelectorAll("button")) {
    item.classList.toggle("is-active", item === button);
  }
  elements.licenseDocumentTitle.textContent = licenseDocument.title;
  elements.licenseDocumentStatus.textContent = "Открываю документ…";
  elements.licenseDocumentContent.textContent = "";
  try {
    const content = await fetchLicenseDocument(licenseDocument.path);
    if (request !== licenseDocumentRequest) return;
    elements.licenseDocumentStatus.textContent = "";
    elements.licenseDocumentContent.textContent = content;
    elements.licenseDocumentContent.scrollTop = 0;
  } catch (error) {
    if (request !== licenseDocumentRequest) return;
    elements.licenseDocumentStatus.textContent = errorMessage(error);
  }
}

function openLicenses() {
  renderLicenseDocumentList();
  licenseModalPreviousFocus = document.activeElement;
  elements.licenseModal.hidden = false;
  elements.appShell.inert = true;
  document.body.classList.add("license-modal-open");
  elements.closeLicensesButton.focus();
  const firstButton = elements.licenseDocumentList.querySelector("button");
  if (firstButton) firstButton.click();
}

function closeLicenses() {
  licenseDocumentRequest += 1;
  elements.licenseModal.hidden = true;
  elements.appShell.inert = false;
  document.body.classList.remove("license-modal-open");
  licenseModalPreviousFocus?.focus?.();
  licenseModalPreviousFocus = null;
}

function renderState() {
  const installed = Boolean(state?.revisionPath);
  elements.emptyState.hidden = installed;
  elements.installedState.hidden = !installed;
  elements.openSiteButton.disabled = !installed || busy;
  elements.fastUpdateButton.disabled = !installed || busy;
  elements.fullUpdateButton.disabled = busy;
  elements.removeSiteButton.disabled = !installed || busy;
  elements.removeSiteButton.hidden = !installed;
  elements.storageVerifyButton.disabled = !installed || busy;

  if (!installed) {
    elements.siteSummary.textContent = "Основной сайт ещё не установлен";
    elements.infoArchive.textContent = "—";
    elements.infoFormat.textContent = "—";
    elements.infoFiles.textContent = "—";
    elements.infoWritten.textContent = "—";
    elements.infoInstalled.textContent = "—";
    elements.infoDuration.textContent = "—";
    elements.infoMode.textContent = "—";
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
  elements.progressSpeed.textContent = "Скорость: вычисляется";
  elements.progressRemaining.textContent = "Осталось примерно: вычисляется";
  elements.errorPanel.hidden = true;
  progressEstimator.reset();
  progressUnit = null;
}

function hideProgress() {
  elements.progressPanel.hidden = true;
}

function showError(error) {
  elements.errorText.textContent = errorMessage(error);
  elements.errorPanel.hidden = false;
}

function showRateEstimate(estimate, unit) {
  if (!estimate.speedPerSecond) {
    elements.progressSpeed.textContent = "Скорость: вычисляется";
    elements.progressRemaining.textContent = "Осталось примерно: вычисляется";
    return;
  }
  const speed = unit === "bytes"
    ? `${formatBytes(estimate.speedPerSecond)}/с`
    : `${estimate.speedPerSecond.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} файл/с`;
  const remaining = estimate.remainingMs === null
    ? "вычисляется"
    : formatDuration(Math.ceil(estimate.remainingMs));
  elements.progressSpeed.textContent = `Скорость: ${speed}`;
  elements.progressRemaining.textContent = `Осталось примерно: ${remaining}`;
}

function handleImportEvent(event) {
  if (!event) return;
  if (event.type === "phase") {
    elements.progressPhase.textContent = event.label;
    if (event.phase === "extract" || event.phase === "apply") {
      progressEstimator.reset();
      progressUnit = event.phase === "extract" ? "bytes" : "files";
      elements.progressSpeed.textContent = "Скорость: вычисляется";
      elements.progressRemaining.textContent = "Осталось примерно: вычисляется";
    }
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
    if (progressUnit !== "bytes") {
      progressEstimator.reset();
      progressUnit = "bytes";
    }
    showRateEstimate(progressEstimator.update(processed, total), "bytes");
  } else if (event.type === "apply-progress") {
    elements.progressNumbers.textContent = `${event.current.toLocaleString("ru-RU")} / ${event.total.toLocaleString("ru-RU")} файлов`;
    elements.progressFile.textContent = event.path || "";
    if (progressUnit !== "files") {
      progressEstimator.reset();
      progressUnit = "files";
    }
    showRateEstimate(progressEstimator.update(event.current, event.total), "files");
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

  cancelScheduledSiteInterfaceRefresh();
  setBusy(true);
  showProgress(isUpdate ? "Быстрое обновление сайта" : "Установка сайта");
  try {
    state = isUpdate
      ? await applyUpdateArchive(file, handleImportEvent)
      : await installFullArchive(file, handleImportEvent);
    await synchronizeSiteInterface({ reloadState: true });
    scheduleSiteInterfaceRefresh();
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

async function openViewer() {
  if (!state) return false;
  try {
    await ensureServiceWorker();
    if (!navigator.serviceWorker.controller) {
      throw new Error("Локальный сайт нельзя открыть до активации Service Worker.");
    }
    elements.viewer.hidden = false;
    elements.appShell.setAttribute("aria-hidden", "true");
    elements.appShell.inert = true;
    elements.siteFrame.src = contentIndexUrl();
    elements.viewerLoading.hidden = false;
    showViewerToolbar();
    return true;
  } catch (error) {
    showError(error);
    setStatus("Локальный сайт пока не открыт", "bad");
    return false;
  }
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
  const managedBytes = state?.writtenBytes || 0;
  const managedFiles = Number(state?.files || 0);
  elements.storageManaged.textContent = state ? `Сайт GameSpace: ${formatBytes(managedBytes)}` : "Сайт GameSpace: не установлен";
  elements.storageFiles.textContent = state ? `${managedFiles.toLocaleString("ru-RU")} файлов в OPFS` : "0 файлов в OPFS";
  if (!navigator.storage?.estimate) {
    elements.storageUsage.textContent = "Оценка браузера: недоступна";
    elements.storageQuota.textContent = "Доступная квота: не сообщается";
    elements.storageBar.style.width = "0%";
    elements.storageRing.style.setProperty("--fill", "0deg");
    elements.storageBarText.textContent = "—";
    elements.storagePersistent.textContent = "Не определено";
    return;
  }
  const estimate = await navigator.storage.estimate();
  elements.storageUsage.textContent = `Оценка браузера: ${formatBytes(estimate.usage || 0)}`;
  elements.storageQuota.textContent = `Доступная квота: ${formatBytes(estimate.quota || 0)}`;
  const percent = estimate.quota ? Math.min(100, (estimate.usage || 0) / estimate.quota * 100) : 0;
  elements.storageBar.style.width = `${percent}%`;
  elements.storageRing.style.setProperty("--fill", `${percent * 3.6}deg`);
  elements.storageBarText.textContent = percent > 0 && percent < 0.1
    ? "<0,1%"
    : `${percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
  const persisted = await navigator.storage.persisted?.().catch(() => false);
  elements.storagePersistent.textContent = persisted ? "Постоянное" : "По решению браузера";
}

async function synchronizeSiteInterface({ reloadState = false } = {}) {
  if (reloadState) state = await readState();
  renderState();
  await refreshStorage();
}

function scheduleSiteInterfaceRefresh() {
  cancelScheduledSiteInterfaceRefresh();
  siteInterfaceRefreshTimer = window.setTimeout(async () => {
    siteInterfaceRefreshTimer = null;
    try {
      await synchronizeSiteInterface({ reloadState: true });
    } catch (error) {
      console.warn("Не удалось повторно обновить сведения о хранилище.", error);
    }
  }, 750);
}

function cancelScheduledSiteInterfaceRefresh() {
  if (siteInterfaceRefreshTimer === null) return;
  clearTimeout(siteInterfaceRefreshTimer);
  siteInterfaceRefreshTimer = null;
}

async function verifyStoredSite() {
  if (!state || busy) return;
  setBusy(true);
  setStatus("Перепроверяю файлы сайта", "neutral");
  try {
    const result = await refreshInstalledSiteStatistics(state);
    state = result.state;
    renderState();
    await refreshStorage();
    setStatus(`Проверено: ${result.files.toLocaleString("ru-RU")} файлов, ${formatBytes(result.bytes)}`, "good");
  } catch (error) {
    showError(error);
    setStatus("Проверка файлов не выполнена", "bad");
  } finally {
    setBusy(false);
  }
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker не поддерживается.");
  const scope = new URL("./", location.href).href;
  if (!serviceWorkerRegistration) {
    serviceWorkerRegistration = await navigator.serviceWorker.getRegistration(scope);
  }
  if (!serviceWorkerRegistration) {
    const workerUrl = new URL(`./${RUNTIME_SCRIPT}`, location.href);
    serviceWorkerRegistration = await navigator.serviceWorker.register(workerUrl, {
      scope: "./",
      updateViaCache: "none",
    });
  }
  if (!serviceWorkerRegistration.active) {
    const pendingWorker = serviceWorkerRegistration.installing || serviceWorkerRegistration.waiting;
    if (pendingWorker) await waitForWorkerInstalled(pendingWorker, 60_000);
    serviceWorkerRegistration = await withTimeout(
      navigator.serviceWorker.ready,
      60_000,
      "Service Worker не активировался за одну минуту. Проверьте подключение и повторите запуск.",
    );
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
  const controlState = await ensureServiceWorkerControlsPage({
    serviceWorker: navigator.serviceWorker,
    storage: sessionStorage,
    reload: () => location.reload(),
  });
  if (controlState === "reloading") {
    await new Promise(() => {});
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
    elements.rollbackPwaButton.disabled = busy || !runtimeState?.previousVersion;
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

function createReleaseOption(catalog, release, index, activeIndex, list) {
    const article = document.createElement("article");
    article.className = "release-option";
    const header = document.createElement("div");
    header.className = "release-option-header";
    const copy = document.createElement("div");
    copy.className = "release-option-copy";
    const title = document.createElement("strong");
    const current = release.version === runtimeState?.activeVersion;
    title.textContent = `GameSpace ${release.version}${release.version === catalog.latest ? " · последняя" : ""}${current ? " · установлена" : ""}`;
    const metadata = document.createElement("small");
    metadata.className = "release-metadata";
    const parts = [];
    if (release.date) parts.push(release.date);
    if (release.size) parts.push(formatBytes(release.size));
    if (release.runtime !== RUNTIME_SCRIPT) parts.push(`требуется ${release.runtime}`);
    metadata.textContent = parts.join(" · ") || "Опубликованный выпуск";
    copy.append(title, metadata);
    const button = document.createElement("button");
    button.className = "version-secondary-button";
    button.type = "button";
    button.dataset.fixedDisabled = current ? "true" : "false";
    button.disabled = current || busy;
    button.textContent = current ? "Установлена" : "Установить";
    const target = list === elements.landingVersionsList ? "landing" : "app";
    if (!current) button.addEventListener("click", () => installPwaRelease(release, target));

    const description = document.createElement("details");
    description.className = "release-description-panel";
    description.open = shouldExpandDescription(index, activeIndex);
    const descriptionToggle = document.createElement("summary");
    const descriptionText = document.createElement("div");
    descriptionText.className = "release-description";
    descriptionText.textContent = normalizeReleaseDescription(release.description);
    const updateToggleText = () => {
      descriptionToggle.textContent = description.open ? "Свернуть описание" : "Показать описание";
    };
    description.addEventListener("toggle", updateToggleText);
    updateToggleText();
    description.append(descriptionToggle, descriptionText);
    header.append(copy, button);
    article.append(header, description);
    return article;
}

function renderVersionCatalog(catalog, list) {
  list.replaceChildren();
  const activeIndex = catalog.versions.findIndex((release) => release.version === runtimeState?.activeVersion);
  let offset = 0;
  const appendNextBatch = () => {
    list.querySelector(".release-more-button")?.remove();
    const batch = getVersionBatch(catalog.versions, offset);
    for (const [batchIndex, release] of batch.items.entries()) {
      list.append(createReleaseOption(catalog, release, offset + batchIndex, activeIndex, list));
    }
    offset = batch.nextOffset;
    if (batch.remaining > 0) {
      const moreButton = document.createElement("button");
      moreButton.className = "version-secondary-button release-more-button";
      moreButton.type = "button";
      moreButton.disabled = busy;
      moreButton.textContent = `Показать ещё (${batch.remaining})`;
      moreButton.addEventListener("click", appendNextBatch);
      list.append(moreButton);
    }
  }
  appendNextBatch();
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
  if (release.version === runtimeState?.activeVersion) return;
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
    if (state && !state.storageVerifiedAt) {
      const result = await refreshInstalledSiteStatistics(state);
      state = result.state;
    }
    renderState();

    if (state && navigator.serviceWorker?.controller) {
      initialViewerOpened = await openViewer();
      if (initialViewerOpened) finishBoot();
    } else if (!state) {
      finishBoot();
    }

    await ensureServiceWorker();
    await refreshRuntimeState({ confirmHealth: true });
    if (state && !initialViewerOpened) {
      initialViewerOpened = await openViewer();
      if (initialViewerOpened) finishBoot();
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
elements.openLicensesButton.addEventListener("click", openLicenses);
elements.closeLicensesButton.addEventListener("click", closeLicenses);
elements.licenseModalBackdrop.addEventListener("click", closeLicenses);
elements.landingVersionsButton.addEventListener("click", () => checkForPwaUpdate("landing"));
elements.rollbackPwaButton.addEventListener("click", rollbackPwaRelease);
elements.recoveryLink.addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await ensureServiceWorker();
    location.assign(elements.recoveryLink.href);
  } catch (error) {
    showError(error);
    setStatus("Страница восстановления пока недоступна", "bad");
  }
});
elements.archiveInput.addEventListener("change", () => importSelectedFile(elements.archiveInput.files?.[0]));
elements.openSiteButton.addEventListener("click", () => { void openViewer(); });
elements.storageVerifyButton.addEventListener("click", verifyStoredSite);
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
  const previousState = state;
  cancelScheduledSiteInterfaceRefresh();
  setBusy(true);
  state = null;
  renderState();
  void refreshStorage().catch(() => {});
  setStatus("Удаляю файлы сайта", "neutral");
  try {
    await removeInstalledSite();
    await synchronizeSiteInterface({ reloadState: true });
    scheduleSiteInterfaceRefresh();
    setStatus("Сайт удалён", "neutral");
  } catch (error) {
    state = await readState().catch(() => previousState);
    renderState();
    await refreshStorage().catch(() => {});
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
      elements.installResult.textContent = "Завершите установку в окне браузера. После подтверждения здесь появится инструкция по запуску GameSpace.";
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
  elements.installAvailability.hidden = true;
  elements.installResult.classList.add("is-complete");
  elements.installResult.hidden = false;
  elements.installResult.textContent = "Закройте эту вкладку браузера. Затем запустите GameSpace с нового ярлыка на рабочем столе или главном экране — только так откроется режим приложения.";
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
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.licenseModal.hidden) {
    event.preventDefault();
    closeLicenses();
  }
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
