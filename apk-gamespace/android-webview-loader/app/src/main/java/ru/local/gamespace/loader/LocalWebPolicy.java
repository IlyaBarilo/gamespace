package ru.local.gamespace.loader;

import java.net.URI;

/** Shared local-origin policy for both WebViews; update URLs are never local content. */
final class LocalWebPolicy {
    static final String ORIGIN = "https://content.gamespace.local";
    static final String CSP = "default-src 'self' data: blob:; "
        + "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; "
        + "style-src 'self' 'unsafe-inline' data: blob:; "
        + "connect-src https://content.gamespace.local data: blob:; "
        + "object-src 'none'; base-uri 'self'; form-action 'none'; "
        + "worker-src 'self' blob:; frame-src 'self' data: blob:;";

    static boolean isInternalUrl(String value) {
        if (value == null) return false;
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "content.gamespace.local".equalsIgnoreCase(uri.getHost())
                && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) { return false; }
    }

    static boolean isInMemoryUrl(String value) {
        if (value == null) return false;
        return value.startsWith("about:") || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("javascript:");
    }
}
