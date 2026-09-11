package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.IOException;
import java.text.DateFormat;
import java.text.DecimalFormat;
import java.util.Date;

/** Native UI only: never exposed to imported pages or JavaScript. */
final class AppUpdateDialog {
    interface SiteState { boolean isBusy(); }
    private final Activity activity;
    private final SiteState site;
    private final SharedPreferences prefs;
    private final AppUpdateRepository repository;
    private final ApkUpdateFiles files;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ApkUpdateIdentity installed;
    private AlertDialog dialog;
    private LinearLayout content;
    private TextView progressText;
    private ProgressBar progressBar;
    private Thread worker;
    private ApkUpdateTransfer.Cancellation cancellation;
    private boolean checking, fileTask, installing, installationObserved, resumed = true;
    private String error = "", notice = "", workLabel = "";
    private long received = -1, total;
    private volatile boolean destroyed;

    AppUpdateDialog(Activity activity, SiteState site) {
        this.activity = activity; this.site = site;
        prefs = activity.getSharedPreferences("gamespace_app_updates", Activity.MODE_PRIVATE);
        repository = new AppUpdateRepository(new AppUpdateRepository.Store() {
            @Override public String readJson() { return prefs.getString("catalog", ""); }
            @Override public long readTime() { return prefs.getLong("checked_at", 0); }
            @Override public boolean save(String json, long checkedAt) {
                return prefs.edit().putString("catalog", json).putLong("checked_at", checkedAt).commit();
            }
        }, new AppUpdateClient());
        files = new ApkUpdateFiles(AppUpdateFileProvider.directory(activity), new ApkUpdateTransfer(), new AndroidApkVerifier(activity));
        refreshInstalled();
        try { repository.loadCached(); }
        catch (Exception ignored) { error = "Сохранённый результат недоступен. Можно выполнить новую проверку."; }
        observeInstallation();
    }
    AlertDialog create() {
        ScrollView scroll = new ScrollView(activity);
        content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(8), dp(20), dp(8)); scroll.addView(content);
        dialog = new AlertDialog.Builder(activity).setTitle("Обновление приложения")
            .setView(scroll).setPositiveButton("Проверить обновления", null).setNegativeButton("Закрыть", null).create();
        render(); return dialog;
    }
    void shown() { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View view) { check(); } }); render(); }
    boolean blocksSiteOperations() { return fileTask || installing; }
    private boolean working() { return checking || fileTask || installing || destroyed; }
    private boolean mayStartFileTask() {
        if (working()) return false;
        if (site.isBusy()) { error = "Дождитесь завершения операции с сайтом или его восстановления."; render(); return false; }
        return true;
    }
    private void check() {
        if (working()) return;
        checking = true; error = ""; notice = ""; render();
        worker = new Thread(new Runnable() { @Override public void run() {
            String failure = "";
            try { repository.check(); } catch (Exception e) { failure = message(e); }
            final String result = failure;
            post(new Runnable() { @Override public void run() { checking = false; worker = null; error = result; renderIfVisible(); } });
        } }, "gamespace-update-check");
        worker.start();
    }
    private void download(final AppUpdateCatalog.Release release) {
        if (!mayStartFileTask()) return;
        beginFileTask("Скачиваю APK…");
        final ApkUpdateTransfer.Cancellation token = cancellation;
        worker = new Thread(new Runnable() { @Override public void run() {
            String failure = "";
            try {
                final long[] lastProgress = {0};
                files.download(release, token, new ApkUpdateTransfer.Progress() { @Override public void update(final long count, final long size) {
                    long now = System.nanoTime();
                    if (count != size && now - lastProgress[0] < 250_000_000L) return;
                    lastProgress[0] = now;
                    post(new Runnable() { @Override public void run() { if (fileTask && !token.isCancelled()) { received = count; total = size; updateProgress(); } } });
                } });
            } catch (Exception e) { failure = token.isCancelled() ? "Загрузка отменена." : message(e); }
            final String result = failure;
            post(new Runnable() { @Override public void run() {
                endFileTask(); error = result;
                if (result.length() == 0) notice = "APK скачан и проверен. Можно перейти к установке.";
                renderIfVisible();
            } });
        } }, "gamespace-apk-download");
        worker.start();
    }
    private void install(final AppUpdateCatalog.Release release) {
        if (!mayStartFileTask()) return;
        beginFileTask("Повторно проверяю APK перед установкой…");
        final ApkUpdateTransfer.Cancellation token = cancellation;
        worker = new Thread(new Runnable() { @Override public void run() {
            File verified = null; String failure = "";
            try { verified = files.verifyReady(release, token); }
            catch (Exception e) { failure = token.isCancelled() ? "Проверка APK отменена." : message(e); }
            final File apk = verified; final String result = failure;
            post(new Runnable() { @Override public void run() {
                endFileTask(); error = result;
                if (apk != null && !token.isCancelled()) {
                    if (resumed && dialog != null && dialog.isShowing() && !site.isBusy()) launchInstaller(apk, release);
                    else notice = "APK проверен. Откройте окно обновления и нажмите «Установить» ещё раз.";
                }
                renderIfVisible();
            } });
        } }, "gamespace-apk-verify");
        worker.start();
    }
    private void launchInstaller(File apk, AppUpdateCatalog.Release release) {
        if (site.isBusy() || destroyed) { error = "Установка недоступна во время операции с сайтом."; return; }
        try {
            if (!ApkUpdateInstaller.allowed(activity)) {
                notice = "Разрешите GameSpace устанавливать обновления. После возврата нажмите «Установить» ещё раз.";
                ApkUpdateInstaller.openPermissionSettings(activity);
                return;
            }
            refreshInstalled();
            if (installed == null || !release.canUpdate(installed.code, Build.VERSION.SDK_INT, installed.signer)) throw new IOException("Этот APK больше не подходит установленной версии. Повторите проверку обновлений.");
            if (!prefs.edit().putLong("install_target", release.versionCode).putLong("install_from", installed.code).commit()) throw new IOException("Не удалось сохранить сведения о предстоящей установке.");
            installing = true; installationObserved = false;
            ApkUpdateInstaller.launch(activity, apk);
            notice = "Подтвердите обновление в системном установщике Android.";
        } catch (Exception e) { installing = false; error = message(e); }
    }
    private void discard() {
        if (!mayStartFileTask()) return;
        beginFileTask("Удаляю скачанные файлы APK…");
        worker = new Thread(new Runnable() { @Override public void run() {
            String failure = "";
            try { files.discard(); } catch (Exception e) { failure = message(e); }
            final String result = failure;
            post(new Runnable() { @Override public void run() { endFileTask(); error = result; if (result.length() == 0) notice = "Скачанные файлы APK удалены."; renderIfVisible(); } });
        } }, "gamespace-apk-discard");
        worker.start();
    }
    private void beginFileTask(String label) {
        fileTask = true; cancellation = new ApkUpdateTransfer.Cancellation(); received = -1; total = 0;
        workLabel = label; error = ""; notice = ""; render();
    }
    private void endFileTask() { fileTask = false; worker = null; cancellation = null; }
    private void cancel() {
        if (cancellation != null) {
            cancellation.cancel(); if (worker != null) worker.interrupt();
            workLabel = "Отменяю операцию…"; received = -1; updateProgress();
        }
    }
    void paused() { resumed = false; }
    void resumed() { resumed = true; refreshInstalled(); observeInstallation(); renderIfVisible(); }
    void activityResult(int requestCode) {
        if (requestCode == ApkUpdateInstaller.REQUEST_INSTALL) {
            installing = false; refreshInstalled();
            if (!observeInstallation() && !installationObserved) notice = "Обновление пока не установлено. Проверенный APK сохранён, можно повторить установку.";
        } else if (requestCode == ApkUpdateInstaller.REQUEST_SETTINGS) {
            notice = "Для установки нажмите «Установить» ещё раз. Android проверит разрешение.";
        }
        renderIfVisible();
    }
    private void refreshInstalled() {
        try { installed = AndroidApkVerifier.installed(activity); }
        catch (IOException ignored) { installed = null; }
    }
    private boolean observeInstallation() {
        long target = prefs.getLong("install_target", 0), previous = prefs.getLong("install_from", 0);
        if (installed != null && previous > 0 && target > previous && installed.code >= target) {
            notice = "Обновление завершено. Установлена версия " + installed.version + ".";
            prefs.edit().remove("install_target").remove("install_from").apply();
            installing = false; installationObserved = true; return true;
        }
        return false;
    }
    private void post(Runnable action) { if (!destroyed) handler.post(new Runnable() { @Override public void run() { if (!destroyed) action.run(); } }); }
    private void renderIfVisible() { if (dialog != null && dialog.isShowing()) render(); }
    private void render() {
        content.removeAllViews(); progressText = null; progressBar = null;
        text("Установлена версия " + (installed == null ? "не определена" : installed.version), true);
        text("Проверка выполняется только по кнопке. Источник — официальные выпуски GameSpace на GitHub.", false);
        AppUpdateRepository.Snapshot snapshot = repository.current();
        if (checking) text("Проверяю обновления…", true);
        if (error.length() > 0) text(error, true);
        if (notice.length() > 0) text(notice, false);
        if (fileTask) {
            progressText = text(workLabel, true);
            progressBar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
            progressBar.setMax(1000); content.addView(progressBar); updateProgress();
            button("Отменить операцию", true, new Runnable() { @Override public void run() { cancel(); } });
        }
        if (snapshot == null) text("Успешных проверок пока нет.", false);
        else {
            text("Последняя успешная проверка: " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(snapshot.checkedAt)), false);
            if (error.length() > 0 || checking) text("Ниже показан последний полученный результат.", false);
            if (!snapshot.saved) text("Результат получен, но сохранить его на устройстве не удалось.", false);
            AppUpdateCatalog.Release latest = snapshot.catalog.releases.get(0);
            text("Последний выпуск: GameSpace " + latest.version, true);
            boolean compatible = installed != null && latest.canUpdate(installed.code, Build.VERSION.SDK_INT, installed.signer);
            if (installed == null) text("Не удалось определить версию или подпись установленного приложения.", false);
            else if (!latest.signerSha256.equals(installed.signer)) text("Подпись выпуска отличается от установленного приложения. Обновление поверх этой установки недоступно.", false);
            else if (latest.minSdk > Build.VERSION.SDK_INT) text("Этот выпуск требует Android API " + latest.minSdk + "; на устройстве API " + Build.VERSION.SDK_INT + ".", false);
            else if (compatible) text("Доступна новая версия.", true);
            else if (latest.versionCode == installed.code) text("Установлена актуальная версия.", true);
            else text("Установленная версия новее опубликованной. Понижение не предлагается.", false);
            text("Опубликовано: " + latest.publishedAt.substring(0, 10) + "\nРазмер APK: " + mib(latest.size) + " МиБ", false);
            text(latest.description.length() == 0 ? "Описание выпуска не добавлено." : latest.description, false);
            boolean ready = files.hasReady(latest);
            if (compatible) {
                if (ready) {
                    text("APK сохранён. Перед установкой файл будет проверен повторно. Сайт и сохранения остаются в приложении.", false);
                    button("Установить", !working() && !site.isBusy(), new Runnable() { @Override public void run() { install(latest); } });
                } else button("Скачать APK", !working() && !site.isBusy(), new Runnable() { @Override public void run() { download(latest); } });
            }
        }
        if (files.hasFiles()) button("Удалить скачанные файлы APK", !working(), new Runnable() { @Override public void run() { discard(); } });
        if (dialog != null && dialog.getButton(AlertDialog.BUTTON_POSITIVE) != null) dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!working());
    }
    private void updateProgress() {
        if (progressText == null || progressBar == null) return;
        boolean determinate = received >= 0 && total > 0;
        progressBar.setIndeterminate(!determinate);
        if (determinate) {
            progressBar.setProgress((int) (received * 1000 / total));
            progressText.setText(received == total ? "Файл получен. Проверяю APK…"
                : "Скачиваю APK: " + mib(received) + " из " + mib(total) + " МиБ (" + (received * 100 / total) + "%)");
        } else progressText.setText(workLabel);
    }
    private void button(String label, boolean enabled, Runnable action) {
        Button button = new Button(activity); button.setText(label); button.setAllCaps(false); button.setEnabled(enabled);
        button.setOnClickListener(new android.view.View.OnClickListener() { @Override public void onClick(android.view.View view) { action.run(); } }); content.addView(button);
    }
    private TextView text(String value, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value); view.setTextSize(bold ? 17 : 15); view.setTextColor(Color.rgb(30, 38, 46)); view.setTextIsSelectable(true);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(8), 0, dp(8)); content.addView(view, params); return view;
    }
    private static String mib(long bytes) { return new DecimalFormat("0.##").format(bytes / (1024.0 * 1024.0)); }
    private static String message(Exception e) {
        if (e instanceof java.net.UnknownHostException) return "Сервер недоступен. Проверьте подключение к интернету.";
        if (e instanceof java.net.SocketTimeoutException) return "Сервер не ответил вовремя. Повторите попытку.";
        if (e instanceof javax.net.ssl.SSLException) return "Не удалось установить защищённое соединение. Проверьте дату устройства и подключение.";
        if (e instanceof IOException && e.getMessage() != null) return e.getMessage();
        return "Не удалось выполнить операцию обновления. Повторите попытку позже.";
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    void destroy() {
        destroyed = true; if (cancellation != null) cancellation.cancel();
        if (worker != null) worker.interrupt(); handler.removeCallbacksAndMessages(null);
        if (dialog != null) dialog.dismiss();
    }
}
