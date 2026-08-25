/*
 * Неизменяемая среда выполнения Service Worker GameSpace v1.
 *
 * После публикации этот файл должен оставаться неизменным на уровне байтов.
 * Пакеты выпусков устанавливаются только по явному действию пользователя.
 * Для будущей среды выполнения потребуется новое имя, например sw-runtime-v2.js.
 */

const RUNTIME_ID = "gamespace-runtime-v1";
const RUNTIME_SCRIPT = "sw-runtime-v1.js";
const RELEASE_CACHE_PREFIX = "gamespace-release-v1:";
const DB_NAME = "gamespace-pwa";
const DB_VERSION = 1;
const STORE_NAME = "app";
const CONTENT_STATE_KEY = "state";
const RELEASE_STATE_KEY = "runtime-v1-release-state";
const SCOPE_URL = new URL("./", self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname;
const CONTENT_PREFIX = new URL("./__gamespace_content__/", SCOPE_URL).pathname;
const RECOVERY_PATH = new URL("./__gamespace_recovery__/", SCOPE_URL).pathname;
const SHELL_ENTRY_URL = new URL("./index.html", SCOPE_URL).href;
const ROOT_RELEASE_MANIFEST_URL = new URL("./release.json", SCOPE_URL).href;
const IS_LOCAL_DEVELOPMENT = ["127.0.0.1", "localhost"].includes(SCOPE_URL.hostname);

let activeContentState;
let releaseStateCache;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await installInitialRelease();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "STATE_CHANGED") {
    activeContentState = undefined;
    return;
  }

  const reply = event.ports?.[0];
  if (!reply) return;

  event.waitUntil((async () => {
    try {
      if (type === "GET_RUNTIME_STATE") {
        const state = await readReleaseState();
        reply.postMessage({ ok: true, runtime: RUNTIME_ID, state });
        return;
      }

      if (type === "INSTALL_RELEASE") {
        const manifestUrl = validateManifestUrl(event.data?.manifestUrl);
        const result = await installRelease(manifestUrl);
        reply.postMessage({ ok: true, runtime: RUNTIME_ID, ...result });
        return;
      }

      if (type === "ACTIVATE_RELEASE") {
        const state = await activateRelease(event.data?.version, { requireHealthCheck: true });
        reply.postMessage({ ok: true, runtime: RUNTIME_ID, state });
        return;
      }

      if (type === "CONFIRM_RELEASE_HEALTH") {
        const state = await confirmReleaseHealth(event.data?.version);
        reply.postMessage({ ok: true, runtime: RUNTIME_ID, state });
        return;
      }

      if (type === "ROLLBACK_RELEASE") {
        const state = await rollbackRelease();
        reply.postMessage({ ok: true, runtime: RUNTIME_ID, state });
        return;
      }

      throw new Error("Неизвестная команда Service Worker.");
    } catch (error) {
      reply.postMessage({ ok: false, error: error?.message || String(error) });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" && event.request.method !== "HEAD") return;
  const url = new URL(event.request.url);
  if (url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  if (isExplicitNetworkCheck(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.pathname === RECOVERY_PATH || url.pathname === `${RECOVERY_PATH}index.html`) {
    event.respondWith(recoveryResponse(event.request.method));
    return;
  }

  if (url.pathname.startsWith(CONTENT_PREFIX)) {
    event.respondWith(serveContent(event.request, url));
    return;
  }

  event.respondWith(serveShell(event.request));
});

function isExplicitNetworkCheck(url) {
  if (!url.searchParams.has("gamespace-check")) return false;
  return ["versions.json", "latest.json", "version.json"].some((name) => url.pathname.endsWith(`/${name}`));
}

function cacheName(version) {
  return `${RELEASE_CACHE_PREFIX}${encodeURIComponent(version)}`;
}

function releaseReadyUrl(version) {
  return new URL(`./__gamespace_release_ready__/${encodeURIComponent(version)}`, SCOPE_URL).href;
}

function defaultReleaseState() {
  return {
    runtime: RUNTIME_ID,
    activeVersion: null,
    previousVersion: null,
    pendingVersion: null,
    pendingAttempted: false,
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть IndexedDB."));
  });
}

async function readDatabaseValue(key) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("Не удалось прочитать IndexedDB."));
    });
  } finally {
    database.close();
  }
}

