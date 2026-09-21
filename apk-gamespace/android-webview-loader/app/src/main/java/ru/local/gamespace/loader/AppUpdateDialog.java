package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.IOException;
import java.text.DateFormat;
import java.text.DecimalFormat;
import java.util.Date;

/** Native update check only: APK downloads and installation are handled outside GameSpace. */
final class AppUpdateDialog {
    private final Activity activity;
    private final SharedPreferences prefs;
    private final AppUpdateRepository repository;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AlertDialog dialog;
    private LinearLayout content;
    private Thread worker;
    private boolean checking;
    private String error = "", notice = "";
    private volatile boolean destroyed;

    AppUpdateDialog(Activity activity) {
        this.activity = activity;
        prefs = activity.getSharedPreferences("gamespace_app_updates", Activity.MODE_PRIVATE);
        repository = new AppUpdateRepository(new AppUpdateRepository.Store() {
            @Override public String readJson() { return prefs.getString("catalog", ""); }
            @Override public long readTime() { return prefs.getLong("checked_at", 0); }
            @Override public boolean save(String json, long checkedAt) {
                return prefs.edit().putString("catalog", json).putLong("checked_at", checkedAt).commit();
            }
        }, new AppUpdateClient());
        try { repository.loadCached(); }
        catch (Exception ignored) { error = "Сохранённый результат недоступен. Можно выполнить новую проверку."; }
    }

