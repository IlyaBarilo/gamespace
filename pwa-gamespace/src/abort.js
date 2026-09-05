export function createAbortError(message = "Операция отменена пользователем.") {
  return new DOMException(message, "AbortError");
}

export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : createAbortError();
}

export function isAbortError(error) {
  return error?.name === "AbortError";
}
