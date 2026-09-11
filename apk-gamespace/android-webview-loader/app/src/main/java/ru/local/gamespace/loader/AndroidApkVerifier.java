package ru.local.gamespace.loader;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.res.XmlResourceParser;
import android.os.Build;
import java.io.File;
import java.io.IOException;
import java.security.MessageDigest;
import org.xmlpull.v1.XmlPullParser;

final class AndroidApkVerifier implements ApkUpdateFiles.Verifier {
    private final Context context;
    AndroidApkVerifier(Context context) { this.context = context.getApplicationContext(); }

    @SuppressWarnings("deprecation")
    static ApkUpdateIdentity installed(Context context) throws IOException {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), signingFlags());
            return identity(info, Build.VERSION.SDK_INT >= 24 ? info.applicationInfo.minSdkVersion : 1);
        } catch (Exception error) { throw new IOException("Не удалось прочитать версию и подпись установленного приложения.", error); }
    }

    @Override public void verify(File file, AppUpdateCatalog.Release release) throws IOException {
        try {
            PackageManager manager = context.getPackageManager();
            PackageInfo archive = manager.getPackageArchiveInfo(file.getAbsolutePath(), signingFlags());
            if (archive == null || archive.applicationInfo == null) throw new IOException("Android не смог прочитать или проверить APK.");
            if (archive.splitNames != null && archive.splitNames.length > 0) throw new IOException("Для обновления нужен самостоятельный APK, а не split-пакет.");
            int minSdk;
            if (Build.VERSION.SDK_INT >= 24) minSdk = archive.applicationInfo.minSdkVersion;
            else {
                // ApplicationInfo.minSdkVersion is public only from API 24.
                // API 23 reads the compiled manifest using public Resources APIs.
                archive.applicationInfo.sourceDir = file.getAbsolutePath();
                archive.applicationInfo.publicSourceDir = file.getAbsolutePath();
                minSdk = 1;
                try (XmlResourceParser xml = manager.getResourcesForApplication(archive.applicationInfo).getAssets().openXmlResourceParser("AndroidManifest.xml")) {
                    for (int event = xml.getEventType(); event != XmlPullParser.END_DOCUMENT; event = xml.next()) {
                        if (event == XmlPullParser.START_TAG && "uses-sdk".equals(xml.getName())) {
                            minSdk = xml.getAttributeIntValue("http://schemas.android.com/apk/res/android", "minSdkVersion", -1);
                            break;
                        }
                    }
                }
            }
            ApkUpdateIdentity.requireCompatible(release, installed(context), identity(archive, minSdk), Build.VERSION.SDK_INT);
        } catch (IOException error) { throw error; }
        catch (Exception error) { throw new IOException("Не удалось проверить пакет, версию или подпись APK.", error); }
    }

    @SuppressWarnings("deprecation")
    private static int signingFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    @SuppressWarnings("deprecation")
    private static ApkUpdateIdentity identity(PackageInfo info, int minSdk) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null || signatures.length != 1) throw new IOException("Ожидалась одна проверенная подпись APK.");
        String signer = ApkUpdateTransfer.hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
        return new ApkUpdateIdentity(info.packageName, info.versionName,
            Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode, minSdk, signer);
    }
}
