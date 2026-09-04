package ru.local.gamespace.loader;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry;
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile;

/** Runs the actual APK ZIP extraction method with only Android/UI services replaced. */
public final class ZipFailureTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        String source = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        Path output = Paths.get(args[1]).toAbsolutePath();
        String harness = "package ru.local.gamespace.loader;\n"
            + "import java.io.*; import java.nio.charset.*; import java.nio.channels.*; import java.util.zip.*;\n"
            + "import org.apache.commons.compress.archivers.sevenz.*;\n"
            + "public final class ZipHarness {\n"
            + "private static final int BUFFER_SIZE=262144; private InputStream input;\n"
            + "private static ArchiveStatistics lastStatistics;\n"
            + "public static long[] statistics() { return new long[]{lastStatistics.values[ArchiveStatistics.Metric.READ.ordinal()][2],lastStatistics.values[ArchiveStatistics.Metric.WRITE.ordinal()][2],lastStatistics.completedFiles}; }\n"
            + "private static class Uri {}\n"
            + "private class ContentResolver { InputStream openInputStream(Uri uri) { return input; } }\n"
            + "private ContentResolver getContentResolver() { return new ContentResolver(); }\n"
            + "private long getContentSize(Uri uri) { return -1L; }\n"
            + "private void updateProgress(String text) {}\n"
            + "private static void checkpointArchive(ZipReadContext context) {}\n"
            + "private String withTrailingSeparator(String path) { return path + File.separator; }\n"
            + "private boolean shouldExtractForFastUpdate(File file, ZipEntry entry) { return true; }\n"
            + "private boolean shouldExtractForFastUpdate(File file, SevenZArchiveEntry entry) { return true; }\n"
            + "private String buildProgressText(String a,long b,long c,long d,int e,int f,int g,File h,boolean i,ProgressEstimator.Archive j) { return \"\"; }\n"
            + "private ZipDiagnosticException buildZipDiagnosticException(Exception error,ZipReadContext context) { return new ZipDiagnosticException(DiagnosticReport.technicalDetails(error),error,context.stage); }\n"
            + member(source, "    private ZipStats extractZipWithCharset(", "    private ZipStats extractSevenZ(")
            + member(source, "    private ZipStats extractSevenZFromChannel(", "    private boolean shouldExtractForFastUpdate(")
            + member(source, "    private long safeChannelPosition(", "    private ZipDiagnosticException buildZipDiagnosticException(")
            + member(source, "    private String normalizeZipEntryName(", "    private File findIndexInExtractedContent(")
            + member(source, "    private static class ZipStats {", "    private static class InstallContext {")
            + source.substring(source.indexOf("    private static class CountingInputStream extends FilterInputStream {"), source.lastIndexOf("\n}"))
            + "public static String run(InputStream input,File directory) throws Exception {\n"
            + "ZipHarness instance=new ZipHarness(); instance.input=input;\n"
            + "lastStatistics=new ArchiveStatistics();\n"
            + "try { ZipStats stats=instance.extractZipWithCharset(new Uri(),directory,\"fixture.zip\",false,StandardCharsets.UTF_8,lastStatistics); return \"OK:\"+stats.files+\":\"+stats.bytes; }\n"
            + "catch (ZipDiagnosticException error) { return error.stage+\"\\n\"+error.getMessage(); } }\n"
            + "public static String run7z(File archive,File directory) throws Exception {\n"
            + "try (FileInputStream input=new FileInputStream(archive)) {\n"
            + "lastStatistics=new ArchiveStatistics();\n"
            + "try { ZipStats stats=new ZipHarness().extractSevenZFromChannel(input.getChannel(),archive.length(),directory,\"fixture.7z\",false,\"open\",lastStatistics); return \"OK:\"+stats.files+\":\"+stats.bytes; }\n"
            + "catch (ZipDiagnosticException error) { return error.stage+\"\\n\"+error.getMessage(); } } } }";

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) { throw new AssertionError("JDK compiler is required"); }
        final String compilationSource = harness;
        JavaFileObject unit = new SimpleJavaFileObject(URI.create("string:///ru/local/gamespace/loader/ZipHarness.java"), JavaFileObject.Kind.SOURCE) {
            @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return compilationSource; }
        };
        boolean compiled = compiler.getTask(null, null, null,
            Arrays.asList("-classpath", System.getProperty("java.class.path"), "-d", output.toString()), null, Arrays.asList(unit)).call();
        if (!compiled) { throw new AssertionError("Could not compile the actual APK extraction method"); }

        try (URLClassLoader loader = new URLClassLoader(new URL[] {output.toUri().toURL()}, ZipFailureTest.class.getClassLoader())) {
            Method run = loader.loadClass("ru.local.gamespace.loader.ZipHarness").getMethod("run", InputStream.class, File.class);
            Path fixtures = Files.createTempDirectory(output, "zip-fixtures-");
            byte[] archive = fixture();
            String result = invoke(run, new ByteArrayInputStream(archive), fixtures.resolve("valid"));
            check(result.equals("OK:1:8192"), "Valid ZIP must still unpack: " + result);
            check(Files.size(fixtures.resolve("valid/index.html")) == 8192, "All valid data must be written");
            Method counters = loader.loadClass("ru.local.gamespace.loader.ZipHarness").getMethod("statistics");
            long[] zipCounters = (long[]) counters.invoke(null);
            check(zipCounters[0] > 8192 && zipCounters[1] == 8192 && zipCounters[2] == 1, "ZIP statistics count actual source and destination bytes");

            byte[] corrupt = archive.clone();
            corrupt[45] ^= 1;
            result = invoke(run, new ByteArrayInputStream(corrupt), fixtures.resolve("crc"));
            check(result.startsWith("чтение данных ZIP-записи\n") && result.contains("CRC"), "CRC failure stage: " + result);

            result = invoke(run, new ByteArrayInputStream(Arrays.copyOf(archive, 300)), fixtures.resolve("truncated"));
            check(result.startsWith("чтение данных ZIP-записи\n"), "Truncated data must not be reported as close failure: " + result);

            result = invoke(run, null, fixtures.resolve("no-stream"));
            check(result.startsWith("открытие выбранного ZIP\n"), "Null provider stream must identify opening stage");

            Path conflict = Files.createDirectories(fixtures.resolve("conflict/index.html")).getParent();
            result = invoke(run, new ByteArrayInputStream(archive), conflict);
            check(result.startsWith("открытие файла назначения\n"), "Output failure must identify destination file stage: " + result);

            InputStream closeFailure = new ByteArrayInputStream(corrupt) {
                @Override public void close() throws IOException { throw new IOException("secondary close failure"); }
            };
            result = invoke(run, closeFailure, fixtures.resolve("read-and-close"));
            check(result.startsWith("чтение данных ZIP-записи\n"), "Closing must not mask the original read failure");
            check(result.contains("CRC") && result.contains("secondary close failure"), "Original and suppressed close failures must both survive");

            Method run7z = loader.loadClass("ru.local.gamespace.loader.ZipHarness").getMethod("run7z", File.class, File.class);
            Path sevenZip = fixtures.resolve("fixture.7z");
            try (SevenZOutputFile seven = new SevenZOutputFile(sevenZip.toFile())) {
                SevenZArchiveEntry entry = new SevenZArchiveEntry();
                entry.setName("index.html");
                seven.putArchiveEntry(entry);
                seven.write(new byte[8192]);
                seven.closeArchiveEntry();
            }
            Path destination = Files.createDirectories(fixtures.resolve("seven-valid"));
            result = (String) run7z.invoke(null, sevenZip.toFile(), destination.toFile());
            check(result.equals("OK:1:8192"), "Valid 7z must still unpack: " + result);
            check(Files.size(destination.resolve("index.html")) == 8192, "All 7z data must be written");
            long[] sevenCounters = (long[]) counters.invoke(null);
            check(sevenCounters[0] > 0 && sevenCounters[1] == 8192 && sevenCounters[2] == 1, "7z statistics count actual source and destination bytes");
            Path badHeader = fixtures.resolve("invalid.7z");
            Files.write(badHeader, new byte[64]);
            result = (String) run7z.invoke(null, badHeader.toFile(), Files.createDirectories(fixtures.resolve("seven-invalid")).toFile());
            check(result.startsWith("чтение заголовка 7z\n"), "Invalid 7z must identify header stage: " + result);
            destination = Files.createDirectories(fixtures.resolve("seven-conflict/index.html")).getParent();
            result = (String) run7z.invoke(null, sevenZip.toFile(), destination.toFile());
            check(result.startsWith("открытие файла назначения\n"), "7z output failure must identify destination stage: " + result);
        }
        System.out.println("APK ZIP/7z extraction: " + checks + " runtime checks passed.");
    }

    private static String member(String source, String start, String end) {
        int from = source.indexOf(start);
        int to = source.indexOf(end, from);
        if (from < 0 || to < 0) { throw new AssertionError("Missing source member: " + start); }
        return source.substring(from, to);
    }

    private static String invoke(Method method, InputStream input, Path directory) throws Exception {
        Files.createDirectories(directory);
        return (String) method.invoke(null, input, directory.toFile());
    }

    private static byte[] fixture() throws IOException {
        byte[] payload = new byte[8192];
        Arrays.fill(payload, (byte) 'x');
        CRC32 crc = new CRC32();
        crc.update(payload);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            ZipEntry entry = new ZipEntry("index.html");
            entry.setMethod(ZipEntry.STORED);
            entry.setSize(payload.length);
            entry.setCrc(crc.getValue());
            zip.putNextEntry(entry);
            zip.write(payload);
            zip.closeEntry();
        }
        return output.toByteArray();
    }

    private static void check(boolean condition, String description) {
        checks++;
        if (!condition) { throw new AssertionError(description); }
    }
}
