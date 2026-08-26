package ru.local.gamespace.loader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry;
import org.apache.commons.compress.archivers.sevenz.SevenZFile;

public class MainActivity extends Activity {
    private static final int REQUEST_OPEN_ZIP = 7001;
    private static final String PREFS = "gamespace_loader";
    private static final String PREF_BASE_PATH = "base_path";
    private static final String PREF_INDEX_PATH = "index_path";
    private static final String PREF_CONTENT_ROOT_PATH = "content_root_path";
    private static final String PREF_ARCHIVE_NAME = "archive_name";
    private static final String PREF_INSTALLED_AT = "installed_at";
    private static final String PREF_EXTRACTED_BYTES = "extracted_bytes";
    private static final String PREF_EXTRACTED_FILES = "extracted_files";
    private static final String PREF_SKIPPED_FILES = "skipped_files";
    private static final String PREF_LAST_UPDATE_MODE = "last_update_mode";
    private static final String PREF_LAST_UPDATE_DURATION_MS = "last_update_duration_ms";
    private static final String PREF_LAST_DELETE_DURATION_MS = "last_delete_duration_ms";
    private static final String PREF_LAST_EXTRACT_DURATION_MS = "last_extract_duration_ms";
    private static final String PREF_LAST_OPERATION_WRITTEN_BYTES = "last_operation_written_bytes";
    private static final String PREF_LAST_OPERATION_WRITTEN_FILES = "last_operation_written_files";
    private static final String STORAGE_DIR_NAME = "gamespace-loader";
    private static final String EXTRACT_DIR_NAME = "site-files";
    private static final int BUFFER_SIZE = 1024 * 256;
    private static final int TOP_BAR_AUTO_HIDE_MS = 5000;
    private static final int TOP_BAR_COUNTDOWN_STEP_MS = 50;
    private static final int PAGE_LOADING_SPINNER_DELAY_MS = 500;
    private static final int PAGE_LOADING_TEXT_DELAY_MS = 1000;
    private static final int PAGE_LOADING_SLOW_DELAY_MS = 10000;
    private static final long PREPARE_PROGRESS_UPDATE_MS = 500L;
    private static final int UPDATE_MODE_FULL = 1;
    private static final int UPDATE_MODE_FAST = 2;
    private static final int ARCHIVE_ZIP = 1;
    private static final int ARCHIVE_7Z = 2;
    private static final String BUILTIN_DEMO_ASSET_NAME = "demo.7z";
    private static final String HOME_PAGE_PAUSE_JS = "(function(){try{window.dispatchEvent(new Event('gamespace:pause'));var list=[];var media=document.querySelectorAll('audio,video');for(var i=0;i<media.length;i++){var m=media[i];if(m&&!m.paused&&!m.ended){list.push(i);try{m.pause();}catch(e){}}}window.__gamespacePausedMedia=list;if(window.Howler&&window.Howler.ctx&&window.Howler.ctx.state==='running'&&window.Howler.ctx.suspend){window.__gamespaceResumeHowler=true;window.Howler.ctx.suspend();}var toneCtx=window.Tone&&window.Tone.context&&(window.Tone.context.rawContext||window.Tone.context);if(toneCtx&&toneCtx.state==='running'&&toneCtx.suspend){window.__gamespaceResumeTone=true;toneCtx.suspend();}}catch(e){}})();";
    private static final String HOME_PAGE_RESUME_JS = "(function(){try{window.dispatchEvent(new Event('gamespace:resume'));var media=document.querySelectorAll('audio,video');var list=window.__gamespacePausedMedia||[];for(var i=0;i<list.length;i++){var m=media[list[i]];if(m){try{var p=m.play();if(p&&p.catch){p.catch(function(){});}}catch(e){}}}window.__gamespacePausedMedia=[];if(window.__gamespaceResumeHowler&&window.Howler&&window.Howler.ctx&&window.Howler.ctx.resume){window.__gamespaceResumeHowler=false;window.Howler.ctx.resume();}var toneCtx=window.Tone&&window.Tone.context&&(window.Tone.context.rawContext||window.Tone.context);if(window.__gamespaceResumeTone&&toneCtx&&toneCtx.resume){window.__gamespaceResumeTone=false;toneCtx.resume();}}catch(e){}})();";
    private static final String BUILTIN_DEMO_ARCHIVE_NAME = "Встроенный демо-сайт (demo.7z)";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private WebView homeWebView;
    private WebView webView;
    private FrameLayout contentFrame;
    private LinearLayout topBarContainer;
    private ProgressBar topBarCountdown;
    private FrameLayout pageLoadingOverlay;
    private ProgressBar pageLoadingSpinner;
    private TextView pageLoadingText;
    private LinearLayout emptyPanel;
    private LinearLayout progressPanel;
    private TextView emptyTitle;
    private TextView emptyDetails;
    private TextView progressTitle;
    private TextView progressDetails;
    private Button backButton;
    private Button homeButton;
    private Button menuButton;
    private Button chooseButton;
    private Button demoButton;

    private volatile boolean busy;
    private int topBarHoldCount;
    private int pendingUpdateMode = UPDATE_MODE_FULL;
    private long topBarHideAtMillis;
    private File currentIndexFile;
    private File currentContentRoot;
    private String indexStateSession = createIndexStateSession();
    private File loadedHomeIndexFile;
    private String loadedHomeUrl = "";
    private boolean clearContentHistoryAfterLoad;
    private boolean contentLoadPending;
    private boolean contentVisualCallbackPending;
    private long contentLoadRequestId;
    private String pendingContentUrl = "";

    private final Runnable topBarCountdownRunnable = new Runnable() {
        @Override
        public void run() {
            if (!shouldAutoHideTopBar()) {
                resetTopBarCountdown();
                return;
            }

            long remaining = topBarHideAtMillis - System.currentTimeMillis();
            if (remaining <= 0L) {
                hideTopBar();
                return;
            }

            if (topBarCountdown != null) {
                topBarCountdown.setProgress((int) remaining);
            }
            mainHandler.postDelayed(this, TOP_BAR_COUNTDOWN_STEP_MS);
        }
    };

    private final Runnable showPageLoadingSpinnerRunnable = new Runnable() {
        @Override
        public void run() {
            if (!contentLoadPending || pageLoadingOverlay == null) {
                return;
            }
            pageLoadingOverlay.setBackgroundColor(Color.argb(84, 8, 19, 31));
            pageLoadingSpinner.setVisibility(View.VISIBLE);
        }
    };

    private final Runnable showPageLoadingTextRunnable = new Runnable() {
        @Override
        public void run() {
            if (!contentLoadPending || pageLoadingText == null) {
                return;
            }
            pageLoadingText.setText("Загрузка игры…");
            pageLoadingText.setVisibility(View.VISIBLE);
        }
    };

