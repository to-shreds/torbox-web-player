package app.apkshelf.firetv;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;

/** A GitHub source. The ref is kept separate so branch names may contain slashes. */
public final class RepoConfig {
    public final String owner;
    public final String repo;
    public final String ref;
    public final String folder;

    private RepoConfig(String owner, String repo, String ref, String folder) {
        this.owner = owner;
        this.repo = repo;
        this.ref = ref;
        this.folder = folder;
    }

    public static RepoConfig fromInput(String repository, String branch, String directory) {
        String input = repository == null ? "" : repository.trim();
        if (input.startsWith("https://")) {
            try {
                URI uri = new URI(input);
                if (!"github.com".equalsIgnoreCase(uri.getHost()) || uri.getUserInfo() != null
                        || (uri.getPort() != -1 && uri.getPort() != 443)
                        || uri.getQuery() != null || uri.getFragment() != null) {
                    throw new IllegalArgumentException("Use a github.com repository URL without a query or fragment.");
                }
                input = uri.getPath();
            } catch (URISyntaxException e) {
                throw new IllegalArgumentException("Enter a repository as owner/name.");
            }
        }
        while (input.startsWith("/")) input = input.substring(1);
        while (input.endsWith("/")) input = input.substring(0, input.length() - 1);
        if (input.endsWith(".git")) input = input.substring(0, input.length() - 4);
        String[] parts = input.split("/", -1);
        if (parts.length != 2) {
            throw new IllegalArgumentException("Enter owner/repository. Put the branch and folder in their separate fields.");
        }
        if (!parts[0].matches("[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
                || !parts[1].matches("[A-Za-z0-9_.-]{1,100}")
                || ".".equals(parts[1]) || "..".equals(parts[1])) {
            throw new IllegalArgumentException("The GitHub owner or repository name is not valid.");
        }
        String ref = branch == null ? "" : branch.trim();
        if (ref.length() > 512 || hasControl(ref) || ref.indexOf(' ') >= 0
                || ref.indexOf('\\') >= 0 || ref.indexOf('~') >= 0 || ref.indexOf('^') >= 0
                || ref.indexOf(':') >= 0 || ref.indexOf('?') >= 0 || ref.indexOf('*') >= 0
                || ref.indexOf('[') >= 0 || ref.contains("..") || ref.contains("@{")
                || ref.contains("//") || ref.startsWith("/") || ref.endsWith("/")
                || ref.endsWith(".") || ref.endsWith(".lock") || "@".equals(ref)) {
            throw new IllegalArgumentException("Enter a valid branch, tag or commit. Leave it empty for the default branch.");
        }
        if (!ref.isEmpty()) {
            for (String segment : ref.split("/")) {
                if (segment.startsWith(".") || segment.endsWith(".lock")) {
                    throw new IllegalArgumentException("This branch or tag name is not valid.");
                }
            }
        }
        String folder = directory == null ? "" : directory.trim();
        while (folder.startsWith("/")) folder = folder.substring(1);
        while (folder.endsWith("/")) folder = folder.substring(0, folder.length() - 1);
        if (folder.length() > 2048 || hasControl(folder) || folder.indexOf('\\') >= 0) {
            throw new IllegalArgumentException("Enter a relative GitHub folder path using forward slashes.");
        }
        if (!folder.isEmpty()) {
            for (String segment : folder.split("/", -1)) {
                if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) {
                    throw new IllegalArgumentException("The folder cannot contain empty, dot or parent-directory segments.");
                }
            }
        }
        return new RepoConfig(parts[0], parts[1], ref, folder);
    }

    public String repository() {
        return owner + "/" + repo;
    }

    public String apiBase() {
        return "https://api.github.com/repos/" + encodeSegment(owner) + "/" + encodeSegment(repo);
    }

    public String contentsUrl() {
        String result = apiBase() + "/contents" + (folder.isEmpty() ? "" : "/" + encodePath(folder));
        return ref.isEmpty() ? result : result + "?ref=" + encodeSegment(ref);
    }

    public static String encodePath(String path) {
        StringBuilder out = new StringBuilder();
        for (String segment : path.split("/", -1)) {
            if (out.length() > 0) out.append('/');
            out.append(encodeSegment(segment));
        }
        return out.toString();
    }

    public static String encodeSegment(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20").replace("*", "%2A");
        } catch (UnsupportedEncodingException impossible) {
            throw new AssertionError(impossible);
        }
    }

    static boolean hasControl(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 || c == 0x7f) return true;
        }
        return false;
    }
}
