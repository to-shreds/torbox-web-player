package app.apkshelf.firetv;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;

/** Small synchronous client. Call its methods from a worker thread. */
public final class GitHubClient {
    public static final long MAX_APK_BYTES = 100L * 1024L * 1024L;
    public static final long MAX_RELEASE_APK_BYTES = 2L * 1024L * 1024L * 1024L;
    private static final int MAX_RELEASE_PAGES = 5;
    private static final int MAX_ASSET_PAGES = 10;
    private static final String BINARY_ACCEPT = "application/octet-stream";
    private static final int MAX_JSON_BYTES = 8 * 1024 * 1024;
    private static final String JSON_ACCEPT = "application/vnd.github.object+json";
    private static final String RAW_ACCEPT = "application/vnd.github.raw+json";
    private final ConnectionFactory factory;

    public GitHubClient() {
        this(new ConnectionFactory() {
            @Override public HttpURLConnection open(URL url) throws IOException {
                return (HttpURLConnection) url.openConnection();
            }
        });
    }

    GitHubClient(ConnectionFactory factory) {
        this.factory = factory;
    }

    interface ConnectionFactory {
        HttpURLConnection open(URL url) throws IOException;
    }

    public interface Progress {
        void onProgress(long downloaded, long total);
    }

    public static final class Cancellation {
        private volatile boolean cancelled;
        private HttpURLConnection active;

        public void cancel() {
            HttpURLConnection toClose;
            synchronized (this) {
                cancelled = true;
                toClose = active;
            }
            if (toClose != null) toClose.disconnect();
        }

        public boolean isCancelled() { return cancelled; }

        public void check() throws InterruptedIOException {
            if (cancelled || Thread.currentThread().isInterrupted()) {
                throw new InterruptedIOException("Download cancelled.");
            }
        }

        private synchronized void attach(HttpURLConnection connection) throws InterruptedIOException {
            check();
            active = connection;
        }

        private synchronized void detach(HttpURLConnection connection) {
            if (active == connection) active = null;
        }
    }

    public static final class ApkEntry {
        public final String name;
        public final String path;
        public final String sha;
        public final long size;
        public final boolean release;
        public final long releaseAssetId;
        public final String releaseUrl;
        public final String releaseSha256;
        public final String releaseTitle;

        public ApkEntry(String name, String path, String sha, long size) {
            this(name, path, sha, size, false, 0, "", "", "");
        }

        private ApkEntry(String name, String path, String sha, long size, boolean release,
                         long releaseAssetId, String releaseUrl, String releaseSha256, String releaseTitle) {
            this.name = name;
            this.path = path;
            this.sha = sha;
            this.size = size;
            this.release = release;
            this.releaseAssetId = releaseAssetId;
            this.releaseUrl = releaseUrl;
            this.releaseSha256 = releaseSha256;
            this.releaseTitle = releaseTitle;
        }
    }

    public static final class Listing {
        public final List<ApkEntry> entries;
        public final String warning;

        private Listing(List<ApkEntry> entries, String warning) {
            this.entries = Collections.unmodifiableList(entries);
            this.warning = warning;
        }
    }

    public Listing list(RepoConfig config, String token, Cancellation cancellation) throws IOException {
        String credential = validToken(token);
        cancellation.check();
        String text = getJson(config.contentsUrl(), credential, cancellation);
        try {
            JSONArray entries;
            if (text.trim().startsWith("[")) {
                entries = new JSONArray(text);
            } else {
                JSONObject object = new JSONObject(text);
                entries = object.optJSONArray("entries");
                if (entries == null) {
                    throw new IOException("The source points to a file. Choose the folder that contains your APKs.");
                }
            }
            if (entries.length() >= 1000) return listViaTrees(config, credential, cancellation);
            return parseContents(entries, config, cancellation);
        } catch (JSONException e) {
            throw new IOException("GitHub returned an unreadable folder listing. Try Refresh.", e);
        }
    }