async function writeDatabaseValue(key, value) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Не удалось записать IndexedDB."));
      transaction.onabort = () => reject(transaction.error || new Error("Запись IndexedDB отменена."));
    });
  } finally {
    database.close();
  }
}

async function readReleaseState() {
  if (releaseStateCache) return { ...releaseStateCache };
  releaseStateCache = { ...defaultReleaseState(), ...(await readDatabaseValue(RELEASE_STATE_KEY) || {}) };
  return { ...releaseStateCache };
}

async function writeReleaseState(state) {
  releaseStateCache = { ...defaultReleaseState(), ...state, runtime: RUNTIME_ID };
  await writeDatabaseValue(RELEASE_STATE_KEY, releaseStateCache);
  return { ...releaseStateCache };
}

function validateVersion(value) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value || "")) {
    throw new Error("Некорректный номер версии PWA.");
  }
  return value;
}

function validateManifestUrl(value) {
  const url = new URL(value, SCOPE_URL);
  if (url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE_PATH)) {
    throw new Error("Манифест выпуска должен находиться внутри GameSpace.");
  }
  return url.href;
}

function normalizeReleasePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) {
    throw new Error("Некорректный путь файла выпуска.");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\0-\x1f]/.test(part))) {
    throw new Error("Небезопасный путь файла выпуска.");
  }
  const normalized = parts.join("/");
  if (normalized.startsWith("__gamespace_")) {
    throw new Error("Путь выпуска пересекается с внутренним адресом GameSpace.");
  }
  return normalized;
}

function validateReleaseManifest(data, manifestUrl) {
  if (data?.schema !== 1 || data?.product !== "gamespace-pwa") {
    throw new Error("Неподдерживаемый формат манифеста выпуска.");
  }
  const version = validateVersion(data.version);
  if (data.runtime !== RUNTIME_SCRIPT) {
    return { requiresRuntime: data.runtime, version };
  }
  if (!Array.isArray(data.files) || data.files.length === 0 || data.files.length > 20_000) {
    throw new Error("Некорректный список файлов выпуска.");
  }

  const seen = new Set();
  const files = data.files.map((file) => {
    const path = normalizeReleasePath(file?.path);
    if (seen.has(path)) throw new Error(`Путь повторяется в выпуске: ${path}`);
    seen.add(path);
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Некорректный размер файла: ${path}`);
    const sha256 = String(file.sha256 || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Некорректная SHA-256: ${path}`);
    const sourceUrl = new URL(file.url || path, manifestUrl);
    if (sourceUrl.origin !== SCOPE_URL.origin || !sourceUrl.pathname.startsWith(SCOPE_PATH)) {
      throw new Error(`Файл выпуска находится за пределами GameSpace: ${path}`);
    }
    return {
      path,
      size,
      sha256,
      sourceUrl: sourceUrl.href,
      canonicalUrl: new URL(path, SCOPE_URL).href,
    };
  });

  if (!seen.has("index.html")) throw new Error("В выпуске отсутствует index.html.");
  return { version, files, requiresRuntime: null };
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchAndVerifyFile(file) {
  const response = await fetch(file.sourceUrl, { cache: "reload" });
  if (!response.ok) throw new Error(`Не удалось скачать ${file.path}: HTTP ${response.status}.`);
  const blob = await response.blob();
  if (blob.size !== file.size) throw new Error(`Размер ${file.path} не совпадает с манифестом.`);
  const hash = await sha256Hex(await blob.arrayBuffer());
  if (hash !== file.sha256) throw new Error(`SHA-256 ${file.path} не совпадает с манифестом.`);
  const headers = new Headers(response.headers);
  headers.set("Content-Length", String(blob.size));
  return new Response(blob, { status: 200, statusText: "OK", headers });
}

