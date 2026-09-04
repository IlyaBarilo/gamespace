package ru.local.gamespace.loader;

import java.util.ArrayList;

/** Time-weighted 15-second rate window, refreshed at most once per second. */
final class ProgressEstimator {
    private static final long WINDOW_MS = 15000L;
    private static final long INTERVAL_MS = 1000L;
    private final ArrayList<Sample> samples = new ArrayList<>();
    private long lastAt;
    private long lastProcessed;
    private long lastEstimateAt;
    private double speedPerSecond = -1.0;
    private long remainingMs = -1L;

    static final class Archive {
        final ProgressEstimator written = new ProgressEstimator();
        final ProgressEstimator read = new ProgressEstimator();
    }

    static final class Estimate {
        final double speedPerSecond;
        final long remainingMs;
        Estimate(double speed, long remaining) { speedPerSecond = speed; remainingMs = remaining; }
    }

    private static final class Sample {
        final long at;
        final long processed;
        Sample(long time, long value) { at = time; processed = value; }
    }

    static long now() { return System.nanoTime() / 1000000L; }

    ProgressEstimator() { this(now()); }
    ProgressEstimator(long at) { reset(at, 0L); }

    private void reset(long at, long processed) {
        lastAt = at;
        lastProcessed = processed;
        lastEstimateAt = at;
        speedPerSecond = -1.0;
        remainingMs = -1L;
        samples.clear();
        samples.add(new Sample(at, processed));
    }

    Estimate update(long processed, long total, long at) {
        processed = Math.max(0L, processed);
        total = Math.max(0L, total);
        if (processed < lastProcessed || at < lastAt) reset(at, processed);
        lastAt = at;
        lastProcessed = processed;
        if (at - lastEstimateAt >= INTERVAL_MS) {
            lastEstimateAt = at;
            samples.add(new Sample(at, processed));
            long cutoff = at - WINDOW_MS;
            while (samples.size() > 1 && samples.get(1).at <= cutoff) samples.remove(0);
            Sample first = samples.get(0);
            long startAt = Math.max(first.at, cutoff);
            double startProcessed = first.processed;
            if (first.at < cutoff && samples.size() > 1) {
                Sample next = samples.get(1);
                startProcessed += (next.processed - first.processed) * ((cutoff - first.at) / (double) (next.at - first.at));
            }
            speedPerSecond = Math.max(0.0, processed - startProcessed) * 1000.0 / (at - startAt);
            double remaining = speedPerSecond > 0.0 && total > 0L
                ? Math.max(0L, total - processed) / speedPerSecond * 1000.0 : -1.0;
            remainingMs = remaining < 0.0 ? -1L : remaining >= Long.MAX_VALUE ? Long.MAX_VALUE : (long) Math.ceil(remaining);
        }
        if (total > 0L && processed >= total) remainingMs = 0L;
        return new Estimate(speedPerSecond, remainingMs);
    }

    int sampleCount() { return samples.size(); }
}
