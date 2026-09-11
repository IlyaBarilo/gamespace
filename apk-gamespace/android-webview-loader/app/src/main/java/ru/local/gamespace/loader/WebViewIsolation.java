package ru.local.gamespace.loader;

import android.os.Build;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ServiceWorkerWebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;

final class WebViewIsolation {
    static void configure(WebSettings settings) {
        // INTERNET changes the platform default to false; retain the former offline policy.
        settings.setBlockNetworkLoads(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setGeolocationEnabled(false);
        if (Build.VERSION.SDK_INT >= 24) Api24.blockServiceWorkerRequests();
    }

    private static final class Api24 {
        static void blockServiceWorkerRequests() {
            ServiceWorkerController controller = ServiceWorkerController.getInstance();
            ServiceWorkerWebSettings settings = controller.getServiceWorkerWebSettings();
            settings.setBlockNetworkLoads(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            // Process-scoped, no Activity reference or updater access. APK games
            // use the local request handler; their Service Workers do not fetch files.
            controller.setServiceWorkerClient(new ServiceWorkerClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return LocalSiteRequestHandler.blocked();
                }
            });
        }
    }
}
