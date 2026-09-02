package ru.local.gamespace.loader;

import java.io.IOException;
import java.util.Arrays;

public final class DiagnosticReportTest {
    private static int checks;

    public static void main(String[] args) {
        equal("GS-NO-SPACE", DiagnosticReport.errorCode(new IOException("write", new IOException("ENOSPC")), "EXTRACT"));
        equal("GS-NO-SPACE", DiagnosticReport.errorCode(new IOException("EDQUOT"), "EXTRACT"));
        equal("GS-ACCESS", DiagnosticReport.errorCode(new SecurityException("provider denied"), "ARCHIVE-OPEN"));
        equal("GS-ACCESS", DiagnosticReport.errorCode(new IOException("EACCES (Permission denied)"), "STORAGE-CREATE"));
        equal("GS-7Z-SEEK", DiagnosticReport.errorCode(new IOException("ESPIPE (Illegal seek)"), "EXTRACT"));
        equal("GS-PATH-LENGTH", DiagnosticReport.errorCode(new IOException("ENAMETOOLONG"), "EXTRACT"));
        equal("GS-UNSAFE-PATH", DiagnosticReport.errorCode(new IOException("Небезопасный путь: ../index.html"), "EXTRACT"));
        equal("GS-ZIP-NAME", DiagnosticReport.errorCode(new IllegalArgumentException("Malformed[1]"), "EXTRACT"));
        equal("GS-INDEX-CHECK", DiagnosticReport.errorCode(new IOException("Нет index.html"), "INDEX-CHECK"));
        equal("GS-DEMO-COPY", DiagnosticReport.errorCode(new IOException(), "DEMO-COPY"));

        IOException original = new IOException("CRC check failed");
        original.addSuppressed(new IOException("close failed"));
        IOException wrapper = new IOException("outer", original);
        check(DiagnosticReport.rootCause(wrapper) == original, "Root cause must survive wrapping");
        String trace = DiagnosticReport.technicalDetails(wrapper);
        check(trace.contains("outer") && trace.contains("CRC check failed"), "Both exceptions must be retained");
        check(trace.contains("Ошибка при закрытии ресурса: java.io.IOException: close failed"), "Suppressed close failure must be retained");
        check(trace.contains("DiagnosticReportTest.java:"), "Source line numbers must be retained");

        IOException first = new IOException("first");
        IOException second = new IOException("second", first);
        first.initCause(second);
        check(DiagnosticReport.rootCause(first) == second, "Cyclic cause traversal must terminate");
        check(DiagnosticReport.technicalDetails(first).length() < 5000, "Cyclic trace must remain bounded");

        String privateMessage = "content://provider/document/private%2Fsite.7z?token=secret "
            + "https://cloud.test/file?token=secret file:///storage/private.7z";
        String safe = DiagnosticReport.safeText(privateMessage);
        check(!safe.contains("secret") && !safe.contains("private") && !safe.contains("cloud.test"), "URI and tokens must be hidden");
        check(safe.contains("[URI скрыт]"), "Redaction must be explicit");
        equal("сайт/игра/index.html", DiagnosticReport.safeText("сайт/игра/index.html"));
        check(!DiagnosticReport.safeText("a\u0000b\u202Ec").contains("\u202E"), "Control and bidi characters must be removed");
        equal("", DiagnosticReport.safeText(null));

        char[] large = new char[100000];
        Arrays.fill(large, 'x');
        String limited = DiagnosticReport.bounded(new String(large));
        check(limited.length() <= DiagnosticReport.MAX_REPORT_CHARS, "Report size cap must be enforced");
        check(limited.endsWith("[Отчёт сокращён]"), "Truncation must be visible");
        check(DiagnosticReport.technicalDetails(new IOException(new String(large))).length() < 4000, "A single exception message must be bounded");
        equal("", DiagnosticReport.technicalDetails(null));
        System.out.println("DiagnosticReport: " + checks + " checks passed.");
    }

    private static void equal(String expected, String actual) {
        check(expected.equals(actual), "Expected " + expected + ", got " + actual);
    }

    private static void check(boolean condition, String description) {
        checks++;
        if (!condition) {
            throw new AssertionError(description);
        }
    }
}
