package app.apkshelf.firetv;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Dependency-free test runner. org.json is needed only on the host JVM. */
public final class BackendTests {
    private static int passed;
    private static final String SHA = "0123456789abcdef0123456789abcdef01234567";
    private static final RepoConfig CONFIG = RepoConfig.fromInput("owner/repo", "feature/a", "apks");
    private interface Task { void run() throws Exception; }

    public static void main(String[] args) throws Exception {
        test("owner/repo config and slash ref encoding", new Task() { public void run() {
            eq("owner", CONFIG.owner); eq("repo", CONFIG.repo);
            eq("https://api.github.com/repos/owner/repo/contents/apks?ref=feature%2Fa", CONFIG.contentsUrl());
        }});
        test("repository URL and default branch", new Task() { public void run() {
            RepoConfig config = RepoConfig.fromInput(" https://github.com/org/repository.git/ ", "", "/");
            eq("org/repository", config.repository()); eq("", config.folder);
            eq("https://api.github.com/repos/org/repository/contents", config.contentsUrl());
        }});
        test("Unicode and spaces encode as path data", new Task() { public void run() {
            RepoConfig config = RepoConfig.fromInput("org/repo", "release/v1", "a b/café");
            check(config.contentsUrl().contains("a%20b/caf%C3%A9?ref=release%2Fv1"));
        }});
        final String[][] invalid = {
            {"owner/repo/tree/main/apks", "", ""}, {"owner/repo", "main", "a/../b"},
            {"owner/repo", "main", "a//b"}, {"owner/repo", "main\nx", ""},
            {"owner/repo", "release/../main", ""}, {"https://user@github.com/o/r", "", ""},
            {"https://example.com/o/r", "", ""}, {"https://github.com/o/r?token=x", "", ""},
            {"owner/repo", "a?ref=b", ""}, {"owner/repo", "main", "a\\b"},
            {"owner/repo", "release/a.lock", ""}, {"owner/repo", "a/.hidden", ""}
        };
        for (int i = 0; i < invalid.length; i++) {
            final String[] input = invalid[i];
            test("invalid source " + i, new Task() { public void run() throws Exception {
                fails(IllegalArgumentException.class, "", new Task() { public void run() {
                    RepoConfig.fromInput(input[0], input[1], input[2]);
                }});
            }});
        }
        test("contents filters files, sorts, skips symlinks/submodules", new Task() { public void run() throws Exception {
            JSONArray items = new JSONArray();
            items.put(item("z.apk", "file", 10)); items.put(item("A.APK", "file", 20));
            items.put(item("text.txt", "file", 1)); items.put(item("dir.apk", "dir", 0));
            items.put(item("link.apk", "symlink", 2));
            items.put(item("sub.apk", "file", 1).put("submodule_git_url", "git://example.test"));
            MockFactory factory = new MockFactory().add(200, new JSONObject().put("entries", items).toString());
            GitHubClient.Listing listing = new GitHubClient(factory).list(CONFIG, "test-secret", new GitHubClient.Cancellation());
            eq(2, listing.entries.size()); eq("A.APK", listing.entries.get(0).name);
            eq("Bearer test-secret", factory.connections.get(0).getRequestProperty("Authorization"));
            eq("2022-11-28", factory.connections.get(0).getRequestProperty("X-GitHub-Api-Version"));
        }});
        test("empty array listing", new Task() { public void run() throws Exception {
            MockFactory factory = new MockFactory().add(200, "[]");
            eq(0, new GitHubClient(factory).list(CONFIG, "", new GitHubClient.Cancellation()).entries.size());
        }});
        test("file instead of folder rejected", new Task() { public void run() throws Exception {
            final GitHubClient client = new GitHubClient(new MockFactory().add(200, "{\"type\":\"file\"}"));
            fails(IOException.class, "points to a file", new Task() { public void run() throws Exception { client.list(CONFIG, "", new GitHubClient.Cancellation()); }});
        }});
        test("wrong folder returned rejected", new Task() { public void run() throws Exception {
            final GitHubClient client = new GitHubClient(new MockFactory().add(200,
                new JSONArray().put(item("a.apk", "file", 10).put("path", "other/a.apk")).toString()));
            fails(IOException.class, "outside", new Task() { public void run() throws Exception { client.list(CONFIG, "", new GitHubClient.Cancellation()); }});
        }});
        test("thousand-entry list falls back to complete subtree", new Task() { public void run() throws Exception {
            JSONArray contents = new JSONArray();
            for (int i = 0; i < 1000; i++) contents.put(item("readme" + i, "file", 1));
            JSONObject root = tree(new JSONArray().put(new JSONObject().put("path", "apks").put("type", "tree").put("sha", SHA)));
            JSONObject apk = new JSONObject().put("path", "b.apk").put("type", "blob").put("mode", "100644").put("sha", SHA).put("size", 123);
            JSONObject link = new JSONObject().put("path", "link.apk").put("type", "blob").put("mode", "120000").put("sha", SHA).put("size", 20);
            MockFactory factory = new MockFactory().add(200, contents.toString()).add(200, root.toString())
                .add(200, tree(new JSONArray().put(apk).put(link)).toString());
            GitHubClient.Listing result = new GitHubClient(factory).list(CONFIG, "", new GitHubClient.Cancellation());
            eq(1, result.entries.size()); eq("b.apk", result.entries.get(0).name); eq(3, factory.connections.size());
            check(factory.connections.get(1).getURL().toString().endsWith("/git/trees/feature%2Fa"));
        }});
        test("truncated fallback tree rejected rather than silently omitted", new Task() { public void run() throws Exception {
            JSONArray contents = new JSONArray(); for (int i = 0; i < 1000; i++) contents.put(new JSONObject());
            final GitHubClient client = new GitHubClient(new MockFactory().add(200, contents.toString())
                .add(200, tree(new JSONArray()).put("truncated", true).toString()));
            fails(IOException.class, "entire folder", new Task() { public void run() throws Exception { client.list(CONFIG, "", new GitHubClient.Cancellation()); }});
        }});
        test("trusted redirect never forwards credential", new Task() { public void run() throws Exception {
            MockFactory factory = new MockFactory().addRedirect("https://raw.githubusercontent.com/owner/repo/metadata.json").add(200, "[]");
            new GitHubClient(factory).list(CONFIG, "secret", new GitHubClient.Cancellation());
            eq("Bearer secret", factory.connections.get(0).getRequestProperty("Authorization"));
            eq(null, factory.connections.get(1).getRequestProperty("Authorization"));
        }});
        for (final String target : new String[] {"http://api.github.com/repos/o/r", "https://attacker.test/file", "https://api.github.com:444/file", "https://u@api.github.com/file"}) {
            test("unsafe redirect rejected: " + target, new Task() { public void run() throws Exception {
                final MockFactory factory = new MockFactory().addRedirect(target);
                fails(IOException.class, "trusted HTTPS", new Task() { public void run() throws Exception { new GitHubClient(factory).list(CONFIG, "secret", new GitHubClient.Cancellation()); }});
                eq(1, factory.connections.size());
            }});
        }
        test("HTTP errors actionable", new Task() { public void run() throws Exception {
            for (final int status : new int[] {401, 403, 404, 409, 429, 503}) {
                final GitHubClient client = new GitHubClient(new MockFactory().add(status, ""));
                fails(IOException.class, "GitHub", new Task() { public void run() throws Exception { client.list(CONFIG, "", new GitHubClient.Cancellation()); }});
            }
        }});
        test("API header injection token rejected", new Task() { public void run() throws Exception {
            final GitHubClient client = new GitHubClient(new MockFactory());
            fails(IOException.class, "invalid characters", new Task() { public void run() throws Exception { client.list(CONFIG, "foo\r\nInjected: x", new GitHubClient.Cancellation()); }});
        }});
        test("verified immutable download", new Task() { public void run() throws Exception {
            byte[] bytes = apkZip(true); String sha = blobSha(bytes);
            MockFactory factory = new MockFactory().add(200, bytes);
            File dir = temporary();
            try {
                File result = new GitHubClient(factory).download(CONFIG, "", selected(bytes, sha), dir, new GitHubClient.Cancellation(), null);
                eq(sha + ".apk", result.getName()); check(Arrays.equals(bytes, Files.readAllBytes(result.toPath())));
                check(factory.connections.get(0).getURL().toString().endsWith("/git/blobs/" + sha));
                eq(1, dir.list().length); check(factory.connections.get(0).disconnected);
            } finally { cleanup(dir); }
        }});
        test("same-size corruption fails hash and cleans partial", new Task() { public void run() throws Exception {
            byte[] bytes = apkZip(true); final byte[] damaged = bytes.clone(); damaged[damaged.length / 2] ^= 1;
            rejectedDownload(damaged, selected(bytes, blobSha(bytes)), "integrity");
        }});
        test("truncated transfer rejected and cleaned", new Task() { public void run() throws Exception {
            byte[] bytes = apkZip(true); rejectedDownload(Arrays.copyOf(bytes, bytes.length - 1), selected(bytes, blobSha(bytes)), "incomplete");
        }});
        test("oversized transfer rejected and cleaned", new Task() { public void run() throws Exception {
            byte[] bytes = apkZip(true); rejectedDownload(Arrays.copyOf(bytes, bytes.length + 1), selected(bytes, blobSha(bytes)), "larger");
        }});
        test("Git LFS pointer rejected despite matching hash", new Task() { public void run() throws Exception {
            byte[] bytes = "version https://git-lfs.github.com/spec/v1\noid sha256:ab\nsize 123\n".getBytes("UTF-8");
            rejectedDownload(bytes, selected(bytes, blobSha(bytes)), "Git LFS");
        }});
        test("ZIP without Android manifest rejected", new Task() { public void run() throws Exception {
            byte[] bytes = apkZip(false); rejectedDownload(bytes, selected(bytes, blobSha(bytes)), "complete Android APK");
        }});
        test("above limit rejected before HTTP", new Task() { public void run() throws Exception {
            final MockFactory factory = new MockFactory(); final File dir = temporary();
            try { fails(IOException.class, "100 MB", new Task() { public void run() throws Exception {
                new GitHubClient(factory).download(CONFIG, "", new GitHubClient.ApkEntry("a.apk", "apks/a.apk", SHA, GitHubClient.MAX_APK_BYTES + 1), dir, new GitHubClient.Cancellation(), null);
            }}); eq(0, factory.connections.size()); } finally { cleanup(dir); }
        }});
        test("cancellation before request", new Task() { public void run() throws Exception {
            final MockFactory factory = new MockFactory(); final GitHubClient.Cancellation cancellation = new GitHubClient.Cancellation(); cancellation.cancel();
            fails(InterruptedIOException.class, "cancelled", new Task() { public void run() throws Exception { new GitHubClient(factory).list(CONFIG, "", cancellation); }});
            eq(0, factory.connections.size());
        }});
        test("cancel during transfer disconnects and removes partial", new Task() { public void run() throws Exception {
            final byte[] bytes = apkZip(true); final GitHubClient.Cancellation cancellation = new GitHubClient.Cancellation();
            final MockFactory factory = new MockFactory().add(200, bytes); final File dir = temporary();
            try {
                fails(InterruptedIOException.class, "cancelled", new Task() { public void run() throws Exception {
                    new GitHubClient(factory).download(CONFIG, "", selected(bytes, blobSha(bytes)), dir, cancellation, new GitHubClient.Progress() {
                        public void onProgress(long received, long total) { if (received > 0) cancellation.cancel(); }
                    });
                }});
                eq(0, dir.list().length); check(factory.connections.get(0).disconnected);
            } finally { cleanup(dir); }
        }});
        System.out.println("PASS: " + passed + " backend tests");
    }

