package ru.local.gamespace.loader;

public final class RuntimeEnvironmentHistoryTest {
    public static void main(String[] args) {
        final String[] saved = {""};
        final long[] now = {1_000L};
        RuntimeEnvironmentHistory.Store store = new RuntimeEnvironmentHistory.Store() {
            public String load() { return saved[0]; }
            public void save(String value) { saved[0] = value; }
        };
        RuntimeEnvironmentHistory history = new RuntimeEnvironmentHistory(store, new RuntimeEnvironmentHistory.Clock() {
            public long now() { return now[0]; }
        });
        history.observe("Android System WebView 142");
        now[0] = 2_000L;
        history.observe("Android System WebView 142");
        now[0] = 3_000L;
        history.observe("Android System WebView 143");
        check(history.size() == 2, "unchanged version extends the current period");
        String formatted = history.format();
        check(formatted.indexOf("Android System WebView 143") < formatted.indexOf("Android System WebView 142"), "new versions appear first");
        check(formatted.contains("— сейчас"), "current period ends with now");

        RuntimeEnvironmentHistory restored = new RuntimeEnvironmentHistory(store, new RuntimeEnvironmentHistory.Clock() {
            public long now() { return now[0]; }
        });
        check(restored.size() == 2, "history survives a new application process");
        for (int version = 144; version <= 170; version++) {
            now[0] += 1_000L;
            restored.observe("Android System WebView " + version);
        }
        check(restored.size() == 20, "history is bounded to twenty versions");
        check(restored.format().startsWith("Android System WebView 170"), "latest version remains first");
        System.out.println("Runtime environment history: periods, persistence and limit checks passed.");
    }

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
    }
}
