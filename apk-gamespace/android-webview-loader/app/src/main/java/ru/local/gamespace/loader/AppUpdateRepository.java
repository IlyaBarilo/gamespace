package ru.local.gamespace.loader;

import java.io.IOException;

/** Successful checks replace the cached snapshot; failed checks preserve it. */
final class AppUpdateRepository {
    interface Store {
        String readJson();
        long readTime();
        boolean save(String json, long checkedAt);
    }
    private final Store store;
    private final AppUpdateClient client;
    private volatile Snapshot current;

    AppUpdateRepository(Store store, AppUpdateClient client) { this.store = store; this.client = client; }

    Snapshot current() { return current; }

    void loadCached() throws IOException {
        try {
            String json = store.readJson();
            long checkedAt = store.readTime();
            if (json == null || json.length() == 0) return;
            if (checkedAt <= 0) throw UpdateJson.invalid();
            current = new Snapshot(AppUpdateCatalog.parse(json), checkedAt, true);
        } catch (RuntimeException error) { throw new IOException("Не удалось прочитать сохранённый результат проверки.", error); }
    }

    Snapshot check() throws IOException {
        String json = client.fetch();
        AppUpdateCatalog catalog = AppUpdateCatalog.parse(json);
        if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("Проверка отменена.");
        long checkedAt = System.currentTimeMillis();
        boolean saved;
        try { saved = store.save(json, checkedAt); }
        catch (RuntimeException error) { saved = false; }
        Snapshot result = new Snapshot(catalog, checkedAt, saved);
        current = result;
        return result;
    }

    static final class Snapshot {
        final AppUpdateCatalog catalog;
        final long checkedAt;
        final boolean saved;
        Snapshot(AppUpdateCatalog catalog, long checkedAt, boolean saved) {
            this.catalog = catalog; this.checkedAt = checkedAt; this.saved = saved;
        }
    }
}
