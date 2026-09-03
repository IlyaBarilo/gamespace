package ru.local.gamespace.loader;

import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

/** Best-effort, bounded checkpoints, independent of site data and of Android APIs. */
final class DiagnosticJournal {
    interface Store { String load(); void save(String value); }
    interface Clock { long now(); }
    private final Store store;
    private final Clock clock;
    private final List<String> trail = new ArrayList<String>();
    private String operation = "";
    private String stage = "";
    private String progress = "";
    private String currentFile = "";
    private String pending = "";
    private String warning = "";
    private long startedAt;
    private long savedAt;

    DiagnosticJournal(Store store, Clock clock) {
        this.store = store;
        this.clock = clock;
        try {
            String raw = store.load();
            if (raw != null && raw.length() <= 150000) {
                Properties data = new Properties();
                data.load(new StringReader(raw));
                if ("true".equals(data.getProperty("active"))) pending = shortText(data.getProperty("report"), 18000);
                for (int i = 0; i < 20; i++) {
                    String item = data.getProperty("trail." + i);
                    if (item != null) trail.add(shortText(item, 500));
                }
            }
        } catch (Exception ignored) { warning = "Предыдущий журнал недоступен."; }
    }

    synchronized String takePending() { String value = pending; pending = ""; return value; }

    synchronized void begin(String name) {
        operation = shortText(name, 150);
        stage = "Подготовка";
        progress = "";
        currentFile = "";
        startedAt = clock.now();
        record("Начало: " + operation, true);
    }

    synchronized void checkpoint(String phase, String detail) {
        if (operation.length() == 0) return;
        if (phase != null) stage = shortText(phase, 200);
        if (detail != null) progress = shortText(detail, 1000);
        flush(false);
    }

    synchronized void record(String action, boolean force) {
        trail.add(clock.now() + " · " + shortText(action, 450));
        while (trail.size() > 20) trail.remove(0);
        flush(force);
    }

    synchronized void file(String path) { currentFile = shortText(path, 600); }

    synchronized void finish() {
        if (operation.length() == 0) return;
        String completed = operation;
        operation = "";
        stage = "";
        progress = "";
        currentFile = "";
        record("Операция закончена: " + completed + " (результат — в журнале и последней ошибке)", true);
    }

    synchronized String snapshot() {
        StringBuilder result = new StringBuilder();
        if (operation.length() > 0) {
            result.append("Операция без отметки о завершении: ").append(operation)
                .append("\nНачало, Unix мс: ").append(startedAt).append("\nКонтрольная точка, Unix мс: ").append(savedAt)
                .append("\nПоследний этап: ").append(stage).append("\nПрогресс: ").append(progress)
                .append("\nПоследний файл: ").append(currentFile)
                .append("\nЭто последний известный этап, а не установленная причина закрытия приложения.\n");
        }
        if (warning.length() > 0) result.append(warning).append('\n');
        result.append("Последние действия (время Unix мс):\n");
        for (String item : trail) result.append(item).append('\n');
        return DiagnosticReport.bounded(result.toString());
    }

    synchronized void flush(boolean force) {
        long now = clock.now();
        if (!force && now - savedAt < 5000) return;
        savedAt = now;
        try {
            Properties data = new Properties();
            data.setProperty("active", String.valueOf(operation.length() > 0));
            data.setProperty("report", snapshot());
            for (int i = 0; i < trail.size(); i++) data.setProperty("trail." + i, trail.get(i));
            StringWriter output = new StringWriter();
            data.store(output, "GameSpace diagnostics v1");
            store.save(output.toString());
        } catch (Exception ignored) { warning = "Журнал не сохраняется; скопируйте отчёт до закрытия приложения."; }
    }

    private static String shortText(String text, int limit) {
        String safe = DiagnosticReport.safeText(text);
        return safe.length() > limit ? safe.substring(0, limit) + "…" : safe;
    }
}