async function installRelease(manifestUrl) {
  const response = await fetch(manifestUrl, { cache: "reload" });
  if (!response.ok) throw new Error(`Манифест выпуска недоступен: HTTP ${response.status}.`);
  const manifest = validateReleaseManifest(await response.json(), manifestUrl);
  if (manifest.requiresRuntime) {
    return { version: manifest.version, installed: false, requiresRuntime: manifest.requiresRuntime };
  }

  const name = cacheName(manifest.version);
  const existing = await caches.open(name);
  if (await existing.match(releaseReadyUrl(manifest.version))) {
    return { version: manifest.version, installed: false, alreadyInstalled: true, requiresRuntime: null };
  }

  await caches.delete(name);
  const cache = await caches.open(name);
  try {
    for (const file of manifest.files) {
      await cache.put(file.canonicalUrl, await fetchAndVerifyFile(file));
    }
    await cache.put(releaseReadyUrl(manifest.version), new Response(JSON.stringify({
      runtime: RUNTIME_ID,
      version: manifest.version,
      installedAt: new Date().toISOString(),
    }), { headers: { "Content-Type": "application/json; charset=utf-8" } }));
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
  return { version: manifest.version, installed: true, alreadyInstalled: false, requiresRuntime: null };
}

async function isReleaseReady(version) {
  if (!version) return false;
  const cache = await caches.open(cacheName(version));
  return Boolean(await cache.match(releaseReadyUrl(version)));
}

async function activateRelease(version, { requireHealthCheck }) {
  validateVersion(version);
  if (!await isReleaseReady(version)) throw new Error("Выбранный выпуск не подготовлен полностью.");
  const state = await readReleaseState();
  if (state.activeVersion === version) return state;
  const next = {
    ...state,
    previousVersion: state.activeVersion,
    activeVersion: version,
    pendingVersion: requireHealthCheck ? version : null,
    pendingAttempted: false,
  };
  await writeReleaseState(next);
  if (!requireHealthCheck) await trimReleaseCaches(next);
  return next;
}

async function confirmReleaseHealth(version) {
  const state = await readReleaseState();
  if (state.activeVersion !== version) throw new Error("Активная версия изменилась до подтверждения запуска.");
  if (state.pendingVersion === version) {
    state.pendingVersion = null;
    state.pendingAttempted = false;
    await writeReleaseState(state);
    await trimReleaseCaches(state);
  }
  return state;
}

async function rollbackRelease() {
  const state = await readReleaseState();
  if (!state.previousVersion || !await isReleaseReady(state.previousVersion)) {
    throw new Error("Предыдущая локальная версия отсутствует.");
  }
  const oldActive = state.activeVersion;
  state.activeVersion = state.previousVersion;
  state.previousVersion = oldActive;
  state.pendingVersion = null;
  state.pendingAttempted = false;
  await writeReleaseState(state);
  await trimReleaseCaches(state);
  return state;
}

async function releaseStateForNavigation() {
  const state = await readReleaseState();
  if (!state.pendingVersion) return state;
  if (!state.pendingAttempted) {
    state.pendingAttempted = true;
    return writeReleaseState(state);
  }
  return rollbackRelease();
}

async function trimReleaseCaches(state) {
  const keep = new Set([state.activeVersion, state.previousVersion].filter(Boolean).map(cacheName));
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith(RELEASE_CACHE_PREFIX) && !keep.has(key))
    .map((key) => caches.delete(key)));
}

