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
    private ViewerAspectRatio() {}
}
