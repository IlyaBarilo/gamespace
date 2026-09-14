package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class CompatibilityDialog {
    interface Host {
        CompatibilityCheck check();
        Map<String, Object> input();
        boolean busy();
    }
    private final Activity activity;
    private final Host host;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String report = "";
    private AlertDialog dialog;
    private TextView guidance, text, status;
    private Button reset, copy, form;

    CompatibilityDialog(Activity activity, Host host) { this.activity = activity; this.host = host; }

    AlertDialog create() {
        LinearLayout content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (16 * activity.getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding, padding, padding);
        guidance = paragraph(content, "");
        paragraph(content, "Отчёт содержит технические сведения об устройстве и результаты проверки GameSpace. Автор программы использует их для улучшения программы, исследований и публикации результатов, в том числе в интернете, научных публикациях и таблицах совместимости на GitHub. Сведения публикуются без привязки к отправителю. Предоставление отчёта добровольно.");
        paragraph(content, "? — неизвестно; - — не применимо. Код целостности помогает обнаружить повреждение текста при копировании или пересылке.");
        reset = button(content, "Начать новую проверку", new View.OnClickListener() { public void onClick(View view) {
            if (host.busy()) return;
            new AlertDialog.Builder(activity).setTitle("Начать новую проверку?")
                .setMessage("Результаты проверки будут сброшены. Установленный сайт и сохранения останутся на месте.")
                .setNegativeButton("Отмена", null).setPositiveButton("Начать", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface ignored, int which) {
                        host.check().reset("Новая проверка начата. Ранее выполненные действия не учитываются.");
                        generate();
                    }
                }).show();
        } });
        paragraph(content, "Текст отчёта доступен только для чтения и формируется заново при каждом открытии этого окна.");
        text = paragraph(content, report); text.setTextIsSelectable(true); text.setTextSize(13);
        copy = button(content, "Копировать", new View.OnClickListener() { public void onClick(View view) { copy(); } });
        form = button(content, "Скопировать и открыть форму", new View.OnClickListener() { public void onClick(View view) {
            boolean copied = copy();
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CompatibilityReport.FORM_URL)));
                status.setText(copied ? "Форма открыта. Вставьте отчёт и нажмите «Отправить» в форме."
                    : "Форма открыта. Вернитесь в GameSpace и скопируйте текст вручную.");
            } catch (RuntimeException unavailable) { status.setText("Не удалось открыть браузер. Попробуйте ещё раз."); }
        } });
        paragraph(content, "Откроется Яндекс Форма. Вставьте скопированный отчёт и отправьте его. Для отправки нужен интернет.");
        status = paragraph(content, ""); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        ScrollView scroll = new ScrollView(activity); scroll.addView(content);
        dialog = new AlertDialog.Builder(activity).setTitle("Проверка совместимости").setView(scroll)
            .setPositiveButton("Закрыть", null).create();
        refresh();
        return dialog;
    }
    void shown() {
        generate();
        final AlertDialog current = dialog;
        handler.postDelayed(new Runnable() { public void run() {
            if (current != dialog || !current.isShowing() || activity.isFinishing() || activity.isDestroyed()) return;
            refresh(); handler.postDelayed(this, 1000);
        } }, 1000);
    }
    private void refresh() {
        guidance.setText(coloredGuidance(host.check().guidance())); reset.setEnabled(!host.busy());
        copy.setEnabled(!report.isEmpty()); form.setEnabled(!report.isEmpty());
    }
    private static CharSequence coloredGuidance(String value) {
        SpannableString result = new SpannableString(value);
        final int green = Color.rgb(22, 115, 68), yellow = Color.rgb(138, 101, 0), red = Color.rgb(180, 35, 35);
        int end = value.indexOf('\n');
        if (end < 0) end = value.length();
        result.setSpan(new ForegroundColorSpan(value.startsWith("Базовая проверка пройдена") ? green
            : value.startsWith("Зафиксирована ошибка") ? red : yellow), 0, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        Matcher match = Pattern.compile("(?m)^\\d+\\. [^\\n]+: (выполнено|пока не выполнено|пока не проверено|ошибка|прервано)$").matcher(value);
        while (match.find()) result.setSpan(new ForegroundColorSpan("выполнено".equals(match.group(1)) ? green
            : "ошибка".equals(match.group(1)) ? red : yellow), match.start(1), match.end(1), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return result;
    }
    private void generate() {
        report = ""; text.setText("");
        try { report = CompatibilityReport.create(host.input()); text.setText(report); status.setText("Отчёт сформирован."); }
        catch (RuntimeException unavailable) { status.setText("Не удалось сформировать отчёт. Закройте окно и откройте его снова."); }
        refresh();
    }
    private boolean copy() {
        if (report.isEmpty()) return false;
        try {
            ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null) throw new IllegalStateException();
            clipboard.setPrimaryClip(ClipData.newPlainText("Отчёт о совместимости GameSpace", report));
            status.setText("Отчёт скопирован."); return true;
        } catch (RuntimeException unavailable) { status.setText("Не удалось скопировать автоматически. Выделите текст и скопируйте его вручную."); return false; }
    }
    private TextView paragraph(LinearLayout content, String value) {
        TextView result = new TextView(activity); result.setText(value); result.setTextSize(14);
        result.setTextColor(Color.rgb(30, 34, 38)); result.setPadding(0, 8, 0, 12);
        content.addView(result, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return result;
    }
    private Button button(LinearLayout content, String title, View.OnClickListener listener) {
        Button result = new Button(activity); result.setText(title); result.setAllCaps(false); result.setOnClickListener(listener);
        content.addView(result, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return result;
    }
}