async function installInitialRelease() {
  const state = await readReleaseState();
  if (state.activeVersion && await isReleaseReady(state.activeVersion)) return;

  try {
    const result = await installRelease(ROOT_RELEASE_MANIFEST_URL);
    if (result.requiresRuntime) throw new Error("Для устанавливаемого выпуска требуется другой Service Worker.");
    await activateRelease(result.version, { requireHealthCheck: false });
  } catch (error) {
    if (!IS_LOCAL_DEVELOPMENT) throw error;
    await installDevelopmentBootstrap();
  }
}

async function installDevelopmentBootstrap() {
  const version = "0.0.0-dev";
  const name = cacheName(version);
  await caches.delete(name);
  const cache = await caches.open(name);
  const rootUrl = SCOPE_URL.href;
  const response = await fetch(rootUrl, { cache: "reload" });
  if (!response.ok) throw new Error("Локальная оболочка разработки недоступна.");
  await cache.put(SHELL_ENTRY_URL, response.clone());
  const html = await response.text();
  const discovered = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], rootUrl))
    .filter((url) => url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_PATH));
  for (const url of discovered) {
    const asset = await fetch(url, { cache: "reload" });
    if (asset.ok) await cache.put(url.href, asset);
  }
  await cache.put(releaseReadyUrl(version), new Response(RUNTIME_ID));
  await writeReleaseState({
    ...defaultReleaseState(),
    activeVersion: version,
  });
}

async function activeReleaseCache({ navigation = false } = {}) {
  const state = navigation ? await releaseStateForNavigation() : await readReleaseState();
  if (!state.activeVersion) return null;
  const cache = await caches.open(cacheName(state.activeVersion));
  if (!await cache.match(releaseReadyUrl(state.activeVersion))) return null;
  return { cache, state };
}

async function serveShell(request) {
  if (IS_LOCAL_DEVELOPMENT) {
    try {
      const response = await fetch(request);
      if (response.ok) return response;
    } catch {
      // Fall back to the local development cache.
    }
  }

  const active = await activeReleaseCache({ navigation: request.mode === "navigate" });
  if (!active) return offlineShellResponse();
  let response = await active.cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (!response && request.mode === "navigate") {
    response = await active.cache.match(SHELL_ENTRY_URL, { ignoreVary: true });
  }
  if (!response) return offlineShellResponse(`Файл оболочки отсутствует в выпуске ${active.state.activeVersion}.`);
  if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
}

