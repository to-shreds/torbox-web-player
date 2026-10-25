# APK Shelf 1.0.3 verification

## Scope

This release **only changes user-visible interface wording** in the existing Fire TV app and increments the Android version so it can be installed over the previous release. It does not change networking, GitHub Releases, SHA-1/SHA-256 download validation, package installer behavior, default repository or settings persistence.

- The standalone tagline **"Your GitHub folder, on your TV."** was removed, leaving the **APK Shelf** title and the configured repository.
- The repeated "Select to download and install" phrase was removed from each APK row. Rows now show filename, size and source (Repository file or Release: name).
- Excessively wordy loading, empty-list, status and cancellation messages were made concise. The bottom remote-control hint was shortened.
- The existing **Refresh**, **Folder settings**, **Allow installs**, **Install downloaded APK**, and standard system permission/installer controls remain.

## Build and integrity

- Implementation and manifest tested at public source commit **`7e3822dd038b3186775363e35742921bf27cd76e`**. Later changes to README, HANDOFF and release artifacts do not modify tested Java source.
- Android package **`app.apkshelf.firetv`**, versionName **1.0.3**, versionCode **4**.
- Signed APK **53,803 bytes**, SHA-256 **`b01efaab1e21485b0237c32593880ddd9825680e4319437f662c8ebf87f7d63e`**.
- Original APK Shelf signing certificate SHA-256 **`fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`**. Verified using Android SDK 35 `apksigner`, consistent with versions 1.0.0, 1.0.1, and 1.0.2. Version increment permits install-over updates.
- Preserved source archive **`APK-Shelf-1.0.3-source.zip`**, SHA-256 **`1c7fba247660a62bc255f8ba6b8f3f1829e224f43d129f3062d6ac0d97f66432`**.

## Automated tests

[Successful private CI run 40146682322](https://github.com/to-shreds/ProjectStatus/actions/runs/40146682322) performed all of the following:

- All **48 backend tests passed**, including GitHub repository and release metadata parsing, verification boundaries and download cancellation. Live GitHub Release metadata for the existing uploaded APKs was checked again; this cosmetic-only release did not re-download the 100 MB Baba file, which was already successfully downloaded and opened in Android's installer by version 1.0.2 (run 40145494609).
- On an accelerated **Android 11/API 30 emulator configured for a TV-sized screen**, installed previous signed **1.0.2** and confirmed its original tagline was visible. Then installed signed **1.0.3 over 1.0.2** and confirmed the tagline and repetitive per-row instruction were absent and the cleaned header/status/remote hint were present.
- Confirmed **`to-shreds/apks`** was still the configured repository and the normal-file and Release assets remained in the list. Verified remote Menu refresh, saved folder settings and the renamed **Fill defaults** settings button.
- Selected an actual TorBox repository APK, downloaded and checked its signature/hash/package integrity via the unchanged app, granted Android's unknown-app installation permission and reached the real system package installer. Cancelling the installer retained the verified download for retry. All acceptance checks passed.

## Publication and constraints

- Current signed installer: [direct download from the `to-shreds/apks` repository](https://raw.githubusercontent.com/to-shreds/apks/main/APK-Shelf-1.0.3.apk). Also preserved in `to-shreds/torbox-web-player/native/updates/releases/APK-Shelf-1.0.3.apk` and private ProjectStatus artifacts.
- The old 1.0.2 APK was removed from the user-facing `to-shreds/apks` **root** so that only the latest Shelf installer is offered there; its signed historical APK remains preserved separately.
- The user reported the previous version working on a physical Firestick. **Version 1.0.3 itself has not been physically tested**; Android emulator testing verified the upgrade and unchanged installer operation.
- Private GitHub Releases remain untested against a live private repository, and Vega OS, split APK bundles, silent installation and background polling remain unsupported.
