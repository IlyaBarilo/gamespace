package ru.local.gamespace.loader;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;

/** Owns only the temporary copy of the bundled demo, outside Android's cache. */
final class DemoImportFile implements Closeable {
    private static final String DIRECTORY = "builtin-demo-import";
    private static final String NAME = "demo.7z";
    // Activity recreation must not delete a file still being read by this process.
    private static DemoImportFile active;
    private final File file;
    private boolean closed;

    private DemoImportFile(File file) { this.file = file; }

    static synchronized DemoImportFile prepare(File privateRoot) throws IOException {
        if (active != null) throw new IOException("Установка встроенного демо уже выполняется.");
        File file = workFile(privateRoot);
        remove(file);
        File directory = file.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Не удалось создать рабочий каталог встроенного демо.");
        }
        active = new DemoImportFile(file);
        return active;
    }

    static synchronized void cleanupInterrupted(File privateRoot) throws IOException {
        File file = workFile(privateRoot);
        if (active != null && active.file.equals(file)) return;
        remove(file);
    }

    File file() { return file; }

    @Override public void close() throws IOException {
        synchronized (DemoImportFile.class) {
            if (closed) return;
            try {
                remove(file);
            } finally {
                closed = true;
                if (active == this) active = null;
            }
        }
    }

    private static File workFile(File privateRoot) throws IOException {
        if (privateRoot == null) throw new IOException("Постоянное хранилище приложения недоступно.");
        File root = privateRoot.getCanonicalFile();
        File directory = new File(root, DIRECTORY).getCanonicalFile();
        File file = new File(directory, NAME).getCanonicalFile();
        if (!root.equals(directory.getParentFile()) || !directory.equals(file.getParentFile())) {
            throw new IOException("Неожиданный путь временного архива демо.");
        }
        return file;
    }

    private static void remove(File file) throws IOException {
        if (file.exists() && (!file.isFile() || !file.delete())) {
            throw new IOException("Не удалось удалить временную копию встроенного демо.");
        }
        File directory = file.getParentFile();
        String[] remaining = directory.list();
        if (remaining != null && remaining.length == 0) directory.delete();
    }
}