    private static JSONObject item(String name, String type, long size) {
        return new JSONObject().put("name", name).put("path", "apks/" + name).put("type", type).put("size", size).put("sha", SHA);
    }
    private static JSONObject tree(JSONArray nodes) { return new JSONObject().put("truncated", false).put("tree", nodes); }
    private static byte[] apkZip(boolean manifest) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) { zip.putNextEntry(new ZipEntry(manifest ? "AndroidManifest.xml" : "readme.txt")); zip.write("test manifest fixture".getBytes("UTF-8")); zip.closeEntry(); }
        return bytes.toByteArray();
    }
    private static GitHubClient.ApkEntry selected(byte[] bytes, String sha) { return new GitHubClient.ApkEntry("test.apk", "apks/test.apk", sha, bytes.length); }
    private static String blobSha(byte[] bytes) throws Exception {
        MessageDigest hash = MessageDigest.getInstance("SHA-1"); hash.update(("blob " + bytes.length + "\0").getBytes("UTF-8")); hash.update(bytes);
        StringBuilder out = new StringBuilder(); for (byte b : hash.digest()) out.append(String.format(Locale.US, "%02x", b & 255)); return out.toString();
    }
    private static void rejectedDownload(final byte[] response, final GitHubClient.ApkEntry entry, String message) throws Exception {
        final File dir = temporary();
        try { fails(IOException.class, message, new Task() { public void run() throws Exception {
            new GitHubClient(new MockFactory().add(200, response)).download(CONFIG, "", entry, dir, new GitHubClient.Cancellation(), null);
        }}); eq(0, dir.list().length); } finally { cleanup(dir); }
    }
    private static File temporary() throws IOException { return Files.createTempDirectory("apkshelf-test-").toFile(); }
    private static void cleanup(File dir) { for (File file : dir.listFiles()) file.delete(); dir.delete(); }
    private static void test(String label, Task task) throws Exception { try { task.run(); passed++; System.out.println("PASS " + label); } catch (Throwable e) { System.err.println("FAIL " + label); throw e; } }
    private static void eq(Object expected, Object actual) { if (!Objects.equals(expected, actual)) throw new AssertionError("Expected " + expected + "; got " + actual); }
    private static void check(boolean value) { if (!value) throw new AssertionError("Check failed"); }
    private static void fails(Class<? extends Throwable> type, String message, Task task) throws Exception {
        try { task.run(); } catch (Throwable failure) { if (!type.isInstance(failure) || (failure.getMessage() != null && !failure.getMessage().contains(message))) throw new AssertionError("Unexpected failure: " + failure, failure); return; }
        throw new AssertionError("Expected " + type.getName());
    }

    private static final class MockFactory implements GitHubClient.ConnectionFactory {
        final List<MockConnection> connections = new ArrayList<MockConnection>();
        final List<Response> responses = new ArrayList<Response>();
        MockFactory add(int code, String body) throws UnsupportedEncodingException { return add(code, body.getBytes("UTF-8")); }
        MockFactory add(int code, byte[] body) { responses.add(new Response(code, body, null)); return this; }
        MockFactory addRedirect(String location) { responses.add(new Response(302, new byte[0], location)); return this; }
        public HttpURLConnection open(URL url) {
            if (connections.size() >= responses.size()) throw new AssertionError("Unexpected network request: " + url);
            MockConnection connection = new MockConnection(url, responses.get(connections.size())); connections.add(connection); return connection;
        }
    }
    private static final class Response { final int code; final byte[] body; final String location; Response(int c, byte[] b, String l) {code = c; body = b; location = l;} }
    private static final class MockConnection extends HttpURLConnection {
        final Response response; boolean disconnected;
        MockConnection(URL url, Response response) { super(url); this.response = response; }
        public int getResponseCode() { return response.code; }
        public String getHeaderField(String key) { return "Location".equals(key) ? response.location : null; }
        public InputStream getInputStream() { return new ByteArrayInputStream(response.body); }
        public void disconnect() { disconnected = true; }
        public boolean usingProxy() { return false; }
        public void connect() {}
    }
}
