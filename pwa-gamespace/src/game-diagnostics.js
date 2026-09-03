import { safeDiagnosticText } from "./diagnostics.js";

export function diagnosticPagePath(value, base = globalThis.location?.href) {
  try {
    const url = new URL(value, base);
    return safeDiagnosticText(decodeURIComponent(url.pathname), 500);
  } catch { return "[путь недоступен]"; }
}

export function observeGameWindow(frameWindow, onIssue) {
  const seen = new Set();
  let count = 0;
  const report = (error, context) => {
    const signature = `${context.stage}:${context.resource || context.script || ""}:${error.message}`;
    if (seen.has(signature) || count >= 10) return;
    seen.add(signature);
    count += 1;
    onIssue(error, { ...context, page: diagnosticPagePath(frameWindow.location.href) });
  };
  const failure = (event) => {
    const target = event.target;
    if (target && target !== frameWindow && (target.src || target.href)) {
      report(new Error(`Не загрузился ресурс ${target.tagName || "страницы"}`), {
        stage: "game-resource", stageLabel: "Загрузка ресурса игры", resource: diagnosticPagePath(target.src || target.href, frameWindow.location.href),
      });
    } else {
      report(event.error || new Error(event.message || "Ошибка JavaScript без подробностей"), {
        stage: "game-script", stageLabel: "Выполнение JavaScript игры", script: diagnosticPagePath(event.filename || frameWindow.location.href), line: event.lineno, column: event.colno,
      });
    }
  };
  const rejection = (event) => {
    const reason = event.reason;
    // Do not serialize arbitrary rejected objects: they may contain game/user data.
    const isError = reason instanceof Error || (typeof frameWindow.Error === "function" && reason instanceof frameWindow.Error);
    report(isError ? reason : new Error(typeof reason === "string" ? safeDiagnosticText(reason, 500) : "Необработанный отказ Promise; содержимое объекта не записывается"), {
      stage: "game-promise", stageLabel: "Асинхронная операция игры",
    });
  };
  frameWindow.addEventListener("error", failure, true);
  frameWindow.addEventListener("unhandledrejection", rejection);
  return () => {
    frameWindow.removeEventListener("error", failure, true);
    frameWindow.removeEventListener("unhandledrejection", rejection);
  };
}
