package ru.local.gamespace.loader;

import java.io.File;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;

/** Private flat APK cache. Neither the imported site nor its saves are addressed here. */
final class ApkUpdateFiles {
    interface Verifier { void verify(File file, AppUpdateCatalog.Release release) throws IOException; }
    private static final ReentrantLock FILE_OPERATION = new ReentrantLock();
    private final File directory;
    private final ApkUpdateTransfer transfer;
    private final Verifier verifier;
    ApkUpdateFiles(File directory, ApkUpdateTransfer transfer, Verifier verifier) {
        this.directory = directory; this.transfer = transfer; this.verifier = verifier;
    }

    File ready(AppUpdateCatalog.Release release) throws IOException { return resolveReady(directory, "ready-" + release.sha256 + ".apk"); }
    boolean hasReady(AppUpdateCatalog.Release release) {
        try { File file = ready(release); return file.isFile() && file.length() == release.size; }
        catch (IOException ignored) { return false; }
    }
    boolean hasFiles() {
        File[] entries = directory.listFiles();
        if (entries == null) return false;
        for (File file : entries) if (ownedName(file.getName())) return true;
        return false;
    }
    File download(AppUpdateCatalog.Release release, ApkUpdateTransfer.Cancellation cancellation, ApkUpdateTransfer.Progress progress) throws IOException {
        acquire();
        File partial = null;
        try {
            cancellation.check();
            ensureDirectory(); clean();
            partial = new File(directory, "download-" + UUID.randomUUID().toString() + ".part.apk");
            if (!partial.createNewFile()) throw new IOException("Не удалось создать временный APK.");
            transfer.download(release, partial, cancellation, progress);
            cancellation.check();
            verifier.verify(partial, release);
            cancellation.check();
            File ready = ready(release);
            if (ready.exists() || !partial.renameTo(ready)) throw new IOException("Не удалось сохранить проверенный APK.");
            partial = null;
            return ready;
        } finally {
            try { if (partial != null) remove(partial); }
            finally { FILE_OPERATION.unlock(); }
        }
    }
    File verifyReady(AppUpdateCatalog.Release release, ApkUpdateTransfer.Cancellation cancellation) throws IOException {
        acquire();
        try {
            File file = ready(release);
            ApkUpdateTransfer.verifyPayload(file, release, cancellation);
            verifier.verify(file, release);
            cancellation.check();
            return file;
        } finally { FILE_OPERATION.unlock(); }
    }
    void discard() throws IOException {
        acquire();
        try { if (directory.exists()) { ensureDirectory(); clean(); } }
        finally { FILE_OPERATION.unlock(); }
    }
    private void ensureDirectory() throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Не удалось создать каталог для APK.");
        checkedDirectory(directory);
    }
    private void clean() throws IOException {
        File[] files = directory.listFiles();
        if (files == null) throw new IOException("Не удалось прочитать каталог скачанных APK.");
        for (File file : files) {
            if (ownedName(file.getName())) {
                if (!file.getCanonicalFile().equals(new File(checkedDirectory(directory), file.getName())) || !file.isFile()) throw new IOException("Некорректный файл в каталоге APK.");
                remove(file);
            }
        }
    }
    private static boolean ownedName(String name) { return name.matches("ready-[0-9a-f]{64}\\.apk|download-[0-9a-f-]{36}\\.part(?:\\.apk)?"); }
    static File resolveReady(File directory, String name) throws IOException {
        if (name == null || !name.matches("ready-[0-9a-f]{64}\\.apk")) throw new IOException("Недопустимое имя APK.");
        File file = new File(directory, name);
        if (!file.getCanonicalFile().equals(new File(checkedDirectory(directory), name))) throw new IOException("Недопустимый путь APK.");
        return file;
    }
    private static File checkedDirectory(File directory) throws IOException {
        // Android may expose its trusted files root through /data/user/0 aliases.
        // Resolve that parent, but never follow a replaced app-updates directory or APK.
        File expected = new File(directory.getAbsoluteFile().getParentFile().getCanonicalFile(), directory.getName());
        if (!directory.getCanonicalFile().equals(expected)) throw new IOException("Некорректный каталог APK.");
        return expected;
    }
    private static void remove(File file) throws IOException {
        if (file.exists() && !file.delete()) throw new IOException("Не удалось удалить временный APK. Повторите операцию после закрытия установщика.");
    }
    private static void acquire() throws IOException {
        if (!FILE_OPERATION.tryLock()) throw new IOException("Предыдущая операция с APK ещё завершается. Повторите попытку.");
    }
}
