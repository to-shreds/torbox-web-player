# APK Shelf handoff

## Controlling sources and goal

APK Shelf is a tiny standalone Fire TV utility to download/install normal APKs from a configurable GitHub repository folder and its published Releases, and (from 1.0.4) locally browse/manage installed Android packages. Default GitHub repo is **`to-shreds/apks`**, default branch `main`, repository root, plus published Releases.

Source: [`to-shreds/torbox-web-player/native/apk-shelf`](https://github.com/to-shreds/torbox-web-player/tree/native-updates/native/apk-shelf). **Exact 1.0.4 Java/manifest commit: `6ff58b2a6548597d46d0d427b9fe6d4149dcdd7d`**. Later public commits are documentation and binary release only. Read private `to-shreds/ProjectStatus/projects/apk-shelf/STATUS.md` first for authoritative readiness.

## Current signed release

- **APK Shelf 1.0.4 / versionCode 5**, package `app.apkshelf.firetv`, original signing certificate SHA-256 **`fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`**.
- Signed APK at `native/updates/releases/APK-Shelf-1.0.4.apk` and at `to-shreds/apks` repository root (for install-over self-updates). **61,995 bytes**, SHA-256 **`24c2526257a298e4c3d483e143c8b1c364eb643bfb0ccbb258e51cc7ac6c92ca`**.
- Tested source archive `native/apk-shelf/APK-Shelf-1.0.4-source.zip`, SHA-256 **`c08a34637916a1929f8d15343e685bdd96c25f402e6827b6a803611d445ae4e2`**; private ProjectStatus artifacts contain the exact same build. It is a tested source snapshot; public README/HANDOFF are refreshed after source archival.
- Original signing key/password are backed up ONLY in private `to-shreds/ProjectStatus/projects/apk-shelf/private/APK-Shelf-Signing-Backup.zip`. **Never expose or publish those materials.** Preserve the package name, key and bump versionCode for all future install-over updates.
- v1.0.3 and older signed APKs remain archived. Only current version is kept in `to-shreds/apks` repository root.

## App features / constraints

- Native Fire TV remote/D-pad navigable UI, no browser/analytics or broad storage access. Lists only direct-child GitHub folder APKs and downloadable SHA-256-verified assets from published Releases in the same combined sorted list. Verifies Git blob SHA-1, Release SHA-256, exact file size and Android APK before system install; retains one downloaded file on installer cancellation. Optional GitHub token stored in Android Keystore and never forwarded to GitHub CDN redirects. Limits and security boundaries documented in README and earlier verification.
- **1.0.4 adds a separate Installed apps activity** accessible from the Shelf toolbar. Enumerates locally installed packages using `QUERY_ALL_PACKAGES`, including system and disabled apps. Search by app name/package ID, cycle filters All/User/System/Disabled/Favorites/Hidden, display free storage. Select an app for Launch, Fire OS App info, platform-confirmed uninstall for ordinary user-installed apps, Favorite, or Hide **in Shelf only** with an explicit disclaimer that it does **not** change Amazon home screen.
- For system apps, provide read-only **ADB disable/restore command instructions** for a separate authorized phone/computer ADB client, not an on-TV privileged action. App explicitly blocks generating disable commands for obvious protected/persistent/low-UID packages. Fire OS has blocked apps' self-ADB connections, and Android does not allow unprivileged apps to disable other packages. Do not claim APK Shelf itself removes or disables protected Amazon apps. Actual external ADB commands were not executed during testing.
- Never add unsafe one-tap bulk system debloat or disable known core apps, home screen, remote controls, Settings, OTA or network services. Protected-package heuristics are not an exhaustive guarantee; warn before any external ADB change and make restorations easy. No fake "Hide from Amazon Home" actions.
- Keep the user's requested plain UI writing style: no taglines, cutesy slogans or redundant instructions. Preserve the last working 1.0.3 file list, settings, installer and library defaults.
- Keep APK Shelf separate from TorBox TV and the web player. Never change TorBox `native/updates/latest.json` or `main` website code for this project.

## Tests / continuation

- [Run 40160620884](https://github.com/to-shreds/ProjectStatus/actions/runs/40160620884) tested signed APK with 48 backend tests and live Android 11/API30 installation over 1.0.3, installed-app inventory, searches, filters, favorite/hide/restore, and protected-system guard. **Every test assertion passed.** Overall workflow was marked failure after tests due to a concurrent ProjectStatus branch push.
- [Run 40160997061](https://github.com/to-shreds/ProjectStatus/actions/runs/40160997061) verified/preserved that **same** APK and source artifact in ProjectStatus using conflict-safe pushes. No retest/rebuild was needed.
- Earlier v1.0.3 emulator tested real Android download/installer, and v1.0.2 run downloaded the full 100 MB Baba Is You GitHub Release asset and opened the Android installer. User said prior APK Shelf worked on a physical Firestick; **v1.0.4 not yet tested on their Firestick**. See `docs/VERIFICATION-1.0.4.md` for precise limitations.
- Future high-value upgrades: a dedicated phone-side ADB management companion with reversible one-at-a-time actions, documented safe/critical package categorization, or favorite launcher shortcuts, if the user wants them. Do not assume protected system packages can be disabled from an ordinary sideloaded app.

## Next concrete step

Install v1.0.4 on the Firestick from the existing Shelf file list, open Installed apps, and search for Luna, Amazon Music, News and similar unwanted applications. Identify exact package names before suggesting any external ADB action; some home screen tiles are part of Amazon's launcher rather than independently removable packages.
