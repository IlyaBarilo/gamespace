package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.IOException;
import java.text.DateFormat;
import java.text.DecimalFormat;
import java.util.Date;

/** Native update check only: APK downloads and installation are handled outside GameSpace. */
final class AppUpdateDialog {
    private static final int BACKDROP = Color.rgb(2, 9, 22);
    private static final int SURFACE = Color.rgb(6, 24, 47);
    private static final int CARD = Color.rgb(10, 38, 71);
    private static final int CARD_PRESSED = Color.rgb(15, 54, 96);
    private static final int BORDER = Color.rgb(31, 83, 128);
    private static final int TEXT = Color.rgb(230, 244, 255);
    private static final int MUTED = Color.rgb(168, 199, 224);
    private static final int ACCENT = Color.rgb(91, 203, 245);

    private final Activity activity;
    private final SharedPreferences prefs;
    private final AppUpdateRepository repository;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AlertDialog dialog;
    private LinearLayout content;
    private Button checkButton;
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
        FrameLayout backdrop = new FrameLayout(activity);
        backdrop.setBackgroundColor(BACKDROP);

        LinearLayout page = new LinearLayout(activity);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(SURFACE);
        int pageWidth = Math.min(activity.getResources().getDisplayMetrics().widthPixels, dp(760));
        backdrop.addView(page, new FrameLayout.LayoutParams(pageWidth,
            ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER_HORIZONTAL));
        page.addView(header(), new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(16), dp(8), dp(16), dp(8));
        content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(14), dp(18), dp(18));
        content.setBackground(round(CARD, BORDER, 18));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        page.addView(scroll, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        checkButton = styledButton("Проверить обновления", true);
        checkButton.setContentDescription("Проверить официальные выпуски GameSpace на GitHub");
        checkButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { check(); }
        });
        LinearLayout footer = new LinearLayout(activity);
        footer.setPadding(dp(16), dp(8), dp(16), dp(18));
        footer.addView(checkButton, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        page.addView(footer);

        dialog = new AlertDialog.Builder(activity).setView(backdrop).create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override public void onShow(DialogInterface unused) { styleWindow(); }
        });
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
        render();
    }

    private View header() {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(20), dp(17), dp(12), dp(15));

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView kicker = label("ПРИЛОЖЕНИЕ", 11, ACCENT, true);
        kicker.setLetterSpacing(0.08f);
        copy.addView(kicker);
        copy.addView(label("Обновление GameSpace APK", 23, TEXT, true));
        copy.addView(label("Установлена версия " + installedVersionName(), 13, MUTED, false));
        row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        ImageButton close = new ImageButton(activity);
        close.setImageResource(R.drawable.ic_menu_close);
        close.setImageTintList(ColorStateList.valueOf(TEXT));
        close.setContentDescription("Закрыть проверку обновлений");
        close.setPadding(dp(12), dp(12), dp(12), dp(12));
        close.setBackground(round(CARD, BORDER, 14));
        close.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { if (dialog != null) dialog.dismiss(); }
        });
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        closeParams.setMargins(dp(12), 0, 0, 0);
        row.addView(close, closeParams);
        return row;
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
        if (checkButton != null) checkButton.setEnabled(!checking && !destroyed);
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
        Button button = styledButton(label, false);
        button.setEnabled(enabled);
        button.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { action.run(); }
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        params.setMargins(0, dp(10), 0, 0);
        content.addView(button, params);
    }

    private TextView text(String value, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(bold ? 17 : 15);
        view.setTextColor(bold ? TEXT : MUTED);
        view.setTextIsSelectable(true);
        view.setLineSpacing(0, 1.08f);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(8), 0, dp(8));
        content.addView(view, params);
        return view;
    }

    private TextView label(String value, int size, int color, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.06f);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private Button styledButton(String label, boolean primary) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextSize(15);
        button.setTextColor(primary ? BACKDROP : TEXT);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setAllCaps(false);
        button.setMinimumHeight(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(14), 0, dp(14), 0);
        button.setBackground(buttonBackground(primary));
        return button;
    }

    private StateListDrawable buttonBackground(boolean primary) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {-android.R.attr.state_enabled},
            round(primary ? Color.rgb(54, 100, 116) : Color.rgb(24, 47, 68), BORDER, 14));
        states.addState(new int[] {android.R.attr.state_pressed},
            round(primary ? Color.rgb(135, 224, 252) : CARD_PRESSED, ACCENT, 14));
        states.addState(new int[] {}, round(primary ? ACCENT : Color.rgb(7, 30, 57), primary ? ACCENT : BORDER, 14));
        return states;
    }

    private GradientDrawable round(int color, int stroke, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private void styleWindow() {
        Window window = dialog == null ? null : dialog.getWindow();
        if (window == null) return;
        window.setBackgroundDrawable(new ColorDrawable(BACKDROP));
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        if (Build.VERSION.SDK_INT >= 21) {
            window.setStatusBarColor(BACKDROP);
            window.setNavigationBarColor(BACKDROP);
        }
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
