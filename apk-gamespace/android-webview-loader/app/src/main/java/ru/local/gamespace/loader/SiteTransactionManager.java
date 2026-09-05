package ru.local.gamespace.loader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Keeps full-site replacement and incremental updates recoverable across process death.
 * All working directories are siblings of site-files, so directory renames stay on one
 * filesystem. The durable marker is cleared only after the filesystem change
 * is complete.
 */
final class SiteTransactionManager {
    static final String ACTIVE_DIRECTORY_NAME = "site-files";
    static final String FULL_STAGING_DIRECTORY_NAME = ".gamespace-full-staging";
    static final String FULL_BACKUP_DIRECTORY_NAME = ".gamespace-full-backup";
    static final String UPDATE_STAGING_DIRECTORY_NAME = ".gamespace-update-staging";
    static final String UPDATE_BACKUP_DIRECTORY_NAME = ".gamespace-update-backup";
    static final String UPDATE_CREATED_DIRECTORY_NAME = ".gamespace-update-created";
    static final String UPDATE_BACKUP_TEMP_NAME = ".gamespace-update-backup.tmp";
    static final long MINIMUM_FREE_SPACE_BYTES = 512L * 1024L * 1024L;

    static final String TYPE_FULL = "full-swap";
    static final String TYPE_UPDATE = "update-merge";
    static final String PHASE_PREPARED = "prepared";
    static final String PHASE_OLD_MOVED = "old-moved";
    static final String PHASE_NEW_ACTIVE = "new-active";

    interface TransactionStore {
        String getType();
        String getBasePath();
        String getPhase();
        boolean begin(String type, String basePath, String phase);
        boolean setPhase(String phase);
        boolean clear();
    }

    interface ProgressListener {
        void onProgress(int current, int total, String path);
    }

    interface CancellationSignal {
        void throwIfCancelled() throws IOException;
    }

    static final class UpdateStoragePlan {
        final int files;
        final int replacedFiles;
        final int newFiles;
        final long sourceBytes;
        final long backupBytes;

        UpdateStoragePlan(int files, int replacedFiles, int newFiles, long sourceBytes, long backupBytes) {
            this.files = files;
            this.replacedFiles = replacedFiles;
            this.newFiles = newFiles;
            this.sourceBytes = sourceBytes;
            this.backupBytes = backupBytes;
        }

        long requiredFreeBytes() {
            return saturatedAdd(backupBytes, MINIMUM_FREE_SPACE_BYTES);
        }
    }

    private final TransactionStore store;

    SiteTransactionManager(TransactionStore store) {
        this.store = store;
    }

    boolean hasPendingTransaction() {
        return store.getType().length() > 0;
    }

    String getPendingBasePath() {
        return store.getBasePath();
    }

    File prepareFullStaging(File base) throws IOException {
        ensureNoPendingTransaction();
        cleanupKnownWorkDirectories(base);
        File staging = child(base, FULL_STAGING_DIRECTORY_NAME);
        ensureDirectory(staging);
        return staging;
    }

    File prepareUpdateStaging(File base) throws IOException {
        ensureNoPendingTransaction();
        cleanupKnownWorkDirectories(base);
        File staging = child(base, UPDATE_STAGING_DIRECTORY_NAME);
        ensureDirectory(staging);
        return staging;
    }

    File commitFullStaging(File base) throws IOException {
        File active = child(base, ACTIVE_DIRECTORY_NAME);
        File staging = child(base, FULL_STAGING_DIRECTORY_NAME);
        File backup = child(base, FULL_BACKUP_DIRECTORY_NAME);
        if (!staging.isDirectory()) {
            throw new IOException("Подготовленный каталог полной установки отсутствует.");
        }

        beginTransaction(TYPE_FULL, base, PHASE_PREPARED);
        try {
            if (active.exists() && !active.renameTo(backup)) {
                throw new IOException("Не удалось временно сохранить предыдущий сайт.");
            }
            setPhase(PHASE_OLD_MOVED);
            if (!staging.renameTo(active)) {
                throw new IOException("Не удалось включить подготовленную версию сайта.");
            }
            setPhase(PHASE_NEW_ACTIVE);
            clearTransaction();
        } catch (IOException error) {
            try {
                recoverFull(base, store.getPhase());
            } catch (IOException recoveryError) {
                error.addSuppressed(recoveryError);
            }
            throw error;
        }

        try {
            deleteRecursively(backup);
        } catch (IOException ignored) {
            // The new active site is already committed. A later preparation pass retries cleanup.
        }
        return active;
    }

