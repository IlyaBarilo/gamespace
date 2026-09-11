package ru.local.gamespace.loader;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.cert.Certificate;
import javax.net.ssl.HttpsURLConnection;

/** JVM tests of the actual client, parser and cache, with no external network. */
public final class AppUpdateTest {
    private static int checks;
    private static final String SIGNER = repeat("a", 64);
    private static final String VALID = catalog(entry("0.3.14", "v0.3.14", 314));

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && "--csp".equals(args[0])) { System.out.print(LocalWebPolicy.CSP); return; }
        catalogTests();
        transportTests();
        cacheTests();
        originTests();
        if (args.length > 0) {
            AppUpdateCatalog generated = AppUpdateCatalog.parse(AppUpdateCatalog.decode(Files.readAllBytes(Paths.get(args[0]))));
            expect(generated.releases.size() == 100, "all 100 producer entries accepted");
            expect(generated.releases.get(0).description.equals("Исправления\nКавычки: \"текст\"; символ 🎮; путь \\demo"), "producer Unicode and escaped text preserved");
        }
        System.out.println("APK update client: " + checks + " checks passed (JVM; not Android UI).");
    }

    private static void catalogTests() throws Exception {
        AppUpdateCatalog.Release release = AppUpdateCatalog.parse(VALID).releases.get(0);
        expect(release.versionCode == 314 && release.version.equals("0.3.14"), "numeric version");
        expect(release.canUpdate(309, 23, SIGNER), "newer compatible release");
        expect(!release.canUpdate(314, 23, SIGNER), "same version");
        expect(!release.canUpdate(400, 23, SIGNER), "no downgrade");
        expect(!release.canUpdate(309, 22, SIGNER), "minimum Android");
        expect(!release.canUpdate(309, 23, repeat("b", 64)), "different installed signing key");
        expect(!release.canUpdate(309, 23, ""), "unknown installed signing key");
        expect(AppUpdateCatalog.versionCode("214748.36.47") == Integer.MAX_VALUE, "largest Android versionCode");
        for (final String version : new String[] {"0.0.0", "0.03.1", "0.3", "0.100.0", "0.0.100", "214748.36.48", "999999999999999999999999.0.0"}) {
            rejects(() -> AppUpdateCatalog.versionCode(version), "invalid version " + version);
        }
        expect(AppUpdateCatalog.parse(catalog(entry("1.0.0", "v1", 10000))).releases.get(0).versionCode == 10000, "short major tag");
        expect(AppUpdateCatalog.parse(catalog(entry("0.5.0", "v0.5", 500))).releases.get(0).versionCode == 500, "short minor tag");
        expect(AppUpdateCatalog.parse(catalog(entry("1.0.1", "v1.0.1", 10001))).releases.get(0).versionCode == 10001, "zero minor retained");
        expect(AppUpdateCatalog.parse(VALID.replace(SIGNER, SIGNER.toUpperCase())).releases.get(0).signerSha256.equals(SIGNER), "digest normalized");
        String[] invalid = {
            VALID.replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
            VALID.replace("\"schemaVersion\":1", "\"schemaVersion\":true"),
            VALID.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"),
            VALID.replace("\"schemaVersion\":1", "\"schemaVersion\":1.0"),
            VALID.replace("\"schemaVersion\":1", "\"schemaVersion\":01"),
            VALID.replace(AppUpdateCatalog.APPLICATION_ID, "another.application"),
            VALID.replace("\"stable\"", "\"beta\""),
            VALID.replace("\"latestVersionCode\":314", "\"latestVersionCode\":313"),
            VALID.replace("2026-09-01", "2026-02-30"),
            VALID.replace("\"minSdk\":23", "\"minSdk\":0"),
            VALID.replace("\"size\":1024", "\"size\":2147483648"),
            VALID.replace("\"description\":\"Описание\"", "\"description\":null"),
            VALID.replace("Описание", repeat("я", 16385)),
            VALID.replace(SIGNER, "bad"),
            VALID.replace("https://github.com/", "https://github.com.evil.invalid/"),
            VALID.replace("/releases/download/", "/releases/latest/download/"),
            VALID.replace("GameSpace-0.3.14.apk", "GameSpace-latest.apk"),
            VALID.replace("\"tag\":\"v0.3.14\"", "\"tag\":\"v0.3.14.0\""),
            VALID.substring(0, VALID.length() - 1), VALID + " true", VALID.replace("Описание", "bad\ntext"),
            VALID.replace("Описание", "\\uD800"), VALID.replace("Описание", "\\uDC00"),
            catalog(entry("0.3.14", "v0.3.14", 314), entry("0.3.14", "v0.3.14", 314)),
            catalog(entry("0.3.14", "v0.3.14", 314), entry("0.4.0", "v0.4", 400)),
            "{\"schemaVersion\":1,\"applicationId\":\"ru.local.gamespace.loader\",\"channel\":\"stable\",\"latestVersionCode\":314,\"releases\":[]}",
            repeat(" ", AppUpdateCatalog.MAX_BYTES) + VALID
        };
        for (final String json : invalid) rejects(() -> AppUpdateCatalog.parse(json), "malformed catalog");
        rejects(() -> UpdateJson.parse(repeat("[", 18) + "0" + repeat("]", 18)), "excessive nesting");
        rejects(() -> UpdateJson.parse("[" + repeat("0,", 10000) + "0]"), "excessive JSON values");
        rejects(() -> AppUpdateCatalog.decode(new byte[] {(byte) 0xc3, 0x28}), "invalid UTF-8");
        expect(AppUpdateCatalog.parse(AppUpdateCatalog.decode(("\ufeff" + VALID).getBytes(StandardCharsets.UTF_8))).releases.size() == 1, "UTF-8 BOM tolerated");
        final String[] tooMany = new String[101];
        for (int i = 0; i < tooMany.length; i++) tooMany[i] = entry((101 - i) + ".0.0", "v" + (101 - i), (101 - i) * 10000);
        rejects(() -> AppUpdateCatalog.parse(catalog(tooMany)), "more than 100 releases");
    }

    private static void transportTests() throws Exception {
        FakeConnection good = connection(VALID);
        expect(client(good).fetch().equals(VALID), "body read without network");
        expect(good.getRequestMethod().equals("GET") && !good.getInstanceFollowRedirects() && !good.getUseCaches(), "GET, no redirects or URL cache");
        expect(good.getConnectTimeout() == 10000 && good.getReadTimeout() == 10000, "bounded connect/read waits");
        expect("identity".equals(good.getRequestProperty("Accept-Encoding")) && "application/json".equals(good.getRequestProperty("Accept")), "bounded uncompressed JSON request");
        expect(good.closed && good.disconnected, "success closes stream and connection");
        for (int status : new int[] {302, 404, 429, 500}) {
            FakeConnection failed = connection(VALID); failed.status = status;
            rejects(() -> client(failed).fetch(), "HTTP " + status);
            expect(failed.disconnected && !failed.opened, "HTTP error never reads body");
        }
        for (String declared : new String[] {"1048577", "999999999999999999999", "-1", "2", "bad"}) {
            FakeConnection failed = connection(VALID); failed.length = declared;
            rejects(() -> client(failed).fetch(), "bad or mismatched declared length");
            expect(failed.disconnected, "length failure disconnects");
        }
        FakeConnection tooLarge = connection(repeat("x", AppUpdateCatalog.MAX_BYTES + 1)); tooLarge.length = null;
        rejects(() -> client(tooLarge).fetch(), "stream exceeds cap without Content-Length");
        expect(tooLarge.closed && tooLarge.disconnected, "oversize closes resources");
        FakeConnection truncated = connection(VALID); truncated.failRead = true;
        rejects(() -> client(truncated).fetch(), "interrupted transfer");
        expect(truncated.closed && truncated.disconnected, "I/O failure closes resources");
        FakeConnection invalidUtf8 = connection(VALID); invalidUtf8.body = new byte[] {(byte) 0xff}; invalidUtf8.length = null;
        rejects(() -> client(invalidUtf8).fetch(), "wire UTF-8 is strict");
        FakeConnection empty = connection(""); rejects(() -> client(empty).fetch(), "empty body");
        FakeConnection cancelled = connection(VALID);
        Thread.currentThread().interrupt();
        try { rejects(() -> client(cancelled).fetch(), "cancelled before request"); }
        finally { Thread.interrupted(); }
        expect(!cancelled.opened, "cancelled client does not open stream");
    }

    private static void cacheTests() throws Exception {
        MemoryStore store = new MemoryStore(); FakeConnection connection = connection(VALID);
        AppUpdateRepository repository = new AppUpdateRepository(store, client(connection));
        repository.loadCached();
        expect(repository.current() == null && !connection.opened, "opening empty cache never checks network");
        AppUpdateRepository.Snapshot success = repository.check();
        expect(success.saved && success.checkedAt > 0 && store.json.equals(VALID), "successful check persists snapshot");
        FakeConnection offline = connection(VALID); offline.failRead = true;
        AppUpdateRepository restarted = new AppUpdateRepository(store, client(offline));
        restarted.loadCached();
        expect(!offline.opened && restarted.current().checkedAt == success.checkedAt, "restart restores without network");
        AppUpdateRepository.Snapshot cached = restarted.current();
        rejects(() -> restarted.check(), "offline check");
        expect(restarted.current() == cached && store.time == success.checkedAt && store.saves == 1, "offline failure preserves last success and date");
        AppUpdateRepository malformed = new AppUpdateRepository(store, client(connection("{}")));
        malformed.loadCached();
        rejects(() -> malformed.check(), "bad new catalog");
        expect(malformed.current().checkedAt == success.checkedAt && store.saves == 1, "bad response does not overwrite cache");
        store.saveFails = true;
        AppUpdateRepository noDisk = new AppUpdateRepository(store, client(connection(VALID)));
        expect(!noDisk.check().saved && noDisk.current() != null, "fresh result usable when persistence fails");
        MemoryStore badCache = new MemoryStore(); badCache.json = "{}"; badCache.time = 1;
        FakeConnection fresh = connection(VALID);
        AppUpdateRepository damaged = new AppUpdateRepository(badCache, client(fresh));
        rejects(() -> damaged.loadCached(), "damaged cache");
        expect(!fresh.opened && damaged.current() == null, "damaged cache triggers no background network");
        expect(damaged.check().saved, "manual check repairs damaged cache");
    }

    private static void originTests() {
        for (String value : new String[] {LocalWebPolicy.ORIGIN + "/", LocalWebPolicy.ORIGIN + ":443/game?q=1#x", "HTTPS://CONTENT.GAMESPACE.LOCAL/a%20b"}) {
            expect(LocalWebPolicy.isInternalUrl(value), "local HTTPS origin accepted");
        }
        for (String value : new String[] {null, "", "http://content.gamespace.local/", "https://content.gamespace.local.evil.invalid/", "https://content.gamespace.local:444/", "https://user@content.gamespace.local/", "https://content.gamespace.local@evil.invalid/", "https://content.gamespace.local./", "https://content.gamespace.local\\@evil.invalid/", "file:///etc/passwd", "content://documents/file", AppUpdateCatalog.URL}) {
            expect(!LocalWebPolicy.isInternalUrl(value), "foreign or ambiguous origin denied");
        }
        expect(LocalWebPolicy.isInMemoryUrl("blob:https://content.gamespace.local/id") && LocalWebPolicy.isInMemoryUrl("data:text/plain,local"), "offline in-memory resources retained");
        expect(!LocalWebPolicy.isInMemoryUrl("https://example.org/") && !LocalWebPolicy.isInMemoryUrl("file:///test"), "external scheme not in-memory");
    }

    private static String entry(String version, String tag, int code) {
        return "{\"tag\":\"" + tag + "\",\"version\":\"" + version + "\",\"versionCode\":" + code
            + ",\"publishedAt\":\"2026-09-01T12:00:00Z\",\"description\":\"Описание\",\"minSdk\":23,\"releaseUrl\":\""
            + AppUpdateCatalog.REPOSITORY + "/releases/tag/" + tag + "\",\"apk\":{\"name\":\"GameSpace-" + version
            + ".apk\",\"url\":\"" + AppUpdateCatalog.REPOSITORY + "/releases/download/" + tag + "/GameSpace-" + version
            + ".apk\",\"size\":1024,\"sha256\":\"" + repeat("b", 64) + "\",\"signerSha256\":\"" + SIGNER + "\"}}";
    }
    private static String catalog(String... entries) {
        String first = entries[0];
        String code = first.substring(first.indexOf("\"versionCode\":") + 14).split(",")[0];
        return "{\"schemaVersion\":1,\"applicationId\":\"" + AppUpdateCatalog.APPLICATION_ID + "\",\"channel\":\"stable\",\"latestVersionCode\":" + code + ",\"releases\":[" + String.join(",", entries) + "]}";
    }
    private static String repeat(String value, int count) { StringBuilder out = new StringBuilder(); for (int i = 0; i < count; i++) out.append(value); return out.toString(); }
    private static void expect(boolean value, String label) { if (!value) throw new AssertionError(label); checks++; }
    private interface Operation { void run() throws Exception; }
    private static void rejects(Operation operation, String label) throws Exception {
        try { operation.run(); } catch (IOException expected) { checks++; return; }
        throw new AssertionError("Expected rejection: " + label);
    }
    private static FakeConnection connection(String body) throws Exception { return new FakeConnection(body.getBytes(StandardCharsets.UTF_8)); }
    private static AppUpdateClient client(final FakeConnection connection) {
        return new AppUpdateClient(url -> { expect(AppUpdateCatalog.URL.equals(url.toString()), "only fixed official endpoint"); return connection; });
    }
    private static final class MemoryStore implements AppUpdateRepository.Store {
        String json = ""; long time; int saves; boolean saveFails;
        @Override public String readJson() { return json; }
        @Override public long readTime() { return time; }
        @Override public boolean save(String value, long checkedAt) { if (saveFails) throw new IllegalStateException("disk unavailable"); json = value; time = checkedAt; saves++; return true; }
    }
    private static final class FakeConnection extends HttpsURLConnection {
        byte[] body; String length; int status = 200; boolean opened, closed, disconnected, failRead;
        FakeConnection(byte[] body) throws Exception { super(new URL(AppUpdateCatalog.URL)); this.body = body; length = Integer.toString(body.length); }
        @Override public int getResponseCode() { return status; }
        @Override public String getHeaderField(String name) { return "Content-Length".equals(name) ? length : null; }
        @Override public InputStream getInputStream() {
            opened = true;
            return new InputStream() {
                final ByteArrayInputStream delegate = new ByteArrayInputStream(body);
                @Override public int read() throws IOException { if (failRead) throw new IOException("transfer failed"); return delegate.read(); }
                @Override public int read(byte[] buffer, int offset, int count) throws IOException { if (failRead) throw new IOException("transfer failed"); return delegate.read(buffer, offset, count); }
                @Override public void close() { closed = true; }
            };
        }
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() { }
        @Override public String getCipherSuite() { return "test"; }
        @Override public Certificate[] getLocalCertificates() { return null; }
        @Override public Certificate[] getServerCertificates() { return null; }
    }
}
