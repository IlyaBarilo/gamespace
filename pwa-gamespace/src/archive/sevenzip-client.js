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
      if (event.data?.type !== "probe-result") return;
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      resolve({ supported: false, reason: "Не удалось запустить 7z Worker." });
    };
    worker.postMessage({ type: "probe" });
  });
}

export function extractSevenZip({ file, destination, requireIndex, onEvent }) {
  return new Promise((resolve, reject) => {
    const worker = createSevenZipWorker();
    worker.onmessage = (event) => {
      const message = event.data;
      onEvent?.(message);
      if (message?.type === "done") {
        worker.terminate();
        resolve(message.result);
      } else if (message?.type === "error") {
        worker.terminate();
        reject(new Error(message.message || "Ошибка распаковки 7z."));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "7z Worker аварийно завершился."));
    };
    worker.postMessage({ type: "extract", file, destination, requireIndex });
  });
}