    int applyPreparedUpdate(File base, ProgressListener listener) throws IOException {
        return applyPreparedUpdate(base, listener, null);
    }

    int applyPreparedUpdate(File base, ProgressListener listener, CancellationSignal cancellation) throws IOException {
        File staging = child(base, UPDATE_STAGING_DIRECTORY_NAME);
        File active = child(base, ACTIVE_DIRECTORY_NAME);
        File backup = child(base, UPDATE_BACKUP_DIRECTORY_NAME);
        File created = child(base, UPDATE_CREATED_DIRECTORY_NAME);
        if (!staging.isDirectory() || !active.isDirectory()) {
            throw new IOException("Не найдены подготовленное обновление или установленный сайт.");
        }

        List<File> sourceFiles = new ArrayList<File>();
        collectFiles(staging, sourceFiles);
        for (File source : sourceFiles) {
            if (cancellation != null) cancellation.throwIfCancelled();
            String relative = relativePath(staging, source);
            validateUpdateTarget(active, safeChild(active, relative), relative);
        }
        beginTransaction(TYPE_UPDATE, base, PHASE_PREPARED);
        try {
            for (int index = 0; index < sourceFiles.size(); index++) {
                if (cancellation != null) cancellation.throwIfCancelled();
                File source = sourceFiles.get(index);
                String relative = relativePath(staging, source);
                File target = safeChild(active, relative);
                if (target.isFile()) {
                    File backupFile = safeChild(backup, relative);
                    prepareBackup(base, target, backupFile, cancellation);
                } else {
                    File marker = safeChild(created, relative);
                    createDurableMarker(marker);
                }
                movePreparedFile(source, target);
                if (cancellation != null) cancellation.throwIfCancelled();
                if (listener != null) {
                    listener.onProgress(index + 1, sourceFiles.size(), relative);
                }
            }
            clearTransaction();
        } catch (IOException error) {
            try {
                recoverUpdate(base);
            } catch (IOException recoveryError) {
                error.addSuppressed(recoveryError);
            }
            throw error;
        }

        try {
            cleanupUpdateDirectories(base);
        } catch (IOException ignored) {
            // The update is complete and the transaction marker is already cleared.
        }
        return sourceFiles.size();
    }

    UpdateStoragePlan summarizePreparedUpdate(File base) throws IOException {
        File staging = child(base, UPDATE_STAGING_DIRECTORY_NAME);
        File active = child(base, ACTIVE_DIRECTORY_NAME);
        if (!staging.isDirectory() || !active.isDirectory()) {
            throw new IOException("Не найдены подготовленное обновление или установленный сайт.");
        }
        List<File> sourceFiles = new ArrayList<File>();
        collectFiles(staging, sourceFiles);
        int replacedFiles = 0;
        int newFiles = 0;
        long sourceBytes = 0L;
        long backupBytes = 0L;
        for (File source : sourceFiles) {
            sourceBytes = saturatedAdd(sourceBytes, source.length());
            String relative = relativePath(staging, source);
            File target = safeChild(active, relative);
            validateUpdateTarget(active, target, relative);
            if (target.isFile()) {
                replacedFiles += 1;
                backupBytes = saturatedAdd(backupBytes, target.length());
            } else {
                newFiles += 1;
            }
        }
        return new UpdateStoragePlan(sourceFiles.size(), replacedFiles, newFiles, sourceBytes, backupBytes);
    }

    private static void validateUpdateTarget(File active, File target, String relative) throws IOException {
        if (target.exists() && !target.isFile()) {
            throw new IOException("Update-архив пытается заменить каталог файлом: " + relative);
        }
        File canonicalActive = active.getCanonicalFile();
        File parent = target.getParentFile();
        while (parent != null && !parent.getCanonicalFile().equals(canonicalActive)) {
            if (parent.exists() && !parent.isDirectory()) {
                throw new IOException("Путь update-архива проходит через существующий файл: " + relative);
            }
            parent = parent.getParentFile();
        }
    }

