package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.CompoundButton;

/** Native full-screen settings surface. It deliberately contains no WebView or JavaScript bridge. */
final class AppMenuDialog {
    interface Listener { void onAction(String item); }

    private static final int BACKDROP = Color.rgb(2, 9, 22);
    private static final int SURFACE = Color.rgb(6, 24, 47);
    private static final int CARD = Color.rgb(10, 38, 71);
    private static final int CARD_PRESSED = Color.rgb(15, 54, 96);
    private static final int BORDER = Color.rgb(31, 83, 128);
    private static final int TEXT = Color.rgb(230, 244, 255);
    private static final int MUTED = Color.rgb(168, 199, 224);
    private static final int ACCENT = Color.rgb(91, 203, 245);
    private static final int SUCCESS = Color.rgb(92, 211, 153);
    private static final int WARNING = Color.rgb(255, 198, 92);
    private static final int DANGER = Color.rgb(255, 116, 125);

    private final Activity activity;
    private final String version;
    private final boolean installed;
    private final boolean busy;
    private final boolean menuTabEnabled;
    private final String menuTabItem;
    private final String[] items;
    private final Listener listener;
    private AlertDialog dialog;

    AppMenuDialog(Activity activity, String version, boolean installed, boolean busy,
            boolean menuTabEnabled, String menuTabItem, String[] items, Listener listener) {
        this.activity = activity;
        this.version = version;
        this.installed = installed;
        this.busy = busy;
        this.menuTabEnabled = menuTabEnabled;
        this.menuTabItem = menuTabItem;
        this.items = items;
        this.listener = listener;
    }

    AlertDialog create() {
        FrameLayout backdrop = new FrameLayout(activity);
        backdrop.setBackgroundColor(BACKDROP);

        LinearLayout page = new LinearLayout(activity);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(SURFACE);
        int maximumWidth = dp(760);
        int pageWidth = Math.min(activity.getResources().getDisplayMetrics().widthPixels, maximumWidth);
        FrameLayout.LayoutParams pageParams = new FrameLayout.LayoutParams(pageWidth,
            ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER_HORIZONTAL);
        backdrop.addView(page, pageParams);

        page.addView(header(), new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(10), dp(16), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        page.addView(scroll, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        content.addView(statusCard(), cardParams());
        if (!busy) content.addView(viewerCard(), cardParams());
        addSection(content, "ЛОКАЛЬНЫЕ АРХИВЫ", "Сайт и обновления", new String[] {
            "Выбрать архив", "Быстро обновить из архива", "Полное обновление из архива",
            "Загрузить встроенный демо-сайт", "Перезагрузить сайт"
        });
        addSection(content, "ПРИЛОЖЕНИЕ", "GameSpace APK", new String[] {
            "Обновление приложения", "Информация"
        });
        addRuntimeSection(content);
        addSection(content, "ДИАГНОСТИКА", "Проверка и отчёты", new String[] {
            "Статистика архива", "Отчёт о совместимости", "Создать отчёт о проблеме", "Последняя ошибка"
        });
        addSection(content, "О ПРИЛОЖЕНИИ", "Документы", new String[] {"Лицензии"});
        addSection(content, "УДАЛЕНИЕ", "Локальный сайт", new String[] {"Очистить сайт"});

        dialog = new AlertDialog.Builder(activity).setView(backdrop).create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override public void onShow(DialogInterface unused) { styleWindow(); }
        });
        return dialog;
    }

    private View header() {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(20), dp(17), dp(12), dp(15));

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView kicker = text("НАСТРОЙКИ И АРХИВЫ", 11, ACCENT, true);
        kicker.setLetterSpacing(0.08f);
        copy.addView(kicker);
        TextView title = text("GameSpace APK", 24, TEXT, true);
        copy.addView(title);
        copy.addView(text("Версия " + version, 13, MUTED, false));
        row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        ImageButton close = new ImageButton(activity);
        close.setImageResource(R.drawable.ic_menu_close);
        close.setImageTintList(ColorStateList.valueOf(TEXT));
        close.setContentDescription("Закрыть меню");
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

