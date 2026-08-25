export const SERVICE_WORKER_RELOAD_MARKER = "gamespace-service-worker-reload-v1";

function readMarker(storage) {
  try {
    return storage?.getItem(SERVICE_WORKER_RELOAD_MARKER) || "";
  } catch {
    return "";
  }
}

function writeMarker(storage) {
  try {
    storage?.setItem(SERVICE_WORKER_RELOAD_MARKER, "1");
  } catch {
    // Reload remains useful even when sessionStorage is unavailable.
  }
}

function clearMarker(storage) {
  try {
    storage?.removeItem(SERVICE_WORKER_RELOAD_MARKER);
  } catch {
    // A missing marker only means that a repeated reload cannot be detected.
  }
}

export function waitForServiceWorkerController(serviceWorker, timeoutMs = 5_000) {
  if (serviceWorker?.controller) return Promise.resolve(true);
  if (!serviceWorker?.addEventListener) return Promise.resolve(false);

  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      serviceWorker.removeEventListener?.("controllerchange", handleControllerChange);
      resolve(Boolean(serviceWorker.controller));
    };
    const handleControllerChange = () => finish();
    const timeout = setTimeout(finish, Math.max(0, timeoutMs));
    serviceWorker.addEventListener("controllerchange", handleControllerChange);
  });
}

export async function ensureServiceWorkerControlsPage({
  serviceWorker,
  storage,
  reload,
  timeoutMs = 5_000,
}) {
  if (await waitForServiceWorkerController(serviceWorker, timeoutMs)) {
    clearMarker(storage);
    return "controlled";
  }

  if (readMarker(storage) !== "1") {
    writeMarker(storage);
    reload();
    return "reloading";
  }

  clearMarker(storage);
  throw new Error("Service Worker установлен, но не управляет страницей. Полностью закройте GameSpace и откройте его снова.");
}
