package app.apkshelf.firetv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Local installed-app inventory. Nothing here runs as root or ADB shell.
 * System-package commands are displayed for use from an external ADB client.
 */
public final class InstalledAppsActivity extends Activity {
    private static final int BG = Color.rgb(11, 16, 32);
    private static final int SURFACE = Color.rgb(22, 31, 49);
    private static final int TEXT = Color.rgb(243, 246, 252);
    private static final int MUTED = Color.rgb(164, 181, 203);
    private static final int ACCENT = Color.rgb(120, 214, 198);
    private static final int[] FILTERS = {0, 1, 2, 3, 4, 5};
    private static final String[] FILTER_NAMES = {"All", "User", "System", "Disabled", "Favorites", "Hidden"};

    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private final List<AppEntry> all = new ArrayList<AppEntry>();
    private final List<AppEntry> visible = new ArrayList<AppEntry>();
    private SharedPreferences preferences;
    private PackageManager packages;
    private ListView appList;
    private TextView count;
    private TextView status;
    private EditText search;
    private Button filterButton;
    private BaseAdapter adapter;
    private int filterIndex;
    private int loadSerial;
    private boolean destroyed;
    private boolean initialLoad = true;

    static final class AppEntry {
        final String name;
        final String packageName;
        final boolean system;
        final boolean enabled;
        final boolean persistent;
        final int uid;

        AppEntry(String name, String packageName, boolean system, boolean enabled,
                 boolean persistent, int uid) {
            this.name = name;
            this.packageName = packageName;
            this.system = system;
            this.enabled = enabled;
            this.persistent = persistent;
            this.uid = uid;
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        packages = getPackageManager();
        preferences = getSharedPreferences("app_inventory", MODE_PRIVATE);
        build();
    }

    @Override protected void onResume() {
        super.onResume();
        reload();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        loadSerial++;
        loader.shutdownNow();
        super.onDestroy();
    }

    private void build() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(36), dp(23), dp(36), dp(18));
        root.setBackgroundColor(BG);

        TextView heading = text("Installed apps", 27, TEXT);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(heading, wide());

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        Button back = button("Back", v -> finish());
        filterButton = button("Filter: " + FILTER_NAMES[filterIndex], v -> {
            filterIndex = (filterIndex + 1) % FILTERS.length;
            filterButton.setText("Filter: " + FILTER_NAMES[filterIndex]);
            applyFilter();
        });
        Button refresh = button("Refresh", v -> reload());
        controls.addView(back, toolbar());
        controls.addView(filterButton, toolbar());
        controls.addView(refresh, toolbar());
        root.addView(controls, wide());

