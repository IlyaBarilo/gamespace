package ru.local.gamespace.loader;

import java.io.StringReader;
import java.io.StringWriter;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

/** Persisted observations only. Existing files are never retroactively counted as an observed import. */
final class CompatibilityCheck {
    interface Store { String load(); boolean save(String text); }
    private static final String[] ORDER = {"launch", "import", "storefront", "game"};
    private final Store store;
    private final String version;
    private String context;
    private String token = "";
    private String contentKey = "";
    private String source;
    private String format;
    private Long bytes, files, duration;
    private final Map<String, Object> steps = new HashMap<String, Object>();
    private String error;
    private String note = "";
    private String warning = "";
    private boolean pending, sawStorefront;
    private long startedAt;

    CompatibilityCheck(Store store, String version, String environment) {
        this.store = store; this.version = version; this.context = version + "|" + environment;
        fresh("");
        try {
            String raw = store.load();
            if (raw != null && raw.length() > 16000) throw new IllegalArgumentException();
            if (raw != null && !raw.isEmpty()) {
                Properties p = new Properties(); p.load(new StringReader(raw));
                if (!"1".equals(p.getProperty("schema"))) throw new IllegalArgumentException();
                if (context.equals(p.getProperty("context"))) {
                    token = p.getProperty("token", ""); contentKey = p.getProperty("content", "");
                    source = p.getProperty("source"); format = p.getProperty("format");
                    bytes = number(p.getProperty("bytes")); files = number(p.getProperty("files")); duration = number(p.getProperty("duration"));
                    error = p.getProperty("error"); note = p.getProperty("note", "");
                    for (String step : ORDER) steps.put(step, p.getProperty(step, "not_performed"));
                    pending = Boolean.parseBoolean(p.getProperty("pending"));
                    CompatibilityReport.body(input(0, 0));
                    if (pending) { pending = false; steps.put("import", "interrupted"); error = null; duration = null;
                        steps.put("storefront", "not_checked"); steps.put("game", "not_checked");
                        note = "Предыдущий импорт не имеет отметки об успешном завершении. Причина прерывания неизвестна."; }
                } else fresh("Версия приложения или среда запуска изменилась. Нужна новая проверка.");
            }
        } catch (Exception unavailable) { fresh("Сохранённая проверка недоступна. Начните новую проверку."); }
        save();
    }

    synchronized void bindEnvironment(String environment) {
        String next = version + "|" + environment;
        if (!next.equals(context)) { context = next; reset("Среда запуска изменилась. Нужна новая проверка."); }
    }

    private void fresh(String message) {
        token = UUID.randomUUID().toString(); contentKey = ""; source = format = error = null;
        bytes = files = duration = null; pending = sawStorefront = false; startedAt = 0; note = message;
        for (String step : ORDER) steps.put(step, "not_performed"); steps.put("launch", "success");
    }
    synchronized void reset(String message) { fresh(message); save(); }

