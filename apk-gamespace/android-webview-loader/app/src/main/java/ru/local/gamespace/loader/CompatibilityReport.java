package ru.local.gamespace.loader;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/** Platform-independent GS1 text contract. No network, device access or diagnostic log export. */
final class CompatibilityReport {
    static final String FORM_URL = "https://forms.yandex.ru/u/6aa7f1166d2d732f54bbcdc3/";
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;
    private static final String[] KEYS = {"launch", "import", "storefront", "game"};
    private static final String[] STAGES = {"запуск приложения", "импорт архива", "загрузка витрины", "переход в игру"};
    private static final String[][] STATES = {
        {"success", "успешно"}, {"recorded", "зафиксирован"}, {"not_performed", "не выполнено"},
        {"not_checked", "не проверено"}, {"error", "ошибка"}, {"interrupted", "прервано"}
    };
    // Safe descriptions only. Raw exception messages and paths must never be supplied here.
    private static final String[][] ERRORS = {
        {"demo", "GS-DEMO", "не удалось получить встроенный демо-архив", "повторите загрузку встроенного демо или выберите свой архив"},
        {"page", "GS-PAGE", "не удалось загрузить страницу витрины или игры", "повторите открытие страницы, затем начните новую проверку"},
        {"script", "GS-SCRIPT", "зафиксирована ошибка JavaScript страницы", "повторите действие, подробности доступны в отдельном отчёте о проблеме"},
        {"resource", "GS-RESOURCE", "не удалось загрузить ресурс страницы", "проверьте полноту архива или повторите проверку со встроенным демо"},
        {"timeout", "GS-LOAD-TIMEOUT", "страница не завершила загрузку за 30 секунд", "дождитесь загрузки или повторите открытие, затем начните новую проверку"},
        {"quota", "QuotaExceededError", "превышена квота хранилища браузера", "проверьте доступное хранилище в GameSpace и повторите импорт после освобождения места"},
        {"space", "GS-STORAGE-SPACE", "недостаточно места для операции", "освободите место на устройстве и повторите импорт"},
        {"archive", "GS-ARCHIVE", "не удалось прочитать или распаковать архив", "проверьте архив и повторите импорт, для базовой проверки можно использовать встроенное демо"},
        {"index", "GS-INDEX-CHECK", "не найдена стартовая HTML-страница", "проверьте структуру архива или установите встроенное демо"},
        {"access", "GS-ACCESS", "нет доступа к необходимым данным", "проверьте доступ к архиву и хранилищу и повторите действие"},
        {"other", "GS-CHECK-ERROR", "зафиксирован сбой на указанном этапе", "повторите указанный этап, подробности доступны в отдельном отчёте о проблеме"}
    };

    private CompatibilityReport() { }

    private static boolean space(char c) {
        return (c >= '\u0009' && c <= '\r') || c == ' ' || c == '\u0085' || c == '\u00a0'
            || c == '\u1680' || (c >= '\u2000' && c <= '\u200a') || c == '\u2028' || c == '\u2029'
            || c == '\u202f' || c == '\u205f' || c == '\u3000';
    }

