package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.security.MessageDigest;
import java.text.DateFormat;
import java.text.DecimalFormat;
import java.util.Date;
import java.util.Locale;

/** Native UI only: never exposed to imported pages or JavaScript. */
final class AppUpdateDialog {
    private final Activity activity;
    private final AppUpdateRepository repository;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final String installedVersion;
    private final long installedCode;
    private final String installedSigner;
    private AlertDialog dialog;
    private LinearLayout content;
    private Thread worker;
    private boolean checking;
    private String error = "";
    private volatile boolean destroyed;

    @SuppressWarnings("deprecation")
    AppUpdateDialog(Activity activity) {
        this.activity = activity;
        final SharedPreferences prefs = activity.getSharedPreferences("gamespace_app_updates", Activity.MODE_PRIVATE);
        repository = new AppUpdateRepository(new AppUpdateRepository.Store() {
            @Override public String readJson() { return prefs.getString("catalog", ""); }
            @Override public long readTime() { return prefs.getLong("checked_at", 0); }
            @Override public boolean save(String json, long checkedAt) {
                return prefs.edit().putString("catalog", json).putLong("checked_at", checkedAt).commit();
            }
        }, new AppUpdateClient());
        String version = "не определена", signer = "";
        long code = -1;
        try {
            PackageManager manager = activity.getPackageManager();
            PackageInfo info = manager.getPackageInfo(activity.getPackageName(), 0);
            version = info.versionName;
            code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo signed = manager.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = signed.signingInfo == null ? null : signed.signingInfo.getApkContentsSigners();
            } else signatures = manager.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
            if (signatures != null && signatures.length == 1) {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
                StringBuilder hex = new StringBuilder();
                for (byte b : digest) hex.append(String.format(Locale.US, "%02x", b & 255));
                signer = hex.toString();
            }
        } catch (Exception ignored) { }
        installedVersion = version; installedCode = code; installedSigner = signer;
        try { repository.loadCached(); }
        catch (Exception ignored) { error = "Сохранённый результат недоступен. Можно выполнить новую проверку."; }
    }

    AlertDialog create() {
        ScrollView scroll = new ScrollView(activity);
        content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(20);
        content.setPadding(padding, dp(8), padding, dp(8));
        scroll.addView(content);
        dialog = new AlertDialog.Builder(activity).setTitle("Обновление приложения")
            .setView(scroll).setPositiveButton("Проверить обновления", null).setNegativeButton("Закрыть", null).create();
        render();
        return dialog;
    }

    void shown() {
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { check(); }
        });
        render();
    }

    private void check() {
        if (checking || destroyed) return;
        checking = true; error = ""; render();
        worker = new Thread(new Runnable() {
            @Override public void run() {
                String failure = "";
                try { repository.check(); }
                catch (java.net.UnknownHostException e) { failure = "Сервер недоступен. Проверьте подключение к интернету."; }
                catch (java.net.SocketTimeoutException e) { failure = "Сервер не ответил вовремя. Повторите проверку."; }
                catch (javax.net.ssl.SSLException e) { failure = "Не удалось установить защищённое соединение. Проверьте дату устройства и подключение."; }
                catch (java.io.IOException e) { failure = e.getMessage() == null ? "Не удалось проверить обновления." : e.getMessage(); }
                catch (Exception e) { failure = "Не удалось проверить обновления. Повторите попытку позже."; }
                final String message = failure;
                if (!destroyed) handler.post(new Runnable() {
                    @Override public void run() {
                        if (destroyed) return;
                        checking = false; error = message; worker = null;
                        if (dialog != null && dialog.isShowing()) render();
                    }
                });
            }
        }, "gamespace-update-check");
        worker.start();
    }

    private void render() {
        content.removeAllViews();
        text("Установлена версия " + installedVersion, true);
        text("Проверка выполняется только по кнопке. Источник — официальные выпуски GameSpace на GitHub.", false);
        AppUpdateRepository.Snapshot snapshot = repository.current();
        if (checking) text("Проверяю обновления…", true);
        if (error.length() > 0) text(error, true);
        if (snapshot == null) text("Успешных проверок пока нет.", false);
        else {
            text("Последняя успешная проверка: " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(snapshot.checkedAt)), false);
            if (error.length() > 0 || checking) text("Ниже показан последний полученный результат.", false);
            if (!snapshot.saved) text("Результат получен, но сохранить его на устройстве не удалось.", false);
            AppUpdateCatalog.Release latest = snapshot.catalog.releases.get(0);
            text("Последний выпуск: GameSpace " + latest.version, true);
            if (installedCode < 0 || installedSigner.length() == 0) text("Не удалось определить версию или подпись установленного приложения.", false);
            else if (!latest.signerSha256.equals(installedSigner)) text("Подпись выпуска отличается от установленного приложения. Обновление поверх этой установки недоступно.", false);
            else if (latest.minSdk > Build.VERSION.SDK_INT) text("Этот выпуск требует Android API " + latest.minSdk + "; на устройстве API " + Build.VERSION.SDK_INT + ".", false);
            else if (latest.canUpdate(installedCode, Build.VERSION.SDK_INT, installedSigner)) text("Доступна новая версия.", true);
            else if (latest.versionCode == installedCode) text("Установлена актуальная версия.", true);
            else text("Установленная версия новее опубликованной. Понижение не предлагается.", false);
            text("Опубликовано: " + latest.publishedAt.substring(0, 10) + "\nРазмер APK: "
                + new DecimalFormat("0.##").format(latest.size / (1024.0 * 1024.0)) + " МиБ", false);
            text(latest.description.length() == 0 ? "Описание выпуска не добавлено." : latest.description, false);
        }
        if (dialog != null && dialog.getButton(AlertDialog.BUTTON_POSITIVE) != null) {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!checking && !destroyed);
        }
    }

    private void text(String value, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value); view.setTextSize(bold ? 17 : 15); view.setTextColor(Color.rgb(30, 38, 46));
        view.setTextIsSelectable(true);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(8), 0, dp(8));
        content.addView(view, params);
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    void destroy() {
        destroyed = true;
        if (worker != null) worker.interrupt();
        handler.removeCallbacksAndMessages(null);
        if (dialog != null) dialog.dismiss();
    }
}
