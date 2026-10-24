package app.apkshelf.firetv;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;

/** Grants the installer read-only access to one verified APK, never to preferences or partials. */
public final class ApkProvider extends ContentProvider {
    public static final String AUTHORITY = "app.apkshelf.firetv.apks";
    public static final String MIME = "application/vnd.android.package-archive";

    public static Uri uriFor(File file) {
        if (!file.getName().matches("[a-f0-9]{40}\\.apk")) {
            throw new IllegalArgumentException("Invalid download name.");
        }
        return new Uri.Builder().scheme("content").authority(AUTHORITY)
                .appendPath("apk").appendPath(file.getName()).build();
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        List<String> segments = uri.getPathSegments();
        if (!"content".equals(uri.getScheme()) || !AUTHORITY.equals(uri.getAuthority())
                || uri.getQuery() != null || uri.getFragment() != null
                || segments.size() != 2 || !"apk".equals(segments.get(0))
                || !segments.get(1).matches("[a-f0-9]{40}\\.apk")) {
            throw new FileNotFoundException("Invalid APK URI.");
        }
        try {
            File directory = new File(getContext().getFilesDir(), "downloads").getCanonicalFile();
            File file = new File(directory, segments.get(1)).getCanonicalFile();
            if (!directory.equals(file.getParentFile()) || !file.isFile()) {
                throw new FileNotFoundException("APK no longer available. Download it again.");
            }
            return file;
        } catch (IOException e) {
            throw new FileNotFoundException("Cannot open the downloaded APK.");
        }
    }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) {
        try { resolve(uri); return MIME; }
        catch (FileNotFoundException e) { throw new IllegalArgumentException(e.getMessage()); }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read access only.");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) {
        try {
            File file = resolve(uri);
            String[] columns = projection == null
                    ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns, 1);
            Object[] values = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = "download.apk";
                if (OpenableColumns.SIZE.equals(columns[i])) values[i] = file.length();
            }
            cursor.addRow(values);
            return cursor;
        } catch (FileNotFoundException e) { throw new IllegalArgumentException(e.getMessage()); }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
    @Override public int delete(Uri uri, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
}
