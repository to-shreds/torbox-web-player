# APK Shelf handoff

## Goal, controlling sources and current version

APK Shelf is a small standalone native Fire TV utility for installing ordinary APKs uploaded either as normal repository files or as GitHub Release assets. The user controls uploads from a browser and selects files with the TV remote. The default repository is **`to-shreds/apks`**, branch `main` (empty configured ref), repository root (empty configured folder), plus all published Releases in that repository.

The app source is [`to-shreds/torbox-web-player/native/apk-shelf`](https://github.com/to-shreds/torbox-web-player/tree/native-updates/native/apk-shelf) on `native-updates`. The reviewed 1.0.2 Java/manifest/test sources are at commit **`af53b2d4e14e0b64fbcb556ab02a66ae28345b84`**; subsequent commits update docs and publish binaries without changing the tested app Java or Android manifest. Read the private `to-shreds/ProjectStatus/projects/apk-shelf/STATUS.md` before doing more work. That record controls readiness.

**Current signed version: 1.0.2 / versionCode 3**, Android package `app.apkshelf.firetv`. APK SHA256 `225073fed499eec8fb8ba7a7d4f9243b2c24068fe9d86157841814c6ae6803e6`; signing certificate SHA256 `fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`, **the same key used by 1.0.0 and 1.0.1**. Release binaries are preserved in the private ProjectStatus artifacts and published at `native/updates/releases/APK-Shelf-1.0.2.apk` on `native-updates`; a copy is also uploaded directly into `to-shreds/apks` root to enable self-update from 1.0.1. The public source archive `native/apk-shelf/APK-Shelf-1.0.2-source.zip` is the CI-tested code snapshot, packaged before these refreshed public instructions.

## Functionality

- GitHub folder listing, direct child `.apk` files only, with Git Tree fallback at GitHub's 1,000-entry Contents limit.
- GitHub Releases listing for the same repository regardless of configured branch/folder. Includes APK assets in published releases, skips drafts, missing/unusable SHA-256 digest, non-APK and incomplete assets. Paginates up to 500 releases/1,000 assets per release with a warning at cutoff. User's release is **Apk library**, tag `Apk`, currently containing `baba-is-you617.apk` (100,240,046 bytes) and `TorBox-TV-0.2.5-test-separate.apk` (7,329,790 bytes).
- A combined, alphabetically sorted TV list with file size and source label, including duplicate filenames when a file exists both as a normal repository file and a Release asset.
- Immutable Git blob downloads verified with exact size and Git SHA-1, GitHub Release asset HTTPS downloads verified with exact size and GitHub SHA-256. Release file size cap 2 GiB; normal blob cap 100 MiB. Transient files cleaned on cancellation/failure; one completed file held for installer retry.
- Release downloads follow strict trusted HTTPS GitHub/CDN redirects, never forward GitHub tokens off `api.github.com`. Optional encrypted token and API endpoint for private release assets exist but **private live release access was not tested**.
- Native Android APK ZIP preflight, platform package preflight, unknown-app permission prompt and Android installer confirmation. No silent/background install, polling, external dependencies, WebView, analytics, broad storage access or Vega OS support.
- Upgrades from version 1.0.0 migrate only the original default source triple to `to-shreds/apks`; custom folder settings persist. Version 1.0.2 installs over 1.0.1 without uninstall because identity and signing key are unchanged.

## Verified, not conjectured

- [Successful CI run 40145494609](https://github.com/to-shreds/ProjectStatus/actions/runs/40145494609) compiled and signed release using the **private original signing key** and verified signatures and version 1.0.2/code 3.
- **48 backend tests passed**, including redirects, SHA mismatches, truncation/cancellation, source merging, duplicate filenames, content size and the 2 GiB Release boundary.
- Live integration downloaded both real user Release assets from GitHub, including all **100,240,046 bytes** of Baba Is You, and verified SHA-256, exact byte counts and APK ZIP/manifest.
- Hardware-accelerated Android 11/API 30 TV emulator installed **v1.0.1 then upgraded to v1.0.2**, preserved settings, listed both current repository files and both release assets in a combined four-item list, refreshed using Menu, downloaded the smaller Release APK, opened the real permission/settings and system installer screens, cancelled and retried, then downloaded all 100 MB of Baba and opened the Android installer again. All acceptance steps passed. Afterwards adding APK Shelf 1.0.2 to the repository root will make five visible files. See `docs/VERIFICATION-1.0.2.md`.
- No test has yet been done on the user's physical Firestick. Amazon-specific settings and installer screens still need confirmation.

## Non-negotiable continuation constraints

- Keep `app.apkshelf.firetv` and the **original APK Shelf private signing key**. Backup is `to-shreds/ProjectStatus/projects/apk-shelf/private/APK-Shelf-Signing-Backup.zip`. Never expose its contents in public source, artifacts, logs or chat.
- Increment versionCode for updates. Keep personal user-configured GitHub settings, all download integrity validation and provider file restrictions. Do not loosen credential sending or URL host validation.
- Keep APK Shelf separate from TorBox TV and the TorBox web player. Do not change `native/updates/latest.json` or the web player's `main` branch for this tool.
- Files directly in the root of `to-shreds/apks` and Release APK assets must coexist, including duplicates with provenance labels. Do not copy 100 MB game binaries into ordinary repository Git history.
- Only claim exactly observed testing; physical Fire TV remote/device not yet tested. Private Release download support only backend-mock-tested.

## Next concrete action

Install 1.0.2 from the root APK in `to-shreds/apks` using the current 1.0.1 APK Shelf or via its public direct download link. Refresh and select Baba Is You under **Release: Apk library** on the Firestick; confirm Android system installation. Upload new smaller APKs to repository root and larger APKs under the existing **Apk library** GitHub Release without updating the utility.
