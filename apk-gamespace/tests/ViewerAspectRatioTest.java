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
        System.out.println("Viewer aspect ratio tests passed.");
    }
    private static void check(boolean value) {
        if (!value) throw new AssertionError("Unexpected aspect ratio or viewport width");
    }
}
