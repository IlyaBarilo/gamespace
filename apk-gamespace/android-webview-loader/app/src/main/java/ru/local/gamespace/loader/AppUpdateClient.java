package ru.local.gamespace.loader;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;

/** This client has one fixed HTTPS endpoint and never downloads APKs. */
final class AppUpdateClient {
    interface ConnectionFactory { HttpsURLConnection open(URL url) throws IOException; }
    private final ConnectionFactory factory;

    AppUpdateClient() {
        this(new ConnectionFactory() {
            @Override public HttpsURLConnection open(URL url) throws IOException {
                return (HttpsURLConnection) url.openConnection();
            }
        });
    }
    AppUpdateClient(ConnectionFactory factory) { this.factory = factory; }

    String fetch() throws IOException {
        checkInterrupted();
        long deadline = System.nanoTime() + 20_000_000_000L;
        HttpsURLConnection connection = factory.open(new URL(AppUpdateCatalog.URL));
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setUseCaches(false);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cache-Control", "no-cache");
            // Default platform TLS verification is intentionally left intact.
            int status = connection.getResponseCode();
            if (status == 404) throw new IOException("Каталог обновлений ещё не опубликован. Повторите проверку после следующего релиза.");
            if (status != 200) throw new IOException("Сервер обновлений вернул HTTP " + status + ". Повторите проверку позже.");
            long declared = -1;
            String length = connection.getHeaderField("Content-Length");
            if (length != null) {
                try {
                    if (!length.matches("[0-9]+")) throw UpdateJson.invalid();
                    declared = Long.parseLong(length);
                } catch (NumberFormatException error) { throw UpdateJson.invalid(); }
            }
            if (declared > AppUpdateCatalog.MAX_BYTES) throw UpdateJson.invalid();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                while (true) {
                    checkInterrupted();
                    if (System.nanoTime() >= deadline) throw new java.net.SocketTimeoutException();
                    int count = input.read(buffer);
                    if (count == -1) break;
                    if (bytes.size() + count > AppUpdateCatalog.MAX_BYTES) throw UpdateJson.invalid();
                    bytes.write(buffer, 0, count);
                }
            }
            if (declared >= 0 && declared != bytes.size()) throw new IOException("Загрузка списка версий прервана. Повторите проверку.");
            checkInterrupted();
            return AppUpdateCatalog.decode(bytes.toByteArray());
        } finally { connection.disconnect(); }
    }

    private static void checkInterrupted() throws InterruptedIOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Проверка отменена.");
    }
}
