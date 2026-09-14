package ru.local.gamespace.loader;

import java.util.Map;

public final class CompatibilityCheckTest {
    private static int checks;
    private static final class Memory implements CompatibilityCheck.Store {
        String text = ""; boolean available = true;
        public String load() { return text; }
        public boolean save(String value) { if (!available) return false; text = value; return true; }
    }
    private static CompatibilityCheck make(Memory store) { return new CompatibilityCheck(store, "0.4.0", "WebView 100"); }
    @SuppressWarnings("unchecked")
    private static String step(CompatibilityCheck check, String name) {
        return (String) ((Map<String, Object>) check.input(10000, 0).get("steps")).get(name);
    }
    private static String report(CompatibilityCheck check) { return CompatibilityReport.create(check.input(10000, 0)); }
    private static void equal(Object expected, Object actual) {
        checks++; if (!expected.equals(actual)) throw new AssertionError(expected + " != " + actual);
    }
    private static void contains(String text, String fragment) { checks++; if (!text.contains(fragment)) throw new AssertionError(fragment + " not in " + text); }
    public static void main(String[] args) {
        Memory store = new Memory(); CompatibilityCheck check = make(store);
        check.reconcileContent("already-installed"); check.pageLoaded(true);
        equal("not_performed", step(check, "import"));
        String ticket = check.beginImport("demo", 1000);
        check.archive(ticket, 1859372, "7z"); check.imported(ticket, "demo:1", 45, 8000, false);
        check.pageLoaded(false); equal("not_performed", step(check, "game"));
        check.pageLoaded(true); check.pageLoaded(false);
        contains(report(check), "ИТОГ: базовая проверка пройдена");
        equal("recorded", step(make(store), "game"));
        String frozen = report(check);
        check.pageError(false, "page"); check.pageLoaded(false);
        contains(report(check), "этап: переход в игру; код: GS-PAGE;");
        contains(frozen, "ИТОГ: базовая проверка пройдена");
        equal("error", step(make(store), "game"));
        check.reconcileContent("demo:2"); equal("not_performed", step(check, "import"));

        for (String[] error : new String[][] {{"demo", "GS-DEMO"}, {"page", "GS-PAGE"}, {"script", "GS-SCRIPT"}, {"resource", "GS-RESOURCE"}, {"timeout", "GS-LOAD-TIMEOUT"}}) {
            check = make(new Memory()); ticket = check.beginImport("demo", 1000);
            if (!"demo".equals(error[0])) { check.imported(ticket, "demo:1", 45, 8000, false); check.pageLoaded(true); }
            check.fail(ticket, "demo".equals(error[0]) ? "import" : "game", error[0], false, 9000);
            contains(report(check), "код: " + error[1] + ";");
            contains(report(check), "ФОРМАТ: 1");
            contains(report(check), "Целостность текста: GS1-");
        }
        check = make(new Memory()); check.pageError(true, "page");
        contains(report(check), "импорт: не выполнено; загрузка витрины: ошибка");

        store = new Memory(); check = make(store);
        String old = check.beginImport("demo", 1000); ticket = check.beginImport("user", 2000);
        check.fail(old, "import", "demo", false, 3000); check.imported(old, "old", 1, 1, false);
        equal("not_checked", step(check, "import"));
        check.fail(ticket, "import", "archive", false, 3000); check.imported(ticket, "new", 1, 1, false);
        equal("error", step(check, "import"));
        ticket = check.beginImport("demo", 4000);
        equal("interrupted", step(make(store), "import"));
        check.imported(ticket, "demo:1", 45, 8000, true); equal("not_performed", step(check, "import"));
        ticket = check.beginImport("demo", 1000); check.imported(ticket, "demo:1", 45, 8000, false);
        equal("not_performed", step(new CompatibilityCheck(store, "0.4.1", "WebView 100"), "import"));
        check.bindEnvironment("WebView 101"); equal("not_performed", step(check, "import"));
        store.available = false; check.pageError(true, "page");
        contains(report(check), "код: GS-PAGE"); contains(check.guidance(), "не удалось сохранить");
        System.out.println("Compatibility observation checks: " + checks);
    }
}