    /** Show normal folder APKs and published GitHub Release assets in the same list. */
    public Listing listAll(RepoConfig config, String token, Cancellation cancellation) throws IOException {
        Listing folder = list(config, token, cancellation);
        cancellation.check();
        try {
            Listing releases = listReleases(config, token, cancellation);
            List<ApkEntry> combined = new ArrayList<ApkEntry>(folder.entries);
            combined.addAll(releases.entries);
            Listing result = sorted(combined);
            return new Listing(result.entries, releases.warning);
        } catch (IOException e) {
            cancellation.check();
            return new Listing(folder.entries,
                    "Repository APKs loaded, but Releases could not be loaded: " + e.getMessage());
        }
    }

    /**
     * Fetch published releases and their assets, independent of the selected Git branch/folder.
     * Only downloadable APKs with a GitHub-provided SHA-256 digest are accepted.
     */
    private Listing listReleases(RepoConfig config, String token, Cancellation cancellation) throws IOException {
        List<ApkEntry> result = new ArrayList<ApkEntry>();
        Set<Long> seenIds = new HashSet<Long>();
        boolean skippedUnverified = false;
        boolean truncated = false;
        String credential = validToken(token);
        try {
            for (int page = 1; page <= MAX_RELEASE_PAGES; page++) {
                cancellation.check();
                JSONArray releases = new JSONArray(getJson(config.apiBase()
                        + "/releases?per_page=100&page=" + page, credential, cancellation));
                for (int index = 0; index < releases.length(); index++) {
                    cancellation.check();
                    JSONObject release = releases.getJSONObject(index);
                    if (release.optBoolean("draft", false)) continue;
                    String title = release.optString("name", "").trim();
                    if (title.isEmpty() || RepoConfig.hasControl(title) || title.length() > 100) {
                        title = release.optString("tag_name", "").trim();
                    }
                    if (RepoConfig.hasControl(title) || title.length() > 100) title = "GitHub release";
                    JSONArray assets = release.optJSONArray("assets");
                    if (assets == null) continue;
                    // GitHub may limit embedded assets to 100; page that list when necessary.
                    if (assets.length() >= 100) {
                        long releaseId = release.optLong("id", -1);
                        if (releaseId <= 0) throw new IOException("GitHub returned an invalid release ID.");
                        for (int assetPage = 1; assetPage <= MAX_ASSET_PAGES; assetPage++) {
                            JSONArray paged = new JSONArray(getJson(config.apiBase() + "/releases/"
                                    + releaseId + "/assets?per_page=100&page=" + assetPage,
                                    credential, cancellation));
                            skippedUnverified |= addReleaseAssets(result, seenIds, paged, title, config);
                            if (paged.length() < 100) break;
                            if (assetPage == MAX_ASSET_PAGES) truncated = true;
                        }
                    } else {
                        skippedUnverified |= addReleaseAssets(result, seenIds, assets, title, config);
                    }
                }
                if (releases.length() < 100) break;
                if (page == MAX_RELEASE_PAGES) truncated = true;
            }
        } catch (JSONException e) {
            throw new IOException("GitHub returned an unreadable Releases listing. Try Refresh.", e);
        }
        String warning = null;
        if (truncated) warning = "There are too many Releases to list in one refresh. Only the first entries were shown.";
        if (skippedUnverified) warning = (warning == null ? "" : warning + " ")
                + "Some Release APKs had no usable SHA-256 checksum and were skipped.";
        return new Listing(result, warning);
    }