    private View statusCard() {
        LinearLayout card = card("СОСТОЯНИЕ", installed ? "Сайт готов к работе" : "Сайт не установлен");
        TextView status = text(busy ? "Выполняется локальная операция" : installed
            ? "Меню открыто поверх локального сайта. Закрытие вернёт к его просмотру."
            : "Установите встроенный демо-сайт или выберите архив на устройстве.", 14, MUTED, false);
        status.setPadding(0, dp(8), 0, 0);
        card.addView(status);
        TextView badge = text(busy ? "ОПЕРАЦИЯ ВЫПОЛНЯЕТСЯ" : installed ? "УСТАНОВЛЕН" : "НЕТ САЙТА",
            11, busy ? WARNING : installed ? SUCCESS : MUTED, true);
        badge.setPadding(dp(11), dp(7), dp(11), dp(7));
        badge.setBackground(round(Color.rgb(7, 29, 54), busy ? WARNING : installed ? SUCCESS : BORDER, 16));
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        badgeParams.setMargins(0, dp(14), 0, 0);
        card.addView(badge, badgeParams);
        return card;
    }

    @SuppressWarnings("deprecation")
    private View viewerCard() {
        LinearLayout card = card("ПРОСМОТР САЙТА", "Вкладка быстрого меню");
        TextView description = text("После скрытия верхней панели вкладка ••• может оставаться вверху экрана и сразу открывать это меню.", 14, MUTED, false);
        description.setPadding(0, dp(8), 0, dp(8));
        card.addView(description);
        Switch setting = new Switch(activity);
        setting.setText("Показывать вкладку •••");
        setting.setTextColor(TEXT);
        setting.setTextSize(15);
        setting.setChecked(menuTabEnabled);
        setting.setShowText(false);
        setting.setPadding(0, dp(6), 0, 0);
        if (Build.VERSION.SDK_INT >= 21) {
            setting.setThumbTintList(toggleColors());
            setting.setTrackTintList(trackColors());
        }
        setting.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override public void onCheckedChanged(CompoundButton button, boolean checked) {
                listener.onAction(menuTabItem);
            }
        });
        card.addView(setting, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return card;
    }

    private void addRuntimeSection(LinearLayout content) {
        for (String item : items) {
            if (item.startsWith("Среда запуска: ")) {
                addSection(content, "СРЕДА ЗАПУСКА", "Android System WebView", new String[] {item});
                return;
            }
        }
    }

    private void addSection(LinearLayout content, String kicker, String title, String[] accepted) {
        LinearLayout section = card(kicker, title);
        int added = 0;
        for (String acceptedItem : accepted) {
            String item = findItem(acceptedItem);
            if (item == null) continue;
            LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            actionParams.setMargins(0, added == 0 ? dp(12) : dp(8), 0, 0);
            section.addView(action(item), actionParams);
            added++;
        }
        if (added > 0) content.addView(section, cardParams());
    }

    private String findItem(String accepted) {
        for (String item : items) {
            if (item.equals(accepted) || accepted.startsWith("Среда запуска: ") && item.startsWith("Среда запуска: ")) return item;
        }
        return null;
    }

    private View action(final String item) {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(13), dp(11), dp(13), dp(11));
        boolean danger = "Очистить сайт".equals(item);
        row.setBackground(actionBackground(danger));
        row.setClickable(true);
        row.setFocusable(true);
        row.setContentDescription(actionTitle(item) + ". " + actionDescription(item));

        ImageView icon = new ImageView(activity);
        icon.setImageResource(actionIcon(item));
        icon.setImageTintList(ColorStateList.valueOf(danger ? DANGER : ACCENT));
        icon.setPadding(dp(7), dp(7), dp(7), dp(7));
        icon.setBackground(round(Color.rgb(5, 27, 51), danger ? DANGER : BORDER, 13));
        row.addView(icon, new LinearLayout.LayoutParams(dp(42), dp(42)));

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(13), 0, 0, 0);
        copy.addView(text(actionTitle(item), 16, danger ? DANGER : TEXT, true));
        copy.addView(text(actionDescription(item), 12, MUTED, false));
        row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                if (dialog != null) dialog.dismiss();
                listener.onAction(item);
            }
        });
        return row;
    }

    private String actionTitle(String item) {
        if (item.startsWith("Среда запуска: ")) return "Среда запуска";
        if ("Быстро обновить из архива".equals(item)) return "Быстро обновить";
        if ("Полное обновление из архива".equals(item)) return "Полная установка";
        if ("Загрузить встроенный демо-сайт".equals(item)) return "Установить демо-сайт";
        if ("Обновление приложения".equals(item)) return "Проверить обновление APK";
        if ("Создать отчёт о проблеме".equals(item)) return "Создать отчёт о проблеме";
        return item;
    }

    private String actionDescription(String item) {
        if ("Выбрать архив".equals(item)) return "Установить локальный сайт из файла .7z или .zip";
        if ("Быстро обновить из архива".equals(item)) return "Заменить только файлы из update-архива";
        if ("Полное обновление из архива".equals(item)) return "Проверить и полностью заменить локальный сайт";
        if ("Загрузить встроенный демо-сайт".equals(item)) return "Заменить текущий сайт встроенным демонстрационным архивом";
        if ("Перезагрузить сайт".equals(item)) return "Заново открыть установленную витрину";
        if ("Обновление приложения".equals(item)) return "Проверить официальный выпуск и открыть его в браузере";
        if ("Информация".equals(item)) return "Версия APK и сведения об установленном сайте";
        if (item.startsWith("Среда запуска: ")) return item.substring("Среда запуска: ".length());
        if ("Статистика архива".equals(item)) return "Последняя установка или локальное обновление";
        if ("Отчёт о совместимости".equals(item)) return "Базовая проверка работы на этом устройстве";
        if ("Создать отчёт о проблеме".equals(item)) return "Собрать технические сведения без содержимого файлов";
        if ("Последняя ошибка".equals(item)) return "Открыть последний сохранённый диагностический отчёт";
        if ("Лицензии".equals(item)) return "Документы доступны без подключения к интернету";
        if ("Очистить сайт".equals(item)) return "Удалить распакованный сайт и его локальные данные";
        return "Открыть";
    }

    private int actionIcon(String item) {
        if ("Выбрать архив".equals(item) || "Быстро обновить из архива".equals(item)
                || "Полное обновление из архива".equals(item)) return R.drawable.ic_menu_archive;
        if (item.contains("демо")) return R.drawable.ic_menu_play;
        if ("Перезагрузить сайт".equals(item)) return R.drawable.ic_menu_reload;
        if ("Обновление приложения".equals(item)) return R.drawable.ic_menu_update;
        if ("Информация".equals(item) || item.startsWith("Среда запуска: ")) return R.drawable.ic_menu_info;
        if ("Лицензии".equals(item)) return R.drawable.ic_menu_document;
        if ("Очистить сайт".equals(item)) return R.drawable.ic_menu_trash;
        return R.drawable.ic_menu_diagnostics;
    }

    private LinearLayout card(String kickerText, String titleText) {
        LinearLayout card = new LinearLayout(activity);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(15), dp(16), dp(16));
        card.setBackground(round(CARD, BORDER, 18));
        TextView kicker = text(kickerText, 10, ACCENT, true);
        kicker.setLetterSpacing(0.08f);
        card.addView(kicker);
        TextView title = text(titleText, 20, TEXT, true);
        title.setPadding(0, dp(3), 0, 0);
        card.addView(title);
        return card;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.06f);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private LinearLayout.LayoutParams cardParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(8), 0, dp(8));
        return params;
    }

    private StateListDrawable actionBackground(boolean danger) {
        int border = danger ? Color.rgb(130, 52, 65) : BORDER;
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {android.R.attr.state_pressed}, round(danger ? Color.rgb(74, 31, 44) : CARD_PRESSED, border, 14));
        states.addState(new int[] {}, round(Color.rgb(7, 30, 57), border, 14));
        return states;
    }

    private GradientDrawable round(int color, int stroke, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private ColorStateList toggleColors() {
        return new ColorStateList(new int[][] {
            new int[] {android.R.attr.state_checked}, new int[] {}
        }, new int[] {ACCENT, Color.rgb(121, 139, 156)});
    }

    private ColorStateList trackColors() {
        return new ColorStateList(new int[][] {
            new int[] {android.R.attr.state_checked}, new int[] {}
        }, new int[] {Color.rgb(34, 105, 132), Color.rgb(50, 65, 80)});
    }

    private void styleWindow() {
        Window window = dialog.getWindow();
        if (window == null) return;
        window.setBackgroundDrawable(new ColorDrawable(BACKDROP));
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        if (Build.VERSION.SDK_INT >= 21) {
            window.setStatusBarColor(BACKDROP);
            window.setNavigationBarColor(BACKDROP);
        }
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
