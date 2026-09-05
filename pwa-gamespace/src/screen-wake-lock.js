export function createScreenWakeLock({
  navigator: browser = globalThis.navigator,
  document: page = globalThis.document,
  onStatus = () => {},
} = {}) {
  let active = false;
  let generation = 0;
  let pendingGeneration = null;
  let sentinel = null;

  const status = (message) => onStatus(message);
  const release = async (lock) => {
    try { await lock?.release(); } catch { /* Import and recovery must still finish. */ }
  };

  async function acquire(current = generation) {
    if (!active || current !== generation || page.visibilityState !== "visible" || sentinel || pendingGeneration === current) return;
    if (!browser?.wakeLock?.request) {
      status("Браузер не удерживает экран. Оставьте GameSpace открытым до завершения операции.");
      return;
    }
    pendingGeneration = current;
    try {
      const lock = await browser.wakeLock.request("screen");
      if (!active || current !== generation || page.visibilityState !== "visible") {
        await release(lock);
        return;
      }
      sentinel = lock;
      lock.addEventListener("release", () => {
        if (sentinel !== lock) return;
        sentinel = null;
        if (active) status("Удержание экрана снято системой. Оставьте GameSpace открытым.");
      });
      status("Экран останется включённым, пока GameSpace открыт и идёт операция.");
    } catch {
      if (active && current === generation) status("Не удалось удержать экран. Оставьте GameSpace открытым до завершения операции.");
    } finally {
      if (pendingGeneration === current) pendingGeneration = null;
    }
  }

  const visibilityChanged = () => {
    if (page.visibilityState === "visible") void acquire();
    else if (active) status("В фоне браузер может приостановить операцию. Вернитесь в GameSpace.");
  };

  return {
    start() {
      if (active) return;
      active = true;
      generation += 1;
      page.addEventListener("visibilitychange", visibilityChanged);
      void acquire();
    },
    async stop() {
      active = false;
      generation += 1;
      page.removeEventListener("visibilitychange", visibilityChanged);
      const held = sentinel;
      sentinel = null;
      status("");
      await release(held);
    },
  };
}
