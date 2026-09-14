package ru.local.gamespace.loader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class CompatibilityReportTest {
    private static int checks;

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        Map<String, Object> vectors = (Map<String, Object>) UpdateJson.parse(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
        List<Map<String, Object>> cases = (List<Map<String, Object>>) vectors.get("cases");
        // Locale must not affect decimal separators, date digits or checksum case.
        Locale previous = Locale.getDefault();
        try {
            for (String language : new String[] {"ru-RU", "en-US", "ar-EG", "tr-TR"}) {
                Locale.setDefault(Locale.forLanguageTag(language));
                for (Map<String, Object> fixture : cases) {
                    Map<String, Object> input = (Map<String, Object>) fixture.get("input");
                    equal(fixture.get("body"), CompatibilityReport.body(input));
                    equal(fixture.get("text"), CompatibilityReport.create(input));
                    equal(fixture.get("code"), CompatibilityReport.code((String) fixture.get("body")));
                    equal(fixture.get("sha256"), sha((String) fixture.get("body")));
                }
            }
        } finally { Locale.setDefault(previous); }
        for (Map<String, Object> fixture : (List<Map<String, Object>>) vectors.get("normalization")) {
            equal(fixture.get("code"), CompatibilityReport.code((String) fixture.get("text")));
            equal(fixture.get("sha256"), sha((String) fixture.get("text")));
        }
        for (Map<String, Object> fixture : (List<Map<String, Object>>) vectors.get("numbers")) {
            equal(fixture.get("expected"), CompatibilityReport.bytes(fixture.get("bytes")));
        }
        Map<String, Object> good = (Map<String, Object>) cases.get(0).get("input");
        for (Object[] patch : new Object[][] {
            {"launchMode", "browser"}, {"appVersion", "v0.4"}, {"variant", "EXE"},
            {"utcOffsetMinutes", 841L}, {"formedAtMs", -1L}, {"formedAtMs", 253402300800000L},
            {"error", "quota"}, {"model", "\ud800"}, {"archiveFormat", "RAR"}, {"archiveFiles", -1L}
        }) {
            final Map<String, Object> input = new HashMap<String, Object>(good);
            input.put((String) patch[0], patch[1]);
            rejects(new Runnable() { public void run() { CompatibilityReport.create(input); } });
        }
        for (String bad : new String[] {"not_checked", "recorded"}) {
            final Map<String, Object> input = new HashMap<String, Object>(good);
            Map<String, Object> steps = new HashMap<String, Object>((Map<String, Object>) good.get("steps"));
            steps.put("import", bad);
            input.put("steps", steps);
            rejects(new Runnable() { public void run() { CompatibilityReport.create(input); } });
        }
        for (final Object number : new Object[] {-1L, 1.5, "1024", 9007199254740992L}) {
            rejects(new Runnable() { public void run() { CompatibilityReport.bytes(number); } });
        }
        final Map<String, Object> badError = new HashMap<String, Object>(good);
        Map<String, Object> failedSteps = new HashMap<String, Object>();
        failedSteps.put("launch", "success"); failedSteps.put("import", "error");
        badError.put("steps", failedSteps); badError.put("error", "/private/path/raw exception");
        rejects(new Runnable() { public void run() { CompatibilityReport.create(badError); } });
        badError.remove("error");
        if (!CompatibilityReport.body(badError).contains("код: GS-CHECK-ERROR")) throw new AssertionError("No safe fallback.");
        Map<String, Object> privateFields = new HashMap<String, Object>(good);
        privateFields.put("archivePath", "C:\\private\\archive.7z");
        privateFields.put("diagnosticLog", "private log");
        String snapshot = CompatibilityReport.create(privateFields);
        privateFields.put("model", "changed");
        equal(cases.get(0).get("text"), snapshot);
        equal(vectors.get("formUrl"), CompatibilityReport.FORM_URL);
        String body = (String) cases.get(0).get("body");
        equal(cases.get(0).get("code"), CompatibilityReport.code(body.replace("\r\n", "   \n\t")));
        for (String changed : new String[] {body + ".", body + "\u200b", body + "\ufeff", body.replace("0.4.0", "0.4.1")}) {
            if (CompatibilityReport.code(changed).equals(cases.get(0).get("code"))) throw new AssertionError("Altered text accepted.");
            checks++;
        }
        System.out.println("GS1: " + checks + " checks passed (8 reference reports, 4 locales, Unicode and invalid inputs).");
    }

    private static String sha(String text) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(CompatibilityReport.normalize(text).getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return hex.toString();
    }

    private static void equal(Object expected, Object actual) {
        if (!expected.equals(actual)) throw new AssertionError("Expected: " + expected + "\nActual: " + actual);
        checks++;
    }

    private static void rejects(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { checks++; return; }
        throw new AssertionError("Invalid input accepted.");
    }
}
