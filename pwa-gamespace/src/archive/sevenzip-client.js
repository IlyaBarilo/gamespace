import { restoreDiagnosticError } from "../diagnostics.js";

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

export function extractSevenZip({ file, destination, requireIndex, onEvent }) {
  return new Promise((resolve, reject) => {
    onEvent?.({ type: "phase", phase: "worker-start", label: "Запускаю отдельный обработчик 7z…" });
    const worker = createSevenZipWorker();
    worker.onmessage = (event) => {
      const message = event.data;
      onEvent?.(message);
      if (message?.type === "done") {
        worker.terminate();
        resolve(message.result);
      } else if (message?.type === "error") {
        worker.terminate();
        const cause = restoreDiagnosticError(message.error || { message: message.message, stack: message.stack });
        const error = new Error(cause.message, { cause });
        if (message.diagnosticContext) error.diagnosticContext = message.diagnosticContext;
        reject(error);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error || new Error(event.message || "7z Worker аварийно завершился."));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("Не удалось прочитать ответ 7z Worker."));
    };
    try { worker.postMessage({ type: "extract", file, destination, requireIndex }); }
    catch (error) { worker.terminate(); reject(error); }
  });
}