    synchronized String beginImport(String source, long now) {
        fresh("Начало импорта зафиксировано. Его успешное завершение пока не подтверждено.");
        this.source = source; pending = true; startedAt = now;
        steps.put("import", "not_checked"); steps.put("storefront", "not_checked"); steps.put("game", "not_checked");
        save(); return token;
    }
    synchronized void archive(String ticket, long size, String type) {
        if (!token.equals(ticket) || !pending) return;
        bytes = size < 0 ? null : size; format = type; save();
    }
    synchronized void imported(String ticket, String key, long fileCount, long elapsed, boolean update) {
        if (!token.equals(ticket) || !pending) return;
        if (update) { reset("Сайт обновлён. Для базовой проверки выполните полную установку демо или своего архива."); return; }
        pending = false; contentKey = key; files = fileCount; duration = elapsed;
        steps.put("import", "success"); steps.put("storefront", "not_performed"); steps.put("game", "not_performed");
        note = "Импорт завершён. Откройте витрину и перейдите в игру."; save();
    }
    synchronized void fail(String ticket, String stage, String category, boolean interrupted, long now) {
        if (ticket != null && !token.equals(ticket)) return;
        int index = -1;
        for (int i = 0; i < ORDER.length; i++) {
            if (ORDER[i].equals(stage)) index = i;
            if ("error".equals(steps.get(ORDER[i])) && index == -1) return;
        }
        if (index < 0) return;
        pending = false;
        if ("import".equals(stage)) duration = startedAt > 0 ? Math.max(0, now - startedAt) : null;
        steps.put(stage, interrupted ? "interrupted" : "error");
        for (int i = index + 1; i < ORDER.length; i++) steps.put(ORDER[i], "not_checked");
        error = interrupted ? null : category;
        note = interrupted ? "Операция прервана. Её успешное завершение не подтверждено."
            : "Зафиксирована ошибка. Её этап и краткое описание включены в отчёт.";
        save();
    }
    synchronized void reconcileContent(String key) {
        if (!pending && !contentKey.isEmpty() && !contentKey.equals(key)) reset("Установленное содержимое изменилось или удалено. Нужна новая проверка.");
    }
    synchronized void pageLoaded(boolean index) {
        if (!"success".equals(steps.get("import")) || error != null) return;
        if (index) { steps.put("storefront", "success"); sawStorefront = true; }
        else if (sawStorefront && "success".equals(steps.get("storefront"))) { steps.put("game", "recorded"); sawStorefront = false; }
        note = ""; save();
    }
    synchronized void pageError(boolean index, String category) {
        if (!pending) fail(null, index ? "storefront" : "game", category, false, System.currentTimeMillis());
    }
    synchronized Map<String, Object> input(long now, int offset) {
        Map<String, Object> input = new HashMap<String, Object>();
        input.put("variant", "APK"); input.put("appVersion", version); input.put("launchMode", "installed");
        input.put("formedAtMs", now); input.put("utcOffsetMinutes", offset);
        input.put("steps", new HashMap<String, Object>(steps)); input.put("error", error);
        input.put("archiveSource", source); input.put("archiveFormat", format); input.put("archiveBytes", bytes);
        input.put("archiveFiles", files); input.put("importDurationMs", duration);
        return input;
    }
    synchronized String guidance() {
        StringBuilder out = new StringBuilder(error != null ? "Зафиксирована ошибка. Неполный отчёт тоже можно отправить."
            : "recorded".equals(steps.get("game")) ? "Базовая проверка пройдена. Можно отправить отчёт."
            : "Базовая проверка пока не пройдена полностью. Отчёт можно отправить уже сейчас.");
        String[] titles = {"Запуск приложения", "Импорт архива", "Загрузка витрины", "Переход в игру"};
        String[] help = {"Откройте установленный GameSpace.", "Закройте окно и установите демо или свой архив. Дождитесь завершения полной установки.",
            "Дождитесь появления витрины игр после установки архива.", "Откройте одну игру из витрины внутри GameSpace. Проходить игру не требуется."};
        for (int i = 0; i < ORDER.length; i++) out.append("\n\n").append(i + 1).append(". ").append(titles[i]).append(": ")
            .append(label((String) steps.get(ORDER[i]))).append("\n").append(help[i]);
        if (!note.isEmpty()) out.append("\n\n").append(note);
        if (!warning.isEmpty()) out.append("\n\n").append(warning);
        return out.toString();
    }
    private static String label(String state) {
        if ("success".equals(state)) return "выполнено";
        if ("recorded".equals(state)) return "зафиксирован";
        if ("error".equals(state)) return "ошибка";
        if ("interrupted".equals(state)) return "прервано";
        return "not_checked".equals(state) ? "пока не проверено" : "пока не выполнено";
    }
    private static Long number(String text) { return text == null ? null : Long.valueOf(text); }
    private static void put(Properties p, String key, Object value) { if (value != null) p.setProperty(key, value.toString()); }
    private void save() {
        try {
            Properties p = new Properties();
            put(p, "schema", 1); put(p, "context", context); put(p, "token", token); put(p, "content", contentKey);
            put(p, "source", source); put(p, "format", format); put(p, "bytes", bytes); put(p, "files", files);
            put(p, "duration", duration); put(p, "error", error); put(p, "note", note); put(p, "pending", pending);
            for (String step : ORDER) put(p, step, steps.get(step));
            StringWriter out = new StringWriter(); p.store(out, null);
            if (!store.save(out.toString())) throw new IllegalStateException();
        } catch (Exception unavailable) { warning = "Проверку не удалось сохранить. Скопируйте отчёт до закрытия приложения."; }
    }
}