    private boolean addReleaseAssets(List<ApkEntry> output, Set<Long> seenIds, JSONArray assets,
                                     String title, RepoConfig config) throws JSONException, IOException {
        boolean skippedUnverified = false;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!"uploaded".equals(asset.optString("state"))) continue;
            String name = asset.optString("name");
            if (!isApkName(name)) continue;
            long size = asset.optLong("size", -1);
            if (size <= 0 || size > MAX_RELEASE_APK_BYTES) continue;
            String checksum = asset.optString("digest", "");
            if (!checksum.matches("sha256:[a-fA-F0-9]{64}")) {
                skippedUnverified = true;
                continue;
            }
            long id = asset.optLong("id", -1);
            if (id <= 0) throw new IOException("GitHub returned an invalid APK Release asset.");
            String address = asset.optString("browser_download_url");
            validateReleaseUrl(config, name, address);
            if (!seenIds.add(id)) continue;
            String sha256 = checksum.substring(7).toLowerCase(Locale.US);
            String storageId = releaseStorageId(config, id, sha256);
            output.add(new ApkEntry(name, "releases/assets/" + id, storageId, size, true, id,
                    address, sha256, title));
        }
        return skippedUnverified;
    }

    private static String releaseStorageId(RepoConfig config, long id, String sha256) throws IOException {
        MessageDigest digest = sha1();
        digest.update((config.repository().toLowerCase(Locale.US) + "/release/" + id + "/" + sha256)
                .getBytes("UTF-8"));
        return hex(digest.digest());
    }

    private static void validateReleaseUrl(RepoConfig config, String name, String address) throws IOException {
        URL url;
        try { url = new URL(address); }
        catch (Exception e) { throw new IOException("GitHub returned an invalid Release download URL.", e); }
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !"github.com".equalsIgnoreCase(url.getHost())
                || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)
                || url.getQuery() != null || url.getRef() != null) {
            throw new IOException("GitHub returned an untrusted Release download URL.");
        }
        String prefix = "/" + config.repository() + "/releases/download/";
        String path = url.getPath();
        if (!path.toLowerCase(Locale.US).startsWith(prefix.toLowerCase(Locale.US))
                || !path.endsWith("/" + RepoConfig.encodeSegment(name))) {
            throw new IOException("GitHub returned a Release download outside this repository.");
        }
    }

    private Listing parseContents(JSONArray items, RepoConfig config, Cancellation cancellation)
            throws JSONException, IOException {
        List<ApkEntry> results = new ArrayList<ApkEntry>();
        Set<String> seen = new HashSet<String>();
        for (int i = 0; i < items.length(); i++) {
            cancellation.check();
            JSONObject item = items.getJSONObject(i);
            if (!"file".equals(item.optString("type")) || !item.isNull("submodule_git_url")) continue;
            String name = item.optString("name");
            if (!isApkName(name)) continue;
            String path = folderPath(config, name);
            if (!path.equals(item.optString("path"))) {
                throw new IOException("GitHub returned a file outside the selected folder. Refresh the list.");
            }
            results.add(entry(name, path, item.optString("sha"), item.optLong("size", -1)));
            if (!seen.add(name)) throw new IOException("GitHub returned duplicate filenames. Try Refresh.");
        }
        return sorted(results);
    }

    /** Contents has a 1,000 item ceiling. Walk subtrees without recursive-tree truncation. */
    private Listing listViaTrees(RepoConfig config, String token, Cancellation cancellation) throws IOException {
        try {
            String ref = config.ref;
            if (ref.isEmpty()) {
                JSONObject repository = new JSONObject(getJson(config.apiBase(), token, cancellation));
                ref = repository.optString("default_branch");
                if (ref.isEmpty()) throw new IOException("The repository has no default branch yet.");
            }
            JSONObject tree = readTree(config, ref, token, cancellation);
            if (!config.folder.isEmpty()) {
                for (String segment : config.folder.split("/")) {
                    JSONArray nodes = requireCompleteTree(tree);
                    String next = null;
                    for (int i = 0; i < nodes.length(); i++) {
                        JSONObject node = nodes.getJSONObject(i);
                        if (segment.equals(node.optString("path")) && "tree".equals(node.optString("type"))) {
                            next = node.optString("sha");
                            break;
                        }
                    }
                    if (next == null) throw new IOException("The folder changed while loading. Check the path or try Refresh.");
                    tree = readTree(config, next, token, cancellation);
                }
            }
            JSONArray nodes = requireCompleteTree(tree);
            List<ApkEntry> results = new ArrayList<ApkEntry>();
            Set<String> seen = new HashSet<String>();
            for (int i = 0; i < nodes.length(); i++) {
                cancellation.check();
                JSONObject node = nodes.getJSONObject(i);
                String mode = node.optString("mode");
                if (!"blob".equals(node.optString("type"))
                        || !("100644".equals(mode) || "100755".equals(mode))) continue;
                String name = node.optString("path");
                if (!isApkName(name)) continue;
                results.add(entry(name, folderPath(config, name), node.optString("sha"), node.optLong("size", -1)));
                if (!seen.add(name)) throw new IOException("GitHub returned duplicate filenames. Try Refresh.");
            }
            return sorted(results);
        } catch (JSONException e) {
            throw new IOException("GitHub returned an unreadable folder tree. Try Refresh.", e);
        }
    }

    private JSONObject readTree(RepoConfig config, String sha, String token, Cancellation cancellation)
            throws IOException, JSONException {
        return new JSONObject(getJson(config.apiBase() + "/git/trees/" + RepoConfig.encodeSegment(sha), token, cancellation));
    }

    private JSONArray requireCompleteTree(JSONObject tree) throws JSONException, IOException {
        if (tree.optBoolean("truncated", false)) {
            throw new IOException("GitHub could not return this entire folder. Move the APKs into a smaller folder.");
        }
        return tree.getJSONArray("tree");
    }

    private Listing sorted(List<ApkEntry> entries) {
        Collections.sort(entries, new Comparator<ApkEntry>() {
            @Override public int compare(ApkEntry left, ApkEntry right) {
                int result = left.name.compareToIgnoreCase(right.name);
                return result == 0 ? left.name.compareTo(right.name) : result;
            }
        });
        return new Listing(entries, null);
    }

    private static String folderPath(RepoConfig config, String name) {
        return config.folder.isEmpty() ? name : config.folder + "/" + name;
    }

    private static boolean isApkName(String name) {
        return name != null && name.length() > 4 && name.toLowerCase(Locale.US).endsWith(".apk")
                && name.indexOf('/') < 0 && name.indexOf('\\') < 0 && !RepoConfig.hasControl(name);
    }

    private static ApkEntry entry(String name, String path, String sha, long size) throws IOException {
        if (sha == null || !sha.matches("[a-fA-F0-9]{40}") || size < 0) {
            throw new IOException("GitHub returned incomplete APK metadata. Try Refresh.");
        }
        return new ApkEntry(name, path, sha.toLowerCase(Locale.US), size);
    }

    public File download(RepoConfig config, String token, ApkEntry selected, File directory,
                         Cancellation cancellation, Progress progress) throws IOException {
        String credential = validToken(token);
        cancellation.check();
        if (selected == null || !isApkName(selected.name)) {
            throw new IOException("Choose an APK from the current folder or Releases.");
        }
        final ApkEntry apk;
        final long maxBytes;
        if (selected.release) {
            if (selected.releaseAssetId <= 0
                    || !("releases/assets/" + selected.releaseAssetId).equals(selected.path)
                    || !selected.sha.matches("[a-f0-9]{40}")
                    || selected.releaseSha256 == null
                    || !selected.releaseSha256.matches("[a-f0-9]{64}")) {
                throw new IOException("This Release APK has invalid metadata. Refresh the list.");
            }
            validateReleaseUrl(config, selected.name, selected.releaseUrl);
            if (!selected.sha.equals(releaseStorageId(config,
                    selected.releaseAssetId, selected.releaseSha256))) {
                throw new IOException("This Release APK changed. Refresh the list.");
            }
            apk = selected;
            maxBytes = MAX_RELEASE_APK_BYTES;
        } else {
            if (!folderPath(config, selected.name).equals(selected.path)) {
                throw new IOException("Choose an APK from the current folder.");
            }
            apk = entry(selected.name, selected.path, selected.sha, selected.size);
            maxBytes = MAX_APK_BYTES;
        }
        if (apk.size == 0) throw new IOException("This APK file is empty. Upload a complete APK to GitHub.");
        if (apk.size > maxBytes) {
            throw new IOException(apk.release ? "This Release APK exceeds GitHub's 2 GiB asset limit."
                    : "This file exceeds GitHub's 100 MB download limit. Use a regular APK below that size.");
        }
        if ((!directory.isDirectory() && !directory.mkdirs()) || !directory.isDirectory()) {
            throw new IOException("There is no writable download folder on this device.");
        }
        if (directory.getUsableSpace() < apk.size + 2 * 1024 * 1024L) {
            throw new IOException("Not enough free space to download this APK. Free some space and try again.");
        }
        File part = File.createTempFile("download-", ".part", directory);
        File complete = new File(directory, apk.sha + ".apk");
        HttpURLConnection connection = null;
        try {
            String address = apk.release
                    ? (credential.isEmpty() ? apk.releaseUrl : config.apiBase() + "/releases/assets/" + apk.releaseAssetId)
                    : config.apiBase() + "/git/blobs/" + apk.sha;
            connection = open(address, credential, apk.release ? BINARY_ACCEPT : RAW_ACCEPT, cancellation);
            MessageDigest digest = apk.release ? sha256() : sha1();
            if (!apk.release) digest.update(("blob " + apk.size + "\0").getBytes("UTF-8"));
            long received = 0;
            byte[] buffer = new byte[32 * 1024];
            if (progress != null) progress.onProgress(0, apk.size);
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                int count;
                while ((count = in.read(buffer)) != -1) {
                    cancellation.check();
                    received += count;
                    if (received > apk.size || received > maxBytes) {
                        throw new IOException("The download is larger than the file listed on GitHub. Refresh and try again.");
                    }
                    out.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    if (progress != null) progress.onProgress(received, apk.size);
                }
                cancellation.check();
                out.getFD().sync();
            }
            if (received != apk.size) throw new IOException("The download was incomplete. Please try again.");
            if (!(apk.release ? apk.releaseSha256 : apk.sha).equals(hex(digest.digest()))) {
                throw new IOException("The downloaded file failed its integrity check. Refresh and try again.");
            }
            checkApkZip(part);
            cancellation.check();
            if (complete.exists() && !complete.delete()) {
                throw new IOException("The previous download could not be replaced. Restart the app and try again.");
            }
            if (!part.renameTo(complete)) throw new IOException("The downloaded APK could not be saved.");
            return complete;
        } catch (SocketTimeoutException e) {
            cancellation.check();
            throw new IOException("The GitHub download timed out. Please try again.", e);
        } catch (IOException e) {
            cancellation.check();
            throw e;
        } finally {
            if (connection != null) {
                cancellation.detach(connection);
                connection.disconnect();
            }
            if (part.exists()) part.delete();
        }
    }

    private static void checkApkZip(File file) throws IOException {
        try (ZipFile zip = new ZipFile(file)) {
            ZipEntry manifest = zip.getEntry("AndroidManifest.xml");
            if (manifest == null || manifest.isDirectory() || manifest.getSize() <= 0) {
                throw new IOException("This file is not a complete Android APK. Upload the APK itself, not a link or split bundle.");
            }
        } catch (ZipException e) {
            throw new IOException("This file is not an APK. Git LFS pointers, web pages and renamed files cannot be installed.", e);
        }
    }

    private String getJson(String address, String token, Cancellation cancellation) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = open(address, token, JSON_ACCEPT, cancellation);
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16 * 1024];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    cancellation.check();
                    if (out.size() + count > MAX_JSON_BYTES) {
                        throw new IOException("This GitHub folder is too large to load safely. Use a smaller APK folder.");
                    }
                    out.write(buffer, 0, count);
                }
                cancellation.check();
                return out.toString("UTF-8");
            }
        } catch (SocketTimeoutException e) {
            cancellation.check();
            throw new IOException("GitHub took too long to respond. Check the connection and try Refresh.", e);
        } catch (IOException e) {
            cancellation.check();
            throw e;
        } finally {
            if (connection != null) {
                cancellation.detach(connection);
                connection.disconnect();
            }
        }
    }

    private HttpURLConnection open(String address, String token, String accept, Cancellation cancellation)
            throws IOException {
        URL url = new URL(address);
        for (int redirects = 0; redirects <= 5; redirects++) {
            cancellation.check();
            validateHost(url);
            HttpURLConnection connection = factory.open(url);
            boolean retain = false;
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                connection.setUseCaches(false);
                connection.setRequestProperty("User-Agent", "APK-Shelf/1.0.2");
                connection.setRequestProperty("Accept", accept);
                connection.setRequestProperty("Accept-Encoding", "identity");
                if ("api.github.com".equalsIgnoreCase(url.getHost())) {
                    connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                    if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
                }
                cancellation.attach(connection);
                int status = connection.getResponseCode();
                cancellation.check();
                if (status == 200) {
                    retain = true;
                    return connection;
                }
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.isEmpty()) throw new IOException("GitHub returned an invalid download redirect.");
                    url = new URL(url, location);
                } else {
                    throw responseError(status, connection);
                }
            } finally {
                if (!retain) {
                    cancellation.detach(connection);
                    connection.disconnect();
                }
            }
        }
        throw new IOException("GitHub redirected this request too many times. Try again later.");
    }

    private static void validateHost(URL url) throws IOException {
        String host = url.getHost().toLowerCase(Locale.US);
        boolean trusted = "api.github.com".equals(host) || "raw.githubusercontent.com".equals(host)
                || "objects.githubusercontent.com".equals(host) || "media.githubusercontent.com".equals(host)
                || "github.com".equals(host) || "release-assets.githubusercontent.com".equals(host);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !trusted || url.getUserInfo() != null
                || (url.getPort() != -1 && url.getPort() != 443)) {
            throw new IOException("GitHub returned a download outside its trusted HTTPS hosts.");
        }
    }

    private static IOException responseError(int status, HttpURLConnection connection) {
        if (status == 401) return new IOException("GitHub rejected the access token. Check or remove it in Settings.");
        if (status == 429 || (status == 403 && "0".equals(connection.getHeaderField("X-RateLimit-Remaining")))) {
            return new IOException("GitHub's request limit has been reached. Wait for it to reset, or add a GitHub token in Settings.");
        }
        if (status == 403) return new IOException("GitHub refused access. The token may need Contents: read permission, or GitHub may be temporarily limiting requests.");
        if (status == 404) return new IOException("GitHub could not find this repository, branch, folder or file. Check Settings; private repositories need a token with Contents: read permission.");
        if (status == 409) return new IOException("This GitHub repository is empty. Upload an APK first.");
        if (status >= 500) return new IOException("GitHub is temporarily unavailable. Please try again later.");
        return new IOException("GitHub could not complete this request (HTTP " + status + "). Try Refresh.");
    }

    private static String validToken(String token) throws IOException {
        String value = token == null ? "" : token.trim();
        if (value.length() > 4096 || RepoConfig.hasControl(value)) {
            throw new IOException("The access token contains invalid characters. Enter it again in Settings.");
        }
        return value;
    }

    private static MessageDigest sha256() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IOException("This device does not provide SHA-256 integrity checking.", impossible);
        }
    }

    private static MessageDigest sha1() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-1");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IOException("This device does not provide the required integrity check.", impossible);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) text.append(String.format(Locale.US, "%02x", value & 0xff));
        return text.toString();
    }
}
