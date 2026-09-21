package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
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
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Native compatibility surface matching the trusted APK settings design. */
final class CompatibilityDialog {
    interface Host {
        CompatibilityCheck check();
        Map<String, Object> input();
        boolean busy();
    }

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
    private static final Pattern STEP_PATTERN = Pattern.compile(
        "(?m)^(\\d+)\\. ([^\\n]+): (выполнено|пока не выполнено|пока не проверено|ошибка|прервано)\\n([^\\n]+)");

    private final Activity activity;
    private final Host host;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final TextView[] stepStatuses = new TextView[4];
    private final TextView[] stepDescriptions = new TextView[4];
    private String report = "";
    private AlertDialog dialog;
    private TextView summary, note, reportText, status;
    private Button reset, copy, form;

    CompatibilityDialog(Activity activity, Host host) {
        this.activity = activity;
        this.host = host;
    }

    AlertDialog create() {
        FrameLayout backdrop = new FrameLayout(activity);
        backdrop.setBackgroundColor(BACKDROP);

        LinearLayout page = new LinearLayout(activity);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackground(pageBackground());
        int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
        int horizontalMargin = dp(screenWidthDp() <= 620f ? 11 : 20);
        int pageWidth = Math.min(Math.max(1, screenWidth - horizontalMargin * 2), dp(780));
        backdrop.addView(page, new FrameLayout.LayoutParams(
            pageWidth, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER_HORIZONTAL));

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

        LinearLayout checkCard = card("ТЕКУЩИЙ РЕЗУЛЬТАТ", "Базовая проверка");
        summary = text("", 15, WARNING, true);
        summary.setPadding(0, dp(9), 0, dp(3));
        checkCard.addView(summary);
        String[] titles = {"Запуск приложения", "Загрузка архива", "Открытие витрины", "Переход в игру"};
        for (int index = 0; index < titles.length; index++) {
            checkCard.addView(step(index, titles[index]), compactParams());
        }
        note = text("", 13, MUTED, false);
        note.setPadding(0, dp(10), 0, 0);
        checkCard.addView(note);
        content.addView(checkCard, cardParams());

        LinearLayout purposeCard = card("ОБ ОТЧЁТЕ", "Как будут использованы сведения");
        purposeCard.addView(paragraph("Отчёт содержит технические сведения об устройстве и результаты проверки GameSpace. Автор программы использует их для улучшения программы, исследований и публикации результатов, в том числе в интернете, научных публикациях и таблицах совместимости на GitHub."));
        purposeCard.addView(paragraph("Сведения публикуются без привязки к отправителю. Предоставление отчёта добровольно."));
        purposeCard.addView(paragraph("? — неизвестно; - — не применимо. Код целостности помогает обнаружить повреждение текста при копировании или пересылке."));
        reset = actionButton("Начать новую проверку", new View.OnClickListener() {
            @Override public void onClick(View view) { confirmReset(); }
        });
        purposeCard.addView(reset, actionParams());
        content.addView(purposeCard, cardParams());

        LinearLayout reportCard = card("ГОТОВЫЙ ОТЧЁТ", "Текст для отправки");
        TextView readonly = text("Текст отчёта доступен только для чтения и формируется заново при каждом открытии этого окна.", 13, MUTED, false);
        readonly.setPadding(0, dp(8), 0, dp(10));
        reportCard.addView(readonly);
        reportText = text("", 12, TEXT, false);
        reportText.setTypeface(Typeface.MONOSPACE);
        reportText.setTextIsSelectable(true);
        reportText.setPadding(dp(12), dp(12), dp(12), dp(12));
        reportText.setBackground(round(Color.rgb(3, 20, 42), BORDER, 12));
        reportCard.addView(reportText, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        copy = actionButton("Копировать отчёт", new View.OnClickListener() {
            @Override public void onClick(View view) { copy(); }
        });
        reportCard.addView(copy, actionParams());
        form = actionButton("Открыть форму", new View.OnClickListener() {
            @Override public void onClick(View view) { openForm(); }
        });
        reportCard.addView(form, actionParams());
        TextView formHint = text("Скопируйте отчёт, откройте Яндекс Форму, вставьте текст и отправьте его. Для открытия формы нужен интернет.", 12, MUTED, false);
        formHint.setPadding(0, dp(10), 0, 0);
        reportCard.addView(formHint);
        status = text("", 13, ACCENT, true);
        status.setPadding(0, dp(9), 0, 0);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        reportCard.addView(status);
        content.addView(reportCard, cardParams());

        dialog = new AlertDialog.Builder(activity).setView(backdrop).create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override public void onShow(DialogInterface unused) { styleWindow(); }
        });
        refresh();
        return dialog;
    }

    void shown() {
        generate();
        final AlertDialog current = dialog;
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                if (current != dialog || !current.isShowing() || activity.isFinishing() || activity.isDestroyed()) return;
                refresh();
                handler.postDelayed(this, 1000);
            }
        }, 1000);
    }

    private View header() {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(4), dp(22), 0, dp(14));

        LinearLayout copy = new LinearLayout(activity);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView kicker = text("ОТЧЁТ О СОВМЕСТИМОСТИ", 10, ACCENT, true);
        kicker.setLetterSpacing(0.08f);
        copy.addView(kicker);
        copy.addView(text("Проверка устройства", screenWidthDp() <= 620f ? 27 : 32, TEXT, true));
        TextView description = text("Что уже работает и что ещё нужно проверить", 13, MUTED, false);
        description.setPadding(0, dp(5), 0, 0);
        copy.addView(description);
        row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        ImageButton close = new ImageButton(activity);
        close.setImageResource(R.drawable.ic_menu_close);
        close.setImageTintList(ColorStateList.valueOf(TEXT));
        close.setContentDescription("Закрыть отчёт");
        close.setPadding(dp(9), dp(9), dp(9), dp(9));
        close.setBackground(round(CARD, BORDER, 12));
        close.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { if (dialog != null) dialog.dismiss(); }
        });
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(dp(42), dp(42));
        closeParams.setMargins(dp(10), 0, 0, 0);
        row.addView(close, closeParams);
        return row;
    }

    private View step(int index, String title) {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(12), dp(10), dp(12), dp(10));
        row.setBackground(round(Color.rgb(5, 27, 51), BORDER, 12));

        LinearLayout headline = new LinearLayout(activity);
        headline.setOrientation(LinearLayout.HORIZONTAL);
        headline.setGravity(Gravity.CENTER_VERTICAL);
        TextView titleView = text((index + 1) + ". " + title, 14, TEXT, true);
        headline.addView(titleView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        stepStatuses[index] = text("пока не выполнено", 12, WARNING, true);
        headline.addView(stepStatuses[index]);
        row.addView(headline);

        stepDescriptions[index] = text("", 12, MUTED, false);
        stepDescriptions[index].setPadding(0, dp(5), 0, 0);
        row.addView(stepDescriptions[index]);
        return row;
    }

    private void refresh() {
        applyGuidance(host.check().guidance());
        boolean idle = !host.busy();
        reset.setEnabled(idle);
        reset.setAlpha(idle ? 1f : 0.55f);
        boolean available = !report.isEmpty();
        copy.setEnabled(available);
        copy.setAlpha(available ? 1f : 0.55f);
        form.setEnabled(available);
        form.setAlpha(available ? 1f : 0.55f);
    }

    private void applyGuidance(String value) {
        int firstBreak = value.indexOf('\n');
        String summaryText = firstBreak < 0 ? value : value.substring(0, firstBreak).trim();
        summary.setText(summaryText);
        summary.setTextColor(summaryText.startsWith("Базовая проверка пройдена") ? SUCCESS
            : summaryText.startsWith("Зафиксирована ошибка") ? DANGER : WARNING);

        Matcher match = STEP_PATTERN.matcher(value);
        int index = 0;
        int tailStart = firstBreak < 0 ? value.length() : firstBreak + 1;
        while (match.find() && index < stepStatuses.length) {
            String state = match.group(3);
            stepStatuses[index].setText(state);
            stepStatuses[index].setTextColor("выполнено".equals(state) ? SUCCESS
                : "ошибка".equals(state) ? DANGER : WARNING);
            stepDescriptions[index].setText(match.group(4).trim());
            tailStart = match.end();
            index++;
        }
        while (index < stepStatuses.length) {
            stepStatuses[index].setText("пока не проверено");
            stepStatuses[index].setTextColor(WARNING);
            stepDescriptions[index].setText("Сведения об этом шаге пока не получены.");
            index++;
        }
        String tail = tailStart < value.length() ? value.substring(tailStart).trim() : "";
        note.setText(tail);
        note.setVisibility(tail.length() == 0 ? View.GONE : View.VISIBLE);
        note.setTextColor(tail.startsWith("Ошибка") ? DANGER : MUTED);
    }

    private void confirmReset() {
        if (host.busy()) return;
        new AlertDialog.Builder(activity)
            .setTitle("Начать новую проверку?")
            .setMessage("Результаты проверки будут сброшены. Установленный сайт и сохранения останутся на месте.")
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Начать", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface ignored, int which) {
                    host.check().reset("Новая проверка начата. Ранее выполненные действия не учитываются.");
                    generate();
                }
            }).show();
    }

    private void generate() {
        report = "";
        reportText.setText("");
        try {
            report = CompatibilityReport.create(host.input());
            reportText.setText(report);
            status.setText("Отчёт сформирован.");
        } catch (RuntimeException unavailable) {
            status.setText("Не удалось сформировать отчёт. Закройте окно и откройте его снова.");
        }
        refresh();
    }

    private boolean copy() {
        if (report.isEmpty()) return false;
        try {
            ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null) throw new IllegalStateException();
            clipboard.setPrimaryClip(ClipData.newPlainText("Отчёт о совместимости GameSpace", report));
            status.setText("Отчёт скопирован.");
            return true;
        } catch (RuntimeException unavailable) {
            status.setText("Не удалось скопировать автоматически. Выделите текст и скопируйте его вручную.");
            return false;
        }
    }

    private void openForm() {
        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(CompatibilityReport.FORM_URL));
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            activity.startActivity(browser);
            status.setText("Форма открыта. Вставьте скопированный отчёт и нажмите «Отправить» в форме.");
        } catch (RuntimeException unavailable) {
            status.setText("Не удалось открыть браузер. Попробуйте ещё раз.");
        }
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

    private TextView paragraph(String value) {
        TextView result = text(value, 13, MUTED, false);
        result.setPadding(0, dp(8), 0, 0);
        return result;
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

    private Button actionButton(String title, View.OnClickListener listener) {
        Button button = new Button(activity);
        button.setText(title);
        button.setTextSize(14);
        button.setTextColor(TEXT);
        button.setAllCaps(false);
        button.setMinHeight(dp(50));
        button.setPadding(dp(14), dp(9), dp(14), dp(9));
        button.setBackground(actionBackground());
        button.setOnClickListener(listener);
        return button;
    }

    private LinearLayout.LayoutParams cardParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(8), 0, dp(8));
        return params;
    }

    private LinearLayout.LayoutParams compactParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(7), 0, 0);
        return params;
    }

    private LinearLayout.LayoutParams actionParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(10), 0, 0);
        return params;
    }

    private GradientDrawable pageBackground() {
        return new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[] {BACKDROP, SURFACE, Color.rgb(11, 45, 88)});
    }

    private StateListDrawable actionBackground() {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {android.R.attr.state_pressed}, round(CARD_PRESSED, ACCENT, 14));
        states.addState(new int[] {}, round(Color.rgb(7, 30, 57), BORDER, 14));
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
}
