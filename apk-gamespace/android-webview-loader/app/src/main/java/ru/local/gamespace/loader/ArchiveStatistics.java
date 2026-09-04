package ru.local.gamespace.loader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Per-operation aggregate timers. No file contents or per-file log are retained. */
final class ArchiveStatistics {
    enum Metric {
        DECODE("Работа распаковщика, включая чтение"),
        READ("Чтение исходного архива"),
        SEEK("Позиционирование и размер источника"),
        DIRECTORY("Проверка и создание каталогов"),
        OPEN("Открытие файлов назначения"),
        WRITE("Запись распакованных данных"),
        CLOSE("Закрытие файлов назначения");
        final String label;
        Metric(String label) { this.label = label; }
    }

    interface IOAction<T> { T run() throws IOException; }
    final long[][] values = new long[Metric.values().length][4];
    final Map<String, Long> phases = new LinkedHashMap<>();
    final long started = System.nanoTime();
    long phaseAt = started;
    long finished;
    String phase = "Подготовка операции";
    int completedFiles;
    int skippedFiles;
    int attempts;

    void record(Metric metric, long at, long bytes, boolean failed) {
        long[] value = values[metric.ordinal()];
        value[0] += Math.max(0L, System.nanoTime() - at);
        value[1]++;
        value[2] += Math.max(0L, bytes);
        if (failed) value[3]++;
    }

    <T> T decode(IOAction<T> action) throws IOException {
        long at = System.nanoTime();
        boolean failed = true;
        try { T result = action.run(); failed = false; return result; }
        finally { record(Metric.DECODE, at, 0L, failed); }
    }

    void phase(String label) {
        if (finished != 0L) return;
        long at = System.nanoTime();
        Long previous = phases.get(phase);
        phases.put(phase, (previous == null ? 0L : previous) + Math.max(0L, at - phaseAt));
        phaseAt = at;
        phase = label;
    }

    void finish() {
        if (finished != 0L) return;
        phase("Завершено");
        finished = System.nanoTime();
    }

    void ensureDirectory(File directory) throws IOException {
        long at = System.nanoTime();
        boolean failed = true;
        try {
            if (!directory.exists() && !directory.mkdirs()) {
                throw new IOException("Не удалось создать каталог: " + directory.getAbsolutePath());
            }
            failed = false;
        } finally { record(Metric.DIRECTORY, at, 0L, failed); }
    }

    FileOutputStream output(File file) throws IOException {
        long at = System.nanoTime();
        boolean failed = true;
        try { FileOutputStream output = new MeasuredOutput(file); failed = false; return output; }
        finally { record(Metric.OPEN, at, 0L, failed); }
    }

    private final class MeasuredOutput extends FileOutputStream {
        MeasuredOutput(File file) throws IOException { super(file); }
        @Override public void write(byte[] bytes) throws IOException { write(bytes, 0, bytes.length); }
        @Override public void write(byte[] bytes, int offset, int length) throws IOException {
            long at = System.nanoTime();
            boolean failed = true;
            try { super.write(bytes, offset, length); failed = false; }
            finally { record(Metric.WRITE, at, failed ? 0L : length, failed); }
        }
        @Override public void write(int value) throws IOException {
            long at = System.nanoTime();
            boolean failed = true;
            try { super.write(value); failed = false; }
            finally { record(Metric.WRITE, at, failed ? 0L : 1L, failed); }
        }
        @Override public void close() throws IOException {
            long at = System.nanoTime();
            boolean failed = true;
            try { super.close(); failed = false; }
            finally { record(Metric.CLOSE, at, 0L, failed); }
        }
    }

