package ru.local.gamespace.loader;

import java.io.ByteArrayInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ArchiveStatisticsTest {
    public static void main(String[] args) throws Exception {
        ArchiveStatistics stats = new ArchiveStatistics();
        InputStream input = stats.input(new ByteArrayInputStream(new byte[5]));
        check(input.read() == 0, "single byte read");
        check(input.read(new byte[8]) == 4, "bulk read");
        check(input.read() == -1, "EOF");
        check(stats.values[ArchiveStatistics.Metric.READ.ordinal()][2] == 5, "no double counting / EOF bytes");
        IOException original = new IOException("source failed");
        InputStream broken = stats.input(new InputStream() {
            public int read() throws IOException { throw original; }
        });
        try { broken.read(); throw new AssertionError("read must fail"); }
        catch (IOException error) { check(error == original, "original read failure retained"); }
        check(stats.values[ArchiveStatistics.Metric.READ.ordinal()][3] == 1, "failed read counted");

        Path directory = Files.createTempDirectory(java.nio.file.Paths.get(args[0]), "statistics-");
        Path file = directory.resolve("output.bin");
        try (FileOutputStream output = stats.output(file.toFile())) {
            output.write(new byte[] {1, 2, 3});
            output.write(4);
        }
        check(stats.values[ArchiveStatistics.Metric.WRITE.ordinal()][2] == 4, "output bytes counted exactly once");
        check(Files.size(file) == 4, "output unchanged");
        try (SeekableByteChannel channel = stats.channel(Files.newByteChannel(file))) {
            check(channel.read(ByteBuffer.allocate(2)) == 2, "channel read");
            channel.position(0);
            check(channel.read(ByteBuffer.allocate(4)) == 4, "reread");
            check(channel.size() == 4, "channel size");
        }
        check(stats.values[ArchiveStatistics.Metric.READ.ordinal()][2] == 11, "actual repeated reads counted");
        check(stats.values[ArchiveStatistics.Metric.SEEK.ordinal()][1] == 2, "seeks counted");
        stats.phase("проверка результата");
        String report = stats.report("test", "JVM", "fixture.7z", 4, "7z", "полная установка", "ошибка", "test");
        check(report.contains("Результат: ошибка") && report.contains("вложенное чтение"), "report includes outcome and timing semantics");
        int phases = stats.phases.size();
        stats.finish();
        check(stats.phases.size() == phases, "finish is idempotent");
        System.out.println("Archive statistics: byte counters, errors, seek and report checks passed.");
    }
    private static void check(boolean condition, String label) { if (!condition) throw new AssertionError(label); }
}
