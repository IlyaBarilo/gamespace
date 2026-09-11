package ru.local.gamespace.loader;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.io.File;
import java.io.IOException;

final class ApkUpdateInstaller {
    static final int REQUEST_SETTINGS = 6240;
    static final int REQUEST_INSTALL = 6241;
    static boolean allowed(Activity activity) { return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls(); }
    static void openPermissionSettings(Activity activity) {
        activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + activity.getPackageName())), REQUEST_SETTINGS);
    }
    @SuppressWarnings("deprecation")
    static void launch(Activity activity, File file) throws IOException {
        Uri uri = AppUpdateFileProvider.uri(activity, file);
        Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, AppUpdateFileProvider.MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_RETURN_RESULT, true);
        intent.setClipData(ClipData.newRawUri("Обновление GameSpace", uri));
        // Only a system installer receives the temporary grant, never a third-party file handler.
        ResolveInfo chosen = activity.getPackageManager().resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
        if (!system(chosen)) {
            chosen = null;
            for (ResolveInfo candidate : activity.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
                if (system(candidate)) { chosen = candidate; break; }
            }
        }
        if (chosen == null) throw new IOException("Системный установщик APK не найден на устройстве.");
        intent.setComponent(new ComponentName(chosen.activityInfo.packageName, chosen.activityInfo.name));
        activity.startActivityForResult(intent, REQUEST_INSTALL);
    }
    private static boolean system(ResolveInfo info) {
        return info != null && info.activityInfo != null && info.activityInfo.applicationInfo != null
            && (info.activityInfo.applicationInfo.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0;
    }
}
