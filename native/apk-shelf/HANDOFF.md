# APK Shelf handoff

## Project goal and controlling sources

APK Shelf is a lightweight, native Fire TV app for viewing/downloading ordinary APKs from a GitHub repository's selected folder **and** its published Releases in one list and handing the APK to Android's regular installer. Newly uploaded APKs appear after Refresh, without rebuilding Shelf.

The source lives in [`to-shreds/torbox-web-player/native/apk-shelf`](https://github.com/to-shreds/torbox-web-player/tree/native-updates/native/apk-shelf) on the `native-updates` branch. **Current 1.0.3 implementation commit: `7e3822dd038b3186775363e35742921bf27cd76e`**. Later branch commits add docs/source snapshots and signed APK releases without changing the tested Android Java/manifest. Read the private [ProjectStatus record](https://github.com/to-shreds/ProjectStatus/blob/main/projects/apk-shelf/STATUS.md) first whenever continuing this project; it controls readiness.

## Current signed release (1.0.3)

- Android package **`app.apkshelf.firetv`**, `versionName=1.0.3`, `versionCode=4`, original certificate SHA-256 **`fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`**. Compatible with install-over updates of 1.0.0, 1.0.1 and 1.0.2.
- **Signed APK:** `native/updates/releases/APK-Shelf-1.0.3.apk` and `to-shreds/apks` repository root `APK-Shelf-1.0.3.apk`. SHA-256: **`b01efaab1e21485b0237c32593880ddd9825680e4319437f662c8ebf87f7d63e`**, 53,803 bytes. The root copy replaces the obsolete 1.0.2 root installer, which remains preserved in the original TorBox releases location and private artifacts.
- Source archive: `native/apk-shelf/APK-Shelf-1.0.3-source.zip`, SHA-256 **`1c7fba247660a62bc255f8ba6b8f3f1829e224f43d129f3062d6ac0d97f66432`**, produced from the pinned tested implementation before post-test documentation was updated.
- Default source remains **`to-shreds/apks`**, default branch (currently `main`), repository root, and all the same repository's published Releases. A saved custom source remains untouched.
- APK Shelf 1.0.3 removes the formerly visible tagline **"Your GitHub folder, on your TV."** and simplifies verbose row, navigation hint, empty-list and status copy. **Keep UI wording plain, compact, direct and functional. Do not reintroduce marketing copy, slogans or cutesy text.**
- Only UI wording/Android version changed from 1.0.2. The GitHub APIs, download integrity, installer, security and remote controls did not change.

## Existing behavior to preserve

- GitHub Contents/tree listing for direct-child .apk files and alphabetically combined list of published Release APK assets, retaining duplicates with their source labels.
- Large Release assets up to 2 GiB, SHA-256 asset digest and exact length validation; normal Git blobs up to about 100 MiB with Git SHA-1 validation. APK ZIP/Android manifest/platform package checks before installer. Keep strict TLS GitHub/CDN host validation and no forwarding the optional GitHub token to redirects.
- No extra permissions for broad storage access. One verified completed download may be retained through unknown-app install permission or installer cancellation; temporary files cleaned on failure/cancellation.
- TV-focused remote navigation, Refresh/Menu, Folder settings, Allow installs, custom repo/branch/folder and Android Keystore-encrypted optional read-only private GitHub token.
- No silent installs, browser/WebView, background polling, Vega OS, APK split bundles, Git LFS pointers or GitHub Release assets without published SHA-256 digests. Live private Release downloads remain unverified even though authenticated API routing passed mocked backend tests.
- Keep APK Shelf **separate** from TorBox TV and the web player; do not change TorBox `native/updates/latest.json` or the site's `main` branch when maintaining Shelf.

## Testing and evidence

- [Successful 1.0.3 CI test run 40146682322](https://github.com/to-shreds/ProjectStatus/actions/runs/40146682322): 48 backend tests, live GitHub release metadata, pinned 1.0.3 signed with original key, and accelerated Android 11 TV emulator tests. Emulator displayed old version 1.0.2 tagline before installing 1.0.3 over it; verified new tagline-free header, concise row labels/status, combined root+Release listing, Menu refresh, saved settings, actual APK download, unknown-app permission and real Android installer with cancel/retained file.
- Previous [1.0.2 run 40145494609](https://github.com/to-shreds/ProjectStatus/actions/runs/40145494609) downloaded the **full 100,240,046-byte** `baba-is-you617.apk` from the user's real GitHub Release, passed SHA-256 and APK checks, and opened Android's system installer. 1.0.3 does not alter this tested implementation.
- The user confirmed the prior APK Shelf version **works on their physical Firestick**. They have not yet specifically tested the 1.0.3 update. See `docs/VERIFICATION-1.0.3.md`, `docs/VERIFICATION-1.0.2.md` and older records.

## Signing and continuation safety

- **Original private signing key backup:** `to-shreds/ProjectStatus/projects/apk-shelf/private/APK-Shelf-Signing-Backup.zip`. Never publish the key, password, or backup, nor expose them to chat/logs. Private CI accesses it only during signing.
- Keep the package and signing identity; for any future release increase `versionCode`. Update the exact APK and source outputs in private ProjectStatus artifacts, public releases and `to-shreds/apks` root, and finalize ProjectStatus STATUS.md **last**.
- Removing the prior Shelf installer from the user-facing root avoids presenting obsolete Shelf versions. Historical versions remain available privately and in the original release directory.

## Next action

On the physical Firestick with a prior APK Shelf version installed, select Refresh, choose **APK-Shelf-1.0.3.apk** in `to-shreds/apks`, and approve the install-over update. Confirm the unwanted tagline is gone. No further code work is required unless the user reports another issue.
