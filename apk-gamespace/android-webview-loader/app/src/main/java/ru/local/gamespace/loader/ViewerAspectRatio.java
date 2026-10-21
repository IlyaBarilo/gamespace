package ru.local.gamespace.loader;

/** Shared menu values and bounded content width; auto fills the available screen. */
final class ViewerAspectRatio {
    static final String[] VALUES = {"auto", "9:16", "10:16", "16:9", "16:10"};
    static final String[] LABELS = {"Авто (во весь экран)", "9:16", "10:16", "16:9", "16:10"};
    static int index(String value) {
        for (int i = 0; i < VALUES.length; i++) if (VALUES[i].equals(value)) return i;
        return 0;
    }
    static String normalize(String value) { return VALUES[index(value)]; }
    static int contentWidth(int width, int height, String value) {
        int available = Math.max(0, width);
        int selected = index(value);
        if (selected == 0) return available;
        int[] widths = {0, 9, 10, 16, 16};
        int[] heights = {1, 16, 16, 9, 10};
        return (int) Math.min(available, Math.round(Math.max(0, height) * (double) widths[selected] / heights[selected]));
    }
    static int contentWidth(int width, int height, String value, String display) {
        int base = contentWidth(width, height, value);
        return "portrait".equals(display) ? Math.min(base, contentWidth(width, height, "10:16")) : base;
    }
    static String displayFromUrl(String value) {
        try {
            java.net.URI uri = new java.net.URI(value);
            String query = uri.getRawQuery();
            if (query != null) for (String part : query.split("&")) {
                String[] pair = part.split("=", 2);
                if ("gamespaceDisplay".equals(java.net.URLDecoder.decode(pair[0], "UTF-8"))) {
                    return pair.length == 2 && "portrait".equals(java.net.URLDecoder.decode(pair[1], "UTF-8"))
                        ? "portrait" : "auto";
                }
            }
        } catch (Exception ignored) {}
        return "auto";
    }
    private ViewerAspectRatio() {}
}
