function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

const WINDOW_MS = 15_000;
const UPDATE_INTERVAL_MS = 1000;
const nonnegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export class ProgressEstimator {
  constructor() {
    this.reset();
  }

  reset(now = monotonicNow(), processed = 0) {
    this.lastAt = now;
    this.lastProcessed = processed;
    this.lastEstimateAt = now;
    this.samples = [{ at: now, processed }];
    this.speedPerSecond = null;
    this.remainingMs = null;
    this.complete = false;
  }

  update(processed, total, now = monotonicNow()) {
    const safeProcessed = nonnegative(processed);
    const safeTotal = nonnegative(total);
    if (!Number.isFinite(now)) now = this.lastAt;
    const restarted = safeProcessed < this.lastProcessed || now < this.lastAt;
    if (restarted) this.reset(now, safeProcessed);
    this.lastProcessed = safeProcessed;
    this.lastAt = now;

    let updated = restarted;
    if (now - this.lastEstimateAt >= UPDATE_INTERVAL_MS) {
      this.lastEstimateAt = now;
      // At most one sample per second; retain the sample preceding the window
      // boundary so irregular event intervals can be interpolated by time.
      this.samples.push({ at: now, processed: safeProcessed });
      const cutoff = now - WINDOW_MS;
      while (this.samples.length > 1 && this.samples[1].at <= cutoff) this.samples.shift();
      const first = this.samples[0];
      const next = this.samples[1];
      const startAt = Math.max(first.at, cutoff);
      const startProcessed = first.at < cutoff && next
        ? first.processed + (next.processed - first.processed) * (cutoff - first.at) / (next.at - first.at)
        : first.processed;
      this.speedPerSecond = Math.max(0, safeProcessed - startProcessed) * 1000 / (now - startAt);
      this.remainingMs = this.speedPerSecond > 0 && safeTotal > 0
        ? Math.max(0, safeTotal - safeProcessed) / this.speedPerSecond * 1000
        : null;
      updated = true;
    }
    const complete = safeTotal > 0 && safeProcessed >= safeTotal;
    if (complete) {
      this.remainingMs = 0;
      if (!this.complete) updated = true;
    }
    this.complete = complete;
    return {
      processed: safeProcessed, total: safeTotal, speedPerSecond: this.speedPerSecond,
      remainingMs: this.remainingMs, updated,
    };
  }
}
