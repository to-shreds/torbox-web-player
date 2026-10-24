# APK Shelf handoff

## Goal and controlling sources

Create a separate, simple Fire TV utility that lists ordinary APKs in a configurable GitHub folder and downloads them into the system installer. New uploads must appear after Refresh without rebuilding the utility. User's known device is an Android-based Fire TV Stick 4K Plus.

This source tree and the accompanying `APK-Shelf-1.0.0-source.zip` control implementation. The published source location is `native/apk-shelf/` on the `native-updates` branch of `to-shreds/torbox-web-player`; the signed APK is in `native/updates/releases/`. `to-shreds/ProjectStatus/projects/apk-shelf/STATUS.md` controls readiness. Read that record before continuing.

## Implementation

- App identity: APK Shelf, package `app.apkshelf.firetv`, version `1.0.0` / code `1`.
- Native Java Activity and widgets, platform networking/JSON, no AndroidX, WebView, background service, Google services, or runtime dependency downloads.
- Default source: repository `to-shreds/torbox-web-player`, branch `native-updates`, folder `native/updates/releases`. Configurable repository, ref, folder and optional encrypted GitHub token.
- Contents listing, with nonrecursive Git Tree fallback at 1,000 entries. Lists only direct child APK files, sorted by name.
- Downloads immutable Git blobs, verifies exact size and Git SHA, checks ZIP/manifest and Android package preflight, and exposes only completed files through a read-only private content provider with temporary installer grants.
- Foreground operations, cancellation, stale callback guards, retained pending APK across permission/settings flow, and normal system installation confirmation.

## Completed and evidence

Signed build, 37 backend test groups, real GitHub listing and 11.6 MB APK download, and independent code review passed. The final accelerated Android run passed ten automated checks covering launch/listing, D-pad settings, download, actual permission UI, installer handoff, cancellation/retry, and persisted settings after process restart. Actual self-installation was also confirmed through package-manager timestamps and install logs; the optional success-screen/relaunch assertion did not complete because self-replacement closed the caller and returned to the launcher. No APK change was required during testing. Runtime details and physical-device limits are in `docs/VERIFICATION.md` and `docs/hosted-runtime-verification.txt`. `docs/tested-source-sha256.txt` records the actual build inputs.

APK SHA-256: `34d297f48389c0a6ff758f1d2b86d077bc3a810a7b09ee83dc79385cd07b3132`. Signing certificate SHA-256: `fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`.

## Preserve

- Keep this utility separate from TorBox TV and the web player. Do not modify the website's `main` branch or TorBox `native/updates/latest.json` to update this utility.
- Preserve the APK Shelf package name and its dedicated signing key for install-over updates. Increase `versionCode` for future versions.
- The private key/password backup is saved in the private ProjectStatus record at `projects/apk-shelf/private/APK-Shelf-Signing-Backup.zip`. Never include it in public source or APK artifacts. This key is unrelated to the TorBox TV signing key.
- Keep actual app-install confirmation, exact size/hash checking, private provider scoping, token encryption, and GitHub-only credential forwarding.
- Do not claim silent installation, background polling, release-asset support, LFS support, or Vega OS support.
- Do not turn browser screenshots into deliverables; runtime images are temporary internal inspection only.

## Next action

Jon can install APK Shelf once on his Firestick, enable its installation permission, and use the already configured public folder or change Folder settings. After that, upload ordinary APKs into the selected GitHub folder and Refresh on the TV. Physical Fire TV permission wording and remote behavior remain device acceptance checks. A future version should retain the signing key and increase the version code. If rerunning the optional self-update test, use package-manager replacement evidence and relaunch directly instead of expecting a persistent success dialog after the running app replaces itself.
