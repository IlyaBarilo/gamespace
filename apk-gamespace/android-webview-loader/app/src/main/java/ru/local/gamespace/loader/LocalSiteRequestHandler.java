package ru.local.gamespace.loader;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Serves installed content through one private HTTPS origin without file:// access. */
final class LocalSiteRequestHandler {
    static final String ORIGIN = "https://content.gamespace.local";
    private static final String HOST = "content.gamespace.local";
    private volatile File contentRoot;

    void setContentRoot(File root) {
        contentRoot = root;
    }

    String urlForFile(File file) throws IOException {
        File root = requiredRoot();
        String relative = relativePath(root, file.getCanonicalFile());
        Uri.Builder builder = Uri.parse(ORIGIN).buildUpon();
        for (String part : relative.split("/")) builder.appendPath(part);
        return builder.build().toString();
    }

    boolean isInternalUrl(String value) {
        if (value == null) return false;
        try {
            Uri uri = Uri.parse(value);
            int port = uri.getPort();
            return "https".equalsIgnoreCase(uri.getScheme())
                && HOST.equalsIgnoreCase(uri.getHost())
                && (port == -1 || port == 443);
        } catch (Exception ignored) {
            return false;
        }
    }

    File fileForUrl(String value) throws IOException {
        if (!isInternalUrl(value)) return null;
        File root = requiredRoot();
        Uri uri = Uri.parse(value);
        String path = uri.getPath();
        String relative = path == null ? "" : path.replaceFirst("^/+", "");
        while (relative.endsWith("/")) relative = relative.substring(0, relative.length() - 1);
        if (relative.length() == 0) relative = "index.html";
        validatePath(relative);
        File candidate = new File(root, relative).getCanonicalFile();
        ensureInside(root, candidate);
        if (candidate.isDirectory()) {
            for (String index : new String[] {"index.html", "index.htm", "INDEX.HTML", "INDEX.HTM"}) {
                File nested = new File(candidate, index);
                if (nested.isFile()) return nested.getCanonicalFile();
            }
        }
        return candidate;
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;
        return intercept(request.getUrl().toString(), request.getMethod(), request.getRequestHeaders());
    }

    WebResourceResponse intercept(String value) {
        return intercept(value, "GET", null);
    }

    private WebResourceResponse intercept(String value, String method, Map<String, String> requestHeaders) {
        try {
            if (isInternalUrl(value)) return serve(value, method, requestHeaders);
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                return response(403, "Forbidden", "text/plain", "utf-8", new ByteArrayInputStream(new byte[0]), 0L, null);
            }
            return null;
        } catch (Exception error) {
            byte[] message;
            try { message = "Локальный файл недоступен.".getBytes("UTF-8"); }
            catch (Exception ignored) { message = new byte[0]; }
            return response(500, "Internal Server Error", "text/plain", "utf-8", new ByteArrayInputStream(message), message.length, null);
        }
    }

    private WebResourceResponse serve(String value, String method, Map<String, String> requestHeaders) throws IOException {
        File file = fileForUrl(value);
        if (file == null || !file.isFile()) {
            return response(404, "Not Found", "text/plain", "utf-8", new ByteArrayInputStream(new byte[0]), 0L, null);
        }

        long size = file.length();
        long[] range = parseRange(header(requestHeaders, "Range"), size);
        if (range != null && range.length == 0) {
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Content-Range", "bytes */" + size);
            return response(416, "Range Not Satisfiable", mimeType(file.getName()), encoding(file.getName()), new ByteArrayInputStream(new byte[0]), 0L, headers);
        }

        long start = range == null ? 0L : range[0];
        long end = range == null ? size - 1L : range[1];
        long length = size == 0L ? 0L : end - start + 1L;
        InputStream data = new ByteArrayInputStream(new byte[0]);
        if (!"HEAD".equalsIgnoreCase(method) && length > 0L) {
            FileInputStream input = new FileInputStream(file);
            skipFully(input, start);
            data = new LimitedInputStream(input, length);
        }
        Map<String, String> headers = new HashMap<String, String>();
        if (range != null) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        return response(range == null ? 200 : 206, range == null ? "OK" : "Partial Content",
            mimeType(file.getName()), encoding(file.getName()), data, length, headers);
    }

    private static WebResourceResponse response(int status, String reason, String mime, String encoding,
                                                InputStream data, long length, Map<String, String> extra) {
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", Long.toString(Math.max(0L, length)));
        if (extra != null) headers.putAll(extra);
        return new WebResourceResponse(mime, encoding, status, reason, headers, data);
    }

    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) return entry.getValue();
        }
        return null;
    }

    private static long[] parseRange(String header, long size) {
        if (header == null || !header.startsWith("bytes=") || size <= 0L) return null;
        String value = header.substring(6).trim();
        if (value.indexOf(',') >= 0) return new long[0];
        int separator = value.indexOf('-');
        if (separator < 0) return new long[0];
        try {
            String left = value.substring(0, separator).trim();
            String right = value.substring(separator + 1).trim();
            long start;
            long end;
            if (left.length() == 0) {
                long suffix = Long.parseLong(right);
                if (suffix <= 0L) return new long[0];
                start = Math.max(0L, size - suffix);
                end = size - 1L;
            } else {
                start = Long.parseLong(left);
                end = right.length() == 0 ? size - 1L : Math.min(size - 1L, Long.parseLong(right));
            }
            if (start < 0L || start >= size || end < start) return new long[0];
            return new long[] {start, end};
        } catch (NumberFormatException ignored) {
            return new long[0];
        }
    }

    private static void skipFully(InputStream input, long count) throws IOException {
        long remaining = count;
        while (remaining > 0L) {
            long skipped = input.skip(remaining);
            if (skipped > 0L) remaining -= skipped;
            else if (input.read() == -1) throw new IOException("Не удалось перейти к диапазону файла.");
            else remaining -= 1L;
        }
    }

    private File requiredRoot() throws IOException {
        File root = contentRoot;
        if (root == null || !root.isDirectory()) throw new IOException("Корневой каталог сайта не задан.");
        return root.getCanonicalFile();
    }

    private static String relativePath(File root, File file) throws IOException {
        ensureInside(root, file);
        String boundary = root.getCanonicalPath() + File.separator;
        return file.getCanonicalPath().substring(boundary.length()).replace(File.separatorChar, '/');
    }

    private static void ensureInside(File root, File file) throws IOException {
        String boundary = root.getCanonicalPath() + File.separator;
        if (!file.getCanonicalPath().startsWith(boundary)) throw new IOException("Запрошен файл за пределами установленного сайта.");
    }

    private static void validatePath(String path) throws IOException {
        if (path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) throw new IOException("Некорректный путь локального ресурса.");
        for (String part : path.split("/")) {
            if (part.length() == 0 || ".".equals(part) || "..".equals(part)) throw new IOException("Небезопасный путь локального ресурса.");
        }
    }

    private static String mimeType(String name) {
        String lower = name.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static String encoding(String name) {
        String mime = mimeType(name);
        return mime.startsWith("text/") || "application/json".equals(mime) ? "utf-8" : null;
    }

    private static final class LimitedInputStream extends FilterInputStream {
        private long remaining;

        LimitedInputStream(InputStream input, long remaining) {
            super(input);
            this.remaining = remaining;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0L) return -1;
            int value = super.read();
            if (value >= 0) remaining -= 1L;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0L) return -1;
            int read = super.read(buffer, offset, (int) Math.min((long) length, remaining));
            if (read > 0) remaining -= read;
            return read;
        }
    }
}