function offlineShellResponse(message = "Автономная оболочка GameSpace ещё не установлена полностью.") {
  return new Response(message, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function recoveryResponse(method) {
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#071a36"><title>Восстановление GameSpace</title>
<style>html{color-scheme:dark;background:#071a36;font:16px system-ui,sans-serif}body{max-width:680px;margin:0 auto;padding:32px 20px;color:#eef7ff}main{padding:24px;border:1px solid #407db9;border-radius:20px;background:#0b274d}h1{margin-top:0}button,a{display:inline-block;margin:8px 8px 0 0;padding:12px 16px;border:0;border-radius:10px;background:#82c7ff;color:#061426;font-weight:700;text-decoration:none}button:disabled{opacity:.45}code{color:#a6d8ff}</style></head>
<body><main><h1>Восстановление GameSpace</h1><p id="state">Проверяю локальные версии…</p>
<button id="rollback" disabled>Вернуться к предыдущей версии</button><a href="../">Открыть GameSpace</a><p id="result"></p></main>
<script>const state=document.querySelector('#state'),result=document.querySelector('#result'),button=document.querySelector('#rollback');
async function call(type,data={}){const worker=navigator.serviceWorker.controller||(await navigator.serviceWorker.ready).active;if(!worker)throw new Error('Service Worker не найден.');return new Promise((resolve,reject)=>{const channel=new MessageChannel();channel.port1.onmessage=e=>e.data?.ok?resolve(e.data):reject(new Error(e.data?.error||'Ошибка восстановления.'));worker.postMessage({type,...data},[channel.port2]);});}
async function refresh(){try{const reply=await call('GET_RUNTIME_STATE'),s=reply.state;state.innerHTML='Активная версия: <code>'+String(s.activeVersion||'—')+'</code><br>Предыдущая версия: <code>'+String(s.previousVersion||'—')+'</code>';button.disabled=!s.previousVersion;}catch(e){state.textContent=e.message;}}
button.onclick=async()=>{button.disabled=true;try{const reply=await call('ROLLBACK_RELEASE');result.textContent='Восстановлена версия '+reply.state.activeVersion+'. Откройте GameSpace.';}catch(e){result.textContent=e.message;}await refresh();};refresh();</script></body></html>`;
  return new Response(method === "HEAD" ? null : html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function readActiveContentState() {
  if (activeContentState !== undefined) return activeContentState;
  activeContentState = await readDatabaseValue(CONTENT_STATE_KEY);
  return activeContentState;
}

function safeDecodePath(pathname) {
  let relative = pathname.slice(CONTENT_PREFIX.length);
  try {
    relative = decodeURIComponent(relative);
  } catch {
    throw new Error("Некорректное кодирование URL.");
  }
  const parts = relative.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.includes("\\") || /[\0-\x1f]/.test(part))) {
    throw new Error("Небезопасный путь запроса.");
  }
  return parts;
}

async function getDirectoryAt(root, parts) {
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return directory;
}

async function resolveFile(root, baseParts, requestParts) {
  const combined = [...baseParts, ...requestParts];
  if (!combined.length) combined.push("index.html");
  const fileName = combined.at(-1);
  const directoryParts = combined.slice(0, -1);
  try {
    const directory = await getDirectoryAt(root, directoryParts);
    const handle = await directory.getFileHandle(fileName);
    return { file: await handle.getFile(), name: fileName };
  } catch (error) {
    if (error?.name !== "NotFoundError" && error?.name !== "TypeMismatchError") throw error;
  }

  try {
    const directory = await getDirectoryAt(root, combined);
    for (const name of ["index.html", "index.htm", "INDEX.HTML", "INDEX.HTM"]) {
      try {
        return { file: await (await directory.getFileHandle(name)).getFile(), name };
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
      }
    }
  } catch (error) {
    if (error?.name !== "NotFoundError" && error?.name !== "TypeMismatchError") throw error;
  }
  return null;
}

function mimeType(path) {
  const extension = path.split(".").at(-1).toLocaleLowerCase("en-US");
  return ({
    html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
    xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif", ico: "image/x-icon", avif: "image/avif",
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    wasm: "application/wasm", pdf: "application/pdf",
  })[extension] || "application/octet-stream";
}

function parseRange(header, size) {
  if (!header || !header.startsWith("bytes=")) return null;
  const match = /^(\d*)-(\d*)$/.exec(header.slice(6).trim());
  if (!match) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

async function serveContent(request, url) {
  try {
    const state = await readActiveContentState();
    if (!state?.revisionPath) return new Response("Сайт не установлен.", { status: 404 });
    const root = await navigator.storage.getDirectory();
    const requestParts = safeDecodePath(url.pathname);
    const baseParts = [state.revisionPath, state.contentRoot].filter(Boolean).flatMap((part) => part.split("/"));
    const resolved = await resolveFile(root, baseParts, requestParts);
    if (!resolved) return new Response("Файл локального сайта не найден.", { status: 404 });
    const { file } = resolved;

    const headers = new Headers({
      "Content-Type": mimeType(resolved.name),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const range = parseRange(request.headers.get("Range"), file.size);
    if (range?.invalid) {
      headers.set("Content-Range", `bytes */${file.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      const length = range.end - range.start + 1;
      headers.set("Content-Length", String(length));
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
      return new Response(request.method === "HEAD" ? null : file.slice(range.start, range.end + 1), { status: 206, headers });
    }
    headers.set("Content-Length", String(file.size));
    return new Response(request.method === "HEAD" ? null : file, { status: 200, headers });
  } catch (error) {
    return new Response(`Ошибка локального хранилища: ${error?.message || error}`, { status: 500 });
  }
}
