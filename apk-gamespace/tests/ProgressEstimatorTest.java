package ru.local.gamespace.loader;

/** Deterministic burst, stall and large-archive scenarios without Android. */
public final class ProgressEstimatorTest {
    private static int checks;

    public static void main(String[] args) {
        ProgressEstimator estimator = new ProgressEstimator(0L);
        close(estimator.update(100L, 1000L, 250L).speedPerSecond, -1.0, "Initial speed is unknown");
        ProgressEstimator.Estimate middle = estimator.update(500L, 1000L, 1000L);
        close(middle.speedPerSecond, 500.0, "First second rate");
        check(middle.remainingMs == 1000L, "First ETA");
        ProgressEstimator.Estimate burst = estimator.update(900L, 1000L, 1250L);
        close(burst.speedPerSecond, 500.0, "Rate held between refreshes");
        check(burst.remainingMs == 1000L, "ETA held between refreshes");
        check(estimator.update(1000L, 1000L, 1300L).remainingMs == 0L, "Completion is immediate");

        estimator = new ProgressEstimator(0L);
        estimator.update(1000L, 10000L, 1000L);
        for (long at = 1001L; at < 2000L; at++) estimator.update(1000L, 10000L, at);
        close(estimator.update(2000L, 10000L, 2000L).speedPerSecond, 1000.0, "Duplicate events do not inflate rate");

        estimator = new ProgressEstimator(0L);
        for (long second = 1L; second <= 20L; second++) estimator.update(second * 1000L, 100000L, second * 1000L);
        close(estimator.update(22000L, 100000L, 21000L).speedPerSecond, 16000.0 / 15.0, "Rate changes gradually");
        for (long second = 22L; second < 35L; second++) estimator.update(20000L + (second - 20L) * 2000L, 100000L, second * 1000L);
        ProgressEstimator.Estimate settled = estimator.update(50000L, 100000L, 35000L);
        close(settled.speedPerSecond, 2000.0, "Old rate leaves the 15-second window");
        check(settled.remainingMs == 25000L, "ETA follows the recent rate");

        estimator = new ProgressEstimator(0L);
        estimator.update(2000L, 100000L, 2000L);
        estimator.update(6000L, 100000L, 4000L);
        close(estimator.update(36000L, 100000L, 19000L).speedPerSecond, 2000.0, "Sparse events use elapsed time");
        close(estimator.update(46000L, 100000L, 21000L).speedPerSecond, 2400.0, "Window boundary is interpolated");

        estimator = new ProgressEstimator(0L);
        estimator.update(1000L, 10000L, 1000L);
        for (long second = 2L; second < 16L; second++) estimator.update(1000L, 10000L, second * 1000L);
        ProgressEstimator.Estimate paused = estimator.update(1000L, 10000L, 16000L);
        close(paused.speedPerSecond, 0.0, "Long pause reaches zero rate");
        check(paused.remainingMs == -1L, "Paused ETA is unknown");
        close(estimator.update(2500L, 10000L, 17000L).speedPerSecond, 100.0, "Resume includes the pause");

        estimator = new ProgressEstimator(0L);
        estimator.update(800L, 1000L, 1000L);
        close(estimator.update(1L, 10L, 1200L).speedPerSecond, -1.0, "Counter restart clears rate");
        close(estimator.update(6L, 10L, 2200L).speedPerSecond, 5.0, "Restart uses a new baseline");
        close(estimator.update(7L, 10L, 2100L).speedPerSecond, -1.0, "Clock reversal clears rate");
        close(estimator.update(9L, 10L, 3100L).speedPerSecond, 2.0, "Clock reversal uses a new baseline");

        estimator = new ProgressEstimator(0L);
        check(estimator.update(100L, 0L, 1000L).remainingMs == -1L, "Unknown total has no ETA");
        estimator = new ProgressEstimator(0L);
        ProgressEstimator.Estimate shortOperation = estimator.update(10L, 10L, 100L);
        check(shortOperation.remainingMs == 0L && shortOperation.speedPerSecond < 0.0, "Subsecond completion has zero ETA");

        estimator = new ProgressEstimator(0L);
        long total = 40L * 1024L * 1024L * 1024L;
        ProgressEstimator.Estimate large = null;
        for (long at = 1L; at <= 60000L; at++) large = estimator.update(at * 1024L * 1024L / 10L, total, at);
        close(large.speedPerSecond, 100.0 * 1024 * 1024, "Rate supports archives above 4 GB");
        check(large.remainingMs == 349600L, "Large archive ETA");
        check(estimator.sampleCount() <= 17, "Frequent events retain bounded samples");
        System.out.println("Progress estimator: " + checks + " checks passed.");
    }

    private static void close(double actual, double expected, String message) {
        check(Math.abs(actual - expected) < 0.001, message + ": " + actual);
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }
}
