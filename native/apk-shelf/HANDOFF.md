# APK Shelf handoff

## Goal and controlling sources

A separate, lightweight native Fire TV app lists ordinary APK files placed in a configurable GitHub folder, downloads them and opens the system package installer. Uploading a new APK and choosing Refresh must work without changing the utility.

The current implementation is `native/apk-shelf/` in `to-shreds/torbox-web-player`, branch `native-updates`. Version 1.0.1 Java/manifest code is commit `f07e96069b59bc3f1bb7375cc9a7dd6a5d2be3af`; later branch commits add release documentation and the built APK. The private `to-shreds/ProjectStatus/projects/apk-shelf/STATUS.md` controls readiness and next steps. Read that file first when resuming.

## Current release

- **1.0.1 / versionCode 2**, package `app.apkshelf.firetv`, original APK Shelf signing certificate SHA-256 `fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`.
- Default repository **`to-shreds/apks`**, default branch (currently `main`) and repository root. This public repository was initialized with a README. Any ordinary APK uploaded directly to its root is shown after Refresh.
- Original version 1.0.0 default was `to-shreds/torbox-web-player` on `native-updates` in `native/updates/releases`. The upgrade changes that *saved original default triple* to the new source; other saved/custom sources are preserved. New installations use the new default immediately.
- Signed binary: `native/updates/releases/APK-Shelf-1.0.1.apk`. SHA-256: `137b7cbdfcde64a8a500924c6eda7528bfdf7f67d17a896a2763b2734641eac6`. The existing TorBox TV and APK Shelf 1.0.0 files remain intact for historical and update purposes.
- Java Activity/widgets and platform networking, no WebView, background services, AndroidX or Google Services. Access optional private repositories via an Android Keystore-encrypted token.
- GitHub API direct-child listing, 1,000-item tree fallback, immutable Git blob download with size/SHA check, native APK preflight, private read-only provider, system permission/install flow, cancellation and installer retry.

## Tests and evidence

- Original 1.0.0 passed 37 backend test groups and a full Android installer/remote/navigation check. See `docs/VERIFICATION.md`.
- 1.0.1 was rebuilt with the **same private APK Shelf signing key**, signed and validated with Android build tools 35, JDK 17, versionCode 2 and the unchanged certificate. The backend logic and permissions are unchanged.
- [Accelerated Android run 40121081573](https://github.com/to-shreds/ProjectStatus/actions/runs/40121081573) succeeded on Android 11/API 30: fresh install pointed to `to-shreds/apks` with zero APKs (README filtered out); upgrade over v1.0.0 with the original saved defaults migrated to `to-shreds/apks`; upgrade from a customized folder preserved that folder. The installer accepted the install-over upgrade. See `docs/VERIFICATION-1.0.1.md`.
- No physical Fire TV check has occurred for this new version. Amazon's particular installer and settings screens remain device acceptance steps.

## Do not break

- Preserve the exact APK Shelf package name **and original signing key**. Future version updates require a higher versionCode. Private signing backup is in the private ProjectStatus repository at `projects/apk-shelf/private/APK-Shelf-Signing-Backup.zip`. Never expose its contents, password, or private key publicly.
- Preserve separate TorBox TV package and release manifest; do not alter `native/updates/latest.json` or the browser player's `main` branch for this utility.
- Do not silently install apps or imply background polling, release-asset/split APK/Git LFS compatibility, or Vega OS support.
- Preserve settings for explicitly configured sources, including during future default changes. Treat app source as authoritative; do not mistake the preexisting v1.0.0 `APK-Shelf-1.0.0-source.zip` for current code.

## Next action

Install version 1.0.1 on the physical Fire TV once, either fresh or over version 1.0.0. It should show an empty list until APKs are uploaded directly into `https://github.com/to-shreds/apks`. Then select Refresh and an APK to verify the device's permission/installer behavior. Keep the same signing key for any later version.
