# APK Shelf

A small native Android / Fire TV utility: put ordinary APK files in a GitHub folder, open APK Shelf on the TV, and select a file to download and install it.

## Using the app

1. Install `APK-Shelf-1.0.0.apk` on the Fire TV once using your usual sideloading method.
2. Open APK Shelf. Its starting folder is `to-shreds/torbox-web-player`, branch `native-updates`, folder `native/updates/releases`.
3. Upload an APK to [that GitHub folder](https://github.com/to-shreds/torbox-web-player/tree/native-updates/native/updates/releases), then select **Refresh** on the TV. GitHub's **Add file > Upload files** works for files up to 25 MiB.
4. Select an APK. APK Shelf downloads and verifies it, then opens the normal system installer. Confirm installation there.

The first time, allow APK Shelf under **Settings > My Fire TV > Developer Options > Install unknown apps**. The app has an **Allow installs** button to help. Some Fire OS versions use different wording or open the main settings screen instead. If Developer Options is hidden, open **About**, highlight the device name, and press Select seven times. Older devices use a global **Apps from Unknown Sources** setting.

The folder is public. Upload only files you intend to make publicly downloadable. The app does not require a GitHub token for this folder.

## A different folder

Open **Folder settings** and enter:

| Setting | Value |
| --- | --- |
| Repository | `owner/repository`, or the root `https://github.com/owner/repository` URL |
| Branch or tag | A branch, tag, or commit; leave blank for the repository's default branch |
| Folder | A relative folder path such as `apks`; leave blank for the root |
| GitHub token | Optional; needed for a private repository |

Branch and folder are separate to support branch names containing slashes. APKs in the selected folder are listed alphabetically; subfolders are not searched. Settings are saved on the device.

For a private repository, use a fine-grained personal access token restricted to that repository with **Contents: read**. The token is encrypted with Android Keystore, never embedded in the app or source, and sent only to `api.github.com`. Private tokens require Android API 23 or later, which includes Fire OS 6 and later. Public folders also work on Fire OS 5.

## Controls and behavior

- Up/down selects a file; Select downloads it and opens the installer.
- The Menu key refreshes the list.
- Back cancels an active request/download, or exits when idle.
- Downloads stop safely if the app leaves the screen. Select the file again to restart.
- A completed download is retained for installation after granting permission or returning from Settings. At most one completed download is kept.
- Uploading another version and selecting Refresh updates the list. New files do not require a new APK Shelf build.
- The installer still decides whether an APK is compatible and whether its signature/version can update an already installed app. The utility never installs silently or uninstalls anything.

## Limits

This version supports regular, self-contained `.apk` files in GitHub repository folders. It does not install `.xapk`/`.apks` bundles or fetch Git LFS pointers. GitHub's browser upload limit is 25 MiB; regular repository files and the Git blob download endpoint are limited to about 100 MB. For a larger file, use another distribution method. Public unauthenticated API use is normally limited to 60 requests per hour per IP, so the app refreshes only on opening or user request.

This is for Android-based Fire OS devices, including Jon's Fire TV Stick 4K Plus. Vega OS devices cannot run Android APKs. No Google Play Services, browser component, account server, analytics, advertising SDK, background service, or broad storage permission is used.

## Build and maintenance

Package: `app.apkshelf.firetv`. Version: `1.0.0` / code `1`. Minimum Android API: 22. Target/compile API: 35. Native Java with platform widgets and networking; no external application runtime dependencies.

See [tools/README.md](tools/README.md) for the direct JDK/Android SDK build, [docs/VERIFICATION.md](docs/VERIFICATION.md) for actual checks and remaining device acceptance, and [HANDOFF.md](HANDOFF.md) for continuation state. The release signing key is backed up separately in the private project records; it is deliberately excluded from this source archive. Preserve that key and package name for future updates.

## Official references

- [Amazon Fire OS versions and devices](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html)
- [GitHub folder listings and limits](https://docs.github.com/en/rest/repos/contents)
- [GitHub Git blob downloads](https://docs.github.com/en/rest/git/blobs)
- [GitHub file size limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [GitHub API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Android package installation permission](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())
- [Android content-provider URI grants](https://developer.android.com/guide/topics/manifest/provider-element)