    void recoverPendingTransaction() throws IOException {
        String type = store.getType();
        if (type.length() == 0) {
            return;
        }
        String basePath = store.getBasePath();
        if (basePath.length() == 0) {
            throw new IOException("В журнале операции отсутствует каталог данных.");
        }
        File base = new File(basePath).getCanonicalFile();
        if (TYPE_FULL.equals(type)) {
            recoverFull(base, store.getPhase());
            return;
        }
        if (TYPE_UPDATE.equals(type)) {
            recoverUpdate(base);
            return;
        }
        throw new IOException("В журнале обнаружен неизвестный тип операции: " + type);
    }

    void cleanupKnownWorkDirectories(File base) throws IOException {
        if (hasPendingTransaction()) {
            throw new IOException("Сначала требуется восстановить незавершённую операцию.");
        }
        deleteRecursively(child(base, FULL_STAGING_DIRECTORY_NAME));
        deleteRecursively(child(base, FULL_BACKUP_DIRECTORY_NAME));
        cleanupUpdateDirectories(base);
    }

    private void recoverFull(File base, String phase) throws IOException {
        File active = child(base, ACTIVE_DIRECTORY_NAME);
        File staging = child(base, FULL_STAGING_DIRECTORY_NAME);
        File backup = child(base, FULL_BACKUP_DIRECTORY_NAME);

        if (backup.exists()) {
            if (active.exists()) {
                deleteRecursively(staging);
                if (!active.renameTo(staging)) {
                    throw new IOException("Не удалось отложить незавершённую новую версию сайта.");
                }
            }
            if (!backup.renameTo(active)) {
                if (!active.exists() && staging.exists()) {
                    staging.renameTo(active);
                }
                throw new IOException("Не удалось восстановить предыдущую версию сайта.");
            }
        } else if (!PHASE_PREPARED.equals(phase) && active.exists() && !staging.exists()) {
            if (!active.renameTo(staging)) {
                throw new IOException("Не удалось отключить незавершённую первую установку.");
            }
        }

        clearTransaction();
        deleteRecursively(staging);
        deleteRecursively(backup);
    }

    private void recoverUpdate(File base) throws IOException {
        File active = child(base, ACTIVE_DIRECTORY_NAME);
        File backup = child(base, UPDATE_BACKUP_DIRECTORY_NAME);
        File created = child(base, UPDATE_CREATED_DIRECTORY_NAME);
        List<File> backupFiles = new ArrayList<File>();
        List<File> createdMarkers = new ArrayList<File>();
        collectFilesIfPresent(backup, backupFiles);
        collectFilesIfPresent(created, createdMarkers);

        IOException failure = null;
        for (File backupFile : backupFiles) {
            try {
                String relative = relativePath(backup, backupFile);
                copyFileDurable(backupFile, safeChild(active, relative));
            } catch (IOException error) {
                failure = appendFailure(failure, error);
            }
        }
        for (File marker : createdMarkers) {
            try {
                String relative = relativePath(created, marker);
                File target = safeChild(active, relative);
                if (target.exists() && !target.delete()) {
                    throw new IOException("Не удалось удалить частично созданный файл: " + relative);
                }
            } catch (IOException error) {
                failure = appendFailure(failure, error);
            }
        }
        if (failure != null) {
            throw failure;
        }

        clearTransaction();
        cleanupUpdateDirectories(base);
    }

    private void cleanupUpdateDirectories(File base) throws IOException {
        deleteRecursively(child(base, UPDATE_STAGING_DIRECTORY_NAME));
        deleteRecursively(child(base, UPDATE_BACKUP_DIRECTORY_NAME));
        deleteRecursively(child(base, UPDATE_CREATED_DIRECTORY_NAME));
        deleteRecursively(child(base, UPDATE_BACKUP_TEMP_NAME));
    }

    private static void prepareBackup(File base, File source, File backup, CancellationSignal cancellation) throws IOException {
        // Recovery enumerates only completed backups. Keep a partially copied file
        // outside that tree, including after process death or a failed close/sync.
        File temporary = child(base, UPDATE_BACKUP_TEMP_NAME);
        copyFileDurable(source, temporary, cancellation);
        if (temporary.length() != source.length()) {
            throw new IOException("Размер резервной копии не совпадает с исходным файлом.");
        }
        ensureDirectory(backup.getParentFile());
        if (!temporary.renameTo(backup)) {
            throw new IOException("Не удалось завершить подготовку резервной копии.");
        }
    }

    private void beginTransaction(String type, File base, String phase) throws IOException {
        boolean saved = store.begin(type, base.getCanonicalPath(), phase);
        if (!saved) {
            throw new IOException("Не удалось сохранить журнал файловой операции.");
        }
    }

