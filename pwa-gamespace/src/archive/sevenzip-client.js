import { restoreDiagnosticError } from "../diagnostics.js";
import { createAbortError, throwIfAborted } from "../abort.js";

export function createSevenZipWorker() {
  return new Worker(new URL("./7z-worker.js", import.meta.url), { type: "module", name: "gamespace-7z" });
}

export function probeSevenZipSupport() {
  return new Promise((resolve) => {
    const worker = createSevenZipWorker();
    const timeout = setTimeout(() => {
      worker.terminate();
      resolve({ supported: false, reason: "Проверка 7z превысила время ожидания." });
    }, 15_000);
    worker.onmessage = (event) => {
      if (!["probe-result", "error"].includes(event.data?.type)) return;
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data.type === "error" ? { supported: false, reason: event.data.error?.message || event.data.message || "Ошибка проверки 7z." } : event.data);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      resolve({ supported: false, reason: "Не удалось запустить 7z Worker." });
    };
    try { worker.postMessage({ type: "probe" }); }
    catch (error) {
      clearTimeout(timeout);
      worker.terminate();
      resolve({ supported: false, reason: error?.message || "Не удалось проверить 7z." });
    }
  });
}

export function extractSevenZip({ file, destination, requireIndex, onEvent, signal }) {
  return new Promise((resolve, reject) => {
    try { throwIfAborted(signal); }
    catch (error) { reject(error); return; }
    onEvent?.({ type: "phase", phase: "worker-start", label: "Запускаю отдельный обработчик 7z…" });
    const worker = createSevenZipWorker();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      callback(value);
    };
    const abort = () => finish(reject, signal?.reason instanceof Error ? signal.reason : createAbortError());
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      const message = event.data;
      onEvent?.(message);
      if (message?.type === "done") {
        finish(resolve, message.result);
      } else if (message?.type === "error") {
        const cause = restoreDiagnosticError(message.error || { message: message.message, stack: message.stack });
        const error = new Error(cause.message, { cause });
        if (message.diagnosticContext) error.diagnosticContext = message.diagnosticContext;
        finish(reject, error);
      }
    };
    worker.onerror = (event) => {
      finish(reject, event.error || new Error(event.message || "7z Worker аварийно завершился."));
    };
    worker.onmessageerror = () => {
      finish(reject, new Error("Не удалось прочитать ответ 7z Worker."));
    };
    try { worker.postMessage({ type: "extract", file, destination, requireIndex }); }
    catch (error) { finish(reject, error); }
  });
}
