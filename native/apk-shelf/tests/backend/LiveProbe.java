package app.apkshelf.firetv;

import java.io.File;
import java.net.URI;

/** Optional read-only live check against the public default shelf. */
public final class LiveProbe {
    public static void main(String[] args) throws Exception {
        String proxy = System.getenv("HTTPS_PROXY");
        if (proxy != null && !proxy.isEmpty()) {
            URI address = new URI(proxy);
            System.setProperty("https.proxyHost", address.getHost());
            System.setProperty("https.proxyPort", Integer.toString(address.getPort()));
        }
        RepoConfig config = RepoConfig.fromInput("to-shreds/torbox-web-player", "native-updates", "native/updates/releases");
        GitHubClient client = new GitHubClient();
        GitHubClient.Listing listing = client.list(config, "", new GitHubClient.Cancellation());
        System.out.println("Live folder returned " + listing.entries.size() + " APK(s).");
        if (listing.entries.isEmpty()) throw new AssertionError("Default folder contains no APKs.");
        File directory = new File(args[0]);
        for (GitHubClient.ApkEntry entry : listing.entries) {
            if (entry.name.equals("TorBox-TV-0.2.4-test.apk")) {
                File downloaded = client.download(config, "", entry, directory, new GitHubClient.Cancellation(), null);
                System.out.println("PASS live GitHub list + raw Git blob download + exact size/hash + APK validation: " + downloaded.length() + " bytes.");
                if (!downloaded.delete()) throw new AssertionError("Could not remove live probe download.");
                return;
            }
        }
        throw new AssertionError("Expected known APK missing from default folder.");
    }
}