    AlertDialog create() {
        ScrollView scroll = new ScrollView(activity);
        content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(8), dp(20), dp(8));
        scroll.addView(content);
        dialog = new AlertDialog.Builder(activity).setTitle("Обновление приложения")
            .setView(scroll).setPositiveButton("Проверить обновления", null).setNegativeButton("Закрыть", null).create();
        render();
        return dialog;
    }

    MenuStatus menuStatus() {
        AppUpdateRepository.Snapshot snapshot = repository.current();
        if (snapshot == null) return new MenuStatus("Проверка обновлений ещё не выполнялась", 0L);
        AppUpdateCatalog.Release latest = snapshot.catalog.releases.get(0);
        long installedCode = installedVersionCode();
        String status;
        if (installedCode < 0L) {
            status = "Установленная версия не определена; последний выпуск " + latest.version;
        } else if (latest.minSdk > Build.VERSION.SDK_INT) {
            status = "Последний выпуск " + latest.version + " требует Android API " + latest.minSdk;
        } else if (latest.versionCode > installedCode) {
            status = "Доступна версия " + latest.version;
        } else if (latest.versionCode == installedCode) {
            status = "Установлена актуальная версия " + latest.version;
        } else {
            status = "Установленная версия новее выпуска " + latest.version;
        }
        return new MenuStatus(status, snapshot.checkedAt);
    }

    void shown() {
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new android.view.View.OnClickListener() {
            @Override public void onClick(android.view.View view) { check(); }
        });
        render();
    }

    private void check() {
        if (checking || destroyed) return;
        checking = true;
        error = "";
        notice = "";
        render();
        worker = new Thread(new Runnable() {
            @Override public void run() {
                String failure = "";
                try { repository.check(); }
                catch (Exception e) { failure = message(e); }
                final String result = failure;
                post(new Runnable() {
                    @Override public void run() {
                        checking = false;
                        worker = null;
                        error = result;
                        renderIfVisible();
                    }
                });
            }
        }, "gamespace-update-check");
        worker.start();
    }

    private void openRelease(AppUpdateCatalog.Release release) {
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(release.releaseUrl)));
            notice = "Страница выпуска открыта в браузере. Скачивание и установка выполняются вне GameSpace.";
        } catch (RuntimeException unavailable) {
            error = "Не удалось открыть страницу выпуска в браузере.";
        }
        renderIfVisible();
    }

    private void post(Runnable action) {
        if (!destroyed) handler.post(new Runnable() {
            @Override public void run() { if (!destroyed) action.run(); }
        });
    }

    private void renderIfVisible() {
        if (dialog != null && dialog.isShowing()) render();
    }

    private void render() {
        content.removeAllViews();
        long installedCode = installedVersionCode();
        text("Установлена версия " + installedVersionName(), true);
        text("Проверка выполняется только по кнопке. Источник — официальные выпуски GameSpace на GitHub.", false);
        text("GameSpace не скачивает и не устанавливает APK. Для обновления откройте официальный выпуск в браузере.", false);
        AppUpdateRepository.Snapshot snapshot = repository.current();
        if (checking) text("Проверяю обновления…", true);
        if (error.length() > 0) text(error, true);
        if (notice.length() > 0) text(notice, false);
        if (snapshot == null) text("Успешных проверок пока нет.", false);
        else {
            text("Последняя успешная проверка: " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(snapshot.checkedAt)), false);
            if (error.length() > 0 || checking) text("Ниже показан последний полученный результат.", false);
            if (!snapshot.saved) text("Результат получен, но сохранить его на устройстве не удалось.", false);
            final AppUpdateCatalog.Release latest = snapshot.catalog.releases.get(0);
            text("Последний выпуск: GameSpace " + latest.version, true);
            if (installedCode < 0) {
                text("Не удалось определить установленную версию приложения.", false);
            } else if (latest.minSdk > Build.VERSION.SDK_INT) {
                text("Этот выпуск требует Android API " + latest.minSdk + "; на устройстве API " + Build.VERSION.SDK_INT + ".", false);
            } else if (latest.versionCode > installedCode) {
                text("Доступна новая версия.", true);
            } else if (latest.versionCode == installedCode) {
                text("Установлена актуальная версия.", true);
            } else {
                text("Установленная версия новее опубликованной.", false);
            }
            text("Опубликовано: " + latest.publishedAt.substring(0, 10) + "\nРазмер APK: " + mib(latest.size) + " МиБ", false);
            text(latest.description.length() == 0 ? "Описание выпуска не добавлено." : latest.description, false);
            button("Открыть официальный выпуск", !checking, new Runnable() {
                @Override public void run() { openRelease(latest); }
            });
        }
        if (dialog != null && dialog.getButton(AlertDialog.BUTTON_POSITIVE) != null) {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!checking && !destroyed);
        }
    }

    private String installedVersionName() {
        try { return packageInfo().versionName; }
        catch (Exception ignored) { return "не определена"; }
    }

    @SuppressWarnings("deprecation")
    private long installedVersionCode() {
        try {
            PackageInfo info = packageInfo();
            return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception ignored) { return -1; }
    }

    private PackageInfo packageInfo() throws Exception {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
    }

    private void button(String label, boolean enabled, Runnable action) {
        Button button = new Button(activity);
        button.setText(label);
        button.setAllCaps(false);
        button.setEnabled(enabled);
        button.setOnClickListener(new android.view.View.OnClickListener() {
            @Override public void onClick(android.view.View view) { action.run(); }
        });
        content.addView(button);
    }

    private TextView text(String value, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(bold ? 17 : 15);
        view.setTextColor(Color.rgb(30, 38, 46));
        view.setTextIsSelectable(true);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(8), 0, dp(8));
        content.addView(view, params);
        return view;
    }

    private static String mib(long bytes) {
        return new DecimalFormat("0.##").format(bytes / (1024.0 * 1024.0));
    }

    private static String message(Exception e) {
        if (e instanceof java.net.UnknownHostException) return "Сервер недоступен. Проверьте подключение к интернету.";
        if (e instanceof java.net.SocketTimeoutException) return "Сервер не ответил вовремя. Повторите попытку.";
        if (e instanceof javax.net.ssl.SSLException) return "Не удалось установить защищённое соединение. Проверьте дату устройства и подключение.";
        if (e instanceof IOException && e.getMessage() != null) return e.getMessage();
        return "Не удалось проверить обновления. Повторите попытку позже.";
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    static final class MenuStatus {
        final String text;
        final long checkedAt;

        MenuStatus(String text, long checkedAt) {
            this.text = text;
            this.checkedAt = checkedAt;
        }
    }

    void destroy() {
        destroyed = true;
        if (worker != null) worker.interrupt();
        handler.removeCallbacksAndMessages(null);
        if (dialog != null) dialog.dismiss();
    }
}
