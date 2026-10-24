package app.apkshelf.firetv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Small, remote-first folder browser. All network and hashing work stays off the UI thread. */
public final class MainActivity extends Activity {
    static final String DEFAULT_REPO = "to-shreds/apks";
    static final String DEFAULT_REF = "";
    static final String DEFAULT_FOLDER = "";
    private static final int INSTALL_REQUEST = 40;
    private static final int SETTINGS_REQUEST = 41;
    private static final int BG = Color.rgb(11, 16, 32);
    private static final int SURFACE = Color.rgb(22, 31, 49);
    private static final int TEXT = Color.rgb(243, 246, 252);
    private static final int MUTED = Color.rgb(164, 181, 203);
    private static final int ACCENT = Color.rgb(120, 214, 198);

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final GitHubClient client = new GitHubClient();
    private final List<GitHubClient.ApkEntry> entries = new ArrayList<>();
    private SharedPreferences preferences;
    private RepoConfig config;
    private TokenStore tokenStore;
    private String token = "";
    private String credentialsError;
    private GitHubClient.Cancellation active;
    private int generation;
    private boolean busy;
    private boolean waitingForPermission;
    private boolean installerActive;
    private boolean destroyed;
    private boolean foreground;
    private File pendingFile;
    private String pendingName;
    private String pendingDescription;
    private TextView sourceLabel;
    private TextView countLabel;
    private TextView statusLabel;
    private TextView emptyLabel;
    private ProgressBar progress;
    private Button refreshButton;
    private Button settingsButton;
    private Button permissionButton;
    private Button cancelButton;
    private Button installButton;
    private ListView list;
    private ApkAdapter adapter;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        preferences = getSharedPreferences("settings", MODE_PRIVATE);
        migrateOriginalDefault();
        tokenStore = new TokenStore(this);
        try { token = tokenStore.read(); }
        catch (Exception e) { credentialsError = "Your saved GitHub token could not be opened. Re-enter it in Folder settings."; }
        try {
            config = RepoConfig.fromInput(preferences.getString("repository", DEFAULT_REPO),
                    preferences.getString("ref", DEFAULT_REF), preferences.getString("folder", DEFAULT_FOLDER));
        } catch (IllegalArgumentException e) {
            config = RepoConfig.fromInput(DEFAULT_REPO, DEFAULT_REF, DEFAULT_FOLDER);
        }
        waitingForPermission = preferences.getBoolean("waiting_permission", false);
        restorePending();
        buildScreen();
        refresh();
    }

    /**
     * Updating an existing installation must change the original default, not
     * just the defaults used by a new installation. Custom sources stay intact.
     */
    private void migrateOriginalDefault() {
        String savedRepo = preferences.getString("repository", null);
        String savedRef = preferences.getString("ref", null);
        String savedFolder = preferences.getString("folder", null);
        if ("to-shreds/torbox-web-player".equals(savedRepo)
                && "native-updates".equals(savedRef)
                && "native/updates/releases".equals(savedFolder)) {
            boolean saved = preferences.edit()
                    .putString("repository", DEFAULT_REPO)
                    .putString("ref", DEFAULT_REF)
                    .putString("folder", DEFAULT_FOLDER).commit();
            if (saved) {
                // A pending installation from the previous folder is no longer current.
                preferences.edit().remove("pending_file").remove("pending_name")
                        .remove("pending_description").putBoolean("waiting_permission", false).commit();
            }
        }
    }

    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(40), dp(24), dp(40), dp(20));
        root.setFitsSystemWindows(true);
        TextView title = text("APK Shelf", 29, TEXT);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title);
        root.addView(text("Your GitHub folder, on your TV.", 14, MUTED));

        sourceLabel = text("", 13, ACCENT);
        sourceLabel.setMaxLines(2);
        sourceLabel.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        LinearLayout.LayoutParams sourceParams = matchWrap();
        sourceParams.topMargin = dp(10);
        sourceParams.bottomMargin = dp(12);
        root.addView(sourceLabel, sourceParams);
        updateSource();

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        refreshButton = button("Refresh", v -> refresh());
        settingsButton = button("Folder settings", v -> showSettings());
        permissionButton = button("Allow installs", v -> openPermissionHelp(false));
        toolbar.addView(refreshButton, toolbarParams());
        toolbar.addView(settingsButton, toolbarParams());
        toolbar.addView(permissionButton, toolbarParams());
        root.addView(toolbar);

        countLabel = text("APKS", 12, MUTED);
        countLabel.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams countParams = matchWrap();
        countParams.topMargin = dp(16);
        countParams.bottomMargin = dp(7);
        root.addView(countLabel, countParams);

        android.widget.FrameLayout content = new android.widget.FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        list = new ListView(this);
        list.setId(View.generateViewId());
        list.setCacheColorHint(Color.TRANSPARENT);
        list.setDivider(new android.graphics.drawable.ColorDrawable(BG));
        list.setDividerHeight(dp(6));
        list.setSelector(focusBackground());
        list.setDrawSelectorOnTop(false);
        list.setItemsCanFocus(false);
        list.setChoiceMode(ListView.CHOICE_MODE_NONE);
        list.setPadding(dp(3), dp(3), dp(3), dp(3));
        list.setClipToPadding(false);
        list.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        adapter = new ApkAdapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> {
            if (!busy && !installerActive && position < entries.size()) download(entries.get(position));
        });
        content.addView(list, new android.widget.FrameLayout.LayoutParams(-1, -1));
        emptyLabel = text("Loading your folder...", 17, MUTED);
        emptyLabel.setGravity(Gravity.CENTER);
        emptyLabel.setPadding(dp(24), dp(12), dp(24), dp(12));
        content.addView(emptyLabel, new android.widget.FrameLayout.LayoutParams(-1, -1));
        list.setEmptyView(emptyLabel);

        LinearLayout statusArea = new LinearLayout(this);
        statusArea.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams statusParams = matchWrap();
        statusParams.topMargin = dp(10);
        root.addView(statusArea, statusParams);
        statusLabel = text("", 13, MUTED);
        statusLabel.setMaxLines(3);
        statusArea.addView(statusLabel, matchWrap());
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(1000);
        progress.setVisibility(View.GONE);
        statusArea.addView(progress, new LinearLayout.LayoutParams(-1, dp(7)));
        LinearLayout transferActions = new LinearLayout(this);
        cancelButton = button("Cancel", v -> cancelOperation("Cancelled. Choose an APK to try again."));
        cancelButton.setVisibility(View.GONE);
        installButton = button("Install downloaded APK", v -> installPending());
        installButton.setVisibility(pendingFile == null ? View.GONE : View.VISIBLE);
        transferActions.addView(cancelButton, toolbarParams());
        transferActions.addView(installButton, toolbarParams());
        statusArea.addView(transferActions);
        TextView hint = text("SELECT  Download and install       MENU  Refresh       BACK  Cancel or exit", 11, MUTED);
        LinearLayout.LayoutParams hintParams = matchWrap();
        hintParams.topMargin = dp(9);
        root.addView(hint, hintParams);
        setContentView(root);
        refreshButton.requestFocus();
    }

    private void updateSource() {
        sourceLabel.setText(config.owner + "/" + config.repo + "  /  "
                + (config.folder.isEmpty() ? "(repository root)" : config.folder)
                + "  [" + (config.ref.isEmpty() ? "default branch" : config.ref) + "]");
    }

    private void refresh() {
        if (busy || installerActive) return;
        final int operation = beginOperation("Loading APKs from GitHub...");
        final GitHubClient.Cancellation cancellation = active;
        final RepoConfig source = config;
        final String auth = token;
        emptyLabel.setText("Loading your folder...");
        worker.execute(() -> {
            try {
                final GitHubClient.Listing result = client.list(source, auth, cancellation);
                main.post(() -> {
                    if (!current(operation)) return;
                    endOperation();
                    entries.clear();
                    entries.addAll(result.entries);
                    adapter.notifyDataSetChanged();
                    countLabel.setText(entries.size() + (entries.size() == 1 ? " APK" : " APKS"));
                    emptyLabel.setText("No APKs in this folder yet.\nUpload an .apk to the configured GitHub folder, then select Refresh.");
                    String message = entries.isEmpty() ? "Folder connected. Ready for your first APK."
                            : "Select an APK to download it and open the installer.";
                    if (result.warning != null && !result.warning.isEmpty()) message = result.warning;
                    if (credentialsError != null) message = credentialsError;
                    statusLabel.setText(message);
                    if (!entries.isEmpty() && foreground) { list.setSelection(0); list.requestFocus(); }
                    if (foreground && waitingForPermission && pendingFile != null
                            && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
                        installPending();
                    }
                });
            } catch (Exception e) { reportFailure(operation, e, false); }
        });
    }

    private void download(final GitHubClient.ApkEntry entry) {
        final int operation = beginOperation("Downloading " + entry.name + "...");
        final GitHubClient.Cancellation cancellation = active;
        final RepoConfig source = config;
        final String auth = token;
        clearPending();
        cancelButton.requestFocus();
        worker.execute(() -> {
            try {
                File directory = new File(getFilesDir(), "downloads");
                // Only one completed/partial transfer is retained. No broad storage permission is used.
                File[] old = directory.listFiles();
                if (old != null) for (File f : old) {
                    if (f.getName().matches("[a-f0-9]{40}\\.apk(?:\\.part)?") || f.getName().endsWith(".part")) f.delete();
                }
                final long[] lastUpdate = {0};
                File file = client.download(source, auth, entry, directory, cancellation, (done, total) -> {
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (done < total && now - lastUpdate[0] < 150) return;
                    lastUpdate[0] = now;
                    main.post(() -> {
                        if (!current(operation)) return;
                        progress.setIndeterminate(false);
                        progress.setProgress(total > 0 ? (int) Math.min(1000, done * 1000 / total) : 0);
                        statusLabel.setText("Downloading " + entry.name + "  " + size(done) + " / " + size(total));
                    });
                });
                cancellation.check();
                PackageInfo info = getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
                if (info == null || info.applicationInfo == null) {
                    file.delete();
                    throw new IOException("This file is not an Android APK that this device can read.");
                }
                if (Build.VERSION.SDK_INT >= 24 && info.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT) {
                    file.delete();
                    throw new IOException("This APK requires a newer Android / Fire OS version than this device has.");
                }
                info.applicationInfo.sourceDir = file.getAbsolutePath();
                info.applicationInfo.publicSourceDir = file.getAbsolutePath();
                String label = String.valueOf(info.applicationInfo.loadLabel(getPackageManager()));
                final String description = label + (info.versionName == null ? "" : " " + info.versionName)
                        + "  (" + info.packageName + ")";
                cancellation.check();
                main.post(() -> {
                    if (!current(operation)) return;
                    endOperation();
                    pendingFile = file;
                    pendingName = entry.name;
                    pendingDescription = description;
                    preferences.edit().putString("pending_file", file.getName())
                            .putString("pending_name", pendingName).putString("pending_description", description).commit();
                    installButton.setVisibility(View.VISIBLE);
                    statusLabel.setText("Download verified. " + description);
                    if (foreground) installPending();
                });
            } catch (Exception e) { reportFailure(operation, e, true); }
        });
    }

    private void reportFailure(final int operation, Exception error, final boolean download) {
        String message = error.getMessage();
        final String safeMessage = message == null || message.trim().isEmpty()
                ? "Could not connect. Check Wi-Fi and try Refresh." : message;
        main.post(() -> {
            if (!current(operation)) return;
            endOperation();
            statusLabel.setText(safeMessage);
            if (entries.isEmpty()) emptyLabel.setText("Could not load this folder.\nCheck Folder settings, then select Refresh.");
            if (foreground) {
                new AlertDialog.Builder(this).setTitle(download ? "Download stopped" : "Could not load APKs")
                        .setMessage(safeMessage).setPositiveButton("OK", null).show();
            }
            refreshButton.requestFocus();
        });
    }

    private int beginOperation(String message) {
        busy = true;
        generation++;
        active = new GitHubClient.Cancellation();
        statusLabel.setText(message);
        progress.setVisibility(View.VISIBLE);
        progress.setIndeterminate(true);
        cancelButton.setVisibility(View.VISIBLE);
        installButton.setVisibility(View.GONE);
        refreshButton.setEnabled(false);
        settingsButton.setEnabled(false);
        permissionButton.setEnabled(false);
        list.setEnabled(false);
        cancelButton.requestFocus();
        return generation;
    }

    private boolean current(int operation) { return !destroyed && operation == generation && busy; }
    private void endOperation() {
        busy = false;
        active = null;
        progress.setVisibility(View.GONE);
        cancelButton.setVisibility(View.GONE);
        refreshButton.setEnabled(true);
        settingsButton.setEnabled(true);
        permissionButton.setEnabled(true);
        list.setEnabled(true);
        installButton.setVisibility(pendingFile != null && pendingFile.isFile() ? View.VISIBLE : View.GONE);
    }
    private void cancelOperation(String message) {
        if (active != null) active.cancel();
        generation++;
        endOperation();
        statusLabel.setText(message);
        if (entries.isEmpty()) emptyLabel.setText("Select Refresh to load your APK folder.");
        refreshButton.requestFocus();
    }

    private void installPending() {
        if (busy || installerActive || pendingFile == null || !pendingFile.isFile()) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            openPermissionHelp(true);
            return;
        }
        waitingForPermission = false;
        preferences.edit().putBoolean("waiting_permission", false).commit();
        Uri uri = ApkProvider.uriFor(pendingFile);
        Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
        intent.setDataAndType(uri, ApkProvider.MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("APK", uri));
        intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
        try {
            installerActive = true;
            startActivityForResult(intent, INSTALL_REQUEST);
            statusLabel.setText("Installer opened for " + pendingName + ". Confirm installation on the next screen.");
        } catch (ActivityNotFoundException e) {
            intent.setAction(Intent.ACTION_VIEW);
            try { startActivityForResult(intent, INSTALL_REQUEST); }
            catch (RuntimeException missing) {
                installerActive = false;
                showMessage("Installer unavailable", "This device did not provide an APK installer. The verified download is retained.");
            }
        } catch (RuntimeException e) {
            installerActive = false;
            showMessage("Installation could not start", "Allow APK Shelf to install unknown apps in Fire TV Settings, then select Install downloaded APK.");
        }
    }

    private void openPermissionHelp(boolean resumeInstall) {
        if (Build.VERSION.SDK_INT >= 26 && getPackageManager().canRequestPackageInstalls()) {
            showMessage("Ready to install", "APK Shelf is allowed to open the installer. Choose an APK from the list.");
            return;
        }
        new AlertDialog.Builder(this).setTitle("Allow APK Shelf to install apps")
                .setMessage("In Fire TV Settings, open My Fire TV > Developer Options > Install unknown apps and turn on APK Shelf.\n\nOn older Fire OS versions, enable Apps from Unknown Sources. If Developer Options is hidden, open About, highlight your device name and press Select seven times.\n\nReturn here afterward. You will still confirm each installation.")
                .setPositiveButton("Open settings", (dialog, which) -> {
                    waitingForPermission = resumeInstall;
                    preferences.edit().putBoolean("waiting_permission", resumeInstall).commit();
                    Intent specific = Build.VERSION.SDK_INT >= 26
                            ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))
                            : new Intent(Settings.ACTION_SECURITY_SETTINGS);
                    try { startActivityForResult(specific, SETTINGS_REQUEST); }
                    catch (ActivityNotFoundException e) {
                        try { startActivityForResult(new Intent(Settings.ACTION_SETTINGS), SETTINGS_REQUEST); }
                        catch (ActivityNotFoundException missing) {
                            showMessage("Open Fire TV Settings", "Use the Home button to open Settings > My Fire TV > Developer Options. Then return to APK Shelf and select Install downloaded APK.");
                        }
                    }
                }).setNegativeButton("Later", null).show();
    }

    private void showSettings() {
        if (busy) return;
        ScrollView scroll = new ScrollView(this);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(10), dp(24), dp(14));
        scroll.addView(form);
        TextView explanation = text("Use any GitHub repository folder. Public folders need no token. Only APKs directly in this folder are listed.", 14, MUTED);
        form.addView(explanation);
        EditText repository = field(form, "Repository (owner/name)", config.owner + "/" + config.repo, false);
        EditText ref = field(form, "Branch or tag (blank uses the default branch)", config.ref, false);
        EditText folder = field(form, "Folder (blank uses the repository root)", config.folder, false);
        EditText auth = field(form, "GitHub token (optional, private repositories only)", token, true);
        form.addView(text("For a private repository, use a fine-grained token with Contents: read access to that repository. It is encrypted on this device. Clear this field for a public folder.", 12, MUTED));
        TextView error = text("", 13, Color.rgb(255, 176, 162));
        error.setVisibility(View.GONE);
        form.addView(error);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("GitHub folder")
                .setView(scroll).setPositiveButton("Save and load", null)
                .setNeutralButton("Use my default folder", null).setNegativeButton("Cancel", null).create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                try {
                    RepoConfig next = RepoConfig.fromInput(repository.getText().toString(), ref.getText().toString(), folder.getText().toString());
                    String nextToken = auth.getText().toString().trim();
                    if (nextToken.length() > 512 || nextToken.matches(".*\\s+.*")) {
                        throw new IllegalArgumentException("The token contains spaces or is too long. Paste just the token itself.");
                    }
                    tokenStore.write(nextToken);
                    if (!preferences.edit().putString("repository", next.owner + "/" + next.repo)
                            .putString("ref", next.ref).putString("folder", next.folder).commit()) {
                        throw new IOException("Could not save the GitHub folder. Try again.");
                    }
                    config = next;
                    token = nextToken;
                    credentialsError = null;
                    clearPending();
                    entries.clear();
                    adapter.notifyDataSetChanged();
                    updateSource();
                    ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(repository.getWindowToken(), 0);
                    dialog.dismiss();
                    refresh();
                } catch (Exception e) {
                    error.setText(e.getMessage() == null ? "Could not save settings. Please try again." : e.getMessage());
                    error.setVisibility(View.VISIBLE);
                    scroll.smoothScrollTo(0, form.getHeight());
                }
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
                repository.setText(DEFAULT_REPO);
                ref.setText(DEFAULT_REF);
                folder.setText(DEFAULT_FOLDER);
                auth.setText("");
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus();
            });
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus();
        });
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
            dialog.getWindow().setLayout(Math.min(dp(720), getResources().getDisplayMetrics().widthPixels - dp(48)), -2);
        }
    }

    private EditText field(LinearLayout parent, String title, String value, boolean password) {
        TextView label = text(title, 13, ACCENT);
        LinearLayout.LayoutParams labelParams = matchWrap();
        labelParams.topMargin = dp(12);
        parent.addView(label, labelParams);
        EditText edit = new EditText(this);
        edit.setTextColor(TEXT);
        edit.setTextSize(16);
        edit.setSingleLine(true);
        edit.setSelectAllOnFocus(true);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | (password
                ? InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_TEXT_VARIATION_URI));
        edit.setText(value);
        if (Build.VERSION.SDK_INT >= 26) edit.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        parent.addView(edit, matchWrap());
        return edit;
    }

    private void restorePending() {
        String name = preferences.getString("pending_file", "");
        if (name.matches("[a-f0-9]{40}\\.apk")) {
            File file = new File(new File(getFilesDir(), "downloads"), name);
            if (file.isFile()) {
                pendingFile = file;
                pendingName = preferences.getString("pending_name", "Downloaded APK");
                pendingDescription = preferences.getString("pending_description", pendingName);
            }
        }
    }
    private void clearPending() {
        pendingFile = null;
        pendingName = null;
        pendingDescription = null;
        waitingForPermission = false;
        preferences.edit().remove("pending_file").remove("pending_name").remove("pending_description")
                .putBoolean("waiting_permission", false).commit();
        if (installButton != null) installButton.setVisibility(View.GONE);
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        if (waitingForPermission && pendingFile != null && !busy && !installerActive
                && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            installPending();
        }
    }
    @Override protected void onPause() { foreground = false; super.onPause(); }
    @Override protected void onStop() {
        if (busy) cancelOperation("Stopped when APK Shelf left the screen. Refresh or choose the APK again.");
        super.onStop();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == INSTALL_REQUEST) {
            installerActive = false;
            statusLabel.setText(result == RESULT_OK ? "Installation completed. Choose another APK, or press Home to open your app."
                    : "Installer closed. You can retry using Install downloaded APK, or choose another file.");
            installButton.requestFocus();
        }
        if (request == SETTINGS_REQUEST && pendingFile != null) {
            statusLabel.setText("Select Install downloaded APK to continue.");
            installButton.requestFocus();
        }
    }
    @Override public void onBackPressed() {
        if (busy) cancelOperation("Cancelled. Choose an APK to try again.");
        else super.onBackPressed();
    }
    @Override public boolean onKeyUp(int code, KeyEvent event) {
        if (code == KeyEvent.KEYCODE_MENU) { refresh(); return true; }
        return super.onKeyUp(code, event);
    }
    @Override protected void onDestroy() {
        destroyed = true;
        generation++;
        if (active != null) active.cancel();
        worker.shutdownNow();
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void showMessage(String title, String message) {
        new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("OK", null).show();
    }
    private int dp(float number) { return (int) (number * getResources().getDisplayMetrics().density + 0.5f); }
    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }
    private Button button(String title, View.OnClickListener action) {
        Button button = new Button(this);
        button.setText(title);
        button.setTextColor(TEXT);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setMinHeight(dp(42));
        button.setMinimumHeight(dp(42));
        button.setPadding(dp(18), dp(7), dp(18), dp(7));
        button.setBackground(focusBackground());
        button.setOnClickListener(action);
        button.setOnFocusChangeListener((view, focused) -> view.setElevation(focused ? dp(4) : 0));
        return button;
    }
    private StateListDrawable focusBackground() {
        StateListDrawable drawable = new StateListDrawable();
        drawable.addState(new int[]{android.R.attr.state_focused}, shape(Color.rgb(36, 68, 81), ACCENT));
        drawable.addState(new int[]{android.R.attr.state_pressed}, shape(Color.rgb(36, 68, 81), ACCENT));
        drawable.addState(new int[]{android.R.attr.state_selected}, shape(Color.rgb(36, 68, 81), ACCENT));
        drawable.addState(new int[]{-android.R.attr.state_enabled}, shape(Color.rgb(16, 23, 37), Color.TRANSPARENT));
        drawable.addState(new int[]{}, shape(SURFACE, Color.TRANSPARENT));
        return drawable;
    }
    private GradientDrawable shape(int color, int border) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(8));
        shape.setStroke(dp(2), border);
        return shape;
    }
    private LinearLayout.LayoutParams toolbarParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, dp(42));
        p.rightMargin = dp(10);
        p.topMargin = dp(4);
        return p;
    }
    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(-1, -2); }
    private static String size(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format(Locale.US, "%.1f KB", bytes / 1024.0);
        return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024));
    }
    private final class ApkAdapter extends BaseAdapter {
        @Override public int getCount() { return entries.size(); }
        @Override public GitHubClient.ApkEntry getItem(int position) { return entries.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public View getView(int position, View convert, ViewGroup parent) {
            LinearLayout row;
            TextView filename;
            TextView detail;
            if (convert == null) {
                row = new LinearLayout(MainActivity.this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(18), dp(10), dp(18), dp(10));
                row.setMinimumHeight(dp(63));
                filename = text("", 17, TEXT);
                filename.setSingleLine(true);
                filename.setEllipsize(TextUtils.TruncateAt.MIDDLE);
                detail = text("", 12, MUTED);
                row.addView(filename, matchWrap());
                row.addView(detail, matchWrap());
            } else {
                row = (LinearLayout) convert;
                filename = (TextView) row.getChildAt(0);
                detail = (TextView) row.getChildAt(1);
            }
            GitHubClient.ApkEntry entry = getItem(position);
            filename.setText(entry.name);
            detail.setText(size(entry.size) + "    Select to download and install");
            return row;
        }
    }
}
