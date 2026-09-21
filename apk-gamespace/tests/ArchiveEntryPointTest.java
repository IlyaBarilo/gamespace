package ru.local.gamespace.loader;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ArchiveEntryPointTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        Path base = new File(args[0], "archive-entry-point").toPath();
        deleteTree(base.toFile());
        Files.createDirectories(base);

        Path rootIndex = fixture(base, "root-index");
        write(rootIndex, "index.html");
        write(rootIndex, "start.html");
        write(rootIndex.resolve("bundle"), "index.html");
        equal("index.html", ArchiveEntryPoint.find(rootIndex.toFile()), "root index wins over other HTML files and directories");

        Path rootHtml = fixture(base, "root-html");
        write(rootHtml, "START.HTML");
        write(rootHtml.resolve("bundle"), "index.html");
        equal("START.HTML", ArchiveEntryPoint.find(rootHtml.toFile()), "single root HTML wins before directory search");

        Path blockedDirectory = fixture(base, "blocked-directory");
        write(blockedDirectory, "readme.txt");
        write(blockedDirectory.resolve("bundle"), "index.html");
        equal(null, ArchiveEntryPoint.find(blockedDirectory.toFile()), "regular root file blocks directory search");

        Path directoryIndex = fixture(base, "directory-index");
        write(directoryIndex.resolve("bundle"), "index.html");
        write(directoryIndex.resolve("bundle"), "game.html");
        equal("index.html", ArchiveEntryPoint.find(directoryIndex.toFile()), "index wins inside the only directory");

        Path directoryHtml = fixture(base, "directory-html");
        write(directoryHtml.resolve("bundle"), "game.html");
        write(directoryHtml.resolve("bundle/assets"), "image.png");
        equal("game.html", ArchiveEntryPoint.find(directoryHtml.toFile()), "single HTML starts inside the only directory");

        Path serviceFiles = fixture(base, "service-files");
        write(serviceFiles, ".DS_Store");
        write(serviceFiles, "Thumbs.db");
        write(serviceFiles, "desktop.ini");
        write(serviceFiles.resolve("__MACOSX"), "metadata");
        write(serviceFiles.resolve(".hidden"), "file.txt");
        write(serviceFiles.resolve("bundle"), "game.html");
        equal("game.html", ArchiveEntryPoint.find(serviceFiles.toFile()), "hidden and system entries do not block the only directory");

        Path ambiguousRoot = fixture(base, "ambiguous-root");
        write(ambiguousRoot, "first.html");
        write(ambiguousRoot, "second.html");
        equal(null, ArchiveEntryPoint.find(ambiguousRoot.toFile()), "multiple root HTML files are rejected");

        Path multipleDirectories = fixture(base, "multiple-directories");
        write(multipleDirectories.resolve("one"), "index.html");
        write(multipleDirectories.resolve("two"), "asset.png");
        equal(null, ArchiveEntryPoint.find(multipleDirectories.toFile()), "multiple top directories are rejected");

        Path nestedIndex = fixture(base, "nested-index");
        write(nestedIndex.resolve("bundle/nested"), "index.html");
        equal(null, ArchiveEntryPoint.find(nestedIndex.toFile()), "nested HTML is not selected recursively");

        Path htm = fixture(base, "htm");
        write(htm, "index.htm");
        equal(null, ArchiveEntryPoint.find(htm.toFile()), "htm extension is not supported");

        System.out.println("Archive entry point: " + checks + " checks passed.");
    }

    private static Path fixture(Path base, String name) throws Exception {
        Path path = base.resolve(name);
        Files.createDirectories(path);
        return path;
    }

    private static void write(Path directory, String name) throws Exception {
        Files.createDirectories(directory);
        Files.write(directory.resolve(name), "fixture".getBytes(StandardCharsets.UTF_8));
    }

    private static void equal(String expectedName, File actual, String message) {
        String actualName = actual == null ? null : actual.getName();
        checks++;
        if (expectedName == null ? actualName != null : !expectedName.equals(actualName)) {
            throw new AssertionError(message + ": expected=" + expectedName + ", actual=" + actualName);
        }
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        if (!file.delete()) throw new IllegalStateException("Cannot delete " + file);
    }
}