    private static String unicode(String text) {
        if (text == null) throw invalid();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i >= text.length() || !Character.isLowSurrogate(text.charAt(i))) throw invalid();
            } else if (Character.isLowSurrogate(c)) throw invalid();
        }
        return text;
    }

    static String normalize(String text) {
        unicode(text);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < text.length(); i++) if (!space(text.charAt(i))) out.append(text.charAt(i));
        return out.toString();
    }

    private static String value(Object raw) {
        if (raw == null) return "?";
        if (!(raw instanceof String) || ((String) raw).length() > 512) throw invalid();
        String text = unicode((String) raw);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (space(c)) c = ' ';
            else if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x202a && c <= 0x202e)
                || (c >= 0x2066 && c <= 0x2069)) c = '\ufffd';
            if (c != ' ' || (out.length() > 0 && out.charAt(out.length() - 1) != ' ')) out.append(c);
        }
        if (out.length() > 0 && out.charAt(out.length() - 1) == ' ') out.setLength(out.length() - 1);
        String single = out.toString();
        if (single.isEmpty()) return "?";
        return single.indexOf(';') >= 0 || single.indexOf('"') >= 0 ? "\"" + single.replace("\"", "\"\"") + "\"" : single;
    }

    private static Long integer(Object raw) {
        if (raw == null) return null;
        if (!(raw instanceof Long) && !(raw instanceof Integer)) throw invalid();
        long number = ((Number) raw).longValue();
        if (number < 0 || number > MAX_SAFE_INTEGER) throw invalid();
        return number;
    }

    private static String choice(Object key, String[][] options, String fallback) {
        if (key == null && fallback != null) return fallback;
        for (String[] option : options) if (option[0].equals(key)) return option[1];
        throw invalid();
    }

    private static String decimalTenths(long number) {
        return Long.toString(number / 10) + (number % 10 == 0 ? "" : "," + number % 10);
    }

    static String bytes(Object raw) {
        Long number = integer(raw);
        if (number == null) return "?";
        String[] units = {"Б", "КБ", "МБ", "ГБ", "ТБ"};
        long divisor = 1;
        int unit = 0;
        while (number >= divisor * 1024 && unit < units.length - 1) { divisor *= 1024; unit++; }
        if (unit == 0) return number + " Б";
        long tenths = (number / divisor) * 10 + ((number % divisor) * 10 + divisor / 2) / divisor;
        return decimalTenths(tenths) + " " + units[unit];
    }

    private static String duration(Object raw) {
        Long number = integer(raw);
        if (number == null) return "?";
        if (number > 0 && number < 100) return "<0,1 с";
        return decimalTenths(number / 100 + (number % 100 >= 50 ? 1 : 0)) + " с";
    }

    private static String timestamp(Object raw, Object rawOffset) {
        Long milliseconds = integer(raw);
        if (milliseconds == null || (!(rawOffset instanceof Integer) && !(rawOffset instanceof Long))) throw invalid();
        long offset = ((Number) rawOffset).longValue();
        if (Math.abs(offset) > 840 || offset < -840) throw invalid();
        long shifted = milliseconds + offset * 60000;
        if (shifted < 0 || shifted > 253402300799999L) throw invalid();
        SimpleDateFormat format = new SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(shifted)) + String.format(Locale.ROOT, " (UTC%s%02d:%02d)",
            offset < 0 ? "-" : "+", Math.abs(offset) / 60, Math.abs(offset) % 60);
    }

    static String body(Map<String, ?> input) {
        String variant = choice(input.get("variant"), new String[][] {{"APK", "APK"}, {"PWA", "PWA"}}, null);
        String launchMode = choice(input.get("launchMode"), new String[][] {{"installed", "установленное приложение"}, {"browser", "вкладка браузера"}}, null);
        boolean installed = "installed".equals(input.get("launchMode"));
        if ("APK".equals(variant) && !installed) throw invalid();
        Object version = input.get("appVersion");
        if (!(version instanceof String) || !((String) version).matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) throw invalid();
        Object rawSteps = input.get("steps");
        if (rawSteps != null && !(rawSteps instanceof Map)) throw invalid();
        Map<?, ?> raw = (Map<?, ?>) rawSteps;
        String[] steps = new String[4];
        String[] labels = new String[4];
        boolean completed = true;
        int failure = -1;
        for (int i = 0; i < KEYS.length; i++) {
            Object state = raw == null ? null : raw.get(KEYS[i]);
            if (state == null) state = "not_performed";
            labels[i] = choice(state, STATES, null);
            steps[i] = (String) state;
            boolean stepCompleted = (i == 3 ? "recorded" : "success").equals(state);
            if (("recorded".equals(state) && i != 3) || ("success".equals(state) && i == 3) || (stepCompleted && !completed)) throw invalid();
            completed = completed && stepCompleted;
            if ("error".equals(state)) { if (failure != -1) throw invalid(); failure = i; }
        }
        String[] error = null;
        if (failure == -1 && input.get("error") != null) throw invalid();
        if (failure != -1) {
            Object code = input.get("error") == null ? "other" : input.get("error");
            for (String[] candidate : ERRORS) if (candidate[0].equals(code)) error = candidate;
            if (error == null) throw invalid();
        }
        Long files = integer(input.get("archiveFiles"));
        List<String> lines = new ArrayList<String>();
        lines.add("GameSpace — базовая проверка совместимости");
        lines.add("ФОРМАТ: 1");
        lines.add("СФОРМИРОВАН: " + timestamp(input.get("formedAtMs"), input.get("utcOffsetMinutes")));
        lines.add("ПРИЛОЖЕНИЕ: вариант: " + variant + "; версия: " + version + "; запуск: " + launchMode);
        lines.add("УСТРОЙСТВО: производитель: " + value(input.get("manufacturer")) + "; модель: " + value(input.get("model")));
        lines.add("СИСТЕМА: название: " + value(input.get("systemName")) + "; версия: " + value(input.get("systemVersion")) + "; базовая ОС: " + value(input.get("baseOs")) + "; версия базовой ОС: " + value(input.get("baseOsVersion")));
        lines.add("СРЕДА: название: " + value(input.get("environmentName")) + "; версия: " + value(input.get("environmentVersion")));
        lines.add("ХРАНИЛИЩЕ: режим: " + ("APK".equals(variant) ? "-" : choice(input.get("storageMode"), new String[][] {{"persistent", "постоянное"}, {"ordinary", "обычное"}}, "?")));
        lines.add("АРХИВ: источник: " + choice(input.get("archiveSource"), new String[][] {{"demo", "демо-архив"}, {"user", "пользовательский архив"}}, "?")
            + "; формат: " + choice(input.get("archiveFormat"), new String[][] {{"7z", "7z"}, {"ZIP", "ZIP"}, {"ZIP64", "ZIP64"}}, "?")
            + "; размер: " + bytes(input.get("archiveBytes")) + "; файлов: " + ("success".equals(steps[1]) && files != null ? files.toString() : "?")
            + "; время импорта: " + duration(input.get("importDurationMs")));
        lines.add("ПРОВЕРКА: запуск приложения: " + labels[0] + "; импорт: " + labels[1] + "; загрузка витрины: " + labels[2] + "; переход в игру внутри GameSpace: " + labels[3]);
        if (error != null) lines.add("ОШИБКА: этап: " + STAGES[failure] + "; код: " + error[1] + "; описание: " + error[2]);
        boolean complete = completed && installed;
        lines.add("ИТОГ: " + (error != null ? "базовая проверка завершилась ошибкой" : complete ? "базовая проверка пройдена" : "базовая проверка не завершена"));
        if (!complete || error != null) {
            String next = !installed || !"success".equals(steps[0]) ? "запустите установленное приложение и начните новую проверку"
                : !"success".equals(steps[1]) ? "импортируйте встроенное демо или свой архив в рамках текущей проверки"
                : !"success".equals(steps[2]) ? "откройте витрину установленного сайта в GameSpace"
                : "перейдите из витрины в одну из игр внутри GameSpace";
            lines.add("ДЕЙСТВИЯ: " + (error != null ? error[3] : next));
        }
        StringBuilder out = new StringBuilder();
        for (String line : lines) { if (out.length() != 0) out.append("\r\n"); out.append(line); }
        return out.toString();
    }

    static String code(String body) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(normalize(body).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            return "GS1-" + hex.substring(29, 35).toUpperCase(Locale.ROOT);
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException("SHA-256 недоступен.", error); }
    }

    static String create(Map<String, ?> input) {
        String text = body(input);
        return text + "\r\nЦелостность текста: " + code(text);
    }

    private static IllegalArgumentException invalid() { return new IllegalArgumentException("Некорректные данные GS1."); }
}
