package app.apkshelf.firetv;

import java.io.File;
import java.net.URI;

/** Live read-only test against the user's two published APK release assets. */
public final class LiveReleaseProbe {
    public static void main(String[] args) throws Exception {
        String proxy = System.getenv("HTTPS_PROXY");
        if (proxy != null && !proxy.isEmpty()) {
            URI address = new URI(proxy);
            System.setProperty("https.proxyHost", address.getHost());
            System.setProperty("https.proxyPort", Integer.toString(address.getPort()));
        }
        RepoConfig config = RepoConfig.fromInput("to-shreds/apks", "", "");
        GitHubClient client = new GitHubClient();
        GitHubClient.Listing listing = client.listAll(config, "", new GitHubClient.Cancellation());
        if (listing.warning != null) throw new AssertionError("Release list warning: " + listing.warning);
        GitHubClient.ApkEntry baba = null;
        GitHubClient.ApkEntry torbox = null;
        for (GitHubClient.ApkEntry entry : listing.entries) {
            System.out.println((entry.release ? "RELEASE " : "FOLDER ") + entry.name
                    + " bytes=" + entry.size + " SHA256=" + entry.releaseSha256);
            if ("baba-is-you617.apk".equals(entry.name)) baba = entry;
            if ("TorBox-TV-0.2.5-test-separate.apk".equals(entry.name)) torbox = entry;
        }
        if (baba == null || !baba.release || baba.size != 100240046L
                || !"7cf64f53028c645b4c78506454dd934afb73a8bf4a48bf1bf29f3793a7ec8ac7".equals(baba.releaseSha256)) {
            throw new AssertionError("Expected 100 MB Baba Is You release asset was not discovered.");
        }
        if (torbox == null || !torbox.release || torbox.size != 7329790L
                || !"7c76e56c60904ac041db0da87fca112268dd24a3a61256f400d0b6b7c1bb700b".equals(torbox.releaseSha256)) {
            throw new AssertionError("Expected TorBox release asset was not discovered.");
        }
        System.out.println("PASS both actual published release APKs discovered with exact SHA256 metadata");
        if (args.length == 0) return;
        File directory = new File(args[0]);
        for (GitHubClient.ApkEntry entry : new GitHubClient.ApkEntry[]{torbox, baba}) {
            File file = client.download(config, "", entry, directory, new GitHubClient.Cancellation(),
                    new GitHubClient.Progress() {
                        long last;
                        @Override public void onProgress(long done, long total) {
                            if (done == total || done - last >= 10 * 1024 * 1024) {
                                System.out.println("DOWNLOAD " + entry.name + " " + done + "/" + total);
                                last = done;
                            }
                        }
                    });
            if (file.length() != entry.size) throw new AssertionError("Wrong release file size");
            if (!file.delete()) throw new AssertionError("Could not remove verified test download");
            System.out.println("PASS real GitHub Release HTTPS download, SHA256 and APK ZIP preflight: "
                    + entry.name + " " + entry.size + " bytes");
        }
    }
}