    private void setPhase(String phase) throws IOException {
        if (!store.setPhase(phase)) {
            throw new IOException("Не удалось обновить журнал файловой операции.");
        }
    }

    private void clearTransaction() throws IOException {
        boolean saved = store.clear();
        if (!saved) {
            throw new IOException("Не удалось завершить журнал файловой операции.");
        }
    }

    private void ensureNoPendingTransaction() throws IOException {
        if (hasPendingTransaction()) {
            throw new IOException("Обнаружена незавершённая файловая операция.");
        }
    }

    private static File child(File base, String name) throws IOException {
        return safeChild(base.getCanonicalFile(), name);
    }

    private static File safeChild(File root, String relative) throws IOException {
        File canonicalRoot = root.getCanonicalFile();
        File candidate = new File(canonicalRoot, relative).getCanonicalFile();
        String boundary = canonicalRoot.getPath() + File.separator;
        if (!candidate.getPath().startsWith(boundary)) {
            throw new IOException("Небезопасный путь файловой операции: " + relative);
        }
        return candidate;
    }

    private static String relativePath(File root, File file) throws IOException {
        String boundary = root.getCanonicalPath() + File.separator;
        String path = file.getCanonicalPath();
        if (!path.startsWith(boundary)) {
            throw new IOException("Файл находится за пределами рабочего каталога.");
        }
        return path.substring(boundary.length()).replace(File.separatorChar, '/');
    }

    private static void ensureDirectory(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("Не удалось создать каталог: " + directory.getAbsolutePath());
        }
    }

    private static void collectFilesIfPresent(File directory, List<File> result) throws IOException {
        if (directory.exists()) {
            collectFiles(directory, result);
        }
    }

    private static void collectFiles(File directory, List<File> result) throws IOException {
        File[] children = directory.listFiles();
        if (children == null) {
            throw new IOException("Не удалось прочитать каталог: " + directory.getAbsolutePath());
        }
        for (File child : children) {
            if (child.isDirectory()) {
                collectFiles(child, result);
            } else if (child.isFile()) {
                result.add(child);
            }
        }
    }

    private static void copyFileDurable(File source, File target) throws IOException {
        copyFileDurable(source, target, null);
    }

    private static void copyFileDurable(File source, File target, CancellationSignal cancellation) throws IOException {
        File parent = target.getParentFile();
        if (parent != null) {
            ensureDirectory(parent);
        }
        byte[] buffer = new byte[256 * 1024];
        try (FileInputStream input = new FileInputStream(source);
             FileOutputStream output = new FileOutputStream(target, false)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (cancellation != null) cancellation.throwIfCancelled();
                output.write(buffer, 0, read);
            }
            output.flush();
            output.getFD().sync();
        }
        if (source.lastModified() > 0L) {
            target.setLastModified(source.lastModified());
        }
    }

    private static void createDurableMarker(File marker) throws IOException {
        File parent = marker.getParentFile();
        if (parent != null) {
            ensureDirectory(parent);
        }
        try (FileOutputStream output = new FileOutputStream(marker, false)) {
            output.write(1);
            output.flush();
            output.getFD().sync();
        }
    }

    private static void movePreparedFile(File source, File target) throws IOException {
        File parent = target.getParentFile();
        if (parent != null) {
            ensureDirectory(parent);
        }
        if (target.exists() && !target.delete()) {
            throw new IOException("Не удалось заменить файл: " + target.getAbsolutePath());
        }
        if (!source.renameTo(target)) {
            throw new IOException("Не удалось включить подготовленный файл: " + target.getAbsolutePath());
        }
    }

    private static void deleteRecursively(File file) throws IOException {
        if (!file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) {
                throw new IOException("Не удалось прочитать каталог для очистки: " + file.getAbsolutePath());
            }
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        if (!file.delete() && file.exists()) {
            throw new IOException("Не удалось удалить: " + file.getAbsolutePath());
        }
    }

    private static IOException appendFailure(IOException current, IOException next) {
        if (current == null) {
            return next;
        }
        current.addSuppressed(next);
        return current;
    }

    private static long saturatedAdd(long left, long right) {
        if (right > 0L && left > Long.MAX_VALUE - right) {
            return Long.MAX_VALUE;
        }
        return left + right;
    }
}