    InputStream input(InputStream input) {
        return new FilterInputStream(input) {
            @Override public int read() throws IOException {
                long at = System.nanoTime();
                int value = -1;
                boolean failed = true;
                try { value = in.read(); failed = false; return value; }
                finally { record(Metric.READ, at, value < 0 ? 0L : 1L, failed); }
            }
            @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                long at = System.nanoTime();
                int count = 0;
                boolean failed = true;
                try { count = in.read(bytes, offset, length); failed = false; return count; }
                finally { record(Metric.READ, at, count, failed); }
            }
        };
    }

    SeekableByteChannel channel(final SeekableByteChannel channel) {
        return new SeekableByteChannel() {
            @Override public int read(ByteBuffer buffer) throws IOException {
                long at = System.nanoTime();
                int count = 0;
                boolean failed = true;
                try { count = channel.read(buffer); failed = false; return count; }
                finally { record(Metric.READ, at, count, failed); }
            }
            private long seek(IOAction<Long> action) throws IOException {
                long at = System.nanoTime();
                boolean failed = true;
                try { long result = action.run(); failed = false; return result; }
                finally { record(Metric.SEEK, at, 0L, failed); }
            }
            @Override public long position() throws IOException {
                return seek(new IOAction<Long>() { public Long run() throws IOException { return channel.position(); } });
            }
            @Override public long size() throws IOException {
                return seek(new IOAction<Long>() { public Long run() throws IOException { return channel.size(); } });
            }
            @Override public SeekableByteChannel position(long value) throws IOException {
                seek(new IOAction<Long>() { public Long run() throws IOException { channel.position(value); return value; } });
                return this;
            }
            @Override public int write(ByteBuffer buffer) throws IOException { return channel.write(buffer); }
            @Override public SeekableByteChannel truncate(long size) throws IOException { channel.truncate(size); return this; }
            @Override public boolean isOpen() { return channel.isOpen(); }
            @Override public void close() throws IOException { channel.close(); }
        };
    }

    String report(String version, String device, String archive, long archiveBytes, String format, String mode, String outcome, String source) {
        finish();
        StringBuilder text = new StringBuilder("GameSpace APK — статистика архива, формат 1\n");
        text.append("Дата: ").append(new java.util.Date()).append('\n');
        text.append("Версия: ").append(version).append("\nУстройство / ОС: ").append(device).append('\n');
        text.append("Архив: ").append(archive).append("\nРазмер архива: ").append(archiveBytes).append(" байт\n");
        text.append("Формат: ").append(format).append("\nОперация: ").append(mode).append("\nРезультат: ").append(outcome).append('\n');
        text.append("Источник: ").append(source).append('\n');
        text.append("Общее время операции: ").append(seconds(finished - started)).append('\n');
        text.append("Буфер распаковки: 262144 байт\nПопыток чтения архива: ").append(attempts).append('\n');
        text.append("Полностью записано файлов: ").append(completedFiles).append("\nПропущено актуальных файлов: ").append(skippedFiles).append('\n');
        long written = values[Metric.WRITE.ordinal()][2];
        text.append("Записано данных: ").append(written).append(" байт\n");
        Long extraction = phases.get("открытие выбранного архива");
        if (extraction == null) extraction = phases.get("открытие встроенного архива");
        if (extraction != null && extraction > 0L) {
            text.append("Обработка архива: ").append(seconds(extraction)).append('\n');
            text.append("Средняя скорость обработки: ").append(String.format(Locale.US, "%.2f", written / 1048576.0 / (extraction / 1e9))).append(" МиБ/с\n");
        }
        text.append("\nЗамеры вызовов (время; количество; переданные байты; ошибки):\n");
        for (Metric metric : Metric.values()) {
            long[] value = values[metric.ordinal()];
            text.append(metric.label).append(": ").append(seconds(value[0])).append("; ")
                .append(value[1]).append("; ").append(value[2]).append("; ").append(value[3]).append('\n');
        }
        text.append("Принудительный сброс записи: отдельный fsync не вызывается\n");
        text.append("\nЭтапы всей операции (последовательно):\n");
        for (Map.Entry<String, Long> entry : phases.entrySet()) text.append(entry.getKey()).append(": ").append(seconds(entry.getValue())).append('\n');
        text.append("\nКак читать статистику:\nВремя распаковщика включает вложенное чтение и позиционирование. Эти строки не складываются.\n")
            .append("Чтение учитывает вызовы файлового провайдера и повторные чтения; это не физический счётчик USB.\n")
            .append("Скорость рассчитана по записанным данным и времени обработки архива, включая чтение заголовков.\n")
            .append("Счётчики включают повторные попытки ZIP и выполненную часть работы при ошибке.\n")
            .append("В PWA отличаются файловые API и распаковщик. Сравнивайте один архив и одинаковый режим установки.\n")
            .append("Измерения добавляют небольшие накладные расходы; содержимое файлов не сохраняется в отчёте.\n");
        return text.toString();
    }

    private static String seconds(long nanos) { return String.format(Locale.US, "%.3f с", nanos / 1e9); }
}
