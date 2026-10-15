package ru.local.gamespace.loader;

public final class CanvasFpsPositionTest {
    public static void main(String[] args) {
        for (int i = 0; i < CanvasFpsPosition.VALUES.length; i++) {
            String value = CanvasFpsPosition.VALUES[i];
            if (!value.equals(CanvasFpsPosition.normalize(value)) || CanvasFpsPosition.index(value) != i
                || CanvasFpsPosition.LABELS[i].isEmpty()) throw new AssertionError(value);
        }
        for (String value : new String[] {null, "", "black-field", "top-left';alert(1)"}) {
            if (!"top-left".equals(CanvasFpsPosition.normalize(value))) throw new AssertionError(value);
        }
        System.out.println("Canvas FPS position tests passed.");
    }
}
