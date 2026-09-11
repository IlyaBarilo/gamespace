package ru.local.gamespace.loader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.URI;
import java.net.URL;
import java.net.SocketTimeoutException;
import java.security.MessageDigest;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;

/** Streams only a catalog-selected APK; no tokens, relaxed TLS or automatic redirects. */
final class ApkUpdateTransfer {
    static final long FREE_RESERVE = 16L * 1024 * 1024;
    interface Progress { void update(long received, long total); }
    interface Space { long available(File directory); }
    static final class Cancellation {
        private volatile boolean cancelled;
        void cancel() { cancelled = true; }
        boolean isCancelled() { return cancelled; }
        void check() throws InterruptedIOException {
            if (cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Загрузка отменена.");
        }
    }
    private final AppUpdateClient.ConnectionFactory factory;
    private final Space space;
    ApkUpdateTransfer() {
        this(new AppUpdateClient.ConnectionFactory() {
            @Override public HttpsURLConnection open(URL url) throws IOException { return (HttpsURLConnection) url.openConnection(); }
        }, new Space() {
            @Override public long available(File directory) { return directory.getUsableSpace(); }
        });
    }
    ApkUpdateTransfer(AppUpdateClient.ConnectionFactory factory, Space space) { this.factory = factory; this.space = space; }

    void download(AppUpdateCatalog.Release release, File destination, Cancellation cancellation, Progress progress) throws IOException {
        cancellation.check();
        requireSpace(destination.getParentFile(), release.size);
        URL first = new URL(release.apkUrl), address = first;
        long deadline = System.nanoTime() + 15L * 60 * 1_000_000_000L;
        for (int redirects = 0; ; redirects++) {
            cancellation.check();
            if (!allowedAddress(address.toString(), first.toString())) throw new IOException("Сервер перенаправил загрузку APK на неподдерживаемый адрес.");
            HttpsURLConnection connection = factory.open(address);
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
                connection.setUseCaches(false); connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept", "application/octet-stream");
                connection.setRequestProperty("Accept-Encoding", "identity");
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (redirects >= 5 || location == null) throw new IOException("Слишком много перенаправлений при загрузке APK.");
                    address = new URL(address, location);
                    continue;
                }
                if (status != 200) throw new IOException("Не удалось скачать APK: HTTP " + status + ". Повторите загрузку позже.");
                String length = connection.getHeaderField("Content-Length");
                if (length != null && !Long.toString(release.size).equals(length)) throw new IOException("Размер APK на сервере не совпадает с каталогом.");
                String encoding = connection.getHeaderField("Content-Encoding");
                if (encoding != null && !"identity".equalsIgnoreCase(encoding)) throw new IOException("Сервер вернул неподдерживаемое кодирование APK.");
                MessageDigest digest = digest();
                long received = 0, lastSpaceCheck = 0;
                progress.update(0, release.size);
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                    byte[] buffer = new byte[64 * 1024];
                    while (true) {
                        cancellation.check();
                        if (System.nanoTime() >= deadline) throw new SocketTimeoutException("Время загрузки APK истекло.");
                        int count = input.read(buffer);
                        if (count == -1) break;
                        cancellation.check();
                        if (received + count > release.size) throw new IOException("Сервер прислал APK больше объявленного размера.");
                        output.write(buffer, 0, count); digest.update(buffer, 0, count); received += count;
                        if (received - lastSpaceCheck >= 1024 * 1024) {
                            requireSpace(destination.getParentFile(), release.size - received); lastSpaceCheck = received;
                        }
                        progress.update(received, release.size);
                    }
                    cancellation.check();
                    if (received != release.size) throw new IOException("Загрузка APK прервалась: файл получен не полностью.");
                    if (!hex(digest.digest()).equals(release.sha256)) throw new IOException("Контрольная сумма APK не совпадает. Повторите проверку обновлений и загрузку.");
                    output.getFD().sync();
                }
                cancellation.check();
                return;
            } finally { connection.disconnect(); }
        }
    }

    static void verifyPayload(File file, AppUpdateCatalog.Release release, Cancellation cancellation) throws IOException {
        if (!file.isFile() || file.length() != release.size) throw new IOException("Скачанный APK отсутствует или имеет неверный размер. Скачайте его заново.");
        MessageDigest digest = digest();
        long size = 0;
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024]; int count;
            while ((count = input.read(buffer)) != -1) {
                cancellation.check(); size += count;
                if (size > release.size) throw new IOException("Размер скачанного APK изменился.");
                digest.update(buffer, 0, count);
            }
        }
        cancellation.check();
        if (size != release.size || !hex(digest.digest()).equals(release.sha256)) throw new IOException("Скачанный APK повреждён. Удалите файл и скачайте его заново.");
    }

    static boolean allowedAddress(String value, String original) {
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
            if ("github.com".equals(uri.getHost())) return value.equals(original) && uri.getRawQuery() == null;
            return ("release-assets.githubusercontent.com".equals(uri.getHost()) || "objects.githubusercontent.com".equals(uri.getHost()))
                && uri.getPath() != null && uri.getPath().startsWith("/");
        } catch (Exception ignored) { return false; }
    }
    private void requireSpace(File directory, long remaining) throws IOException {
        if (space.available(directory) < remaining + FREE_RESERVE) throw new IOException("Недостаточно свободного места для APK. Освободите место и повторите загрузку.");
    }
    private static MessageDigest digest() throws IOException {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (Exception error) { throw new IOException("Не удалось проверить SHA-256 APK.", error); }
    }
    static String hex(byte[] digest) {
        StringBuilder value = new StringBuilder();
        for (byte b : digest) value.append(String.format(Locale.US, "%02x", b & 255));
        return value.toString();
    }
}
