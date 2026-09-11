package ru.local.gamespace.loader;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

public final class DemoImportFileTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory(java.nio.file.Paths.get(args[0]), "demo-work-test-");
        Path privateRoot = Files.createDirectory(root.resolve("no-backup"));
        Path cacheRoot = Files.createDirectory(root.resolve("cache"));
        Path installed = Files.write(privateRoot.resolve("installed-game.html"), new byte[] { 7, 8 });
        byte[] demo = { 1, 2, 3, 4 };
        Path work;
        try (DemoImportFile handle = DemoImportFile.prepare(privateRoot.toFile())) {
            work = handle.file().toPath();
            Files.write(work, demo);
            Path cached = Files.write(cacheRoot.resolve("old-cache"), new byte[] { 9 });
            Files.delete(cached);
            Files.delete(cacheRoot);
            check(Arrays.equals(demo, Files.readAllBytes(work)), "clearing cache preserves the active demo copy");
            DemoImportFile.cleanupInterrupted(privateRoot.toFile());
            check(Files.exists(work), "startup cleanup preserves an active import after Activity recreation");
            expectFailure(() -> DemoImportFile.prepare(privateRoot.toFile()), "overlapping imports are rejected");
            check(Arrays.equals(demo, Files.readAllBytes(work)), "rejected import does not overwrite the first copy");
        }
        check(!Files.exists(work), "successful import removes the temporary copy");
        check(Files.exists(installed), "cleanup preserves installed files");

        try (DemoImportFile handle = DemoImportFile.prepare(privateRoot.toFile())) {
            Files.write(handle.file().toPath(), new byte[] { 1 });
            throw new IOException("simulated copy failure");
        } catch (IOException expected) {
            check("simulated copy failure".equals(expected.getMessage()), "copy failure stays visible");
        }
        check(!Files.exists(work), "failed copy is removed before another import");

        // A file without a live handle represents a previous process that was stopped.
        Files.createDirectories(work.getParent());
        Files.write(work, demo);
        Path unrelated = Files.write(work.getParent().resolve("unrelated.txt"), new byte[] { 5 });
        DemoImportFile.cleanupInterrupted(privateRoot.toFile());
        check(!Files.exists(work), "next process removes an interrupted copy");
        check(Files.exists(unrelated) && Files.exists(installed), "startup cleanup targets only the demo copy");

        DemoImportFile handle = DemoImportFile.prepare(privateRoot.toFile());
        Files.createDirectory(work);
        Path obstruction = Files.write(work.resolve("keep.txt"), new byte[] { 6 });
        expectFailure(handle::close, "cleanup reports an unexpected directory instead of deleting it recursively");
        check(Files.exists(obstruction), "unexpected content is preserved");
        Files.delete(obstruction);
        Files.delete(work);
        try (DemoImportFile retry = DemoImportFile.prepare(privateRoot.toFile())) {
            check(retry.file() != null, "cleanup failure releases the process guard for a later retry");
        }
        Files.delete(unrelated);
        DemoImportFile.cleanupInterrupted(privateRoot.toFile());
        Files.delete(installed);
        Files.delete(privateRoot);
        Files.delete(root);
        System.out.println("Demo import work file: " + checks + " checks passed.");
    }

    private interface Action { void run() throws Exception; }
    private static void expectFailure(Action action, String message) throws Exception {
        try { action.run(); } catch (IOException expected) { checks++; return; }
        throw new AssertionError(message);
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }
}
