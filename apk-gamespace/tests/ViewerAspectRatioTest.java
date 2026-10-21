package ru.local.gamespace.loader;

public final class ViewerAspectRatioTest {
    public static void main(String[] args) {
        String[] values = {"auto", "9:16", "10:16", "16:9", "16:10"};
        int[] widths = {1920, 608, 675, 1920, 1728};
        for (int i = 0; i < values.length; i++) {
            check(ViewerAspectRatio.contentWidth(1920, 1080, values[i]) == widths[i]);
            check(ViewerAspectRatio.contentWidth(390, 844, values[i]) == 390);
            check(ViewerAspectRatio.normalize(values[i]).equals(values[i]));
        }
        check(ViewerAspectRatio.contentWidth(900, 1200, "9:16") == 675);
        check(ViewerAspectRatio.contentWidth(1920, 1080, null) == 1920);
        check(ViewerAspectRatio.contentWidth(1920, 1080, "invalid") == 1920);
        check(ViewerAspectRatio.normalize(null).equals("auto"));
        check(ViewerAspectRatio.contentWidth(1920, 1080, "auto", "portrait") == 675);
        check(ViewerAspectRatio.contentWidth(1920, 1080, "16:9", "portrait") == 675);
        check(ViewerAspectRatio.contentWidth(1920, 1080, "9:16", "portrait") == 608);
        check(ViewerAspectRatio.contentWidth(390, 844, "auto", "portrait") == 390);
        check(ViewerAspectRatio.contentWidth(1920, 1080, "16:10", "auto") == 1728);
        check(ViewerAspectRatio.displayFromUrl("https://content.gamespace.local/game.html?diff=2&gamespaceDisplay=portrait").equals("portrait"));
        check(ViewerAspectRatio.displayFromUrl("https://content.gamespace.local/game.html?gamespaceDisplay=auto").equals("auto"));
        check(ViewerAspectRatio.displayFromUrl("https://content.gamespace.local/game.html?gamespaceDisplay=unknown").equals("auto"));
        check(ViewerAspectRatio.displayFromUrl("https://content.gamespace.local/game.html").equals("auto"));
        System.out.println("Viewer aspect ratio tests passed.");
    }
    private static void check(boolean value) {
        if (!value) throw new AssertionError("Unexpected aspect ratio or viewport width");
    }
}
