# APK Shelf 1.0.4 installed-app manager verification

## Build and identity

- Tested implementation commit **`6ff58b2a6548597d46d0d427b9fe6d4149dcdd7d`** on public `to-shreds/torbox-web-player` branch `native-updates`. Subsequent changes update documentation and publish the tested binary without modifying the app Java or manifest.
- Android package `app.apkshelf.firetv`, versionName `1.0.4`, versionCode `5`, minimum API 22, target 35.
- Signed APK **61,995 bytes**, SHA-256 **`24c2526257a298e4c3d483e143c8b1c364eb643bfb0ccbb258e51cc7ac6c92ca`**, certificate SHA-256 **`fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`**; same original certificate as previous APK Shelf versions.
- Tested source archive SHA-256 **`c08a34637916a1929f8d15343e685bdd96c25f402e6827b6a803611d445ae4e2`**, preserved privately and in the public `native/apk-shelf/APK-Shelf-1.0.4-source.zip`. It reflects the exact tested code; its README/HANDOFF are pre-release snapshots.
- Permissions newly introduced: `QUERY_ALL_PACKAGES` solely to enumerate system/third-party apps locally, and `REQUEST_DELETE_PACKAGES` to open the user-confirmed Android uninstaller.

## Checks completed

[Android acceptance run 40160620884](https://github.com/to-shreds/ProjectStatus/actions/runs/40160620884) signed and verified the APK and **passed all runtime assertions** on a hardware-accelerated Android 11/API 30 TV-screen emulator:

1. Install original APK Shelf 1.0.3, confirm no Installed apps button, then install signed 1.0.4 directly over it.
2. Open Installed apps and confirm the local inventory loads and available internal storage is displayed.
3. Search the inventory by the current app's package name `app.apkshelf.firetv`; confirm it is visible as a user app.
4. Add a favorite, verify it is marked; hide it *only in the Shelf inventory* after reading the explicit launcher-limitation warning; confirm it disappears and is recoverable via the Hidden filter.
5. Cycle through All/User/System/Disabled/Favorites/Hidden and restore the hidden favorite.
6. Search `com.android.settings` to confirm system-package visibility and its ADB instructions action. The program refused to issue disable commands for this protected core package.
7. Verify filters/search and Back returned to the original APK Shelf screen, with the GitHub download list intact.

The **48 existing backend test groups passed** (normal GitHub file listing, Releases, checksum and redirect safety, cancellation). Live metadata for the user's existing published release was checked again, without re-downloading the 100 MB Baba file that had already been validated and passed to Android's installer by 1.0.2.

**Important provenance:** The test workflow *overall* reported failure only in its **final private-artifact git push**, because another project had pushed to ProjectStatus simultaneously. All compiled, signed, backend and emulator checks succeeded first. [Preservation run 40160997061](https://github.com/to-shreds/ProjectStatus/actions/runs/40160997061) retrieved the **exact original workflow artifacts**, verified their SHA-256 values, rebased around concurrent work and published the signed binary and source to private ProjectStatus. No app code or binary was rebuilt or changed in response.

## Not tested or restricted

- The installed-app manager was tested on Android emulator, not on a physical Amazon Firestick; Amazon's exact system App info and uninstall controls may vary, and some built-in packages are protected.
- Third-party uninstall uses Android's `ACTION_DELETE` confirmation UI with `REQUEST_DELETE_PACKAGES`; the emulator script did **not** actually uninstall another package. Uninstall always requires platform confirmation.
- "Hide in Shelf only" does **not** change Amazon home screen, and Favorites are local to APK Shelf.
- Direct disable/enable of another package is **not** performed by APK Shelf. Reversible external ADB shell commands are only shown/copied and must be executed by an authorized host such as the user's phone, one package at a time. Some Fire OS packages cannot be disabled even over ADB, and disabling the wrong package can impair the device. Commands were not executed as part of this test.
- No real private GitHub Release token case, split APKs, Vega OS, or device-owner/root operation was tested.
