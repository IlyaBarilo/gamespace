package ru.local.gamespace.loader;

/** Allowlisted values are safe to pass to the rendering probe; no game storage is used. */
final class CanvasFpsPosition {
    static final String[] VALUES = {"toolbar", "top-left", "top-right", "bottom-left", "bottom-right", "middle-left"};
    static final String[] LABELS = {"В панели управления", "Слева сверху", "Справа сверху", "Слева снизу", "Справа снизу", "Слева по центру"};
    static int index(String value) {
        for (int i = 0; i < VALUES.length; i++) if (VALUES[i].equals(value)) return i;
        return 0;
    }
    static String normalize(String value) { return VALUES[index(value)]; }
    private CanvasFpsPosition() {}
}
