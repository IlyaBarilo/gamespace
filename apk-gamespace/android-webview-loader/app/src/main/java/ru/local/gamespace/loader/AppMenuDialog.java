package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
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
import android.widget.GridLayout;
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
    private final SiteState siteState;
    private final AppState appState;
    private final DiagnosticsState diagnosticsState;
    private final Listener listener;
    private AlertDialog dialog;

    AppMenuDialog(Activity activity, String version, boolean installed, boolean busy,
            boolean menuTabEnabled, String menuTabItem, String[] items, SiteState siteState,
            AppState appState, DiagnosticsState diagnosticsState, Listener listener) {
        this.activity = activity;
        this.version = version;
        this.installed = installed;
        this.busy = busy;
        this.menuTabEnabled = menuTabEnabled;
        this.menuTabItem = menuTabItem;
        this.items = items;
        this.siteState = siteState;
        this.appState = appState;
        this.diagnosticsState = diagnosticsState;
        this.listener = listener;
    }

    AlertDialog create() {
        FrameLayout backdrop = new FrameLayout(activity);
        backdrop.setBackgroundColor(BACKDROP);

        LinearLayout page = new LinearLayout(activity);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackground(pageBackground());
        int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
        float widthDp = screenWidth / activity.getResources().getDisplayMetrics().density;
        int horizontalMargin = dp(widthDp <= 620f ? 11 : 20);
        int pageWidth = Math.min(Math.max(1, screenWidth - horizontalMargin * 2), dp(1040));
        FrameLayout.LayoutParams pageParams = new FrameLayout.LayoutParams(pageWidth,
            ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER_HORIZONTAL);
        backdrop.addView(page, pageParams);

        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(9), 0, dp(9), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        page.addView(scroll, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        content.addView(header(), new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        content.addView(statusLine(), statusLineParams());
        content.addView(compatibilityCard(), cardParams());
        if (busy) {
            content.addView(operationCard(), cardParams());
        } else if (installed) {
            content.addView(installedSiteCard(), cardParams());
        } else {
            content.addView(firstLaunchCard(), cardParams());
        }
        if (!busy) content.addView(storageCard(), cardParams());
        if (!busy && installed) content.addView(localArchivesCard(), cardParams());
        if (!busy) content.addView(applicationCard(), cardParams());
        if (!busy) content.addView(alternativeAppCard(), cardParams());
        content.addView(informationCard(), cardParams());
        content.addView(lastProcessingCard(), cardParams());
        if (!busy) content.addView(viewerCard(), cardParams());
        content.addView(lastErrorCard(), cardParams());
        if (!busy) content.addView(licensesCard(), cardParams());
        if (!busy && installed) content.addView(deleteCard(), cardParams());

        dialog = new AlertDialog.Builder(activity).setView(backdrop).create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override public void onShow(DialogInterface unused) { styleWindow(); }
        });
        return dialog;
    }

    private View header() {
        boolean compact = screenWidthDp() <= 620f;
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(4), dp(22), 0, dp(18));

        ImageView logo = new ImageView(activity);
        logo.setImageResource(R.mipmap.ic_launcher);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setContentDescription("Значок GameSpace");
        if (Build.VERSION.SDK_INT >= 21) logo.setElevation(dp(8));
        int logoSize = compact ? 61 : 72;
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(logoSize), dp(logoSize));
        logoParams.setMargins(0, 0, dp(compact ? 14 : 18), 0);
        row.addView(logo, logoParams);

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView kicker = text("НАСТРОЙКИ · ЛОКАЛЬНОЕ ПРИЛОЖЕНИЕ", 10, ACCENT, true);
        kicker.setLetterSpacing(0.08f);
        copy.addView(kicker);

        LinearLayout titleLine = new LinearLayout(activity);
        titleLine.setOrientation(LinearLayout.HORIZONTAL);
        titleLine.setGravity(Gravity.BOTTOM);
        TextView title = text("GameSpace", compact ? 30 : 34, TEXT, true);
        titleLine.addView(title);
        TextView versionLabel = text(version, compact ? 13 : 15, ACCENT, true);
        LinearLayout.LayoutParams versionParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        versionParams.setMargins(dp(compact ? 8 : 11), 0, 0, dp(3));
        titleLine.addView(versionLabel, versionParams);
        copy.addView(titleLine);

        TextView summary = text(installed
            ? siteState.archiveName + " · " + siteState.siteSize
            : "Основной сайт ещё не установлен", 14, MUTED, false);
        summary.setPadding(0, dp(7), 0, 0);
        copy.addView(summary);
        row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        return row;
    }

    private View statusLine() {
        LinearLayout line = new LinearLayout(activity);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(dp(13), dp(9), dp(13), dp(9));
        line.setBackground(round(Color.rgb(3, 20, 42), BORDER, 12));

        View dot = new View(activity);
        int tone = busy ? WARNING : installed ? SUCCESS : Color.rgb(130, 169, 203);
        dot.setBackground(round(tone, tone, 8));
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(8), dp(8));
        dotParams.setMargins(0, 0, dp(9), 0);
        line.addView(dot, dotParams);

        String value = busy
            ? diagnosticsState.operationTitle + ". " + diagnosticsState.operationDetails
            : installed ? "Сайт готов к автономной работе"
                : "Приложение готово к импорту";
        line.addView(text(value, 12, MUTED, false), new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        ImageButton close = closeButton();
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(dp(34), dp(34));
        closeParams.setMargins(dp(8), 0, 0, 0);
        line.addView(close, closeParams);
        return line;
    }

    private ImageButton closeButton() {
        ImageButton close = new ImageButton(activity);
        close.setImageResource(R.drawable.ic_menu_close);
        close.setImageTintList(ColorStateList.valueOf(TEXT));
        close.setContentDescription("Закрыть меню");
        close.setPadding(dp(8), dp(8), dp(8), dp(8));
        close.setBackground(round(CARD, BORDER, 11));
        close.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { if (dialog != null) dialog.dismiss(); }
        });
        return close;
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

    private View compatibilityCard() {
        LinearLayout card = card("БАЗОВАЯ ПРОВЕРКА", "Совместимость устройства");
        int color = diagnosticsState.compatibilityError ? DANGER
            : diagnosticsState.compatibilityComplete ? SUCCESS : WARNING;
        TextView state = text(diagnosticsState.compatibilityStatus, 14, color, true);
        state.setPadding(0, dp(9), 0, 0);
        card.addView(state);
        TextView description = text("Доступна с первого запуска, даже если архив ещё не установлен или возникла ошибка.", 13, MUTED, false);
        description.setPadding(0, dp(7), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {"Отчёт о совместимости"});
        return card;
    }

    private View operationCard() {
        LinearLayout card = card("ЛОКАЛЬНАЯ ОПЕРАЦИЯ", diagnosticsState.operationTitle);
        TextView details = text(diagnosticsState.operationDetails, 14, WARNING, true);
        details.setPadding(0, dp(9), 0, 0);
        card.addView(details);
        TextView hint = text(diagnosticsState.operationHint, 13, MUTED, false);
        hint.setPadding(0, dp(7), 0, 0);
        card.addView(hint);
        return card;
    }

    private View installedSiteCard() {
        LinearLayout card = card("ДОВЕРЕННЫЙ РЕЖИМ", "Готов к запуску");
        TextView description = text("Витрина и игры открываются из локального каталога приложения. Подключение к интернету для запуска не требуется.", 13, MUTED, false);
        description.setPadding(0, dp(8), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {"Открыть GameSpace"});
        return card;
    }

    private View firstLaunchCard() {
        LinearLayout card = card("ПЕРВЫЙ ЗАПУСК", "Выберите, с чего начать");
        TextView description = text("Установите встроенную демонстрацию или выберите основной архив GameSpace на устройстве.", 13, MUTED, false);
        description.setPadding(0, dp(8), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {"Загрузить встроенный демо-сайт", "Выбрать архив"});
        return card;
    }

    private View localArchivesCard() {
        LinearLayout card = card("ЛОКАЛЬНЫЕ АРХИВЫ", "Сайт и обновления");
        TextView description = text("Основной архив можно обновить полностью или применить подготовленное локальное обновление.", 13, MUTED, false);
        description.setPadding(0, dp(8), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {
            "Быстро обновить из архива", "Полное обновление из архива",
            "Загрузить встроенный демо-сайт", "Перезагрузить сайт"
        });
        return card;
    }

    private View applicationCard() {
        LinearLayout card = card("ОБОЛОЧКА APK", "Версия приложения");
        card.addView(detailLine("Установлено", "GameSpace " + version));
        card.addView(detailLine("Сборка", appState.buildDate));
        card.addView(detailLine("Минимальная версия Android", appState.minAndroid));
        card.addView(detailLine("Система", appState.androidVersion));
        card.addView(detailLine("Устройство", appState.deviceModel));
        card.addView(detailLine("WebView", appState.webView));

        TextView updateStatus = text(appState.updateStatus, 13, updateStatusColor(appState.updateStatus), true);
        updateStatus.setPadding(0, dp(11), 0, 0);
        card.addView(updateStatus);
        card.addView(detailLine("Последняя проверка", appState.updateCheckedAt));

        TextView network = text("Интернет используется только при ручной проверке официальных выпусков. Скачивание и установка APK выполняются вне GameSpace.", 12, MUTED, false);
        network.setPadding(0, dp(10), 0, 0);
        card.addView(network);
        String runtime = findRuntimeItem();
        addCardActions(card, runtime == null
            ? new String[] {"Обновление приложения", "Информация"}
            : new String[] {"Обновление приложения", runtime, "Информация"});
        return card;
    }

    private View alternativeAppCard() {
        LinearLayout card = card("ДРУГАЯ ВЕРСИЯ", "GameSpace PWA");
        TextView description = text("APK и PWA можно установить одновременно. Их локальные сайты, настройки и сохранения игр не переносятся автоматически.", 13, MUTED, false);
        description.setPadding(0, dp(8), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {"Открыть PWA-версию"});
        return card;
    }

    private View storageCard() {
        LinearLayout card = card("ХРАНИЛИЩЕ", "Память приложения");
        LinearLayout summary = new LinearLayout(activity);
        summary.setOrientation(LinearLayout.HORIZONTAL);
        summary.setGravity(Gravity.CENTER_VERTICAL);
        summary.setPadding(0, dp(12), 0, 0);

        StorageRingView ring = new StorageRingView(activity, siteState.usedPercent);
        summary.addView(ring, new LinearLayout.LayoutParams(dp(88), dp(88)));

        LinearLayout details = new LinearLayout(activity);
        details.setOrientation(LinearLayout.VERTICAL);
        details.setPadding(dp(14), 0, 0, 0);
        details.addView(text("Сайт GameSpace: " + siteState.siteSize, 15, TEXT, true));
        details.addView(text(siteState.fileCount, 13, MUTED, false));
        details.addView(text("Занято в разделе: " + siteState.usedSpace, 13, MUTED, false));
        details.addView(text("Свободно: " + siteState.freeSpace, 13, MUTED, false));
        details.addView(text("Раздел: " + siteState.totalSpace, 13, MUTED, false));
        summary.addView(details, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        card.addView(summary);

        TextView location = text(siteState.storageLabel, 13, ACCENT, true);
        location.setPadding(0, dp(12), 0, 0);
        card.addView(location);
        if (installed) {
            card.addView(storageLine("Архив", siteState.archiveName));
            card.addView(storageLine("Дата операции", siteState.installedAt));
            card.addView(storageLine("Проверка файлов", siteState.verifiedAt));
        }
        TextView retention = text("Файлы находятся в каталоге приложения и удаляются при очистке данных или удалении APK.", 12, MUTED, false);
        retention.setPadding(0, dp(11), 0, 0);
        card.addView(retention);

        String verify = findItem("Перепроверить файлы");
        if (verify != null) {
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.setMargins(0, dp(12), 0, 0);
            card.addView(action(verify), params);
        }
        return card;
    }

    private View informationCard() {
        LinearLayout card = card("СОСТОЯНИЕ", "Информация");
        TextView description = text(installed
            ? "Сведения о последней установке или обработке локального сайта."
            : "Сведения появятся после установки демонстрации или основного архива.", 13, MUTED, false);
        description.setPadding(0, dp(8), 0, dp(4));
        card.addView(description);

        GridLayout grid = new GridLayout(activity);
        int columns = screenWidthDp() > 620f ? 2 : 1;
        grid.setColumnCount(columns);
        grid.setUseDefaultMargins(false);
        addInformationCell(grid, "Архив", installed ? siteState.archiveName : "—", columns);
        addInformationCell(grid, "Формат", installed ? siteState.archiveFormat : "—", columns);
        addInformationCell(grid, "Файлы", installed ? siteState.fileCount : "—", columns);
        addInformationCell(grid, "Размер сайта", installed ? siteState.siteSize : "—", columns);
        addInformationCell(grid, "Дата", installed ? siteState.installedAt : "—", columns);
        addInformationCell(grid, "Время", installed ? siteState.operationDuration : "—", columns);
        addInformationCell(grid, "Последний режим", installed ? siteState.operationMode : "—", columns);
        addInformationCell(grid, "Проверка файлов", installed ? siteState.verifiedAt : "—", columns);
        LinearLayout.LayoutParams gridParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gridParams.setMargins(0, dp(8), 0, 0);
        card.addView(grid, gridParams);
        return card;
    }

    private void addInformationCell(GridLayout grid, String label, String value, int columns) {
        LinearLayout cell = new LinearLayout(activity);
        cell.setOrientation(LinearLayout.VERTICAL);
        cell.setPadding(dp(12), dp(10), dp(12), dp(10));
        cell.setBackground(round(Color.rgb(5, 27, 51), BORDER, 12));
        TextView labelView = text(label.toUpperCase(), 9, ACCENT, true);
        labelView.setLetterSpacing(0.07f);
        cell.addView(labelView);
        TextView valueView = text(value, 14, TEXT, true);
        valueView.setPadding(0, dp(4), 0, 0);
        cell.addView(valueView);

        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = 0;
        params.height = ViewGroup.LayoutParams.WRAP_CONTENT;
        params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
        params.setMargins(dp(3), dp(3), dp(3), dp(3));
        if (columns == 1) params.width = ViewGroup.LayoutParams.MATCH_PARENT;
        grid.addView(cell, params);
    }

    private View lastProcessingCard() {
        LinearLayout card = card("ПОСЛЕДНЯЯ ОБРАБОТКА", "Статистика архива");
        int color = diagnosticsState.hasArchiveStatistics ? SUCCESS : MUTED;
        TextView state = text(diagnosticsState.hasArchiveStatistics
            ? "Сведения о последней обработке сохранены"
            : "Статистики обработки архива пока нет", 13, color, true);
        state.setPadding(0, dp(8), 0, 0);
        card.addView(state);
        addCardActions(card, new String[] {"Статистика архива"});
        return card;
    }

    private View lastErrorCard() {
        LinearLayout card = card("ПОМОЩЬ ПРИ СБОЕ", "Последняя ошибка");
        int color = diagnosticsState.hasLastError ? WARNING : SUCCESS;
        TextView state = text(diagnosticsState.hasLastError
            ? "Последняя ошибка сохранена"
            : "Сохранённых ошибок пока нет", 13, color, true);
        state.setPadding(0, dp(8), 0, 0);
        card.addView(state);
        TextView description = text("Технический отчёт не включает содержимое пользовательских файлов.", 13, MUTED, false);
        description.setPadding(0, dp(7), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {"Последняя ошибка", "Создать отчёт о проблеме"});
        return card;
    }

    private View licensesCard() {
        LinearLayout card = card("О ПРИЛОЖЕНИИ", "Лицензии");
        TextView description = text("Лицензия GameSpace и сведения о сторонних компонентах доступны без подключения к интернету.", 13, MUTED, false);
        description.setPadding(0, dp(8), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {"Лицензии"});
        return card;
    }

    private View deleteCard() {
        LinearLayout card = card("УДАЛЕНИЕ", "Локальный сайт");
        TextView description = text("Удаляет распакованный сайт и его локальные данные. Само приложение остаётся установленным.", 13, MUTED, false);
        description.setPadding(0, dp(8), 0, 0);
        card.addView(description);
        addCardActions(card, new String[] {"Очистить сайт"});
        return card;
    }

    private TextView storageLine(String label, String value) {
        TextView line = text(label + ": " + value, 13, MUTED, false);
        line.setPadding(0, dp(5), 0, 0);
        return line;
    }

    private TextView detailLine(String label, String value) {
        TextView line = text(label + ": " + value, 13, MUTED, false);
        line.setPadding(0, dp(6), 0, 0);
        return line;
    }

    private int updateStatusColor(String status) {
        if (status.startsWith("Доступна версия")) return WARNING;
        if (status.startsWith("Установлена актуальная версия")) return SUCCESS;
        return MUTED;
    }

    private void addCardActions(LinearLayout card, String[] accepted) {
        int added = 0;
        for (String acceptedItem : accepted) {
            String item = findItem(acceptedItem);
            if (item == null) continue;
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.setMargins(0, added == 0 ? dp(12) : dp(8), 0, 0);
            card.addView(action(item), params);
            added++;
        }
    }

    private String findItem(String accepted) {
        for (String item : items) {
            if (item.equals(accepted) || accepted.startsWith("Среда запуска: ") && item.startsWith("Среда запуска: ")) return item;
        }
        return null;
    }

    private String findRuntimeItem() {
        for (String item : items) {
            if (item.startsWith("Среда запуска: ")) return item;
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
        if ("Открыть GameSpace".equals(item)) return "Открыть GameSpace";
        if ("Выбрать архив".equals(item)) return "Выбрать основной архив";
        if ("Быстро обновить из архива".equals(item)) return "Быстро обновить";
        if ("Полное обновление из архива".equals(item)) return "Полная установка";
        if ("Загрузить встроенный демо-сайт".equals(item)) return "Установить демо-сайт";
        if ("Обновление приложения".equals(item)) return "Проверить обновление APK";
        if ("Создать отчёт о проблеме".equals(item)) return "Создать отчёт о проблеме";
        return item;
    }

    private String actionDescription(String item) {
        if ("Открыть GameSpace".equals(item)) return "Перейти к установленной витрине игр";
        if ("Выбрать архив".equals(item)) return "Выбрать site.7z или site.zip на устройстве";
        if ("Быстро обновить из архива".equals(item)) return "Заменить только файлы из update-архива";
        if ("Полное обновление из архива".equals(item)) return "Проверить и полностью заменить локальный сайт";
        if ("Загрузить встроенный демо-сайт".equals(item)) return "Заменить текущий сайт встроенным демонстрационным архивом";
        if ("Перезагрузить сайт".equals(item)) return "Заново открыть установленную витрину";
        if ("Перепроверить файлы".equals(item)) return "Заново посчитать размер и количество файлов сайта";
        if ("Обновление приложения".equals(item)) return "Проверить официальный выпуск и открыть его в браузере";
        if ("Информация".equals(item)) return "Версия APK и сведения об установленном сайте";
        if ("Открыть PWA-версию".equals(item)) return "Открыть официальный сайт PWA во внешнем браузере";
        if (item.startsWith("Среда запуска: ")) return "Открыть сведения о WebView и историю изменений";
        if ("Статистика архива".equals(item)) return "Последняя установка или локальное обновление";
        if ("Отчёт о совместимости".equals(item)) return "Базовая проверка работы на этом устройстве";
        if ("Создать отчёт о проблеме".equals(item)) return "Собрать технические сведения без содержимого файлов";
        if ("Последняя ошибка".equals(item)) return "Открыть последний сохранённый диагностический отчёт";
        if ("Лицензии".equals(item)) return "Документы доступны без подключения к интернету";
        if ("Очистить сайт".equals(item)) return "Удалить распакованный сайт и его локальные данные";
        return "Открыть";
    }

    private int actionIcon(String item) {
        if ("Открыть GameSpace".equals(item)) return R.drawable.ic_menu_play;
        if ("Выбрать архив".equals(item) || "Быстро обновить из архива".equals(item)
                || "Полное обновление из архива".equals(item)) return R.drawable.ic_menu_archive;
        if (item.contains("демо")) return R.drawable.ic_menu_play;
        if ("Перезагрузить сайт".equals(item)) return R.drawable.ic_menu_reload;
        if ("Обновление приложения".equals(item)) return R.drawable.ic_menu_update;
        if ("Открыть PWA-версию".equals(item)) return R.drawable.ic_menu_external;
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

    private LinearLayout.LayoutParams statusLineParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(4), 0, dp(10));
        return params;
    }

    private GradientDrawable pageBackground() {
        return new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[] {BACKDROP, SURFACE, Color.rgb(11, 45, 88)});
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

    private float screenWidthDp() {
        return activity.getResources().getDisplayMetrics().widthPixels
            / activity.getResources().getDisplayMetrics().density;
    }

    static final class SiteState {
        final String archiveName, siteSize, fileCount, storageLabel, usedSpace, freeSpace, totalSpace;
        final String installedAt, verifiedAt, archiveFormat, operationDuration, operationMode;
        final int usedPercent;

        SiteState(String archiveName, String siteSize, String fileCount, String storageLabel,
                String usedSpace, String freeSpace, String totalSpace, String installedAt, String verifiedAt,
                String archiveFormat, String operationDuration, String operationMode, int usedPercent) {
            this.archiveName = archiveName;
            this.siteSize = siteSize;
            this.fileCount = fileCount;
            this.storageLabel = storageLabel;
            this.usedSpace = usedSpace;
            this.freeSpace = freeSpace;
            this.totalSpace = totalSpace;
            this.installedAt = installedAt;
            this.verifiedAt = verifiedAt;
            this.archiveFormat = archiveFormat;
            this.operationDuration = operationDuration;
            this.operationMode = operationMode;
            this.usedPercent = usedPercent;
        }
    }

    static final class AppState {
        final String buildDate, minAndroid, androidVersion, deviceModel, webView, updateStatus, updateCheckedAt;

        AppState(String buildDate, String minAndroid, String androidVersion, String deviceModel,
                String webView, String updateStatus, String updateCheckedAt) {
            this.buildDate = buildDate;
            this.minAndroid = minAndroid;
            this.androidVersion = androidVersion;
            this.deviceModel = deviceModel;
            this.webView = webView;
            this.updateStatus = updateStatus;
            this.updateCheckedAt = updateCheckedAt;
        }
    }

    static final class DiagnosticsState {
        final String operationTitle, operationDetails, operationHint, compatibilityStatus;
        final boolean compatibilityComplete, compatibilityError, hasLastError, hasArchiveStatistics;

        DiagnosticsState(String operationTitle, String operationDetails, String operationHint,
                String compatibilityStatus, boolean compatibilityComplete, boolean compatibilityError,
                boolean hasLastError, boolean hasArchiveStatistics) {
            this.operationTitle = operationTitle;
            this.operationDetails = operationDetails;
            this.operationHint = operationHint;
            this.compatibilityStatus = compatibilityStatus;
            this.compatibilityComplete = compatibilityComplete;
            this.compatibilityError = compatibilityError;
            this.hasLastError = hasLastError;
            this.hasArchiveStatistics = hasArchiveStatistics;
        }
    }

    private static final class StorageRingView extends View {
        private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final int percent;
        private final float density;

        StorageRingView(Activity activity, int percent) {
            super(activity);
            this.percent = percent;
            density = activity.getResources().getDisplayMetrics().density;
            track.setStyle(Paint.Style.STROKE);
            track.setStrokeWidth(8f * density);
            track.setStrokeCap(Paint.Cap.ROUND);
            track.setColor(Color.rgb(29, 67, 101));
            fill.setStyle(Paint.Style.STROKE);
            fill.setStrokeWidth(8f * density);
            fill.setStrokeCap(Paint.Cap.ROUND);
            fill.setColor(ACCENT);
            label.setColor(TEXT);
            label.setTextAlign(Paint.Align.CENTER);
            label.setTextSize(17f * density);
            label.setTypeface(Typeface.DEFAULT_BOLD);
            setContentDescription(percent < 0 ? "Занятое место неизвестно" : "Занято " + percent + " процентов раздела");
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float inset = 8f * density;
            RectF bounds = new RectF(inset, inset, getWidth() - inset, getHeight() - inset);
            canvas.drawArc(bounds, -90f, 360f, false, track);
            if (percent >= 0) canvas.drawArc(bounds, -90f, percent * 3.6f, false, fill);
            Paint.FontMetrics metrics = label.getFontMetrics();
            float baseline = getHeight() / 2f - (metrics.ascent + metrics.descent) / 2f;
            canvas.drawText(percent < 0 ? "—" : percent + "%", getWidth() / 2f, baseline, label);
        }
    }
}
