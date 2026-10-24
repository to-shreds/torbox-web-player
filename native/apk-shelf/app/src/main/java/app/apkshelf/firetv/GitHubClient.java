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

        public ApkEntry(String name, String path, String sha, long size) {
            this.name = name;
            this.path = path;
            this.sha = sha;
            this.size = size;
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
        if (selected == null || !isApkName(selected.name)
                || !folderPath(config, selected.name).equals(selected.path)) {
            throw new IOException("Choose an APK from the current folder.");
        }
        ApkEntry apk = entry(selected.name, selected.path, selected.sha, selected.size);
        if (apk.size == 0) throw new IOException("This APK file is empty. Upload a complete APK to GitHub.");
        if (apk.size > MAX_APK_BYTES) {
            throw new IOException("This file exceeds GitHub's 100 MB download limit. Use a regular APK below that size.");
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
            connection = open(config.apiBase() + "/git/blobs/" + apk.sha, credential, RAW_ACCEPT, cancellation);
            MessageDigest digest = sha1();
            digest.update(("blob " + apk.size + "\0").getBytes("UTF-8"));
            long received = 0;
            byte[] buffer = new byte[32 * 1024];
            if (progress != null) progress.onProgress(0, apk.size);
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                int count;
                while ((count = in.read(buffer)) != -1) {
                    cancellation.check();
                    received += count;
                    if (received > apk.size || received > MAX_APK_BYTES) {
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
            if (!apk.sha.equals(hex(digest.digest()))) {
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
                connection.setRequestProperty("User-Agent", "APK-Shelf/1.0");
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
                || "objects.githubusercontent.com".equals(host) || "media.githubusercontent.com".equals(host);
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
