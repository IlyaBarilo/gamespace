package ru.local.gamespace.loader;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

final class AppUpdateCatalog {
    static final int MAX_BYTES = 1024 * 1024;
    static final String URL = "https://ilyabarilo.github.io/gamespace/apk/updates.json";
    static final String APPLICATION_ID = "ru.local.gamespace.loader";
    static final String REPOSITORY = "https://github.com/IlyaBarilo/gamespace";
    final List<Release> releases;

    private AppUpdateCatalog(List<Release> releases) { this.releases = Collections.unmodifiableList(releases); }

    static String decode(byte[] bytes) throws IOException {
        if (bytes.length == 0 || bytes.length > MAX_BYTES) throw UpdateJson.invalid();
        try {
            String value = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            return value.startsWith("\ufeff") ? value.substring(1) : value;
        } catch (CharacterCodingException error) { throw UpdateJson.invalid(); }
    }

    static AppUpdateCatalog parse(String json) throws IOException {
        if (json == null || json.length() > MAX_BYTES || json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw UpdateJson.invalid();
        Map<?, ?> root = object(UpdateJson.parse(json));
        if (number(root, "schemaVersion") != 1 || !APPLICATION_ID.equals(string(root, "applicationId"))
            || !"stable".equals(string(root, "channel"))) throw UpdateJson.invalid();
        Object list = root.get("releases");
        if (!(list instanceof List) || ((List<?>) list).isEmpty() || ((List<?>) list).size() > 100) throw UpdateJson.invalid();
        List<Release> releases = new ArrayList<Release>();
        long previous = Long.MAX_VALUE;
        for (Object item : (List<?>) list) {
            Map<?, ?> entry = object(item);
            String version = string(entry, "version");
            int code = versionCode(version);
            String tag = canonicalTag(version);
            if (!tag.equals(string(entry, "tag")) || number(entry, "versionCode") != code || code >= previous) throw UpdateJson.invalid();
            previous = code;
            String releaseUrl = REPOSITORY + "/releases/tag/" + tag;
            if (!releaseUrl.equals(string(entry, "releaseUrl"))) throw UpdateJson.invalid();
            String date = string(entry, "publishedAt");
            if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")) throw UpdateJson.invalid();
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC")); format.setLenient(false);
            ParsePosition position = new ParsePosition(0);
            if (format.parse(date, position) == null || position.getIndex() != date.length()) throw UpdateJson.invalid();
            String description = string(entry, "description");
            if (description.getBytes(StandardCharsets.UTF_8).length > 32768) throw UpdateJson.invalid();
            int minSdk = number(entry, "minSdk");
            Map<?, ?> apk = object(entry.get("apk"));
            String name = "GameSpace-" + version + ".apk";
            String apkUrl = REPOSITORY + "/releases/download/" + tag + "/" + name;
            if (!name.equals(string(apk, "name")) || !apkUrl.equals(string(apk, "url"))) throw UpdateJson.invalid();
            releases.add(new Release(version, code, date, description, minSdk, releaseUrl, apkUrl,
                number(apk, "size"), digest(apk, "sha256"), digest(apk, "signerSha256")));
        }
        if (number(root, "latestVersionCode") != releases.get(0).versionCode) throw UpdateJson.invalid();
        return new AppUpdateCatalog(releases);
    }

    static int versionCode(String version) throws IOException {
        if (version == null || !version.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) throw UpdateJson.invalid();
        try {
            String[] parts = version.split("\\.");
            long major = Long.parseLong(parts[0]), minor = Long.parseLong(parts[1]), patch = Long.parseLong(parts[2]);
            if (major > Integer.MAX_VALUE / 10000 || minor > 99 || patch > 99) throw UpdateJson.invalid();
            long value = major * 10000 + minor * 100 + patch;
            if (value <= 0 || value > Integer.MAX_VALUE) throw UpdateJson.invalid();
            return (int) value;
        } catch (NumberFormatException error) { throw UpdateJson.invalid(); }
    }

    private static String canonicalTag(String version) {
        if (version.endsWith(".0")) {
            version = version.substring(0, version.length() - 2);
            if (version.endsWith(".0")) version = version.substring(0, version.length() - 2);
        }
        return "v" + version;
    }
    private static Map<?, ?> object(Object value) throws IOException {
        if (!(value instanceof Map)) throw UpdateJson.invalid();
        return (Map<?, ?>) value;
    }
    private static String string(Map<?, ?> object, String key) throws IOException {
        Object value = object.get(key);
        if (!(value instanceof String)) throw UpdateJson.invalid();
        return (String) value;
    }
    private static int number(Map<?, ?> object, String key) throws IOException {
        Object value = object.get(key);
        if (!(value instanceof Long) || (Long) value <= 0 || (Long) value > Integer.MAX_VALUE) throw UpdateJson.invalid();
        return ((Long) value).intValue();
    }
    private static String digest(Map<?, ?> object, String key) throws IOException {
        String value = string(object, key);
        if (!value.matches("[0-9a-fA-F]{64}")) throw UpdateJson.invalid();
        return value.toLowerCase(Locale.US);
    }

    static final class Release {
        final String version, publishedAt, description, releaseUrl, apkUrl, sha256, signerSha256;
        final int versionCode, minSdk, size;
        Release(String version, int versionCode, String publishedAt, String description, int minSdk,
                String releaseUrl, String apkUrl, int size, String sha256, String signerSha256) {
            this.version = version; this.versionCode = versionCode; this.publishedAt = publishedAt;
            this.description = description; this.minSdk = minSdk; this.releaseUrl = releaseUrl;
            this.apkUrl = apkUrl; this.size = size; this.sha256 = sha256; this.signerSha256 = signerSha256;
        }
        boolean canUpdate(long installedCode, int sdk, String installedSigner) {
            return versionCode > installedCode && minSdk <= sdk && signerSha256.equals(installedSigner);
        }
    }
}
