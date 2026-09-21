package ru.local.gamespace.loader;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class ArchiveEntryPoint {
    private static final String INDEX_NAME = "index.html";

    private ArchiveEntryPoint() {
    }

    static File find(File extractRoot) {
        if (extractRoot == null || !extractRoot.isDirectory()) {
            return null;
        }

        File[] children = extractRoot.listFiles();
        if (children == null) {
            return null;
        }

        List<File> rootFiles = new ArrayList<File>();
        List<File> topDirectories = new ArrayList<File>();
        for (File child : children) {
            if (isIgnoredRootEntry(child)) {
                continue;
            }
            if (child.isFile()) {
                rootFiles.add(child);
            } else if (child.isDirectory()) {
                topDirectories.add(child);
            }
        }

        if (!rootFiles.isEmpty()) {
            return chooseStartFile(rootFiles);
        }
        if (topDirectories.size() != 1) {
            return null;
        }

        File[] directoryChildren = topDirectories.get(0).listFiles();
        if (directoryChildren == null) {
            return null;
        }
        List<File> directoryFiles = new ArrayList<File>();
        for (File child : directoryChildren) {
            if (child.isFile() && !isIgnoredName(child.getName())) {
                directoryFiles.add(child);
            }
        }
        return chooseStartFile(directoryFiles);
    }

    private static File chooseStartFile(List<File> files) {
        for (File file : files) {
            if (INDEX_NAME.equals(file.getName())) {
                return file;
            }
        }

        File caseInsensitiveIndex = null;
        for (File file : files) {
            if (INDEX_NAME.equals(file.getName().toLowerCase(Locale.US))) {
                if (caseInsensitiveIndex != null) {
                    return null;
                }
                caseInsensitiveIndex = file;
            }
        }
        if (caseInsensitiveIndex != null) {
            return caseInsensitiveIndex;
        }

        File onlyHtml = null;
        for (File file : files) {
            if (!isHtmlName(file.getName())) {
                continue;
            }
            if (onlyHtml != null) {
                return null;
            }
            onlyHtml = file;
        }
        return onlyHtml;
    }

    private static boolean isHtmlName(String name) {
        return !isIgnoredName(name) && name.toLowerCase(Locale.US).endsWith(".html");
    }

    private static boolean isIgnoredRootEntry(File entry) {
        return entry == null || isIgnoredName(entry.getName());
    }

    private static boolean isIgnoredName(String name) {
        if (name == null || name.length() == 0 || name.startsWith(".")) {
            return true;
        }
        String normalized = name.toLowerCase(Locale.US);
        return "__macosx".equals(normalized)
            || ".ds_store".equals(normalized)
            || "thumbs.db".equals(normalized)
            || "desktop.ini".equals(normalized);
    }
}