    private final Runnable showSlowPageLoadingTextRunnable = new Runnable() {
        @Override
        public void run() {
            if (!contentLoadPending || pageLoadingText == null) {
                return;
            }
            pageLoadingText.setText("Загрузка занимает больше времени…");
            pageLoadingText.setVisibility(View.VISIBLE);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        configureWebView(homeWebView, true);
        configureWebView(webView, false);
        loadInstalledSiteOrPrompt();
    }

    @Override
    protected void onResume() {
        super.onResume();
        WebView visibleWebView = getVisibleSiteWebView();
        if (visibleWebView != null) {
            visibleWebView.onResume();
            if (visibleWebView == homeWebView && !contentLoadPending) {
                resumeHomePageMedia();
            }
        }
        if (contentLoadPending && webView != null) {
            webView.onResume();
        }
        if (shouldAutoHideTopBar()) {
            showTopBarWithCountdown();
        }
    }

    @Override
    protected void onPause() {
        WebView visibleWebView = getVisibleSiteWebView();
        if (visibleWebView != null) {
            if (visibleWebView == homeWebView && !contentLoadPending) {
                pauseHomePageMedia();
            }
            visibleWebView.onPause();
        }
        if (contentLoadPending && webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    private void buildUi() {
        FrameLayout rootFrame = new FrameLayout(this);
        rootFrame.setBackgroundColor(Color.WHITE);

        topBarContainer = new LinearLayout(this);
        topBarContainer.setOrientation(LinearLayout.VERTICAL);
        topBarContainer.setBackgroundColor(Color.argb(128, 31, 38, 45));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), dp(6), dp(8), dp(6));
        toolbar.setBackgroundColor(Color.TRANSPARENT);

        TextView title = new TextView(this);
        title.setText("GameSpace APK " + getAppVersionName());
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        backButton = createToolbarIconButton("←", "Назад");
        backButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                navigateBackInSite();
            }
        });
        toolbar.addView(backButton, new LinearLayout.LayoutParams(dp(42), dp(42)));

        homeButton = createToolbarIconButton("⌂", "Главное меню");
        homeButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openSiteHome();
            }
        });
        toolbar.addView(homeButton, new LinearLayout.LayoutParams(dp(42), dp(42)));

        menuButton = createToolbarIconButton("⚙", "Настройки");
        menuButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showAppMenu();
            }
        });
        toolbar.addView(menuButton, new LinearLayout.LayoutParams(dp(42), dp(42)));

        topBarCountdown = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        topBarCountdown.setIndeterminate(false);
        topBarCountdown.setMax(TOP_BAR_AUTO_HIDE_MS);
        topBarCountdown.setProgress(TOP_BAR_AUTO_HIDE_MS);

        topBarContainer.addView(toolbar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        topBarContainer.addView(topBarCountdown, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(3)
        ));

        contentFrame = new FrameLayout(this);

        homeWebView = new WebView(this);
        homeWebView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        homeWebView.setVisibility(View.GONE);
        contentFrame.addView(homeWebView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        webView = new WebView(this);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVisibility(View.GONE);
        contentFrame.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        emptyPanel = createEmptyPanel();
        contentFrame.addView(emptyPanel, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        progressPanel = createProgressPanel();
        contentFrame.addView(progressPanel, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        pageLoadingOverlay = createPageLoadingOverlay();
        pageLoadingOverlay.setVisibility(View.GONE);
        contentFrame.addView(pageLoadingOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        rootFrame.addView(contentFrame, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        rootFrame.addView(topBarContainer, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        ));

        setContentView(rootFrame);
    }

    private Button createToolbarIconButton(String text, String description) {
        Button button = new Button(this);
        button.setText(text);
        button.setContentDescription(description);
        button.setAllCaps(false);
        button.setTextSize(20);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setPadding(0, 0, 0, 0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        return button;
    }

    private LinearLayout createEmptyPanel() {
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        outer.setGravity(Gravity.CENTER);
        outer.setPadding(dp(24), dp(24), dp(24), dp(24));
        outer.setBackgroundColor(Color.WHITE);

        emptyTitle = new TextView(this);
        emptyTitle.setTextColor(Color.rgb(22, 28, 33));
        emptyTitle.setTextSize(22);
        emptyTitle.setTypeface(Typeface.DEFAULT_BOLD);
        emptyTitle.setGravity(Gravity.CENTER);
        outer.addView(emptyTitle, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        emptyDetails = new TextView(this);
        emptyDetails.setTextColor(Color.rgb(75, 84, 92));
        emptyDetails.setTextSize(15);
        emptyDetails.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailsParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        detailsParams.setMargins(0, dp(12), 0, dp(20));
        outer.addView(emptyDetails, detailsParams);

        chooseButton = new Button(this);
        chooseButton.setText("Выбрать архив");
        chooseButton.setAllCaps(false);
        chooseButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openZipPicker();
            }
        });
        outer.addView(chooseButton, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(48)
        ));

        demoButton = new Button(this);
        demoButton.setText("Загрузить встроенный демо-сайт");
        demoButton.setAllCaps(false);
        demoButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                installBuiltinDemoSite();
            }
        });
        LinearLayout.LayoutParams demoParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(48)
        );
        demoParams.setMargins(0, dp(10), 0, 0);
        outer.addView(demoButton, demoParams);

        return outer;
    }

    private LinearLayout createProgressPanel() {
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        outer.setGravity(Gravity.CENTER);
        outer.setPadding(dp(24), dp(24), dp(24), dp(24));
        outer.setBackgroundColor(Color.WHITE);

        ProgressBar progressBar = new ProgressBar(this);
        outer.addView(progressBar, new LinearLayout.LayoutParams(dp(56), dp(56)));

        progressTitle = new TextView(this);
        progressTitle.setTextColor(Color.rgb(22, 28, 33));
        progressTitle.setTextSize(20);
        progressTitle.setTypeface(Typeface.DEFAULT_BOLD);
        progressTitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        titleParams.setMargins(0, dp(18), 0, dp(8));
        outer.addView(progressTitle, titleParams);

        progressDetails = new TextView(this);
        progressDetails.setTextColor(Color.rgb(75, 84, 92));
        progressDetails.setTextSize(15);
        progressDetails.setGravity(Gravity.CENTER);
        outer.addView(progressDetails, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        return outer;
    }

    private FrameLayout createPageLoadingOverlay() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.TRANSPARENT);
        overlay.setClickable(true);
        overlay.setFocusable(true);

        LinearLayout indicator = new LinearLayout(this);
        indicator.setOrientation(LinearLayout.VERTICAL);
        indicator.setGravity(Gravity.CENTER);

        pageLoadingSpinner = new ProgressBar(this);
        pageLoadingSpinner.setVisibility(View.INVISIBLE);
        indicator.addView(pageLoadingSpinner, new LinearLayout.LayoutParams(dp(52), dp(52)));

        pageLoadingText = new TextView(this);
        pageLoadingText.setText("Загрузка игры…");
        pageLoadingText.setTextColor(Color.WHITE);
        pageLoadingText.setTextSize(16);
        pageLoadingText.setTypeface(Typeface.DEFAULT_BOLD);
        pageLoadingText.setGravity(Gravity.CENTER);
        pageLoadingText.setVisibility(View.INVISIBLE);
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        textParams.setMargins(dp(20), dp(12), dp(20), 0);
        indicator.addView(pageLoadingText, textParams);

        FrameLayout.LayoutParams indicatorParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        overlay.addView(indicator, indicatorParams);
        return overlay;
    }

    private void showTopBarWithCountdown() {
        if (topBarContainer == null) {
            return;
        }

        topBarContainer.setVisibility(View.VISIBLE);

        if (shouldAutoHideTopBar()) {
            startTopBarCountdown();
        } else {
            cancelTopBarCountdown();
        }
    }

    private void showTopBarPersistent() {
        if (topBarContainer == null) {
            return;
        }

        topBarContainer.setVisibility(View.VISIBLE);
        cancelTopBarCountdown();
    }

    private void startTopBarCountdown() {
        if (topBarContainer == null) {
            return;
        }

        topBarContainer.setVisibility(View.VISIBLE);

        if (!shouldAutoHideTopBar()) {
            cancelTopBarCountdown();
            return;
        }

        topBarHideAtMillis = System.currentTimeMillis() + TOP_BAR_AUTO_HIDE_MS;
        resetTopBarCountdown();
        mainHandler.removeCallbacks(topBarCountdownRunnable);
        mainHandler.post(topBarCountdownRunnable);
    }

    private void cancelTopBarCountdown() {
        mainHandler.removeCallbacks(topBarCountdownRunnable);
        resetTopBarCountdown();
    }

    private void resetTopBarCountdown() {
        if (topBarCountdown != null) {
            topBarCountdown.setProgress(TOP_BAR_AUTO_HIDE_MS);
        }
    }

    private void hideTopBar() {
        mainHandler.removeCallbacks(topBarCountdownRunnable);
        if (topBarCountdown != null) {
            topBarCountdown.setProgress(0);
        }
        if (topBarContainer != null) {
            topBarContainer.setVisibility(View.GONE);
        }
    }

    private boolean shouldAutoHideTopBar() {
        return !busy
            && topBarHoldCount == 0
            && currentIndexFile != null
            && currentIndexFile.isFile()
            && getVisibleSiteWebView() != null;
    }

    private WebView getVisibleSiteWebView() {
        if (webView != null && webView.getVisibility() == View.VISIBLE) {
            return webView;
        }
        if (homeWebView != null && homeWebView.getVisibility() == View.VISIBLE) {
            return homeWebView;
        }
        return null;
    }

    private void showHomeWebView() {
        boolean contentWasActive = contentLoadPending
            || (webView != null && webView.getVisibility() != View.GONE);
        if (webView != null) {
            if (contentWasActive) {
                clearContentWebView();
            } else {
                webView.onPause();
                webView.setVisibility(View.GONE);
            }
        }
        if (homeWebView != null) {
            homeWebView.setVisibility(View.VISIBLE);
            homeWebView.onResume();
            resumeHomePageMedia();
        }
    }

    private void showContentWebView() {
        boolean wasPending = contentLoadPending;
        contentLoadPending = false;
        contentVisualCallbackPending = false;
        hidePageLoadingOverlay();
        if (homeWebView != null) {
            if (!wasPending) {
                pauseHomePageMedia();
            }
            homeWebView.onPause();
            homeWebView.setVisibility(View.GONE);
        }
        if (webView != null) {
            webView.setVisibility(View.VISIBLE);
            webView.onResume();
        }
    }

    private void hideSiteWebViews() {
        boolean loadWasPending = contentLoadPending;
        cancelPendingContentLoadState();
        if (homeWebView != null) {
            if (homeWebView.getVisibility() == View.VISIBLE && !loadWasPending) {
                pauseHomePageMedia();
            }
            homeWebView.onPause();
            homeWebView.setVisibility(View.GONE);
        }
        if (webView != null) {
            if (loadWasPending) {
                webView.stopLoading();
            }
            webView.onPause();
            webView.setVisibility(View.GONE);
        }
    }

    private void beginPendingContentLoad(String url) {
        contentLoadRequestId += 1L;
        contentLoadPending = true;
        contentVisualCallbackPending = false;
        pendingContentUrl = url == null ? "" : url;

        if (homeWebView != null) {
            pauseHomePageMedia();
            homeWebView.onPause();
            homeWebView.setVisibility(View.VISIBLE);
        }
        if (webView != null) {
            webView.setVisibility(View.INVISIBLE);
            webView.onResume();
        }
        startPageLoadingOverlay();
    }

    private void cancelPendingContentLoadState() {
        contentLoadRequestId += 1L;
        contentLoadPending = false;
        contentVisualCallbackPending = false;
        pendingContentUrl = "";
        hidePageLoadingOverlay();
    }

    private void startPageLoadingOverlay() {
        mainHandler.removeCallbacks(showPageLoadingSpinnerRunnable);
        mainHandler.removeCallbacks(showPageLoadingTextRunnable);
        mainHandler.removeCallbacks(showSlowPageLoadingTextRunnable);
        if (pageLoadingOverlay != null) {
            pageLoadingOverlay.setBackgroundColor(Color.TRANSPARENT);
            pageLoadingOverlay.setVisibility(View.VISIBLE);
        }
        if (pageLoadingSpinner != null) {
            pageLoadingSpinner.setVisibility(View.INVISIBLE);
        }
        if (pageLoadingText != null) {
            pageLoadingText.setText("Загрузка игры…");
            pageLoadingText.setVisibility(View.INVISIBLE);
        }
        mainHandler.postDelayed(showPageLoadingSpinnerRunnable, PAGE_LOADING_SPINNER_DELAY_MS);
        mainHandler.postDelayed(showPageLoadingTextRunnable, PAGE_LOADING_TEXT_DELAY_MS);
        mainHandler.postDelayed(showSlowPageLoadingTextRunnable, PAGE_LOADING_SLOW_DELAY_MS);
    }

    private void hidePageLoadingOverlay() {
        mainHandler.removeCallbacks(showPageLoadingSpinnerRunnable);
        mainHandler.removeCallbacks(showPageLoadingTextRunnable);
        mainHandler.removeCallbacks(showSlowPageLoadingTextRunnable);
        if (pageLoadingOverlay != null) {
            pageLoadingOverlay.setVisibility(View.GONE);
            pageLoadingOverlay.setBackgroundColor(Color.TRANSPARENT);
        }
        if (pageLoadingSpinner != null) {
            pageLoadingSpinner.setVisibility(View.INVISIBLE);
        }
        if (pageLoadingText != null) {
            pageLoadingText.setVisibility(View.INVISIBLE);
        }
    }

    private boolean isCurrentContentPage(WebView view, String url) {
        if (view == null || url == null || url.startsWith("about:")) {
            return false;
        }
        return view == webView && url.equals(pendingContentUrl);
    }

    private void requestContentVisualState(final WebView view, String url) {
        if (!contentLoadPending
            || contentVisualCallbackPending
            || !isCurrentContentPage(view, url)) {
            return;
        }

        contentVisualCallbackPending = true;
        final long requestId = contentLoadRequestId;
        view.postVisualStateCallback(requestId, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long completedRequestId) {
                if (!contentLoadPending
                    || completedRequestId != contentLoadRequestId
                    || completedRequestId != requestId
                    || view != webView) {
                    return;
                }
                showContentWebView();
            }
        });
    }

    private void handleContentLoadError(String description) {
        if (!contentLoadPending) {
            return;
        }
        showHomeWebView();
        String details = description == null || description.trim().length() == 0
            ? "неизвестная ошибка"
            : description.trim();
        Toast.makeText(this, "Не удалось загрузить игру: " + details, Toast.LENGTH_LONG).show();
    }

    private void beginTopBarHold() {
        topBarHoldCount += 1;
        showTopBarPersistent();
    }

    private void endTopBarHold() {
        if (topBarHoldCount > 0) {
            topBarHoldCount -= 1;
        }
        if (topBarHoldCount == 0 && shouldAutoHideTopBar()) {
            startTopBarCountdown();
        }
    }

    private void showHeldDialog(AlertDialog dialog) {
        beginTopBarHold();
        dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override
            public void onDismiss(DialogInterface dialog) {
                endTopBarHold();
            }
        });
        dialog.show();
    }

    private void configureWebView(WebView view, boolean homeView) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        if (!homeView && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            settings.setOffscreenPreRaster(true);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
        }

        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(homeView ? new HomeSiteClient() : new ContentSiteClient());
    }

    private void loadInstalledSiteOrPrompt() {
        File index = findInstalledIndex();
        if (index != null) {
            loadSite(index);
            return;
        }

        currentIndexFile = null;
        currentContentRoot = null;
        hideSiteWebViews();
        progressPanel.setVisibility(View.GONE);
        emptyPanel.setVisibility(View.VISIBLE);
        emptyTitle.setText("Сайт не установлен");
        emptyDetails.setText("Выберите ZIP/7z-архив с сайтом или загрузите встроенный демо-сайт для проверки приложения.\n\nДемо-сайт распакуется во внутренний каталог приложения и запустится без интернета. Позже его можно заменить своим архивом через настройки.");
        if (backButton != null) {
            backButton.setEnabled(false);
        }
        if (homeButton != null) {
            homeButton.setEnabled(false);
        }
        showTopBarPersistent();
    }

    private File findInstalledIndex() {
        SharedPreferences prefs = getPrefs();
        String savedIndexPath = prefs.getString(PREF_INDEX_PATH, "");
        if (savedIndexPath != null && savedIndexPath.length() > 0) {
            File savedIndex = new File(savedIndexPath);
            if (savedIndex.isFile()) {
                currentContentRoot = savedIndex.getParentFile();
                return savedIndex;
            }
        }

        List<File> bases = getCandidateStorageBases();
        for (File base : bases) {
            File extractRoot = new File(base, EXTRACT_DIR_NAME);
            File index = findIndexInExtractedContent(extractRoot);
            if (index != null) {
                currentContentRoot = index.getParentFile();
                try {
                    SiteStats installedStats = summarizeInstalledSite(extractRoot);
                    saveInstalledSite(base, index, "", 0L, installedStats.bytes, installedStats.files);
                } catch (IOException ignored) {
                    saveInstalledSite(base, index, "", 0L, 0L, 0);
                }
                return index;
            }
        }

        return null;
    }

    private void loadSite(File indexFile) {
        currentIndexFile = indexFile;
        currentContentRoot = indexFile.getParentFile();
        emptyPanel.setVisibility(View.GONE);
        progressPanel.setVisibility(View.GONE);
        String indexUrl = buildIndexUrl(indexFile);
        if (!isSameFile(loadedHomeIndexFile, indexFile) || !indexUrl.equals(loadedHomeUrl)) {
            loadedHomeIndexFile = indexFile;
            loadedHomeUrl = indexUrl;
            homeWebView.loadUrl(indexUrl);
        }
        showHomeWebView();
        if (backButton != null) {
            backButton.setEnabled(true);
        }
        if (homeButton != null) {
            homeButton.setEnabled(true);
        }
    }

    private String buildIndexUrl(File indexFile) {
        return Uri.fromFile(indexFile)
            .buildUpon()
            .appendQueryParameter("app", null)
            .appendQueryParameter("gamespaceIndexSession", indexStateSession)
            .build()
            .toString();
    }

    private static String createIndexStateSession() {
        return Long.toString(System.currentTimeMillis(), 36) + "-" + Long.toString(System.nanoTime(), 36);
    }

    private void resetIndexStateSession() {
        indexStateSession = createIndexStateSession();
        clearWebViewPages();
    }

    private void clearWebViewPages() {
        loadedHomeIndexFile = null;
        loadedHomeUrl = "";
        if (homeWebView != null) {
            pauseHomePageMedia();
            homeWebView.stopLoading();
            homeWebView.loadUrl("about:blank");
            homeWebView.clearHistory();
        }
        clearContentWebView();
    }

    private void clearContentWebView() {
        cancelPendingContentLoadState();
        clearContentHistoryAfterLoad = false;
        if (webView == null) {
            return;
        }

        webView.onPause();
        webView.stopLoading();
        webView.clearHistory();
        webView.loadUrl("about:blank");
        webView.clearHistory();
        webView.setVisibility(View.GONE);
    }

    private void pauseHomePageMedia() {
        runHomePageScript(HOME_PAGE_PAUSE_JS);
    }

    private void resumeHomePageMedia() {
        runHomePageScript(HOME_PAGE_RESUME_JS);
    }

    private void runHomePageScript(String script) {
        if (homeWebView != null) {
            homeWebView.evaluateJavascript(script, null);
        }
    }

    private boolean isSameFile(File left, File right) {
        if (left == null || right == null) {
            return false;
        }

        try {
            return left.getCanonicalFile().equals(right.getCanonicalFile());
        } catch (IOException e) {
            return left.getAbsolutePath().equals(right.getAbsolutePath());
        }
    }

    private void navigateBackInSite() {
        if (busy) {
            return;
        }

        if (contentLoadPending) {
            showHomeWebView();
            return;
        }

        if (webView != null && webView.getVisibility() == View.VISIBLE) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                showHomeWebView();
            }
            return;
        }

        if (homeWebView != null && homeWebView.getVisibility() == View.VISIBLE && homeWebView.canGoBack()) {
            homeWebView.goBack();
            return;
        }

        Toast.makeText(this, "Нет предыдущей страницы.", Toast.LENGTH_SHORT).show();
    }

    private void openSiteHome() {
        if (busy) {
            return;
        }

        if (currentIndexFile != null && currentIndexFile.isFile()) {
            loadSite(currentIndexFile);
            return;
        }

        File index = findInstalledIndex();
        if (index != null) {
            loadSite(index);
            return;
        }

        Toast.makeText(this, "Сайт не установлен.", Toast.LENGTH_SHORT).show();
        loadInstalledSiteOrPrompt();
    }

    private void showProgress(final String title, final String details) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                hideSiteWebViews();
                emptyPanel.setVisibility(View.GONE);
                progressPanel.setVisibility(View.VISIBLE);
                progressTitle.setText(title);
                progressDetails.setText(details);
                backButton.setEnabled(false);
                homeButton.setEnabled(false);
                menuButton.setEnabled(false);
                chooseButton.setEnabled(false);
                if (demoButton != null) {
                    demoButton.setEnabled(false);
                }
                showTopBarPersistent();
            }
        });
    }

    private void updateProgress(final String details) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                progressDetails.setText(details);
            }
        });
    }

    private void finishBusy() {
        busy = false;
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                backButton.setEnabled(currentIndexFile != null && currentIndexFile.isFile());
                homeButton.setEnabled(currentIndexFile != null && currentIndexFile.isFile());
                menuButton.setEnabled(true);
                chooseButton.setEnabled(true);
                if (demoButton != null) {
                    demoButton.setEnabled(true);
                }
                if (shouldAutoHideTopBar()) {
                    startTopBarCountdown();
                }
            }
        });
    }

    private void showAppMenu() {
        if (busy) {
            return;
        }

        final boolean installed = currentIndexFile != null && currentIndexFile.isFile();
        final String[] items = installed
            ? new String[] {"Быстро обновить из архива", "Полное обновление из архива", "Перезагрузить сайт", "Информация", "Лицензии", "Очистить сайт"}
            : new String[] {"Выбрать архив", "Загрузить встроенный демо-сайт", "Информация", "Лицензии"};

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("GameSpace APK " + getAppVersionName())
            .setItems(items, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    String item = items[which];
                    if ("Выбрать архив".equals(item)) {
                        pendingUpdateMode = UPDATE_MODE_FULL;
                        openZipPicker();
                    } else if ("Загрузить встроенный демо-сайт".equals(item)) {
                        installBuiltinDemoSite();
                    } else if ("Быстро обновить из архива".equals(item)) {
                        pendingUpdateMode = UPDATE_MODE_FAST;
                        openZipPicker();
                    } else if ("Полное обновление из архива".equals(item)) {
                        pendingUpdateMode = UPDATE_MODE_FULL;
                        openZipPicker();
                    } else if ("Перезагрузить сайт".equals(item)) {
                        reloadSite();
                    } else if ("Информация".equals(item)) {
                        showInfoDialog();
                    } else if ("Лицензии".equals(item)) {
                        showLicensesDialog();
                    } else if ("Очистить сайт".equals(item)) {
                        confirmClearSite();
                    }
                }
            })
            .create();
        showHeldDialog(dialog);
    }

    private void openZipPicker() {
        if (busy) {
            return;
        }

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
            "application/zip",
            "application/x-zip-compressed",
            "application/x-7z-compressed",
            "application/octet-stream",
            "application/x-zip"
        });
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            startActivityForResult(intent, REQUEST_OPEN_ZIP);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Не найден файловый менеджер для выбора архива.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_OPEN_ZIP || resultCode != RESULT_OK || data == null || data.getData() == null) {
            pendingUpdateMode = UPDATE_MODE_FULL;
            return;
        }

        final Uri uri = data.getData();
        final int updateMode = pendingUpdateMode;
        pendingUpdateMode = UPDATE_MODE_FULL;
        try {
            int flags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            if (flags != 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                getContentResolver().takePersistableUriPermission(uri, flags);
            }
        } catch (SecurityException ignored) {
            // Some providers grant temporary read access only; immediate streaming still works.
        }

        if (currentIndexFile != null && currentIndexFile.isFile()) {
            boolean fastUpdate = updateMode == UPDATE_MODE_FAST;
            AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(fastUpdate ? "Быстро обновить сайт?" : "Полностью обновить сайт?")
                .setMessage(fastUpdate
                    ? "Старые файлы не удаляются. Из архива будут записаны только новые файлы и файлы с более свежей датой. Файлы, которых нет в архиве, останутся на телефоне."
                    : "Старые файлы сайта будут удалены, затем выбранный архив будет распакован заново.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton(fastUpdate ? "Быстро обновить" : "Полное обновление", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        installFromZip(uri, updateMode);
                    }
                })
                .create();
            showHeldDialog(dialog);
        } else {
            installFromZip(uri, UPDATE_MODE_FULL);
        }
    }

    private void installFromZip(final Uri uri, final int updateMode) {
        if (busy) {
            return;
        }

        busy = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final String archiveName = getDisplayName(uri);
        final int archiveType = detectArchiveType(uri, archiveName);
        final String archiveFormat = formatArchiveType(archiveType);
        final File previousIndexFile = currentIndexFile;
        final boolean fastUpdate = updateMode == UPDATE_MODE_FAST && previousIndexFile != null && previousIndexFile.isFile();
        showProgress(fastUpdate ? "Быстрое обновление сайта" : "Распаковка сайта", "Подготовка хранилища...\nФормат: " + archiveFormat + "\nАрхив: " + archiveName);

        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                File base = null;
                File extractRoot = null;
                long extractedBytes = 0L;
                int extractedFiles = 0;
                int skippedFiles = 0;
                long totalStartedAt = System.currentTimeMillis();
                long deleteDurationMs = 0L;
                long extractDurationMs = 0L;
                String diagnosticMessage = "";

                try {
                    updateProgress("Выбираю хранилище...\nФормат: " + archiveFormat + "\nАрхив: " + archiveName);
                    base = chooseStorageBaseForInstall();
                    updateProgress("Хранилище выбрано:\n" + base.getAbsolutePath() + "\nСвободно: " + formatBytes(base.getUsableSpace()));
                    if (!base.exists() && !base.mkdirs()) {
                        throw new IOException("Не удалось создать каталог: " + base.getAbsolutePath());
                    }

                    extractRoot = new File(base, EXTRACT_DIR_NAME);
                    if (fastUpdate) {
                        updateProgress("Быстрое обновление.\nСтарые файлы не удаляются.\nБудут записаны только новые и более свежие файлы.");
                    } else {
                        long deleteStartedAt = System.currentTimeMillis();
                        DeleteStats deleted = clearExtractedSite(extractRoot, "Удаляю предыдущую версию сайта");
                        deleteDurationMs = System.currentTimeMillis() - deleteStartedAt;
                        updateProgress("Подготовка завершена.\nУдалено файлов: " + deleted.files + ", каталогов: " + deleted.directories + "\nНачинаю распаковку...");
                    }
                    if (!extractRoot.exists() && !extractRoot.mkdirs()) {
                        throw new IOException("Не удалось создать каталог сайта: " + extractRoot.getAbsolutePath());
                    }

                    long extractStartedAt = System.currentTimeMillis();
                    ZipStats stats = archiveType == ARCHIVE_7Z
                        ? extractSevenZ(uri, extractRoot, archiveName, fastUpdate)
                        : extractZip(uri, extractRoot, archiveName, fastUpdate);
                    extractDurationMs = System.currentTimeMillis() - extractStartedAt;
                    extractedBytes = stats.bytes;
                    extractedFiles = stats.files;
                    skippedFiles = stats.skippedFiles;

                    File index = findIndexInExtractedContent(extractRoot);
                    if (index == null && fastUpdate && previousIndexFile.isFile()) {
                        index = previousIndexFile;
                    }
                    if (index == null) {
                        throw new IOException("В архиве не найден index.html. Поддерживается index.html в корне, site/index.html или один верхний каталог с index.html.");
                    }

                    SiteStats installedStats = summarizeInstalledSite(extractRoot);
                    long totalDurationMs = System.currentTimeMillis() - totalStartedAt;
                    saveInstalledSite(
                        base,
                        index,
                        archiveName,
                        System.currentTimeMillis(),
                        installedStats.bytes,
                        installedStats.files,
                        skippedFiles,
                        fastUpdate ? "fast" : "full",
                        totalDurationMs,
                        deleteDurationMs,
                        extractDurationMs,
                        extractedBytes,
                        extractedFiles
                    );
                    final File finalIndex = index;
                    final long finalBytes = installedStats.bytes;
                    final int finalFiles = installedStats.files;
                    final int finalOperationFiles = extractedFiles;
                    final int finalSkippedFiles = skippedFiles;
                    final boolean finalFastUpdate = fastUpdate;

                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            String message = finalFastUpdate
                                ? "Быстрое обновление: загружено " + finalOperationFiles + ", пропущено " + finalSkippedFiles
                                : "Сайт установлен: " + formatBytes(finalBytes) + ", файлов: " + finalFiles;
                            Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                            resetIndexStateSession();
                            loadSite(finalIndex);
                        }
                    });
                } catch (final Exception e) {
                    diagnosticMessage = buildInstallErrorDetails(e, archiveName, fastUpdate, base, extractRoot, totalStartedAt);
                    final String finalDiagnosticMessage = diagnosticMessage;
                    final String finalBriefMessage = buildBriefErrorMessage(e);
                    if (extractRoot != null && !fastUpdate) {
                        try {
                            clearExtractedSite(extractRoot, "Удаляю неполную распаковку");
                        } catch (IOException ignored) {
                        }
                    }

                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            if (fastUpdate && previousIndexFile != null && previousIndexFile.isFile()) {
                                Toast.makeText(MainActivity.this, "Быстрое обновление не завершено.", Toast.LENGTH_LONG).show();
                                loadSite(previousIndexFile);
                                showErrorDialog("Ошибка быстрого обновления", finalDiagnosticMessage);
                                return;
                            }
                            hideSiteWebViews();
                            progressPanel.setVisibility(View.GONE);
                            emptyPanel.setVisibility(View.VISIBLE);
                            emptyTitle.setText("Сайт не установлен");
                            emptyDetails.setText("Распаковка не завершена.\n\n" + finalBriefMessage);
                            Toast.makeText(MainActivity.this, "Ошибка распаковки архива.", Toast.LENGTH_LONG).show();
                            showErrorDialog("Ошибка распаковки архива", finalDiagnosticMessage);
                        }
                    });
                } finally {
                    finishBusy();
                }
            }
        }, "site-zip-extract");

        worker.start();
    }

    private void installBuiltinDemoSite() {
        if (busy) {
            return;
        }

        busy = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showProgress("Загрузка встроенного демо-сайта", "Подготавливаю встроенный архив demo.7z...");

        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                File base = null;
                File extractRoot = null;
                File demoArchive = null;
                long totalStartedAt = System.currentTimeMillis();
                long deleteDurationMs = 0L;
                long extractDurationMs = 0L;

                try {
                    updateProgress("Копирую встроенный demo.7z во временный каталог...");
                    demoArchive = copyAssetToCache(BUILTIN_DEMO_ASSET_NAME, "builtin-demo.7z");

                    updateProgress("Выбираю хранилище для демо-сайта...");
                    base = chooseStorageBaseForInstall();
                    if (!base.exists() && !base.mkdirs()) {
                        throw new IOException("Не удалось создать каталог: " + base.getAbsolutePath());
                    }

                    extractRoot = new File(base, EXTRACT_DIR_NAME);
                    long deleteStartedAt = System.currentTimeMillis();
                    DeleteStats deleted = clearExtractedSite(extractRoot, "Удаляю предыдущую версию сайта");
                    deleteDurationMs = System.currentTimeMillis() - deleteStartedAt;
                    updateProgress("Подготовка завершена.\nУдалено файлов: " + deleted.files + ", каталогов: " + deleted.directories + "\nРаспаковываю встроенный демо-сайт...");

                    if (!extractRoot.exists() && !extractRoot.mkdirs()) {
                        throw new IOException("Не удалось создать каталог сайта: " + extractRoot.getAbsolutePath());
                    }

                    long extractStartedAt = System.currentTimeMillis();
                    ZipStats stats = extractSevenZFromFile(demoArchive, extractRoot, BUILTIN_DEMO_ARCHIVE_NAME, false);
                    extractDurationMs = System.currentTimeMillis() - extractStartedAt;

                    File index = findIndexInExtractedContent(extractRoot);
                    if (index == null) {
                        throw new IOException("Во встроенном демо-сайте не найден index.html.");
                    }

                    SiteStats installedStats = summarizeInstalledSite(extractRoot);
                    long totalDurationMs = System.currentTimeMillis() - totalStartedAt;
                    saveInstalledSite(
                        base,
                        index,
                        BUILTIN_DEMO_ARCHIVE_NAME,
                        System.currentTimeMillis(),
                        installedStats.bytes,
                        installedStats.files,
                        stats.skippedFiles,
                        "demo",
                        totalDurationMs,
                        deleteDurationMs,
                        extractDurationMs,
                        stats.bytes,
                        stats.files
                    );

                    final File finalIndex = index;
                    final int finalFiles = installedStats.files;
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            resetIndexStateSession();
                            Toast.makeText(MainActivity.this, "Демо-сайт загружен, файлов: " + finalFiles, Toast.LENGTH_LONG).show();
                            loadSite(finalIndex);
                        }
                    });
                } catch (final Exception e) {
                    final String finalDiagnosticMessage = buildInstallErrorDetails(e, BUILTIN_DEMO_ARCHIVE_NAME, false, base, extractRoot, totalStartedAt);
                    final String finalBriefMessage = buildBriefErrorMessage(e);
                    if (extractRoot != null) {
                        try {
                            clearExtractedSite(extractRoot, "Удаляю неполную распаковку демо-сайта");
                        } catch (IOException ignored) {
                        }
                    }

                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            hideSiteWebViews();
                            progressPanel.setVisibility(View.GONE);
                            emptyPanel.setVisibility(View.VISIBLE);
                            emptyTitle.setText("Сайт не установлен");
                            emptyDetails.setText("Встроенный демо-сайт не загрузился.\n\n" + finalBriefMessage);
                            Toast.makeText(MainActivity.this, "Ошибка загрузки демо-сайта.", Toast.LENGTH_LONG).show();
                            showErrorDialog("Ошибка загрузки демо-сайта", finalDiagnosticMessage);
                        }
                    });
                } finally {
                    if (demoArchive != null && demoArchive.isFile()) {
                        demoArchive.delete();
                    }
                    finishBusy();
                }
            }
        }, "builtin-demo-extract");

        worker.start();
    }

    private File copyAssetToCache(String assetName, String fileName) throws IOException {
        File out = new File(getCacheDir(), fileName);
        InputStream input = getAssets().open(assetName);
        FileOutputStream output = new FileOutputStream(out);
        try {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        } finally {
            try {
                input.close();
            } catch (IOException ignored) {
            }
            output.close();
        }
        return out;
    }

    private int detectArchiveType(Uri uri, String archiveName) {
        String lowerName = archiveName == null ? "" : archiveName.toLowerCase(Locale.US);
        if (lowerName.endsWith(".7z")) {
            return ARCHIVE_7Z;
        }
        if (lowerName.endsWith(".zip")) {
            return ARCHIVE_ZIP;
        }

        InputStream stream = null;
        try {
            stream = getContentResolver().openInputStream(uri);
            if (stream == null) {
                return ARCHIVE_ZIP;
            }
            byte[] signature = new byte[6];
            int read = stream.read(signature);
            if (read >= 6
                && signature[0] == 0x37
                && signature[1] == 0x7A
                && (signature[2] & 0xFF) == 0xBC
                && (signature[3] & 0xFF) == 0xAF
                && signature[4] == 0x27
                && signature[5] == 0x1C) {
                return ARCHIVE_7Z;
            }
            if (read >= 2 && signature[0] == 0x50 && signature[1] == 0x4B) {
                return ARCHIVE_ZIP;
            }
        } catch (IOException ignored) {
        } finally {
            if (stream != null) {
                try {
                    stream.close();
                } catch (IOException ignored) {
                }
            }
        }

        return ARCHIVE_ZIP;
    }

    private String formatArchiveType(int archiveType) {
        return archiveType == ARCHIVE_7Z ? "7z" : "ZIP";
    }

    private ZipStats extractZip(Uri uri, File extractRoot, String archiveName, boolean fastUpdate) throws IOException {
        Charset[] charsets = getZipNameCharsets();
        ZipDiagnosticException firstMalformedError = null;

        for (int i = 0; i < charsets.length; i++) {
            Charset charset = charsets[i];
            if (charset == null) {
                continue;
            }

            if (i > 0) {
                updateProgress("Повторяю чтение ZIP с кодировкой имен: " + charset.name()
                    + "\nАрхив: " + archiveName
                    + "\nЭто может помочь для русских имен файлов в старых ZIP.");
                if (!fastUpdate) {
                    clearExtractedSite(extractRoot, "Очищаю неполную распаковку перед повтором");
                    if (!extractRoot.exists() && !extractRoot.mkdirs()) {
                        throw new IOException("Не удалось создать каталог сайта: " + extractRoot.getAbsolutePath());
                    }
                }
            }

            try {
                return extractZipWithCharset(uri, extractRoot, archiveName, fastUpdate, charset);
            } catch (ZipDiagnosticException e) {
                if (isMalformedZipNameError(getRootCause(e)) && i < charsets.length - 1) {
                    if (firstMalformedError == null) {
                        firstMalformedError = e;
                    }
                    continue;
                }
                throw e;
            }
        }

        if (firstMalformedError != null) {
            throw firstMalformedError;
        }
        throw new IOException("Не удалось выбрать кодировку имен ZIP.");
    }

    private ZipStats extractZipWithCharset(Uri uri, File extractRoot, String archiveName, boolean fastUpdate, Charset charset) throws IOException {
        ZipReadContext context = new ZipReadContext();
        context.archiveName = archiveName;
        context.archiveFormat = "ZIP";
        context.nameEncoding = charset.name();
        context.fastUpdate = fastUpdate;
        context.targetPath = extractRoot.getAbsolutePath();

        ContentResolver resolver = getContentResolver();
        InputStream rawStream = null;
        long archiveSize = getContentSize(uri);
        context.archiveSize = archiveSize;
        long extractedBytes = 0L;
        int extractedFiles = 0;
        int skippedFiles = 0;
        int entries = 0;
        long lastUiUpdate = 0L;
        long progressStartedAt = System.currentTimeMillis();
        byte[] buffer = new byte[BUFFER_SIZE];

        updateProgress((fastUpdate ? "Режим: быстрое обновление\n" : "Режим: обычное обновление\n")
            + "Формат: ZIP\n"
            + "Кодировка имен: " + charset.name() + "\n"
            + "Архив: " + archiveName + "\nМесто: " + extractRoot.getAbsolutePath());

        try {
            context.stage = "открытие выбранного ZIP";
            rawStream = resolver.openInputStream(uri);
            if (rawStream == null) {
                throw new IOException("Не удалось открыть выбранный архив.");
            }

            context.stage = "подготовка каталога распаковки";
            String canonicalRoot = withTrailingSeparator(extractRoot.getCanonicalPath());

            context.stage = "создание ZIP-потока";
            CountingInputStream countingStream = new CountingInputStream(rawStream);
            ZipInputStream zip = new ZipInputStream(new BufferedInputStream(countingStream, BUFFER_SIZE), charset);
            try {
                ZipEntry entry;
                while (true) {
                    context.stage = "чтение следующей записи ZIP";
                    context.readBytes = countingStream.getBytesRead();
                    entry = zip.getNextEntry();
                    if (entry == null) {
                        break;
                    }

                    context.stage = "проверка имени ZIP-записи";
                    context.currentEntryName = entry.getName();
                    String safeName = normalizeZipEntryName(entry.getName());
                    if (safeName == null) {
                        context.stage = "пропуск служебной ZIP-записи";
                        zip.closeEntry();
                        continue;
                    }

                    entries += 1;
                    context.entries = entries;
                    File out = new File(extractRoot, safeName);
                    context.currentOutputPath = out.getAbsolutePath();
                    String outPath = out.getCanonicalPath();
                    if (!outPath.startsWith(canonicalRoot)) {
                        throw new IOException("Небезопасный путь в архиве: " + entry.getName());
                    }

                    if (entry.isDirectory()) {
                        context.stage = "создание каталога";
                        if (!out.exists() && !out.mkdirs()) {
                            throw new IOException("Не удалось создать каталог: " + out.getAbsolutePath());
                        }
                        zip.closeEntry();
                        continue;
                    }

                    boolean existedBefore = out.isFile();

                    if (fastUpdate && existedBefore && !shouldExtractForFastUpdate(out, entry)) {
                        context.stage = "пропуск актуального файла";
                        skippedFiles += 1;
                        context.skippedFiles = skippedFiles;
                        zip.closeEntry();
                        long now = System.currentTimeMillis();
                        if (now - lastUiUpdate > 500L) {
                            lastUiUpdate = now;
                            context.readBytes = countingStream.getBytesRead();
                            context.writtenBytes = extractedBytes;
                            updateProgress(buildProgressText(archiveName, archiveSize, countingStream.getBytesRead(), extractedBytes, extractedFiles, skippedFiles, entries, extractRoot, fastUpdate, progressStartedAt));
                        }
                        continue;
                    }

                    context.stage = "создание родительского каталога";
                    File parent = out.getParentFile();
                    if (parent != null && !parent.exists() && !parent.mkdirs()) {
                        throw new IOException("Не удалось создать каталог: " + parent.getAbsolutePath());
                    }

                    context.stage = "запись файла";
                    FileOutputStream output = new FileOutputStream(out);
                    try {
                        int read;
                        while ((read = zip.read(buffer)) != -1) {
                            output.write(buffer, 0, read);
                            extractedBytes += read;
                            context.readBytes = countingStream.getBytesRead();
                            context.writtenBytes = extractedBytes;
                            long now = System.currentTimeMillis();
                            if (now - lastUiUpdate > 500L) {
                                lastUiUpdate = now;
                                updateProgress(buildProgressText(archiveName, archiveSize, countingStream.getBytesRead(), extractedBytes, extractedFiles, skippedFiles, entries, extractRoot, fastUpdate, progressStartedAt));
                            }
                        }
                    } finally {
                        output.close();
                    }

                    long entryTime = entry.getTime();
                    if (entryTime > 0L) {
                        context.stage = "обновление времени файла";
                        out.setLastModified(entryTime);
                    }
                    extractedFiles += 1;
                    context.extractedFiles = extractedFiles;
                    context.stage = "закрытие ZIP-записи";
                    zip.closeEntry();
                }
            } finally {
                context.stage = "закрытие ZIP-потока";
                zip.close();
            }
        } catch (ZipDiagnosticException e) {
            throw e;
        } catch (Exception e) {
            throw buildZipDiagnosticException(e, context);
        } finally {
            if (rawStream != null) {
                try {
                    rawStream.close();
                } catch (IOException ignored) {
                }
            }
        }

        updateProgress("Распаковка завершена. Проверяю index.html...");
        return new ZipStats(extractedBytes, extractedFiles, skippedFiles);
    }

    private ZipStats extractSevenZ(Uri uri, File extractRoot, String archiveName, boolean fastUpdate) throws IOException {
        ContentResolver resolver = getContentResolver();
        ParcelFileDescriptor descriptor = null;
        FileInputStream inputStream = null;
        FileChannel channel = null;
        long archiveSize = getContentSize(uri);

        try {
            descriptor = resolver.openFileDescriptor(uri, "r");
            if (descriptor == null) {
                throw new IOException("Не удалось открыть выбранный 7z-архив.");
            }

            inputStream = new FileInputStream(descriptor.getFileDescriptor());
            channel = inputStream.getChannel();
            return extractSevenZFromChannel(channel, archiveSize, extractRoot, archiveName, fastUpdate, "открытие выбранного 7z");
        } finally {
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (IOException ignored) {
                }
            }
            if (descriptor != null) {
                try {
                    descriptor.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private ZipStats extractSevenZFromFile(File archiveFile, File extractRoot, String archiveName, boolean fastUpdate) throws IOException {
        FileInputStream inputStream = null;
        try {
            inputStream = new FileInputStream(archiveFile);
            return extractSevenZFromChannel(inputStream.getChannel(), archiveFile.length(), extractRoot, archiveName, fastUpdate, "открытие встроенного 7z");
        } finally {
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private ZipStats extractSevenZFromChannel(FileChannel channel, long archiveSize, File extractRoot, String archiveName, boolean fastUpdate, String openingStage) throws IOException {
        ZipReadContext context = new ZipReadContext();
        context.archiveName = archiveName;
        context.archiveFormat = "7z";
        context.fastUpdate = fastUpdate;
        context.targetPath = extractRoot.getAbsolutePath();
        context.archiveSize = archiveSize;

        SevenZFile sevenZ = null;
        long extractedBytes = 0L;
        int extractedFiles = 0;
        int skippedFiles = 0;
        int entries = 0;
        long lastUiUpdate = 0L;
        long progressStartedAt = System.currentTimeMillis();
        byte[] buffer = new byte[BUFFER_SIZE];

        updateProgress((fastUpdate ? "Режим: быстрое обновление\n" : "Режим: обычное обновление\n")
            + "Формат: 7z\n"
            + "Архив: " + archiveName + "\nМесто: " + extractRoot.getAbsolutePath());

        try {
            context.stage = openingStage;
            context.stage = "подготовка каталога распаковки";
            String canonicalRoot = withTrailingSeparator(extractRoot.getCanonicalPath());

            context.stage = "чтение заголовка 7z";
            sevenZ = new SevenZFile(channel, archiveName);

            SevenZArchiveEntry entry;
            while (true) {
                context.stage = "чтение следующей записи 7z";
                context.readBytes = safeChannelPosition(channel);
                entry = sevenZ.getNextEntry();
                if (entry == null) {
                    break;
                }

                context.stage = "проверка имени 7z-записи";
                context.currentEntryName = entry.getName();
                if (entry.isAntiItem()) {
                    continue;
                }

                String safeName = normalizeZipEntryName(entry.getName());
                if (safeName == null) {
                    continue;
                }

                entries += 1;
                context.entries = entries;
                File out = new File(extractRoot, safeName);
                context.currentOutputPath = out.getAbsolutePath();
                String outPath = out.getCanonicalPath();
                if (!outPath.startsWith(canonicalRoot)) {
                    throw new IOException("Небезопасный путь в архиве: " + entry.getName());
                }

                if (entry.isDirectory()) {
                    context.stage = "создание каталога";
                    if (!out.exists() && !out.mkdirs()) {
                        throw new IOException("Не удалось создать каталог: " + out.getAbsolutePath());
                    }
                    continue;
                }

                boolean existedBefore = out.isFile();
                if (fastUpdate && existedBefore && !shouldExtractForFastUpdate(out, entry)) {
                    context.stage = "пропуск актуального файла";
                    skippedFiles += 1;
                    context.skippedFiles = skippedFiles;
                    long now = System.currentTimeMillis();
                    if (now - lastUiUpdate > 500L) {
                        lastUiUpdate = now;
                        context.readBytes = Math.max(context.readBytes, safeChannelPosition(channel));
                        context.writtenBytes = extractedBytes;
                        updateProgress(buildProgressText(archiveName, archiveSize, context.readBytes, extractedBytes, extractedFiles, skippedFiles, entries, extractRoot, fastUpdate, progressStartedAt));
                    }
                    continue;
                }

                context.stage = "создание родительского каталога";
                File parent = out.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("Не удалось создать каталог: " + parent.getAbsolutePath());
                }

                context.stage = "запись файла";
                FileOutputStream output = new FileOutputStream(out);
                try {
                    if (entry.hasStream()) {
                        int read;
                        while ((read = sevenZ.read(buffer)) != -1) {
                            output.write(buffer, 0, read);
                            extractedBytes += read;
                            context.readBytes = Math.max(context.readBytes, safeChannelPosition(channel));
                            context.writtenBytes = extractedBytes;
                            long now = System.currentTimeMillis();
                            if (now - lastUiUpdate > 500L) {
                                lastUiUpdate = now;
                                updateProgress(buildProgressText(archiveName, archiveSize, context.readBytes, extractedBytes, extractedFiles, skippedFiles, entries, extractRoot, fastUpdate, progressStartedAt));
                            }
                        }
                    }
                } finally {
                    output.close();
                }

                if (entry.getHasLastModifiedDate() && entry.getLastModifiedDate() != null) {
                    context.stage = "обновление времени файла";
                    out.setLastModified(entry.getLastModifiedDate().getTime());
                }
                extractedFiles += 1;
                context.extractedFiles = extractedFiles;
            }
        } catch (ZipDiagnosticException e) {
            throw e;
        } catch (Exception e) {
            throw buildZipDiagnosticException(e, context);
        } finally {
            if (sevenZ != null) {
                try {
                    sevenZ.close();
                } catch (IOException ignored) {
                }
            }
        }

        updateProgress("Распаковка завершена. Проверяю index.html...");
        return new ZipStats(extractedBytes, extractedFiles, skippedFiles);
    }

    private boolean shouldExtractForFastUpdate(File out, ZipEntry entry) {
        long entryTime = entry.getTime();
        if (entryTime <= 0L) {
            return true;
        }
        return entryTime > out.lastModified();
    }

    private boolean shouldExtractForFastUpdate(File out, SevenZArchiveEntry entry) {
        if (!entry.getHasLastModifiedDate() || entry.getLastModifiedDate() == null) {
            return true;
        }
        return entry.getLastModifiedDate().getTime() > out.lastModified();
    }

    private Charset[] getZipNameCharsets() {
        return new Charset[] {
            StandardCharsets.UTF_8,
            charsetOrNull("IBM866"),
            charsetOrNull("windows-1251")
        };
    }

    private Charset charsetOrNull(String name) {
        try {
            return Charset.forName(name);
        } catch (Exception ignored) {
            return null;
        }
    }

    private long safeChannelPosition(FileChannel channel) {
        if (channel == null) {
            return -1L;
        }
        try {
            return channel.position();
        } catch (IOException ignored) {
            return -1L;
        }
    }

    private ZipDiagnosticException buildZipDiagnosticException(Exception error, ZipReadContext context) {
        return new ZipDiagnosticException(buildZipDiagnosticMessage(error, context), error);
    }

    private String buildZipDiagnosticMessage(Throwable error, ZipReadContext context) {
        Throwable root = getRootCause(error);
        StringBuilder details = new StringBuilder();
        details.append("Не удалось распаковать архив.\n\n");
        appendDiagnosticLine(details, "Этап", context.stage);
        appendDiagnosticLine(details, "Формат", context.archiveFormat);
        appendDiagnosticLine(details, "Кодировка имен", context.nameEncoding);
        appendDiagnosticLine(details, "Архив", context.archiveName);
        details.append("Режим: ").append(context.fastUpdate ? "быстрое обновление" : "обычное обновление").append('\n');
        if (context.archiveSize > 0L) {
            details.append("Размер архива: ").append(formatBytes(context.archiveSize)).append('\n');
        } else {
            details.append("Размер архива: неизвестно\n");
        }
        details.append("Прочитано архива: ").append(formatBytes(context.readBytes));
        if (context.archiveSize > 0L) {
            details.append(" / ").append(formatBytes(context.archiveSize));
        }
        details.append('\n');
        details.append("Записано данных: ").append(formatBytes(context.writtenBytes)).append('\n');
        details.append("Записей архива обработано: ").append(context.entries).append('\n');
        details.append("Файлов записано: ").append(context.extractedFiles).append('\n');
        details.append("Файлов пропущено: ").append(context.skippedFiles).append('\n');
        appendDiagnosticLine(details, "Каталог распаковки", context.targetPath);
        appendDiagnosticLine(details, "Последняя запись архива", context.currentEntryName);
        appendDiagnosticLine(details, "Путь назначения", context.currentOutputPath);
        details.append('\n');
        details.append("Ошибка: ").append(root.getClass().getName()).append('\n');
        appendDiagnosticLine(details, "Сообщение", root.getMessage());
        details.append('\n');
        appendTroubleshootingHints(details, root);
        return details.toString();
    }

    private String buildInstallErrorDetails(Throwable error, String archiveName, boolean fastUpdate, File base, File extractRoot, long startedAt) {
        String message = error.getMessage();
        if (message != null && message.length() > 0 && error instanceof ZipDiagnosticException) {
            return message + "\n\nВремя до ошибки: " + formatDuration(System.currentTimeMillis() - startedAt);
        }

        Throwable root = getRootCause(error);
        StringBuilder details = new StringBuilder();
        details.append("Операция не завершена.\n\n");
        appendDiagnosticLine(details, "Архив", archiveName);
        details.append("Режим: ").append(fastUpdate ? "быстрое обновление" : "обычное обновление").append('\n');
        if (base != null) {
            appendDiagnosticLine(details, "Базовый каталог", base.getAbsolutePath());
            details.append("Свободно: ").append(formatBytes(base.getUsableSpace())).append('\n');
        }
        if (extractRoot != null) {
            appendDiagnosticLine(details, "Каталог сайта", extractRoot.getAbsolutePath());
        }
        details.append("Время до ошибки: ").append(formatDuration(System.currentTimeMillis() - startedAt)).append('\n');
        details.append('\n');
        details.append("Ошибка: ").append(root.getClass().getName()).append('\n');
        appendDiagnosticLine(details, "Сообщение", root.getMessage());
        details.append('\n');
        appendTroubleshootingHints(details, root);
        return details.toString();
    }

    private String buildBriefErrorMessage(Throwable error) {
        Throwable root = getRootCause(error);
        String message = root.getMessage();
        if (message == null || message.length() == 0) {
            message = root.getClass().getName();
        }
        if (isMalformedZipNameError(root)) {
            return "Похоже, Android не смог прочитать имя файла или каталога внутри ZIP: " + message;
        }
        return message;
    }

    private void showErrorDialog(String title, String details) {
        ScrollView scrollView = new ScrollView(this);
        TextView textView = new TextView(this);
        textView.setText(details);
        textView.setTextSize(14);
        textView.setTextColor(Color.rgb(30, 34, 38));
        textView.setTextIsSelectable(true);
        textView.setPadding(dp(20), dp(16), dp(20), dp(16));
        scrollView.addView(textView);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(title)
            .setView(scrollView)
            .setPositiveButton("OK", null)
            .create();
        showHeldDialog(dialog);
    }

    private void appendTroubleshootingHints(StringBuilder details, Throwable error) {
        details.append("Что проверить:\n");
        if (isMalformedZipNameError(error)) {
            details.append("- Сообщение Malformed обычно означает проблему с кодировкой имени файла в ZIP, а не сам размер архива.\n");
            details.append("- Частая причина: кириллица или спецсимволы в именах файлов/каталогов, записанные старой Windows/DOS-кодировкой без UTF-8-флага.\n");
            details.append("- Переупакуйте архив в ZIP с UTF-8 именами, например через 7-Zip: 7z a -tzip -mx=0 -mcu=on site.zip site\n");
            details.append("- Для проверки можно временно переименовать проблемные файлы и каталоги латиницей, цифрами, дефисом или подчеркиванием.\n");
            return;
        }
        if (isZipFormatError(error)) {
            details.append("- Проверьте, что выбран именно ZIP/ZIP64 или 7z, а не .rar, SFX или многотомный архив.\n");
            details.append("- Попробуйте открыть архив в 7-Zip на компьютере и выполнить Test/Проверить.\n");
            details.append("- Если архив больше 2 ГБ, убедитесь, что это ZIP64 и файл был полностью скопирован на телефон.\n");
        }
        if (isNoSpaceError(error)) {
            details.append("- Похоже на нехватку свободного места или отказ записи. Освободите место и повторите полное обновление.\n");
        }
        if (isPathLengthError(error)) {
            details.append("- Похоже на слишком длинный путь или слишком длинное имя файла. Укоротите имена каталогов внутри сайта.\n");
        }
        details.append("- Проверьте имена внутри архива: не должно быть абсолютных путей, ../, C:/, пустых имен и управляющих символов.\n");
        details.append("- Если ошибка повторяется на одном архиве, создайте маленький тестовый архив с частью сайта и проверьте, на какой группе файлов появляется сбой.\n");
    }

    private boolean isMalformedZipNameError(Throwable error) {
        String message = error == null ? "" : String.valueOf(error.getMessage());
        String className = error == null ? "" : error.getClass().getName();
        return message.toLowerCase(Locale.US).contains("malformed")
            || className.toLowerCase(Locale.US).contains("malformed");
    }

    private boolean isZipFormatError(Throwable error) {
        String message = error == null ? "" : String.valueOf(error.getMessage()).toLowerCase(Locale.US);
        String className = error == null ? "" : error.getClass().getName().toLowerCase(Locale.US);
        return className.contains("zip")
            || message.contains("zip")
            || message.contains("not in gzip format")
            || message.contains("invalid entry")
            || message.contains("unexpected end")
            || message.contains("crc");
    }

    private boolean isNoSpaceError(Throwable error) {
        String message = error == null ? "" : String.valueOf(error.getMessage()).toLowerCase(Locale.US);
        return message.contains("no space")
            || message.contains("enospc")
            || message.contains("not enough space")
            || message.contains("недостаточно места");
    }

    private boolean isPathLengthError(Throwable error) {
        String message = error == null ? "" : String.valueOf(error.getMessage()).toLowerCase(Locale.US);
        return message.contains("file name too long")
            || message.contains("enametoolong")
            || message.contains("path too long");
    }

    private Throwable getRootCause(Throwable error) {
        Throwable current = error;
        while (current != null && current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current == null ? error : current;
    }

    private void appendDiagnosticLine(StringBuilder builder, String label, String value) {
        if (value == null || value.length() == 0) {
            return;
        }
        builder.append(label).append(": ").append(value).append('\n');
    }

    private String buildProgressText(String archiveName, long archiveSize, long readBytes, long extractedBytes, int files, int skippedFiles, int entries, File extractRoot, boolean fastUpdate, long progressStartedAt) {
        StringBuilder text = new StringBuilder();
        text.append("Режим: ").append(fastUpdate ? "быстрое обновление" : "обычное обновление").append('\n');
        text.append("Архив: ").append(archiveName).append('\n');
        if (archiveSize > 0L) {
            text.append("Прочитано архива: ").append(formatBytes(readBytes)).append(" / ").append(formatBytes(archiveSize)).append('\n');
        } else {
            text.append("Прочитано архива: ").append(formatBytes(readBytes)).append('\n');
        }
        text.append("Записано: ").append(formatBytes(extractedBytes)).append('\n');
        appendProgressEstimate(text, archiveSize, readBytes, extractedBytes, progressStartedAt);
        text.append("Изменено файлов: ").append(files).append(", пропущено: ").append(skippedFiles).append('\n');
        text.append("Записей архива: ").append(entries).append('\n');
        text.append("Свободно: ").append(formatBytes(extractRoot.getUsableSpace()));
        return text.toString();
    }

    private void appendProgressEstimate(StringBuilder text, long archiveSize, long readBytes, long extractedBytes, long progressStartedAt) {
        long elapsedMs = Math.max(0L, System.currentTimeMillis() - progressStartedAt);
        if (elapsedMs < 500L || extractedBytes <= 0L) {
            text.append("Скорость: вычисляется\n");
        } else {
            long bytesPerSecond = Math.max(1L, (long) (extractedBytes * 1000.0 / elapsedMs));
            text.append("Скорость: ").append(formatBytes(bytesPerSecond)).append("/с\n");
        }

        if (archiveSize <= 0L || readBytes <= 0L || elapsedMs < 500L) {
            text.append("Осталось примерно: вычисляется\n");
            return;
        }

        long boundedRead = Math.min(archiveSize, readBytes);
        double remainingMs = elapsedMs * (archiveSize - boundedRead) / (double) boundedRead;
        long safeRemainingMs = remainingMs >= Long.MAX_VALUE ? Long.MAX_VALUE : Math.max(0L, (long) Math.ceil(remainingMs));
        text.append("Осталось примерно: ").append(formatDuration(safeRemainingMs)).append('\n');
    }

    private String normalizeZipEntryName(String name) throws IOException {
        if (name == null) {
            return null;
        }

        String normalized = name.replace('\\', '/').trim();
        while (normalized.startsWith("./")) {
            normalized = normalized.substring(2);
        }

        if (normalized.length() == 0) {
            return null;
        }

        if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.contains("/../") || normalized.endsWith("/..")) {
            throw new IOException("Небезопасный путь в архиве: " + name);
        }

        if (normalized.length() >= 2 && normalized.charAt(1) == ':') {
            throw new IOException("Небезопасный путь в архиве: " + name);
        }

        for (int i = 0; i < normalized.length(); i++) {
            char value = normalized.charAt(i);
            if (value == 0 || (value < 32 && value != '\t')) {
                throw new IOException("Недопустимый управляющий символ в пути ZIP: " + name);
            }
        }

        if (normalized.equals("__MACOSX") || normalized.startsWith("__MACOSX/") || normalized.endsWith("/.DS_Store")) {
            return null;
        }

        return normalized;
    }

    private File findIndexInExtractedContent(File extractRoot) {
        if (extractRoot == null || !extractRoot.isDirectory()) {
            return null;
        }

        File direct = findIndexFile(extractRoot);
        if (direct != null) {
            return direct;
        }

        File siteDir = findChildDirectoryIgnoreCase(extractRoot, "site");
        if (siteDir != null) {
            File siteIndex = findIndexFile(siteDir);
            if (siteIndex != null) {
                return siteIndex;
            }
        }

        File[] children = extractRoot.listFiles();
        if (children == null) {
            return null;
        }

        List<File> topDirs = new ArrayList<File>();
        List<File> indexCandidates = new ArrayList<File>();
        for (File child : children) {
            if (child.isDirectory() && !isIgnoredTopDirectory(child)) {
                topDirs.add(child);
                File childIndex = findIndexFile(child);
                if (childIndex != null) {
                    indexCandidates.add(childIndex);
                }
            }
        }

        if (indexCandidates.size() == 1) {
            return indexCandidates.get(0);
        }

        if (topDirs.size() == 1) {
            return findIndexFile(topDirs.get(0));
        }

        return null;
    }

    private File findIndexFile(File dir) {
        if (dir == null || !dir.isDirectory()) {
            return null;
        }

        File[] files = dir.listFiles();
        if (files == null) {
            return null;
        }

        File fallback = null;
        for (File file : files) {
            if (!file.isFile()) {
                continue;
            }

            String name = file.getName();
            if ("index.html".equals(name)) {
                return file;
            }
            if ("index.htm".equals(name)) {
                fallback = file;
            } else if (("index.html".equalsIgnoreCase(name) || "index.htm".equalsIgnoreCase(name)) && fallback == null) {
                fallback = file;
            }
        }

        return fallback;
    }

    private File findChildDirectoryIgnoreCase(File parent, String name) {
        File[] children = parent.listFiles();
        if (children == null) {
            return null;
        }

        for (File child : children) {
            if (child.isDirectory() && child.getName().equalsIgnoreCase(name)) {
                return child;
            }
        }

        return null;
    }

    private boolean isIgnoredTopDirectory(File dir) {
        String name = dir.getName();
        return "__MACOSX".equals(name) || name.startsWith(".");
    }

    private File chooseStorageBaseForInstall() {
        SharedPreferences prefs = getPrefs();
        String savedBase = prefs.getString(PREF_BASE_PATH, "");
        if (savedBase != null && savedBase.length() > 0) {
            File base = new File(savedBase);
            File parent = base.getParentFile();
            if ((base.exists() || (parent != null && parent.canWrite())) && isAppStorageBase(base)) {
                return base;
            }
        }

        File best = null;
        long bestUsable = -1L;
        for (File base : getCandidateStorageBases()) {
            File parent = base.getParentFile();
            if (parent == null) {
                continue;
            }
            if (!parent.exists()) {
                parent.mkdirs();
            }

            long usable = parent.getUsableSpace();
            if (usable > bestUsable) {
                bestUsable = usable;
                best = base;
            }
        }

        if (best != null) {
            return best;
        }

        return new File(getFilesDir(), STORAGE_DIR_NAME);
    }

    private List<File> getCandidateStorageBases() {
        List<File> result = new ArrayList<File>();
        Set<String> seen = new HashSet<String>();

        SharedPreferences prefs = getPrefs();
        String savedBase = prefs.getString(PREF_BASE_PATH, "");
        if (savedBase != null && savedBase.length() > 0) {
            addUniqueBase(result, seen, new File(savedBase));
        }

        File[] externalDirs = getExternalFilesDirs(null);
        if (externalDirs != null) {
            for (File dir : externalDirs) {
                if (dir != null) {
                    addUniqueBase(result, seen, new File(dir, STORAGE_DIR_NAME));
                }
            }
        }

        addUniqueBase(result, seen, new File(getFilesDir(), STORAGE_DIR_NAME));
        return result;
    }

    private void addUniqueBase(List<File> result, Set<String> seen, File base) {
        try {
            String path = base.getCanonicalPath();
            if (!seen.contains(path)) {
                seen.add(path);
                result.add(base);
            }
        } catch (IOException ignored) {
        }
    }

    private boolean isAppStorageBase(File base) {
        try {
            String path = base.getCanonicalPath();
            for (File candidate : getCandidateStorageBases()) {
                if (path.equals(candidate.getCanonicalPath())) {
                    return true;
                }
            }
        } catch (IOException ignored) {
        }
        return false;
    }

    private DeleteStats clearExtractedSite(File extractRoot) throws IOException {
        return clearExtractedSite(extractRoot, null);
    }

    private DeleteStats clearExtractedSite(File extractRoot, String progressTitle) throws IOException {
        DeleteStats stats = new DeleteStats();
        if (extractRoot == null || !extractRoot.exists()) {
            if (progressTitle != null) {
                updateProgress(progressTitle + "\nПредыдущих файлов нет.");
            }
            return stats;
        }

        File canonical = extractRoot.getCanonicalFile();
        if (!canonical.getName().equals(EXTRACT_DIR_NAME)) {
            throw new IOException("Отказ удалять неожиданный каталог: " + canonical.getAbsolutePath());
        }

        if (progressTitle != null) {
            updateProgress(progressTitle + "\nКаталог: " + canonical.getAbsolutePath());
        }
        deleteTree(canonical, stats, progressTitle);
        if (progressTitle != null) {
            updateProgress(progressTitle + "\nУдалено файлов: " + stats.files + ", каталогов: " + stats.directories + "\nОсвобождено: " + formatBytes(stats.bytes));
        }
        return stats;
    }

    private void deleteTree(File file, DeleteStats stats, String progressTitle) throws IOException {
        if (file == null || !file.exists()) {
            return;
        }

        boolean directory = file.isDirectory();
        boolean regularFile = file.isFile();

        if (directory) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteTree(child, stats, progressTitle);
                }
            }
        }

        long bytes = regularFile ? file.length() : 0L;
        if (!file.delete() && file.exists()) {
            throw new IOException("Не удалось удалить: " + file.getAbsolutePath());
        }

        if (directory) {
            stats.directories += 1L;
        } else if (regularFile) {
            stats.files += 1L;
            stats.bytes += bytes;
        }
        reportDeleteProgress(stats, progressTitle, file);
    }

    private void reportDeleteProgress(DeleteStats stats, String progressTitle, File current) {
        if (progressTitle == null) {
            return;
        }

        long now = System.currentTimeMillis();
        if (now - stats.lastUiUpdateMillis < PREPARE_PROGRESS_UPDATE_MS) {
            return;
        }

        stats.lastUiUpdateMillis = now;
        String path = current == null ? "" : current.getAbsolutePath();
        updateProgress(progressTitle
            + "\nУдалено файлов: " + stats.files + ", каталогов: " + stats.directories
            + "\nОсвобождено: " + formatBytes(stats.bytes)
            + "\nСейчас: " + path);
    }

    private SiteStats summarizeInstalledSite(File root) throws IOException {
        if (root == null || !root.isDirectory()) {
            throw new IOException("Не найден каталог установленного сайта.");
        }

        SiteStats stats = new SiteStats();
        summarizeInstalledPath(root, stats);
        return stats;
    }

    private void summarizeInstalledPath(File file, SiteStats stats) throws IOException {
        if (file.isFile()) {
            long size = file.length();
            if (Long.MAX_VALUE - stats.bytes < size) {
                throw new IOException("Размер установленного сайта превышает допустимый предел.");
            }
            if (stats.files == Integer.MAX_VALUE) {
                throw new IOException("Количество файлов установленного сайта превышает допустимый предел.");
            }
            stats.bytes += size;
            stats.files += 1;
            return;
        }

        if (!file.isDirectory()) {
            return;
        }

        File[] children = file.listFiles();
        if (children == null) {
            throw new IOException("Не удалось прочитать каталог: " + file.getAbsolutePath());
        }
        for (File child : children) {
            summarizeInstalledPath(child, stats);
        }
    }

    private void reloadSite() {
        File index = findInstalledIndex();
        if (index != null) {
            resetIndexStateSession();
            loadSite(index);
        } else {
            loadInstalledSiteOrPrompt();
        }
    }

    private void confirmClearSite() {
        if (busy) {
            return;
        }

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Очистить сайт?")
            .setMessage("Распакованные файлы будут удалены из каталога приложения. APK останется установленным.")
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Очистить", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    clearInstalledSite();
                }
            })
            .create();
        showHeldDialog(dialog);
    }

    private void clearInstalledSite() {
        busy = true;
        showProgress("Очистка сайта", "Удаляю распакованные файлы...");

        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    SharedPreferences prefs = getPrefs();
                    String basePath = prefs.getString(PREF_BASE_PATH, "");
                    if (basePath != null && basePath.length() > 0) {
                        clearExtractedSite(new File(new File(basePath), EXTRACT_DIR_NAME), "Очищаю установленный сайт");
                    } else {
                        for (File base : getCandidateStorageBases()) {
                            clearExtractedSite(new File(base, EXTRACT_DIR_NAME), "Очищаю установленный сайт");
                        }
                    }

                    prefs.edit().clear().apply();
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            clearWebViewPages();
                            Toast.makeText(MainActivity.this, "Сайт очищен.", Toast.LENGTH_LONG).show();
                            loadInstalledSiteOrPrompt();
                        }
                    });
                } catch (final Exception e) {
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this, "Ошибка очистки: " + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                } finally {
                    finishBusy();
                }
            }
        }, "site-clear");

        worker.start();
    }

    private void saveInstalledSite(File base, File index, String archiveName, long installedAt, long extractedBytes, int extractedFiles) {
        saveInstalledSite(base, index, archiveName, installedAt, extractedBytes, extractedFiles, 0, "", 0L, 0L, 0L, 0L, 0);
    }

    private void saveInstalledSite(File base, File index, String archiveName, long installedAt, long extractedBytes, int extractedFiles, int skippedFiles, String updateMode, long updateDurationMs, long deleteDurationMs, long extractDurationMs, long operationWrittenBytes, int operationWrittenFiles) {
        File contentRoot = index.getParentFile();
        SharedPreferences.Editor editor = getPrefs().edit()
            .putString(PREF_BASE_PATH, base.getAbsolutePath())
            .putString(PREF_INDEX_PATH, index.getAbsolutePath())
            .putString(PREF_CONTENT_ROOT_PATH, contentRoot == null ? "" : contentRoot.getAbsolutePath())
            .putString(PREF_ARCHIVE_NAME, archiveName == null ? "" : archiveName)
            .putLong(PREF_INSTALLED_AT, installedAt)
            .putLong(PREF_EXTRACTED_BYTES, extractedBytes)
            .putInt(PREF_EXTRACTED_FILES, extractedFiles)
            .putInt(PREF_SKIPPED_FILES, skippedFiles)
            .putLong(PREF_LAST_OPERATION_WRITTEN_BYTES, operationWrittenBytes)
            .putInt(PREF_LAST_OPERATION_WRITTEN_FILES, operationWrittenFiles);

        if (updateMode != null && updateMode.length() > 0) {
            editor
                .putString(PREF_LAST_UPDATE_MODE, updateMode)
                .putLong(PREF_LAST_UPDATE_DURATION_MS, updateDurationMs)
                .putLong(PREF_LAST_DELETE_DURATION_MS, deleteDurationMs)
                .putLong(PREF_LAST_EXTRACT_DURATION_MS, extractDurationMs);
        }

        editor.apply();
    }

    private void showInfoDialog() {
        SharedPreferences prefs = getPrefs();
        StringBuilder info = new StringBuilder();
        info.append("Package: ru.local.gamespace.loader\n\n");
        info.append("Версия приложения: ").append(getAppVersionName()).append('\n');
        info.append("Дата сборки: ").append(getString(R.string.app_build_date)).append('\n');
        info.append("Минимальная версия Android: ").append(getString(R.string.app_min_android)).append("\n\n");

        File base = chooseStorageBaseForInstall();
        info.append("Каталог данных:\n").append(base.getAbsolutePath()).append('\n');
        info.append("Свободно: ").append(formatBytes(base.getUsableSpace())).append("\n\n");

        String indexPath = prefs.getString(PREF_INDEX_PATH, "");
        if (indexPath != null && indexPath.length() > 0 && new File(indexPath).isFile()) {
            info.append("Index:\n").append(indexPath).append("\n\n");
            String archiveName = prefs.getString(PREF_ARCHIVE_NAME, "");
            if (archiveName != null && archiveName.length() > 0) {
                info.append("Архив: ").append(archiveName).append('\n');
            }
            long bytes = prefs.getLong(PREF_EXTRACTED_BYTES, 0L);
            int files = prefs.getInt(PREF_EXTRACTED_FILES, 0);
            int skippedFiles = prefs.getInt(PREF_SKIPPED_FILES, 0);
            long operationWrittenBytes = prefs.getLong(PREF_LAST_OPERATION_WRITTEN_BYTES, 0L);
            int operationWrittenFiles = prefs.getInt(PREF_LAST_OPERATION_WRITTEN_FILES, 0);
            String updateMode = prefs.getString(PREF_LAST_UPDATE_MODE, "");
            long totalDuration = prefs.getLong(PREF_LAST_UPDATE_DURATION_MS, -1L);
            long deleteDuration = prefs.getLong(PREF_LAST_DELETE_DURATION_MS, -1L);
            long extractDuration = prefs.getLong(PREF_LAST_EXTRACT_DURATION_MS, -1L);
            long installedAt = prefs.getLong(PREF_INSTALLED_AT, 0L);
            info.append("Размер установленного сайта: ").append(formatBytes(bytes)).append('\n');
            info.append("Файлов установлено: ").append(files).append('\n');
            if (updateMode != null && updateMode.length() > 0) {
                info.append("\nПоследнее обновление:\n");
                if (installedAt > 0L) {
                    info.append("Дата: ").append(formatTimestamp(installedAt)).append('\n');
                }
                info.append("Режим: ").append(formatUpdateMode(updateMode)).append('\n');
                info.append("Всего: ").append(formatDuration(totalDuration)).append('\n');
                info.append("Удаление: ").append(formatDuration(deleteDuration)).append('\n');
                info.append("Распаковка: ").append(formatDuration(extractDuration)).append('\n');
                if ("fast".equals(updateMode)) {
                    info.append("Записано в операции: ").append(formatBytes(operationWrittenBytes)).append('\n');
                    info.append("Новых/обновленных загружено: ").append(operationWrittenFiles).append('\n');
                    info.append("Пропущено файлов: ").append(skippedFiles).append('\n');
                } else if (skippedFiles > 0) {
                    info.append("Пропущено файлов: ").append(skippedFiles).append('\n');
                }
            } else if (skippedFiles > 0) {
                info.append("Пропущено файлов: ").append(skippedFiles).append('\n');
            }
        } else {
            info.append("Сайт пока не установлен.\n");
        }

        info.append("\nИнтернет-разрешение в APK не используется.");

        ScrollView scrollView = new ScrollView(this);
        TextView textView = new TextView(this);
        textView.setText(info.toString());
        textView.setTextSize(14);
        textView.setTextColor(Color.rgb(30, 34, 38));
        textView.setPadding(dp(20), dp(16), dp(20), dp(16));
        scrollView.addView(textView);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Информация")
            .setView(scrollView)
            .setPositiveButton("OK", null)
            .create();
        showHeldDialog(dialog);
    }

    private void showLicensesDialog() {
        final String[] titles = new String[] {
            "MIT License",
            "Фирменные материалы GameSpace",
            "Встроенные демонстрационные материалы",
            "Уведомления о сторонних компонентах",
            "Полные тексты сторонних лицензий"
        };
        final String[] assetPaths = new String[] {
            "licenses/LICENSE.txt",
            "licenses/BRAND_ASSETS_LICENSE.md",
            "licenses/DEMO_CONTENT_LICENSE.md",
            "licenses/THIRD_PARTY_NOTICES.md",
            ""
        };

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Лицензии")
            .setItems(titles, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    if (which == titles.length - 1) {
                        showThirdPartyLicenseList();
                    } else {
                        showLicenseDocument(titles[which], assetPaths[which]);
                    }
                }
            })
            .setNegativeButton("Закрыть", null)
            .create();
        showHeldDialog(dialog);
    }

    private void showThirdPartyLicenseList() {
        final String[] titles = new String[] {
            "7-Zip / un7z-opfs",
            "Apache License 2.0",
            "Commons Codec NOTICE",
            "Commons Compress NOTICE",
            "Commons IO NOTICE",
            "Commons Lang NOTICE",
            "Emscripten",
            "GNU LGPL 2.1",
            "Roboto SIL OFL 1.1",
            "XZ for Java 0BSD",
            "zip.js BSD 3-Clause"
        };
        final String[] assetPaths = new String[] {
            "licenses/third_party/7ZIP-UN7Z-LICENSE.txt",
            "licenses/third_party/APACHE-2.0.txt",
            "licenses/third_party/COMMONS-CODEC-NOTICE.txt",
            "licenses/third_party/COMMONS-COMPRESS-NOTICE.txt",
            "licenses/third_party/COMMONS-IO-NOTICE.txt",
            "licenses/third_party/COMMONS-LANG3-NOTICE.txt",
            "licenses/third_party/EMSCRIPTEN-LICENSE.md",
            "licenses/third_party/LGPL-2.1.txt",
            "licenses/third_party/ROBOTO-OFL-1.1.txt",
            "licenses/third_party/XZ-FOR-JAVA-1.12.txt",
            "licenses/third_party/ZIP-JS-BSD-3-CLAUSE.txt"
        };

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Сторонние лицензии")
            .setItems(titles, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    showLicenseDocument(titles[which], assetPaths[which]);
                }
            })
            .setNegativeButton("Закрыть", null)
            .create();
        showHeldDialog(dialog);
    }

    private void showLicenseDocument(String title, String assetPath) {
        final String content;
        try {
            content = readAssetText(assetPath);
        } catch (IOException error) {
            Toast.makeText(this, "Не удалось открыть лицензию: " + error.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }

        ScrollView scrollView = new ScrollView(this);
        TextView textView = new TextView(this);
        textView.setText(content);
        textView.setTextSize(13);
        textView.setTextColor(Color.rgb(30, 34, 38));
        textView.setTypeface(Typeface.MONOSPACE);
        textView.setTextIsSelectable(true);
        textView.setPadding(dp(20), dp(16), dp(20), dp(16));
        scrollView.addView(textView);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(title)
            .setView(scrollView)
            .setPositiveButton("Закрыть", null)
            .create();
        showHeldDialog(dialog);
    }

    private String readAssetText(String assetPath) throws IOException {
        InputStream input = getAssets().open(assetPath);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        } finally {
            input.close();
        }
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String getAppVersionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (info.versionName != null && info.versionName.length() > 0) {
                return info.versionName;
            }
        } catch (Exception ignored) {
        }
        return getString(R.string.app_version_name);
    }

    private String getDisplayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && name.length() > 0) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        String value = uri.getLastPathSegment();
        return value == null || value.length() == 0 ? "site.zip" : value;
    }

    private long getContentSize(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0) {
                    return cursor.getLong(index);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return -1L;
    }

    private String formatBytes(long bytes) {
        if (bytes < 0L) {
            return "неизвестно";
        }

        double value = bytes;
        String[] units = new String[] {"Б", "КБ", "МБ", "ГБ", "ТБ"};
        int unit = 0;
        while (value >= 1024.0 && unit < units.length - 1) {
            value /= 1024.0;
            unit += 1;
        }

        int digits = unit == 0 || value >= 100.0 ? 0 : value >= 10.0 ? 1 : 2;
        String pattern = digits == 0 ? "0" : digits == 1 ? "0.0" : "0.00";
        DecimalFormatSymbols symbols = DecimalFormatSymbols.getInstance(new Locale("ru", "RU"));
        DecimalFormat format = new DecimalFormat(pattern, symbols);
        format.setGroupingUsed(false);
        return format.format(value) + " " + units[unit];
    }

    private String formatDuration(long millis) {
        if (millis < 0L) {
            return "неизвестно";
        }
        if (millis < 1000L) {
            return millis + " мс";
        }

        long totalSeconds = millis / 1000L;
        long hours = totalSeconds / 3600L;
        long minutes = (totalSeconds % 3600L) / 60L;
        long seconds = totalSeconds % 60L;

        StringBuilder result = new StringBuilder();
        if (hours > 0L) {
            result.append(hours).append(" ч ");
        }
        if (minutes > 0L || hours > 0L) {
            result.append(minutes).append(" мин ");
        }
        result.append(seconds).append(" сек");
        return result.toString();
    }

    private String formatUpdateMode(String mode) {
        if ("fast".equals(mode)) {
            return "быстрое";
        }
        if ("full".equals(mode)) {
            return "обычное";
        }
        if ("demo".equals(mode)) {
            return "встроенное демо";
        }
        return mode == null || mode.length() == 0 ? "неизвестно" : mode;
    }

    private String formatTimestamp(long timestamp) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date(timestamp));
    }

    private String withTrailingSeparator(String path) {
        if (path.endsWith(File.separator)) {
            return path;
        }
        return path + File.separator;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    public void onBackPressed() {
        if (progressPanel.getVisibility() == View.VISIBLE) {
            Toast.makeText(this, "Дождитесь завершения операции.", Toast.LENGTH_SHORT).show();
            return;
        }

        if (contentLoadPending) {
            showHomeWebView();
            return;
        }

        if (webView != null && webView.getVisibility() == View.VISIBLE) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                showHomeWebView();
            }
            return;
        }

        if (homeWebView != null && homeWebView.getVisibility() == View.VISIBLE && homeWebView.canGoBack()) {
            homeWebView.goBack();
            return;
        }

        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacks(topBarCountdownRunnable);
        cancelPendingContentLoadState();
        if (homeWebView != null) {
            homeWebView.destroy();
            homeWebView = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void openContentUrl(String url) {
        if (url == null || busy) {
            return;
        }

        emptyPanel.setVisibility(View.GONE);
        progressPanel.setVisibility(View.GONE);
        webView.stopLoading();
        webView.clearHistory();
        clearContentHistoryAfterLoad = true;
        beginPendingContentLoad(url);
        webView.loadUrl(url);
    }

    private boolean openExternalUrl(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            return true;
        }
        return true;
    }

    private boolean isFileUrl(String url) {
        return url != null && url.startsWith("file:");
    }

    private boolean isInternalLocalUrl(String url) {
        return url != null
            && (url.startsWith("file:")
                || url.startsWith("about:")
                || url.startsWith("javascript:"));
    }

    private boolean isCurrentIndexUrl(String url) {
        if (url == null || currentIndexFile == null || !isFileUrl(url)) {
            return false;
        }

        try {
            Uri uri = Uri.parse(url);
            String path = uri.getPath();
            if (path == null || path.length() == 0) {
                return false;
            }
            return isSameFile(new File(path), currentIndexFile);
        } catch (Exception e) {
            return false;
        }
    }

    private class HomeSiteClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleHomeUrl(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && request != null && request.getUrl() != null) {
                if (!request.isForMainFrame()) {
                    return false;
                }
                return handleHomeUrl(request.getUrl().toString());
            }
            return false;
        }

        private boolean handleHomeUrl(String url) {
            if (url == null) {
                return false;
            }

            if (url.startsWith("about:") || url.startsWith("javascript:")) {
                return false;
            }

            if (isFileUrl(url)) {
                if (isCurrentIndexUrl(url)) {
                    return false;
                }
                openContentUrl(url);
                return true;
            }

            return openExternalUrl(url);
        }
    }

    private class ContentSiteClient extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (contentLoadPending && url != null && !url.startsWith("about:")) {
                contentLoadRequestId += 1L;
                contentVisualCallbackPending = false;
                pendingContentUrl = url;
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            boolean currentPendingPage = contentLoadPending && isCurrentContentPage(view, url);
            if (clearContentHistoryAfterLoad && (!contentLoadPending || currentPendingPage)) {
                clearContentHistoryAfterLoad = false;
                view.clearHistory();
            }
            if (currentPendingPage) {
                requestContentVisualState(view, url);
            }
        }

        @Override
        public void onReceivedError(
            WebView view,
            WebResourceRequest request,
            WebResourceError error
        ) {
            if (view != webView
                || request == null
                || !request.isForMainFrame()
                || !contentLoadPending) {
                return;
            }
            CharSequence description = error == null ? null : error.getDescription();
            handleContentLoadError(description == null ? "" : description.toString());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleContentUrl(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && request != null && request.getUrl() != null) {
                if (!request.isForMainFrame()) {
                    return false;
                }
                return handleContentUrl(request.getUrl().toString());
            }
            return false;
        }

        private boolean handleContentUrl(String url) {
            if (url == null) {
                return false;
            }

            if (isCurrentIndexUrl(url)) {
                showHomeWebView();
                return true;
            }

            if (isInternalLocalUrl(url)) {
                return false;
            }

            return openExternalUrl(url);
        }
    }

    private static class ZipStats {
        final long bytes;
        final int files;
        final int skippedFiles;

        ZipStats(long bytes, int files, int skippedFiles) {
            this.bytes = bytes;
            this.files = files;
            this.skippedFiles = skippedFiles;
        }
    }

    private static class ZipReadContext {
        String archiveName;
        String archiveFormat;
        String nameEncoding;
        String stage;
        String targetPath;
        String currentEntryName;
        String currentOutputPath;
        boolean fastUpdate;
        long archiveSize = -1L;
        long readBytes;
        long writtenBytes;
        int entries;
        int extractedFiles;
        int skippedFiles;
    }

    private static class ZipDiagnosticException extends IOException {
        ZipDiagnosticException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private static class DeleteStats {
        long files;
        long directories;
        long bytes;
        long lastUiUpdateMillis;
    }

    private static class SiteStats {
        long bytes;
        int files;
    }

    private static class CountingInputStream extends FilterInputStream {
        private long bytesRead;

        CountingInputStream(InputStream input) {
            super(input);
        }

        @Override
        public int read() throws IOException {
            int value = super.read();
            if (value != -1) {
                bytesRead += 1L;
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = super.read(buffer, offset, length);
            if (count > 0) {
                bytesRead += count;
            }
            return count;
        }

        long getBytesRead() {
            return bytesRead;
        }
    }
}
