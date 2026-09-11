package ru.local.gamespace.loader;

import java.io.IOException;

final class ApkUpdateIdentity {
    final String packageName, version, signer;
    final long code;
    final int minSdk;
    ApkUpdateIdentity(String packageName, String version, long code, int minSdk, String signer) {
        this.packageName = packageName; this.version = version; this.code = code; this.minSdk = minSdk; this.signer = signer;
    }
    static void requireCompatible(AppUpdateCatalog.Release release, ApkUpdateIdentity installed, ApkUpdateIdentity archive, int sdk) throws IOException {
        if (!AppUpdateCatalog.APPLICATION_ID.equals(installed.packageName) || !installed.packageName.equals(archive.packageName)) throw new IOException("APK принадлежит другому приложению.");
        if (!release.version.equals(archive.version) || release.versionCode != archive.code) throw new IOException("Версия внутри APK не совпадает с каталогом.");
        if (installed.code <= 0 || archive.code <= installed.code) throw new IOException("Эта версия уже установлена или старее установленной. Понижение не допускается.");
        if (archive.minSdk <= 0 || archive.minSdk != release.minSdk || archive.minSdk > sdk) throw new IOException("Требования Android внутри APK не совпадают с каталогом или не подходят устройству.");
        if (installed.signer == null || !installed.signer.matches("[0-9a-f]{64}") || !installed.signer.equals(archive.signer)
            || !installed.signer.equals(release.signerSha256)) throw new IOException("Подпись APK не совпадает с установленным приложением. Установка заблокирована.");
    }
}
