# APK Shelf 1.0.0 verification

## Build identity

- Package: `app.apkshelf.firetv`; version `1.0.0`, code `1`.
- Signed APK: 49,707 bytes.
- APK SHA-256: `34d297f48389c0a6ff758f1d2b86d077bc3a810a7b09ee83dc79385cd07b3132`.
- Signing certificate SHA-256: `fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`.
- Minimum SDK 22, target and compile SDK 35. JDK 17; Android Build Tools 35.0.0.
- Native Java platform APIs only. One DEX file and no native libraries or third-party application runtime JARs.

The direct build completed successfully. Android `apksigner` verified v1, v2, and v3 signatures, including the minimum SDK range. `zipalign` passed and ZIP CRC validation passed. Manifest inspection confirmed the TV launcher entry, banner, optional touchscreen, and exactly two requested permissions: Internet and installation requests. Private signing files were excluded. See [build-verification.txt](build-verification.txt) and [tested-source-sha256.txt](tested-source-sha256.txt).

## Backend checks

All **37 backend test groups passed**, covering repository/path/ref validation, filtering, ordering, malformed responses, 1,000-entry tree fallback, truncated trees, access errors, redirect limits, HTTPS restrictions, bearer-token containment, actual Git blob hashing, corrupt or truncated downloads, LFS pointers, missing APK manifests, size limits, cancellation, and partial-file cleanup. See [backend-test-results.txt](backend-test-results.txt). Tests use a separate host-only JSON JAR; Android supplies JSON APIs at runtime.

A read-only live test used the actual application client against the configured public source. The folder returned `TorBox-TV-0.2.4-test.apk`, 11,590,823 bytes. The client downloaded the immutable Git blob, verified exact size and Git SHA, and verified the APK ZIP/manifest. No token or remote write was used. The temporary test download was removed.

An independent source review found no remaining material blocker in provider access control, credentials, redirects, download integrity, callback cancellation, saved settings, or the installer permission flow.

## Runtime checks

The [final hosted run](https://github.com/to-shreds/ProjectStatus/actions/runs/40119618207) completed successfully using hardware-accelerated Android 11 / API 30 at 1920x1080, density 320. It tested the exact signed APK above. Ten automated checks passed: public download hash; release installation; app launch and live two-APK listing; D-pad access to settings and Back; downloading through the app; enabling installation permission through the actual Android settings UI; returning into the system installer; cancelling while retaining the download; retrying the same download; and retaining a deliberately distinct repository value after force-stop/relaunch.

The optional self-install step expected a persistent success dialog, but Android closed the running app during its replacement and returned to the launcher. That UI assertion timed out. Separate package-manager evidence confirms the same signed APK was actually installed through the system installer: `firstInstallTime` was 18:14:03 UTC and `lastUpdateTime` advanced to 18:15:31 UTC on 2026-10-24, with `com.android.packageinstaller` as installer and successful install events. Relaunch after that self-update was not reached by the test. This is separate from the earlier successful restart/persistence test.

The app source and APK remained unchanged through these checks. The first two hosted runs exposed test-script problems with initial touch-mode selection and XML leaf-node matching; those were corrected before the accepted core-flow run. The original local software emulator could not give reliable results because Android's own System UI stalled. See [hosted-runtime-verification.txt](hosted-runtime-verification.txt) for accepted evidence and [emulator-verification.txt](emulator-verification.txt) for the local attempt. Temporary screenshots and full emulator logs are excluded from the release archive.

## Practical limits and remaining acceptance

This is an Android app for Android-based Fire OS. The emulator check does not verify Amazon's exact settings screens, a particular television's overscan, or behavior on Jon's physical Firestick. The final device acceptance is to sideload the APK once, allow APK Shelf to install unknown apps, and select an APK from the list. The minimum SDK setting is not a claim that every supported Fire OS version was physically tested.

The app supports ordinary self-contained APKs. System installation checks still apply, including minimum OS, device architecture, signatures, missing splits, and version downgrades. Git LFS and release assets are outside this version's folder-based scope. Github folder API limits are handled explicitly; GitHub's blob size limit and network rate limits still apply.

The configured public folder is on the existing `native-updates` branch. Publication adds utility files and its APK; the existing TorBox update manifest, TorBox APK, and website branch are preserved.
