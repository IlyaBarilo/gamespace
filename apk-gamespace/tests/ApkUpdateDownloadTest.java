package ru.local.gamespace.loader;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.HttpsURLConnection;

/** Actual transfer and file transactions; network and Android package parsing are injected. */
public final class ApkUpdateDownloadTest {
    private static int checks;
    private static final String SIGNER = repeat("a", 64);
    private static final String ORIGINAL = AppUpdateCatalog.REPOSITORY + "/releases/download/v0.3.14/GameSpace-0.3.14.apk";
    private static final String CDN = "https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?signature=test";
    private static final byte[] BODY = new byte[2 * 1024 * 1024 + 19];
    private static File testRoot;
    private static AppUpdateCatalog.Release release;

    public static void main(String[] args) throws Exception {
        for (int i = 0; i < BODY.length; i++) BODY[i] = (byte) (i * 31);
        release = release(BODY);
        testRoot = Files.createTempDirectory(new File(args[0]).toPath(), "apk-update-").toFile();
        try { addresses(); transfer(); transactions(); identities(); }
        finally { removeTestTree(testRoot); }
        System.out.println("APK download and verification: " + checks + " JVM checks passed; Android installer not executed.");
    }
    private static void addresses() {
        for (String good : new String[] {ORIGINAL, CDN, CDN.replace("release-assets", "objects"), CDN.replace("/github-production-release-asset/", "/github-production-release-asset-2e65be/")}) expect(ApkUpdateTransfer.allowedAddress(good, ORIGINAL), "official download address");
        for (String bad : new String[] {
            "http://github.com/IlyaBarilo/gamespace", ORIGINAL + "?redirect=1", ORIGINAL + "#x", ORIGINAL.replace("IlyaBarilo", "AnotherOwner"),
            CDN.replace("https://", "http://"), CDN.replace(".com/", ".com.evil.invalid/"), CDN.replace("https://", "https://user@"),
            CDN.replace(".com/", ".com:444/"),
            "https://127.0.0.1/file.apk", "file:///tmp/evil.apk", "content://other/apk", "https://github.com@evil.invalid/file.apk",
            "https://github.com\\@evil.invalid/file.apk"
        }) expect(!ApkUpdateTransfer.allowedAddress(bad, ORIGINAL), "redirect denied: " + bad);
    }
    private static void transfer() throws Exception {
        File folder = directory("transfer");
        FakeConnection redirect = new FakeConnection(new byte[0]); redirect.status = 302; redirect.location = CDN;
        FakeConnection payload = new FakeConnection(BODY);
        List<String> opened = new ArrayList<String>();
        ApkUpdateTransfer client = new ApkUpdateTransfer(url -> { opened.add(url.toString()); return opened.size() == 1 ? redirect : payload; }, dir -> Long.MAX_VALUE);
        File file = new File(folder, "stream.part"); final long[] progress = {0};
        client.download(release, file, new ApkUpdateTransfer.Cancellation(), (count, size) -> {
            if (count < progress[0] || count > size) throw new AssertionError("invalid progress"); progress[0] = count;
        });
        expect(opened.equals(Arrays.asList(ORIGINAL, CDN)), "redirect followed explicitly");
        expect(Arrays.equals(Files.readAllBytes(file.toPath()), BODY) && progress[0] == BODY.length, "exact bytes and progress");
        expect(payload.maxRead <= 64 * 1024, "bounded read buffer");
        expect(redirect.disconnected && !redirect.opened && payload.closed && payload.disconnected, "connections and streams closed");
        expect(!payload.getInstanceFollowRedirects() && !payload.getUseCaches() && payload.getReadTimeout() == 10000, "HTTPS settings");
        expect(payload.getRequestProperty("Authorization") == null && "identity".equals(payload.getRequestProperty("Accept-Encoding")), "no credentials or compressed transport");
        ApkUpdateTransfer.verifyPayload(file, release, new ApkUpdateTransfer.Cancellation()); checks++;
        byte[] changed = BODY.clone(); changed[7] ^= 1; Files.write(file.toPath(), changed);
        rejects(() -> ApkUpdateTransfer.verifyPayload(file, release, new ApkUpdateTransfer.Cancellation()), "changed ready file");

        FakeConnection blocked = new FakeConnection(BODY); blocked.status = 302; blocked.location = "https://evil.invalid/file.apk";
        final int[] attempts = {0};
        ApkUpdateTransfer unsafe = new ApkUpdateTransfer(url -> { attempts[0]++; return blocked; }, dir -> Long.MAX_VALUE);
        rejects(() -> unsafe.download(release, file, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}), "foreign redirect");
        expect(attempts[0] == 1 && blocked.disconnected, "foreign target never requested");
        FakeConnection loop = new FakeConnection(BODY); loop.status = 302; loop.location = ORIGINAL;
        attempts[0] = 0;
        ApkUpdateTransfer loops = new ApkUpdateTransfer(url -> { attempts[0]++; return loop; }, dir -> Long.MAX_VALUE);
        rejects(() -> loops.download(release, file, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}), "redirect loop");
        expect(attempts[0] == 6, "at most five redirects");
        FakeConnection noSpace = new FakeConnection(BODY);
        rejects(() -> new ApkUpdateTransfer(url -> noSpace, dir -> release.size + ApkUpdateTransfer.FREE_RESERVE - 1)
            .download(release, file, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}), "insufficient space");
        expect(!noSpace.opened, "space checked before download");
        final int[] spaceCalls = {0};
        FakeConnection spaceLost = new FakeConnection(BODY);
        rejects(() -> new ApkUpdateTransfer(url -> spaceLost, dir -> spaceCalls[0]++ == 0 ? Long.MAX_VALUE : 0)
            .download(release, file, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}), "space lost during download");
        expect(spaceLost.closed && spaceLost.disconnected, "disk pressure closes resources");
    }
    private static void transactions() throws Exception {
        File folder = directory("private-updates");
        File site = new File(testRoot, "site.txt"); Files.write(site.toPath(), new byte[] {1, 2, 3});
        File unrelated = new File(folder, "keep.txt"); Files.write(unrelated.toPath(), new byte[] {4, 5});
        File stale = new File(folder, "download-" + UUID.randomUUID() + ".part"); Files.write(stale.toPath(), new byte[] {9});
        final int[] verification = {0};
        FakeConnection good = new FakeConnection(BODY);
        ApkUpdateFiles store = store(folder, good, (file, value) -> { expect(file.getName().endsWith(".part.apk"), "verify before promotion"); verification[0]++; });
        File ready = store.download(release, new ApkUpdateTransfer.Cancellation(), (a,b) -> {});
        expect(store.hasReady(release) && ready.isFile() && verification[0] == 1 && !stale.exists(), "verified promotion and stale part cleanup");
        ApkUpdateFiles restarted = store(folder, new FakeConnection(BODY), (file, value) -> { verification[0]++; });
        expect(restarted.hasReady(release), "download survives controller restart");
        expect(restarted.verifyReady(release, new ApkUpdateTransfer.Cancellation()).equals(ready) && verification[0] == 2, "reverify before installer");
        File interrupted = new File(folder, "download-" + UUID.randomUUID() + ".part"); Files.write(interrupted.toPath(), new byte[] {0});
        ApkUpdateTransfer.Cancellation before = new ApkUpdateTransfer.Cancellation(); before.cancel();
        rejects(() -> restarted.download(release, before, (a,b) -> {}), "cancelled before download");
        expect(ready.exists(), "pre-cancel does not delete ready APK");
        restarted.discard();
        expect(!restarted.hasFiles(), "no cached download after cleanup");
        expect(!ready.exists() && !interrupted.exists() && unrelated.isFile() && Arrays.equals(Files.readAllBytes(site.toPath()), new byte[] {1,2,3}), "cleanup limited to owned APK files");

        for (int status : new int[] {403, 404, 429, 500}) {
            FakeConnection failure = new FakeConnection(BODY); failure.status = status;
            rejects(() -> store(folder, failure, (f,r) -> {}).download(release, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}), "HTTP error cleanup");
            emptyOwned(folder); expect(failure.disconnected && !failure.opened, "HTTP failure closed before body");
        }
        for (int mode = 0; mode < 5; mode++) {
            FakeConnection failure = new FakeConnection(mode == 0 ? Arrays.copyOf(BODY, BODY.length - 1) : mode == 1 ? Arrays.copyOf(BODY, BODY.length + 1) : BODY.clone());
            if (mode == 2) failure.body[4] ^= 1;
            if (mode == 3) failure.length = "123";
            if (mode == 4) failure.failRead = true;
            rejects(() -> store(folder, failure, (f,r) -> { throw new AssertionError("unverified bytes reached package verifier"); })
                .download(release, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}), "bad payload cleanup");
            emptyOwned(folder); expect(failure.disconnected, "failed transfer disconnected");
        }
        FakeConnection cancelled = new FakeConnection(BODY);
        ApkUpdateTransfer.Cancellation token = new ApkUpdateTransfer.Cancellation();
        rejects(() -> store(folder, cancelled, (f,r) -> { throw new AssertionError("cancelled APK verified"); })
            .download(release, token, (count,total) -> { if (count > 0) token.cancel(); }), "cancel during stream");
        emptyOwned(folder); expect(cancelled.closed && cancelled.disconnected, "cancel closes network");
        rejects(() -> store(folder, new FakeConnection(BODY), (f,r) -> { throw new IOException("bad signature"); })
            .download(release, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}), "signature rejection");
        emptyOwned(folder);

        CountDownLatch entered = new CountDownLatch(1), resume = new CountDownLatch(1);
        AtomicReference<Throwable> workerError = new AtomicReference<Throwable>();
        ApkUpdateFiles slow = store(folder, new FakeConnection(BODY), (f,r) -> {
            entered.countDown(); try { if (!resume.await(5, TimeUnit.SECONDS)) throw new IOException("test timeout"); }
            catch (InterruptedException e) { throw new IOException(e); }
        });
        Thread worker = new Thread(() -> { try { slow.download(release, new ApkUpdateTransfer.Cancellation(), (a,b) -> {}); } catch (Throwable e) { workerError.set(e); } });
        worker.start();
        try { expect(entered.await(5, TimeUnit.SECONDS), "worker entered verification"); rejects(() -> restarted.discard(), "parallel delete rejected"); }
        finally { resume.countDown(); worker.join(5000); }
        expect(!worker.isAlive() && workerError.get() == null && restarted.hasReady(release), "parallel request cannot remove APK under verification");
        restarted.discard();
        for (final String name : new String[] {"../site.txt", "download-abc.part", "ready-" + repeat("a",64) + ".apk/../site", "ready-%2e%2e.apk", "/site.txt"}) {
            rejects(() -> ApkUpdateFiles.resolveReady(folder, name), "provider path rejected");
        }
        expect(unrelated.isFile() && site.isFile(), "site and unrelated file preserved after all failures");
    }
    private static void identities() throws Exception {
        ApkUpdateIdentity installed = new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.0", 300, 23, SIGNER);
        ApkUpdateIdentity valid = new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.14", 314, 23, SIGNER);
        ApkUpdateIdentity.requireCompatible(release, installed, valid, 23); checks++;
        for (final ApkUpdateIdentity invalid : new ApkUpdateIdentity[] {
            new ApkUpdateIdentity("other.app", "0.3.14", 314, 23, SIGNER),
            new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.15", 314, 23, SIGNER),
            new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.14", 315, 23, SIGNER),
            new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.14", 314, 24, SIGNER),
            new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.14", 314, 23, repeat("b",64)),
            new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.14", 314, 23, null)
        }) rejects(() -> ApkUpdateIdentity.requireCompatible(release, installed, invalid, 36), "incompatible archive identity");
        rejects(() -> ApkUpdateIdentity.requireCompatible(release, valid, valid, 23), "reinstall blocked");
        rejects(() -> ApkUpdateIdentity.requireCompatible(release, new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "1.0.0", 10000, 23, SIGNER), valid, 23), "downgrade blocked");
        rejects(() -> ApkUpdateIdentity.requireCompatible(release, installed, valid, 22), "device API too old");
        rejects(() -> ApkUpdateIdentity.requireCompatible(release, new ApkUpdateIdentity(AppUpdateCatalog.APPLICATION_ID, "0.3.0", 300, 23, repeat("c",64)), valid, 23), "installed key remains trust source");
    }
    private static ApkUpdateFiles store(File dir, FakeConnection connection, ApkUpdateFiles.Verifier verifier) {
        return new ApkUpdateFiles(dir, new ApkUpdateTransfer(url -> connection, folder -> Long.MAX_VALUE), verifier);
    }
    private static AppUpdateCatalog.Release release(byte[] bytes) throws Exception {
        return new AppUpdateCatalog.Release("0.3.14", 314, "2026-09-01T12:00:00Z", "test", 23,
            AppUpdateCatalog.REPOSITORY + "/releases/tag/v0.3.14", ORIGINAL, bytes.length,
            ApkUpdateTransfer.hex(MessageDigest.getInstance("SHA-256").digest(bytes)), SIGNER);
    }
    private static File directory(String name) throws Exception { File dir = new File(testRoot, name); if (!dir.mkdir()) throw new IOException("mkdir failed"); return dir; }
    private static void emptyOwned(File dir) { expect(dir.listFiles((d,n) -> n.endsWith(".part") || n.endsWith(".apk")).length == 0, "failed operation leaves no APK or part"); }
    private static String repeat(String value, int count) { StringBuilder out = new StringBuilder(); for (int i=0;i<count;i++) out.append(value); return out.toString(); }
    private static void expect(boolean value, String label) { if (!value) throw new AssertionError(label); checks++; }
    interface Operation { void run() throws Exception; }
    private static void rejects(Operation op, String label) throws Exception { try { op.run(); } catch (IOException expected) { checks++; return; } throw new AssertionError("Expected rejection: " + label); }
    private static void removeTestTree(File file) throws IOException {
        if (!file.getCanonicalPath().startsWith(testRoot.getCanonicalPath())) throw new IOException("test cleanup escape");
        if (file.isDirectory()) for (File child : file.listFiles()) removeTestTree(child);
        if (!file.delete()) throw new IOException("test cleanup failed");
    }
    private static final class FakeConnection extends HttpsURLConnection {
        byte[] body; int status = 200, maxRead; String length, location; boolean opened, closed, disconnected, failRead;
        FakeConnection(byte[] body) throws Exception { super(new URL(ORIGINAL)); this.body = body; }
        @Override public int getResponseCode() { return status; }
        @Override public String getHeaderField(String name) { return "Content-Length".equals(name) ? length : "Location".equals(name) ? location : null; }
        @Override public InputStream getInputStream() {
            opened = true;
            return new InputStream() {
                final ByteArrayInputStream bytes = new ByteArrayInputStream(body);
                @Override public int read() throws IOException { if (failRead) throw new IOException("read failed"); return bytes.read(); }
                @Override public int read(byte[] b, int offset, int count) throws IOException { maxRead = Math.max(maxRead, count); if (failRead) throw new IOException("read failed"); return bytes.read(b, offset, count); }
                @Override public void close() { closed = true; }
            };
        }
        @Override public void connect() {}
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public String getCipherSuite() { return "test"; }
        @Override public Certificate[] getLocalCertificates() { return null; }
        @Override public Certificate[] getServerCertificates() { return null; }
    }
}
