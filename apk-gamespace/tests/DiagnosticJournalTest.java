package ru.local.gamespace.loader;

import java.util.Properties;
import java.io.StringReader;

public final class DiagnosticJournalTest {
    private static int checks;
    private static class Memory implements DiagnosticJournal.Store {
        String value = ""; int writes; boolean denied;
        public String load() { return value; }
        public void save(String text) { if (denied) throw new SecurityException("denied"); value = text; writes++; }
    }
    private static class Clock implements DiagnosticJournal.Clock { long time = 10000; public long now() { return time; } }
    private static void check(boolean result, String label) { if (!result) throw new AssertionError(label); checks++; }
    public static void main(String[] args) throws Exception {
        Memory memory = new Memory(); Clock clock = new Clock();
        DiagnosticJournal journal = new DiagnosticJournal(memory, clock);
        check(journal.takePending().isEmpty(), "new install has no interrupted operation");
        journal.begin("установка site.7z");
        check(memory.writes == 1, "begin saved immediately");
        journal.checkpoint("запись файла", "game/data.bin; bytes=4096");
        check(memory.writes == 1, "frequent progress does not write storage");
        clock.time += 5000;
        journal.checkpoint("запись файла", "game/data.bin; bytes=8192");
        check(memory.writes == 2, "checkpoint after five seconds");
        DiagnosticJournal restarted = new DiagnosticJournal(memory, clock);
        String pending = restarted.takePending();
        check(pending.contains("установка site.7z") && pending.contains("game/data.bin") && pending.contains("8192"), "restart retains stage, file and progress");
        check(restarted.takePending().isEmpty(), "pending consumed once");
        check(pending.contains("не установленная причина"), "no speculative cause");
        journal.finish();
        check(new DiagnosticJournal(memory, clock).takePending().isEmpty(), "finished operation is not interrupted");
        for (int i = 0; i < 100; i++) journal.record("action " + i, false);
        check(!journal.snapshot().contains("action 79\n") && journal.snapshot().contains("action 99"), "bounded 20 action history");
        journal.record("https://example.test/a?token=SECRET", true);
        check(!journal.snapshot().contains("SECRET"), "URL credentials redacted");
        memory.denied = true;
        journal.begin("ошибка хранилища");
        check(journal.snapshot().contains("Журнал не сохраняется"), "storage denial keeps in-memory report");
        Properties data = new Properties(); data.load(new StringReader(memory.value));
        check(data.size() <= 22, "bounded persisted fields");
        Memory large = new Memory();
        DiagnosticJournal largeJournal = new DiagnosticJournal(large, clock);
        largeJournal.begin("архив");
        largeJournal.file("game/large.bin");
        String russian = String.join("", java.util.Collections.nCopies(500, "я"));
        for (int i = 0; i < 20; i++) largeJournal.record(russian, false);
        largeJournal.checkpoint("запись", "1 ГБ");
        largeJournal.flush(true);
        String restored = new DiagnosticJournal(large, clock).takePending();
        check(restored.contains("game/large.bin"), "filename survives progress and full Unicode journal serialization");
        System.out.println("Diagnostic journal: " + checks + " checks passed.");
    }
}
