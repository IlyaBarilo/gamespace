package ru.local.gamespace.loader;

import java.io.StringReader;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

/** Last observed WebView versions and their actual GameSpace usage periods. */
final class RuntimeEnvironmentHistory {
    interface Store { String load(); void save(String value); }
    interface Clock { long now(); }
    private static final int LIMIT = 20;

    private static final class Entry {
        String label;
        long firstSeen;
        long lastSeen;

        Entry(String label, long firstSeen, long lastSeen) {
            this.label = label;
            this.firstSeen = firstSeen;
            this.lastSeen = lastSeen;
        }
    }

    private final Store store;
    private final Clock clock;
    private final List<Entry> entries = new ArrayList<Entry>();
    private String warning = "";

    RuntimeEnvironmentHistory(Store store, Clock clock) {
        this.store = store;
        this.clock = clock;
        load();
    }

    synchronized void observe(String environment) {
        String label = DiagnosticReport.safeText(environment).replace('\n', ' ');
        if (label.length() > 300) label = label.substring(0, 300);
        if (label.length() == 0) label = "Android WebView — сведения недоступны";
        long now = clock.now();
        if (!entries.isEmpty() && entries.get(0).label.equals(label)) {
            entries.get(0).lastSeen = Math.max(entries.get(0).lastSeen, now);
        } else {
            entries.add(0, new Entry(label, now, now));
            while (entries.size() > LIMIT) entries.remove(entries.size() - 1);
        }
        save();
    }

    synchronized String format() {
        if (entries.isEmpty()) return warning.length() == 0 ? "История пока пуста." : warning;
        StringBuilder text = new StringBuilder();
        SimpleDateFormat format = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.US);
        for (int i = 0; i < entries.size(); i++) {
            Entry entry = entries.get(i);
            if (i > 0) text.append("\n\n");
            text.append(entry.label).append('\n').append(format.format(new Date(entry.firstSeen)))
                .append(" — ").append(i == 0 ? "сейчас" : format.format(new Date(entry.lastSeen)));
        }
        if (warning.length() > 0) text.append("\n\n").append(warning);
        return DiagnosticReport.bounded(text.toString());
    }

    synchronized int size() {
        return entries.size();
    }

    private void load() {
        try {
            String raw = store.load();
            if (raw == null || raw.length() == 0) return;
            if (raw.length() > 30000) throw new IllegalArgumentException("History is too large");
            Properties data = new Properties();
            data.load(new StringReader(raw));
            if (!"1".equals(data.getProperty("schema"))) throw new IllegalArgumentException("Unknown schema");
            int count = Math.min(LIMIT, Integer.parseInt(data.getProperty("count", "0")));
            for (int i = 0; i < count; i++) {
                String label = data.getProperty("entry." + i + ".label", "");
                long firstSeen = Long.parseLong(data.getProperty("entry." + i + ".first", "0"));
                long lastSeen = Long.parseLong(data.getProperty("entry." + i + ".last", "0"));
                if (label.length() > 0 && firstSeen > 0L && lastSeen >= firstSeen) {
                    entries.add(new Entry(label.substring(0, Math.min(300, label.length())), firstSeen, lastSeen));
                }
            }
        } catch (Exception unavailable) {
            entries.clear();
            warning = "Сохранённая история среды запуска недоступна; история начата заново.";
        }
    }

    private void save() {
        try {
            Properties data = new Properties();
            data.setProperty("schema", "1");
            data.setProperty("count", String.valueOf(entries.size()));
            for (int i = 0; i < entries.size(); i++) {
                Entry entry = entries.get(i);
                data.setProperty("entry." + i + ".label", entry.label);
                data.setProperty("entry." + i + ".first", String.valueOf(entry.firstSeen));
                data.setProperty("entry." + i + ".last", String.valueOf(entry.lastSeen));
            }
            StringWriter output = new StringWriter();
            data.store(output, "GameSpace runtime environment history v1");
            store.save(output.toString());
        } catch (Exception unavailable) {
            warning = "История доступна до закрытия приложения: сохранить её на устройстве не удалось.";
        }
    }
}