        search = new EditText(this);
        search.setTextSize(16);
        search.setSingleLine(true);
        search.setTextColor(TEXT);
        search.setHintTextColor(MUTED);
        search.setHint("Search app or package");
        search.setInputType(InputType.TYPE_CLASS_TEXT);
        search.setPadding(dp(12), dp(4), dp(12), dp(4));
        search.setSelectAllOnFocus(false);
        LinearLayout.LayoutParams inputLayout = wide();
        inputLayout.topMargin = dp(10);
        root.addView(search, inputLayout);
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { applyFilter(); }
            @Override public void afterTextChanged(Editable e) {}
        });

        count = text("Loading...", 13, MUTED);
        LinearLayout.LayoutParams countLayout = wide();
        countLayout.topMargin = dp(10);
        root.addView(count, countLayout);

        appList = new ListView(this);
        appList.setCacheColorHint(Color.TRANSPARENT);
        appList.setDivider(new android.graphics.drawable.ColorDrawable(BG));
        appList.setDividerHeight(dp(5));
        appList.setSelector(focusBackground());
        appList.setDrawSelectorOnTop(false);
        appList.setItemsCanFocus(false);
        appList.setChoiceMode(ListView.CHOICE_MODE_NONE);
        appList.setPadding(dp(3), dp(3), dp(3), dp(3));
        appList.setClipToPadding(false);
        adapter = new AppAdapter();
        appList.setAdapter(adapter);
        appList.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < visible.size()) showApp(visible.get(position));
        });
        root.addView(appList, new LinearLayout.LayoutParams(-1, 0, 1));

        status = text("System apps can only be disabled if Fire OS or external ADB permits it.", 12, MUTED);
        status.setMaxLines(2);
        root.addView(status, wide());

        setContentView(root);
        back.requestFocus();
    }

    private void reload() {
        final int serial = ++loadSerial;
        count.setText("Loading installed apps...");
        loader.execute(() -> {
            List<AppEntry> result = new ArrayList<AppEntry>();
            String error = null;
            try {
                List<ApplicationInfo> raw = packages.getInstalledApplications(0);
                for (ApplicationInfo app : raw) {
                    if (Thread.currentThread().isInterrupted()) return;
                    if (app.packageName == null || app.packageName.isEmpty()) continue;
                    CharSequence label = packages.getApplicationLabel(app);
                    String name = label == null ? "" : label.toString().trim();
                    if (name.isEmpty()) name = app.packageName;
                    boolean isSystem = (app.flags & (ApplicationInfo.FLAG_SYSTEM
                            | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0;
                    boolean persistent = (app.flags & ApplicationInfo.FLAG_PERSISTENT) != 0;
                    result.add(new AppEntry(name, app.packageName, isSystem,
                            app.enabled, persistent, app.uid));
                }
                Collections.sort(result, new Comparator<AppEntry>() {
                    @Override public int compare(AppEntry a, AppEntry b) {
                        int c = a.name.compareToIgnoreCase(b.name);
                        if (c == 0) c = a.packageName.compareToIgnoreCase(b.packageName);
                        return c;
                    }
                });
            } catch (Exception e) {
                error = e.getMessage();
            }
            final String issue = error;
            runOnUiThread(() -> {
                if (destroyed || serial != loadSerial) return;
                if (issue != null) {
                    status.setText("Unable to read installed apps: " + issue);
                    count.setText("Unavailable");
                    return;
                }
                all.clear();
                all.addAll(result);
                applyFilter();
                if (initialLoad) {
                    initialLoad = false;
                    status.setText("Uninstall uses Android confirmation. System changes require App info or external ADB.");
                }
            });
        });
    }

    private Set<String> saved(String key) {
        return new HashSet<String>(preferences.getStringSet(key, Collections.<String>emptySet()));
    }

    private boolean marked(String key, String name) {
        return preferences.getStringSet(key, Collections.<String>emptySet()).contains(name);
    }

    private void toggle(String key, String name) {
        Set<String> state = saved(key);
        if (!state.add(name)) state.remove(name);
        preferences.edit().putStringSet(key, state).apply();
        applyFilter();
    }

    private void applyFilter() {
        if (appList == null || adapter == null || count == null) return;
        String term = search == null ? "" : search.getText().toString().trim().toLowerCase(Locale.US);
        Set<String> hidden = saved("hidden");
        Set<String> favorites = saved("favorites");
        visible.clear();
        for (AppEntry app : all) {
            boolean isHidden = hidden.contains(app.packageName);
            if (filterIndex != 5 && isHidden) continue;
            if (filterIndex == 1 && app.system) continue;
            if (filterIndex == 2 && !app.system) continue;
            if (filterIndex == 3 && app.enabled) continue;
            if (filterIndex == 4 && !favorites.contains(app.packageName)) continue;
            if (filterIndex == 5 && !isHidden) continue;
            if (!term.isEmpty() && !app.name.toLowerCase(Locale.US).contains(term)
                    && !app.packageName.toLowerCase(Locale.US).contains(term)) continue;
            visible.add(app);
        }
        adapter.notifyDataSetChanged();
        count.setText(visible.size() + " shown / " + all.size() + " installed"
                + "    |    " + formatBytes(Environment.getDataDirectory().getUsableSpace()) + " free");
    }

    private void showApp(final AppEntry app) {
        String category = app.system ? "System" : "User";
        String state = app.enabled ? "Enabled" : "Disabled";
        String info = app.name + "\n" + app.packageName + "\n" + category + " · " + state;

        List<String> actions = new ArrayList<String>();
        final List<Integer> codes = new ArrayList<Integer>();
        if (app.enabled && packages.getLaunchIntentForPackage(app.packageName) != null) {
            actions.add("Launch"); codes.add(0);
        } else if (app.enabled && packages.getLeanbackLaunchIntentForPackage(app.packageName) != null) {
            actions.add("Launch"); codes.add(0);
        }
        actions.add("App info / system settings"); codes.add(1);
        if (!app.system && !getPackageName().equals(app.packageName)) {
            actions.add("Uninstall"); codes.add(2);
        }
        actions.add(marked("favorites", app.packageName) ? "Remove favorite" : "Favorite"); codes.add(3);
        actions.add(marked("hidden", app.packageName) ? "Show in Shelf" : "Hide in Shelf only"); codes.add(4);
        if (app.system) {
            actions.add("ADB disable / enable instructions"); codes.add(5);
        }
        new AlertDialog.Builder(this).setTitle(info)
                .setItems(actions.toArray(new String[0]), (dialog, which) -> {
                    switch (codes.get(which)) {
                        case 0: launch(app); break;
                        case 1: appInfo(app); break;
                        case 2: uninstall(app); break;
                        case 3: toggle("favorites", app.packageName); break;
                        case 4: hideHere(app); break;
                        case 5: showAdb(app); break;
                    }
                }).setNegativeButton("Close", null).show();
    }

    private void launch(AppEntry app) {
        Intent intent = packages.getLeanbackLaunchIntentForPackage(app.packageName);
        if (intent == null) intent = packages.getLaunchIntentForPackage(app.packageName);
        if (intent == null) {
            message("Can't launch", "This app has no launchable activity.");
            return;
        }
        try { startActivity(intent); }
        catch (RuntimeException e) { message("Can't launch", "Fire OS refused to launch this app."); }
    }

    private void appInfo(AppEntry app) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + app.packageName));
        try { startActivity(intent); }
        catch (ActivityNotFoundException e) {
            try { startActivity(new Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS)); }
            catch (RuntimeException exception) {
                message("App info unavailable", "Open Fire TV Settings > Applications > Manage Installed Applications.");
            }
        } catch (SecurityException e) {
            message("App info unavailable", "Fire OS did not allow opening this package's settings.");
        }
    }

    private void uninstall(AppEntry app) {
        if (app.system || getPackageName().equals(app.packageName)) return;
        new AlertDialog.Builder(this).setTitle("Uninstall " + app.name + "?")
                .setMessage("Android will ask you to confirm. This may remove the app's local data.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Continue", (d, w) -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_DELETE,
                                Uri.parse("package:" + app.packageName)));
                    } catch (RuntimeException e) {
                        message("Uninstall unavailable", "Fire OS did not open the uninstaller. Use App info.");
                    }
                }).show();
    }

    private void hideHere(AppEntry app) {
        if (marked("hidden", app.packageName)) {
            toggle("hidden", app.packageName);
            return;
        }
        new AlertDialog.Builder(this).setTitle("Hide in APK Shelf?")
                .setMessage("This hides the app from APK Shelf's installed-app list only. "
                        + "It does NOT hide the app from the Amazon Fire TV home screen. "
                        + "Use Filter: Hidden to find and restore it.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Hide here", (d, w) -> toggle("hidden", app.packageName))
                .show();
    }

    private static boolean isProtected(AppEntry app) {
        if (app.persistent || app.uid < 10000) return true;
        String pkg = app.packageName.toLowerCase(Locale.US);
        if (pkg.equals("android") || pkg.equals("com.android.systemui")
                || pkg.equals("com.android.settings") || pkg.equals("com.amazon.tv.launcher")
                || pkg.equals("com.amazon.firehomestarter") || pkg.equals("com.amazon.tv.settings")
                || pkg.equals("com.amazon.device.software.ota")
                || pkg.equals("com.amazon.device.software.ota.override")
                || pkg.equals("com.amazon.tv.forcedotaupdater.v2")
                || pkg.equals("com.amazon.tv.easyupgrade")
                || pkg.equals("com.amazon.tv.home")) return true;
        return false;
    }

    private void showAdb(AppEntry app) {
        if (isProtected(app)) {
            message("Protected system component", "APK Shelf will not generate a disable command for this "
                    + "core or persistent system package. Disabling it may prevent the Fire TV from working.");
            return;
        }
        final String disable = "adb shell pm disable-user --user 0 " + app.packageName;
        final String enable = "adb shell pm enable --user 0 " + app.packageName;
        String description = "Fire OS doesn't let APK Shelf directly disable another app. "
                + "From a phone or computer with ADB connected to this Fire TV, use:\n\n"
                + "Disable:\n" + disable + "\n\nRestore:\n" + enable
                + "\n\nUse one change at a time. Even non-core Amazon apps can affect other features. "
                + "Fire OS may refuse protected packages. These commands have NOT been run.";
        new AlertDialog.Builder(this).setTitle("ADB: " + app.name)
                .setMessage(description)
                .setNeutralButton("Copy disable command", (d,w) -> copy(disable))
                .setPositiveButton("Copy restore command", (d,w) -> copy(enable))
                .setNegativeButton("Close", null).show();
    }

    private void copy(String value) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("ADB command", value));
            status.setText("ADB command copied to Fire TV clipboard. Run it only from an authorized ADB client.");
        }
    }

    private void message(String title, String value) {
        new AlertDialog.Builder(this).setTitle(title).setMessage(value)
                .setPositiveButton("OK", null).show();
    }

    @Override public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            reload();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    private static String formatBytes(long size) {
        if (size < 1024L * 1024 * 1024) return String.format(Locale.US, "%.0f MB", size / 1048576.0);
        return String.format(Locale.US, "%.1f GB", size / (1024.0 * 1024 * 1024));
    }

    private int dp(float n) {
        return (int) (n * getResources().getDisplayMetrics().density + .5f);
    }

    private TextView text(String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        return text;
    }

    private LinearLayout.LayoutParams wide() { return new LinearLayout.LayoutParams(-1, -2); }
    private LinearLayout.LayoutParams toolbar() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(44));
        params.rightMargin = dp(12);
        return params;
    }
    private Button button(String value, View.OnClickListener action) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setTextColor(TEXT);
        button.setPadding(dp(15), dp(5), dp(15), dp(5));
        button.setBackground(focusBackground());
        button.setOnClickListener(action);
        return button;
    }
    private StateListDrawable focusBackground() {
        StateListDrawable drawable = new StateListDrawable();
        drawable.addState(new int[]{android.R.attr.state_focused}, shape(Color.rgb(36, 68, 81), ACCENT));
        drawable.addState(new int[]{android.R.attr.state_pressed}, shape(Color.rgb(36, 68, 81), ACCENT));
        drawable.addState(new int[]{}, shape(SURFACE, Color.TRANSPARENT));
        return drawable;
    }
    private GradientDrawable shape(int color, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(8));
        drawable.setStroke(dp(2), stroke);
        return drawable;
    }

    private final class AppAdapter extends BaseAdapter {
        @Override public int getCount() { return visible.size(); }
        @Override public AppEntry getItem(int position) { return visible.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public View getView(int position, View convert, ViewGroup parent) {
            LinearLayout layout;
            TextView title;
            TextView detail;
            if (convert == null) {
                layout = new LinearLayout(InstalledAppsActivity.this);
                layout.setOrientation(LinearLayout.VERTICAL);
                layout.setPadding(dp(14), dp(8), dp(14), dp(8));
                layout.setMinimumHeight(dp(62));
                title = text("", 17, TEXT);
                title.setSingleLine(true);
                title.setEllipsize(TextUtils.TruncateAt.END);
                detail = text("", 11, MUTED);
                detail.setSingleLine(true);
                detail.setEllipsize(TextUtils.TruncateAt.MIDDLE);
                layout.addView(title, wide());
                layout.addView(detail, wide());
            } else {
                layout = (LinearLayout) convert;
                title = (TextView) layout.getChildAt(0);
                detail = (TextView) layout.getChildAt(1);
            }
            AppEntry app = getItem(position);
            title.setText((marked("favorites", app.packageName) ? "★  " : "") + app.name);
            String kind = app.system ? "System" : "User";
            detail.setText(app.packageName + "    " + kind
                    + (app.enabled ? "" : "    Disabled"));
            return layout;
        }
    }
}
