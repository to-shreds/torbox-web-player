# APK Shelf

A small native Android / Fire TV utility: put ordinary APK files in a GitHub folder, open APK Shelf on the TV, and select a file to download and install it.

## Using the app

1. Install **[APK Shelf 1.0.2](https://raw.githubusercontent.com/to-shreds/torbox-web-player/native-updates/native/updates/releases/APK-Shelf-1.0.2.apk)** on Fire TV. It can install directly over an existing 1.0.0 or 1.0.1 installation using the same signing certificate.
2. Open APK Shelf. It defaults to **[to-shreds/apks](https://github.com/to-shreds/apks)**, using its default branch and repository root.
3. For smaller apps, upload a normal `.apk` to that repository's root using **Add file → Upload files** (GitHub website limit: 25 MiB).
4. For larger apps, open **[Releases](https://github.com/to-shreds/apks/releases)**, choose an existing release such as **Apk library → Edit**, and attach the `.apk` file as a release asset. You can also publish a new release. GitHub supports release assets up to 2 GiB each.
5. On the Fire TV, select **Refresh**, select the desired file from the combined list, and confirm Android's **Install** prompt.

Each row identifies a **Repository file** or **Release: [release name]**. All published, non-draft releases in the configured repository are searched; the branch/folder setting applies only to normal repository files. You do **not** need to rebuild APK Shelf every time you upload another APK, whether it was uploaded normally or as a release asset.

The first time, allow APK Shelf under **Settings > My Fire TV > Developer Options > Install unknown apps**. The app has an **Allow installs** button to help. Some Fire OS versions use different wording or open the main settings screen instead. If Developer Options is hidden, open **About**, highlight the device name, and press Select seven times. Older devices use a global **Apps from Unknown Sources** setting.

The default repository is **public**. Only upload software you have the right to redistribute publicly. No GitHub token is needed for its APKs or release assets.

## A different folder

Open **Folder settings** and enter:

| Setting | Value |
| --- | --- |
| Repository | `owner/repository`, or the root `https://github.com/owner/repository` URL |
| Branch or tag | A branch, tag, or commit; leave blank for the repository's default branch |
| Folder | A relative folder path such as `apks`; leave blank for the root |
| GitHub token | Optional; needed for a private repository |

Version 1.0.1 also moves the original 1.0.0 default folder to `to-shreds/apks` when upgrading an existing installation. A separately configured source is preserved.

Branch and folder are separate to support branch names containing slashes. APKs directly in the selected folder are listed alongside APK assets from that repository's published Releases, sorted alphabetically. Subfolders are not searched. Settings are saved on the device.

For a private repository, use a fine-grained personal access token restricted to that repository with **Contents: read**. The token is encrypted with Android Keystore, never embedded in the app or source, and sent only to `api.github.com`; release asset downloads request the authenticated GitHub API asset endpoint. Private release-asset behavior has not been tested on a private live repository. Private tokens require Android API 23 or later, which includes Fire OS 6 and later. Public repositories work on Fire OS 5.

## Controls and behavior

- Up/down selects a file; Select downloads it and opens the installer.
- The Menu key refreshes the list.
- Back cancels an active request/download, or exits when idle.
- Downloads stop safely if the app leaves the screen. Select the file again to restart.
- A completed download is retained for installation after granting permission or returning from Settings. At most one completed download is kept.
- Uploading another version and selecting Refresh updates the list. New files do not require a new APK Shelf build.
- The installer still decides whether an APK is compatible and whether its signature/version can update an already installed app. The utility never installs silently or uninstalls anything.

## Limits

Ordinary standalone `.apk` files are supported. Split packages (`.apks`, `.xapk`), Git LFS pointers and other installers are not supported. For regular repository files GitHub's website upload limit is 25 MiB and its repository blob limit is about 100 MB. **GitHub Release APK assets may be up to 2 GiB each.** Only assets with a published GitHub SHA-256 digest are shown, so every Release download has a verifiable checksum.

APK Shelf checks the expected byte count, Git SHA-1 blob digest for repository files or SHA-256 for Release assets, ZIP/APK manifest, and Android's APK preflight before opening the native installer. Large installs require enough free internal storage for both the APK download and installation. Release assets are downloaded from GitHub's approved HTTPS hosts; any GitHub access token is sent only to `api.github.com`, not to redirect destinations.

The app loads Release metadata for the configured repository as well as the selected repository folder. It limits Releases pagination to 500 releases and 1,000 assets per release and warns when that limit is reached. Private Release downloads have been unit-tested but not tested against a real private GitHub repository. New files appear after manually selecting Refresh; no background polling occurs. Public unauthenticated API use normally has a limit of 60 requests per hour per IP.

This is for Android-based Fire OS devices, including the Fire TV Stick 4K Plus. Vega OS devices cannot run Android APKs. No Google Play Services, browser component, account server, analytics, advertising SDK, background service, or broad storage permission is used.

## Build and maintenance

Package: `app.apkshelf.firetv`. Version: `1.0.2` / code `3`. Minimum Android API: 22. Target/compile API: 35. Native Java with platform widgets and networking; no external application runtime dependencies.

See [tools/README.md](tools/README.md) for the direct JDK/Android SDK build, [docs/VERIFICATION-1.0.2.md](docs/VERIFICATION-1.0.2.md) for Release support verification and physical Fire TV limits (earlier records remain in [VERIFICATION-1.0.1.md](docs/VERIFICATION-1.0.1.md) and [VERIFICATION.md](docs/VERIFICATION.md)), and [HANDOFF.md](HANDOFF.md) for continuation state. The release signing key is backed up separately in the private project records; it is deliberately excluded from this source archive. Preserve that key and package name for future updates.

## Official references

- [Amazon Fire OS versions and devices](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html)
- [GitHub folder listings and limits](https://docs.github.com/en/rest/repos/contents)
- [GitHub Git blob downloads](https://docs.github.com/en/rest/git/blobs)
- [GitHub file size limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [GitHub API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Android package installation permission](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())
- [Android content-provider URI grants](https://developer.android.com/guide/topics/manifest/provider-element)
