package ru.local.gamespace.loader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public final class SiteTransactionManagerTest {
    private static int checks;

    private static final class MemoryStore implements SiteTransactionManager.TransactionStore {
        String type = "";
        String basePath = "";
        String phase = SiteTransactionManager.PHASE_PREPARED;

        @Override public String getType() { return type; }
        @Override public String getBasePath() { return basePath; }
        @Override public String getPhase() { return phase; }
        @Override public boolean begin(String nextType, String nextBasePath, String nextPhase) {
            type = nextType;
            basePath = nextBasePath;
            phase = nextPhase;
            return true;
        }
        @Override public boolean setPhase(String nextPhase) { phase = nextPhase; return true; }
        @Override public boolean clear() { type = ""; basePath = ""; phase = SiteTransactionManager.PHASE_PREPARED; return true; }
    }

    private static void check(boolean value, String label) {
        if (!value) {
            throw new AssertionError(label);
        }
        checks++;
    }

    private static File child(File root, String relative) {
        return new File(root, relative.replace('/', File.separatorChar));
    }

    private static void write(File root, String relative, String value) throws Exception {
        File file = child(root, relative);
        File parent = file.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
            throw new IllegalStateException("Cannot create test directory: " + parent);
        }
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(value.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String read(File root, String relative) throws Exception {
        File file = child(root, relative);
        byte[] data = new byte[(int) file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < data.length) {
                int read = input.read(data, offset, data.length - offset);
                if (read < 0) break;
                offset += read;
            }
        }
        return new String(data, StandardCharsets.UTF_8);
    }

    private static void testFullSwap(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        write(active, "index.html", "old");
        File staging = manager.prepareFullStaging(root);
        write(staging, "new/index.html", "new");

        File committed = manager.commitFullStaging(root);
        check(committed.getCanonicalFile().equals(active.getCanonicalFile()), "full swap returns active directory");
        check("new".equals(read(active, "new/index.html")), "full swap activates prepared revision");
        check(!child(active, "index.html").exists(), "full swap removes files absent from revision");
        check(!manager.hasPendingTransaction(), "full swap clears transaction marker");
        check(!child(root, SiteTransactionManager.FULL_BACKUP_DIRECTORY_NAME).exists(), "full swap removes backup after commit");
    }

    private static void testInterruptedFullSwapRecovery(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        File backup = child(root, SiteTransactionManager.FULL_BACKUP_DIRECTORY_NAME);
        File staging = child(root, SiteTransactionManager.FULL_STAGING_DIRECTORY_NAME);
        write(active, "index.html", "old");
        write(staging, "index.html", "new");
        check(active.renameTo(backup), "test can simulate old revision move");
        store.begin(SiteTransactionManager.TYPE_FULL, root.getCanonicalPath(), SiteTransactionManager.PHASE_OLD_MOVED);

        manager.recoverPendingTransaction();
        check("old".equals(read(active, "index.html")), "recovery restores old full revision");
        check(!staging.exists() && !backup.exists(), "recovery removes incomplete full revision artifacts");
        check(!manager.hasPendingTransaction(), "full recovery clears marker");
    }

    private static void testInterruptedFirstInstallRecovery(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        write(active, "index.html", "incomplete-first-install");
        store.begin(SiteTransactionManager.TYPE_FULL, root.getCanonicalPath(), SiteTransactionManager.PHASE_NEW_ACTIVE);

        manager.recoverPendingTransaction();
        check(!active.exists(), "recovery removes interrupted first installation");
        check(!manager.hasPendingTransaction(), "first-install recovery clears marker");
    }

    private static void testUpdateCommit(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        write(active, "index.html", "old-index");
        write(active, "keep.txt", "keep");
        File staging = manager.prepareUpdateStaging(root);
        write(staging, "index.html", "replacement-even-without-newer-timestamp");
        write(staging, "new/file.txt", "new");

        SiteTransactionManager.UpdateStoragePlan plan = manager.summarizePreparedUpdate(root);
        check(plan.files == 2 && plan.replacedFiles == 1 && plan.newFiles == 1, "update storage plan counts file actions");
        check(plan.sourceBytes == 43L && plan.backupBytes == 9L, "update storage plan counts staged and rollback bytes");
        check(plan.requiredFreeBytes() == SiteTransactionManager.MINIMUM_FREE_SPACE_BYTES + 9L, "update storage plan includes safety reserve");

        int applied = manager.applyPreparedUpdate(root, null);
        check(applied == 2, "update reports applied files");
        check("replacement-even-without-newer-timestamp".equals(read(active, "index.html")), "update replaces every listed file");
        check("keep".equals(read(active, "keep.txt")), "update keeps files absent from archive");
        check("new".equals(read(active, "new/file.txt")), "update adds new files");
        check(!manager.hasPendingTransaction(), "update clears transaction marker");
        check(!staging.exists(), "update removes staging after commit");
    }

    private static void testInterruptedUpdateRecovery(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        File backup = child(root, SiteTransactionManager.UPDATE_BACKUP_DIRECTORY_NAME);
        File created = child(root, SiteTransactionManager.UPDATE_CREATED_DIRECTORY_NAME);
        write(active, "index.html", "partially-updated");
        write(active, "new/file.txt", "partial-new");
        write(backup, "index.html", "old-index");
        write(created, "new/file.txt", "marker");
        store.begin(SiteTransactionManager.TYPE_UPDATE, root.getCanonicalPath(), SiteTransactionManager.PHASE_PREPARED);

        manager.recoverPendingTransaction();
        check("old-index".equals(read(active, "index.html")), "update recovery restores replaced file");
        check(!child(active, "new/file.txt").exists(), "update recovery removes newly created file");
        check(!manager.hasPendingTransaction(), "update recovery clears marker");
        check(!backup.exists() && !created.exists(), "update recovery removes rollback artifacts");
    }

    private static void testUpdateRejectsDirectoryConflictBeforeTransaction(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        write(active, "folder/keep.txt", "keep");
        File staging = manager.prepareUpdateStaging(root);
        write(staging, "folder", "replacement-file");
        try {
            manager.summarizePreparedUpdate(root);
            throw new AssertionError("directory conflict must fail");
        } catch (Exception error) {
            check(error.getMessage().contains("заменить каталог файлом"), "directory conflict has a clear error");
        }
        check(!manager.hasPendingTransaction(), "directory conflict is rejected before journal creation");
        check("keep".equals(read(active, "folder/keep.txt")), "directory conflict preserves active content");
    }

    private static void testCancelledUpdateRollsBack(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        write(active, "index.html", "old-index");
        File staging = manager.prepareUpdateStaging(root);
        write(staging, "index.html", "new-index");
        write(staging, "new/file.txt", "new-file");
        final int[] checksBeforeCancellation = {0};
        try {
            manager.applyPreparedUpdate(root, null, new SiteTransactionManager.CancellationSignal() {
                @Override
                public void throwIfCancelled() throws java.io.IOException {
                    checksBeforeCancellation[0] += 1;
                    if (checksBeforeCancellation[0] >= 5) {
                        throw new java.io.IOException("cancelled by test");
                    }
                }
            });
            throw new AssertionError("cancelled update must fail");
        } catch (java.io.IOException error) {
            check(error.getMessage().contains("cancelled by test"), "cancellation cause is retained");
        }
        check("old-index".equals(read(active, "index.html")), "cancelled update restores replaced file");
        check(!child(active, "new/file.txt").exists(), "cancelled update removes newly created file");
        check(!manager.hasPendingTransaction(), "cancelled update clears transaction marker after rollback");
    }

    private static void testInterruptedBackupPreservesOriginal(File root) throws Exception {
        for (final int cancelAt : new int[] {3, 4}) {
            File base = child(root, "cancel-" + cancelAt);
            MemoryStore store = new MemoryStore();
            SiteTransactionManager manager = new SiteTransactionManager(store);
            File active = child(base, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
            byte[] original = new byte[600000];
            java.util.Arrays.fill(original, (byte) 65);
            active.mkdirs();
            Files.write(child(active, "index.html").toPath(), original);
            write(manager.prepareUpdateStaging(base), "index.html", "new");
            final int[] calls = {0};
            try {
                manager.applyPreparedUpdate(base, null, new SiteTransactionManager.CancellationSignal() {
                    @Override public void throwIfCancelled() throws java.io.IOException {
                        if (++calls[0] == cancelAt) throw new java.io.IOException("cancelled during backup");
                    }
                });
                throw new AssertionError("backup cancellation must fail");
            } catch (java.io.IOException expected) {
                check(expected.getMessage().contains("cancelled during backup"), "backup cancellation cause retained");
            }
            check(java.util.Arrays.equals(original, Files.readAllBytes(child(active, "index.html").toPath())), "incomplete backup never replaces original");
            check(!manager.hasPendingTransaction(), "safe cancellation clears journal");
            check(!child(base, SiteTransactionManager.UPDATE_BACKUP_TEMP_NAME).exists(), "incomplete backup is cleaned");
        }
    }

    private static void testProcessDeathDuringBackup(File root) throws Exception {
        MemoryStore store = new MemoryStore();
        SiteTransactionManager manager = new SiteTransactionManager(store);
        File active = child(root, SiteTransactionManager.ACTIVE_DIRECTORY_NAME);
        write(active, "index.html", "already-updated");
        write(active, "large.bin", "original-large-file");
        write(child(root, SiteTransactionManager.UPDATE_BACKUP_DIRECTORY_NAME), "index.html", "old-index");
        write(root, SiteTransactionManager.UPDATE_BACKUP_TEMP_NAME, "partial-backup");
        store.begin(SiteTransactionManager.TYPE_UPDATE, root.getCanonicalPath(), SiteTransactionManager.PHASE_PREPARED);
        new SiteTransactionManager(store).recoverPendingTransaction();
        check("old-index".equals(read(active, "index.html")), "completed backup restores earlier replacement");
        check("original-large-file".equals(read(active, "large.bin")), "process death leaves file with incomplete backup intact");
        check(!child(root, SiteTransactionManager.UPDATE_BACKUP_TEMP_NAME).exists(), "recovery discards unpublished backup");
    }

    public static void main(String[] args) throws Exception {
        File parent = args.length == 0 ? new File(".") : new File(args[0]);
        File suite = Files.createTempDirectory(parent.toPath(), "site-transaction-").toFile();
        try {
            testFullSwap(child(suite, "full-commit"));
            testInterruptedFullSwapRecovery(child(suite, "full-recovery"));
            testInterruptedFirstInstallRecovery(child(suite, "first-install-recovery"));
            testUpdateCommit(child(suite, "update-commit"));
            testInterruptedUpdateRecovery(child(suite, "update-recovery"));
            testUpdateRejectsDirectoryConflictBeforeTransaction(child(suite, "update-directory-conflict"));
            testCancelledUpdateRollsBack(child(suite, "update-cancellation"));
            testInterruptedBackupPreservesOriginal(child(suite, "backup-cancellation"));
            testProcessDeathDuringBackup(child(suite, "backup-process-death"));
            System.out.println("Site transactions: " + checks + " checks passed.");
        } finally {
            delete(suite);
        }
    }

    private static void delete(File file) throws Exception {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) delete(child);
        }
        if (!file.delete() && file.exists()) {
            throw new IllegalStateException("Cannot delete test path: " + file);
        }
    }
}
