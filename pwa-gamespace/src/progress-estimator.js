function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export class ProgressEstimator {
  constructor() {
    this.reset();
  }

  reset(now = monotonicNow()) {
    this.startedAt = now;
    this.lastAt = now;
    this.lastProcessed = 0;
    this.speedPerSecond = 0;
  }

  update(processed, total, now = monotonicNow()) {
    const safeProcessed = Math.max(0, Number(processed) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    if (safeProcessed < this.lastProcessed || now < this.lastAt) this.reset(now);

    const delta = safeProcessed - this.lastProcessed;
    const deltaMs = now - this.lastAt;
    const totalElapsedMs = now - this.startedAt;
    if (delta > 0 && deltaMs > 0 && totalElapsedMs >= 500) {
      const currentSpeed = delta * 1000 / deltaMs;
      this.speedPerSecond = this.speedPerSecond > 0
        ? this.speedPerSecond * 0.75 + currentSpeed * 0.25
        : currentSpeed;
    }

    this.lastProcessed = safeProcessed;
    this.lastAt = now;

    const speedPerSecond = this.speedPerSecond > 0 ? this.speedPerSecond : null;
    const remaining = Math.max(0, safeTotal - safeProcessed);
    const remainingMs = speedPerSecond && safeTotal > 0
      ? remaining / speedPerSecond * 1000
      : null;
    return { processed: safeProcessed, total: safeTotal, speedPerSecond, remainingMs };
  }
}
