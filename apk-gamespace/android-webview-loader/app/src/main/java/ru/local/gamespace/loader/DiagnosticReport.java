package ru.local.gamespace.loader;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Locale;
import java.util.Set;

/** Bounded, plain-text support reports; deliberately independent of Android. */
final class DiagnosticReport {
    static final int MAX_REPORT_CHARS = 24000;
    private static final String TRUNCATED = "\n[Отчёт сокращён]";

    private DiagnosticReport() { }

    static String errorCode(Throwable error, String stageCode) {
        for (Throwable current : causes(error)) {
            String message = String.valueOf(current.getMessage()).toLowerCase(Locale.US);
            if (message.contains("enospc") || message.contains("no space") || message.contains("edquot")) {
                return "GS-NO-SPACE";
            }
            if (current instanceof SecurityException || message.contains("eacces")
                || message.contains("permission denied") || message.contains("eperm")) {
                return "GS-ACCESS";
            }
            if (message.contains("espipe") || message.contains("illegal seek") || message.contains("not seekable")) {
                return "GS-7Z-SEEK";
            }
            if (message.contains("enametoolong") || message.contains("file name too long")) {
                return "GS-PATH-LENGTH";
            }
            if (message.contains("небезопасный путь")) {
                return "GS-UNSAFE-PATH";
            }
            if (message.contains("malformed")) {
                return "GS-ZIP-NAME";
            }
        }
        return "GS-" + stageCode;
    }

    static Throwable rootCause(Throwable error) {
        Throwable root = error;
        for (Throwable current : causes(error)) {
            root = current;
        }
        return root;
    }

    private static Iterable<Throwable> causes(Throwable error) {
        java.util.List<Throwable> result = new java.util.ArrayList<Throwable>();
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<Throwable, Boolean>());
        for (Throwable current = error; current != null && result.size() < 12 && seen.add(current); current = current.getCause()) {
            result.add(current);
        }
        return result;
    }

    static String safeText(String value) {
        if (value == null) {
            return "";
        }
        // Do not forward document identifiers, cloud tokens or links from provider exceptions.
        String safe = value.replace("\r\n", "\n").replaceAll("(?i)(?:content|file|https?)://[^\\s\\\"<>]+", "[URI скрыт]");
        return safe.replaceAll("[\\p{Cntrl}&&[^\\n\\t]]|[\\u202A-\\u202E\\u2066-\\u2069]", "?");
    }

    static String bounded(String value) {
        String safe = safeText(value);
        if (safe.length() <= MAX_REPORT_CHARS) {
            return safe;
        }
        return safe.substring(0, MAX_REPORT_CHARS - TRUNCATED.length()) + TRUNCATED;
    }

    static String technicalDetails(Throwable error) {
        StringBuilder text = new StringBuilder();
        int causeNumber = 0;
        for (Throwable current : causes(error)) {
            text.append(causeNumber++ == 0 ? "Исключение: " : "Причина: ");
            appendException(text, current);
            StackTraceElement[] frames = current.getStackTrace();
            for (int i = 0; i < Math.min(frames.length, 18); i++) {
                text.append("  at ").append(frames[i]).append('\n');
            }
            if (frames.length > 18) {
                text.append("  ...\n");
            }
            Throwable[] suppressed = current.getSuppressed();
            for (int i = 0; i < Math.min(suppressed.length, 3); i++) {
                text.append("Ошибка при закрытии ресурса: ");
                appendException(text, suppressed[i]);
            }
        }
        return bounded(text.toString());
    }

    private static void appendException(StringBuilder text, Throwable error) {
        text.append(error.getClass().getName()).append(": ");
        String message = safeText(error.getMessage());
        text.append(message.length() > 1500 ? message.substring(0, 1500) + "…" : message).append('\n');
    }
}
