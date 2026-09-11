package ru.local.gamespace.loader;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Minimal read-only file provider: a single flat namespace of verified APKs, no site paths. */
public final class AppUpdateFileProvider extends ContentProvider {
    static final String MIME = "application/vnd.android.package-archive";
    static File directory(Context context) { return new File(context.getFilesDir(), "app-updates"); }
    static Uri uri(Context context, File file) throws IOException {
        File expected = ApkUpdateFiles.resolveReady(directory(context), file.getName());
        if (!expected.equals(file) || !expected.isFile()) throw new IOException("Проверенный APK недоступен.");
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".updates")
            .appendPath("apk").appendPath(file.getName()).build();
    }
    @Override public boolean onCreate() { return true; }
    private File resolve(Uri uri) throws FileNotFoundException {
        try {
            if (!"content".equals(uri.getScheme()) || !(getContext().getPackageName() + ".updates").equals(uri.getAuthority())
                || uri.getQuery() != null || uri.getFragment() != null || uri.getPathSegments().size() != 2
                || !"apk".equals(uri.getPathSegments().get(0))) throw new IOException();
            String name = uri.getPathSegments().get(1);
            if (!("/apk/" + name).equals(uri.getEncodedPath())) throw new IOException();
            File file = ApkUpdateFiles.resolveReady(directory(getContext()), name);
            if (!file.isFile()) throw new IOException();
            return file;
        } catch (IOException error) { throw new FileNotFoundException("Проверенный APK недоступен."); }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Разрешено только чтение APK.");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public String getType(Uri uri) { return MIME; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        final File file;
        try { file = resolve(uri); } catch (IOException error) { throw new IllegalArgumentException(error.getMessage()); }
        if (projection == null) projection = new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(projection, 1);
        Object[] values = new Object[projection.length];
        for (int index = 0; index < projection.length; index++) {
            if (OpenableColumns.DISPLAY_NAME.equals(projection[index])) values[index] = "GameSpace.apk";
            else if (OpenableColumns.SIZE.equals(projection[index])) values[index] = file.length();
        }
        cursor.addRow(values); return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
