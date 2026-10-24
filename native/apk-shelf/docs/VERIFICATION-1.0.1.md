# APK Shelf 1.0.1 verification

## Scope and build identity

This update only changes the initial GitHub source and migrates the original saved defaults while leaving custom configurations intact. It preserves the package, signing key, download validation, installer handoff, permissions, and TV UI.

- Source tested: `to-shreds/torbox-web-player` at `f07e96069b59bc3f1bb7375cc9a7dd6a5d2be3af` (the later README and HANDOFF edits do not change the tested Java or manifest).
- Package: `app.apkshelf.firetv`, `versionCode=2`, `versionName=1.0.1`, minimum Android API 22, target/compile API 35.
- Signed APK SHA-256: `137b7cbdfcde64a8a500924c6eda7528bfdf7f67d17a896a2763b2734641eac6`.
- Signing certificate SHA-256: `fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14` (identical to version 1.0.0, permitting normal install-over updates).
- Build: JDK 17, Android Build Tools 35.0.0; build/signature/version checks passed. Built with the backed-up private key in the private ProjectStatus repository.

## Runtime tests

[Successful GitHub Actions verification run 40121081573](https://github.com/to-shreds/ProjectStatus/actions/runs/40121081573), on a hardware-accelerated Android 11/API 30 emulator at 1920 × 1080, ran three upgrade scenarios against the *signed release build*:

1. **Fresh install:** opened with `to-shreds/apks`, repository default branch, root folder; listed zero APKs, as expected because only README.md existed.
2. **Install over 1.0.0 with original settings saved:** saved the former `to-shreds/torbox-web-player` / `native-updates` / `native/updates/releases` source using the 1.0.0 settings UI; installed version 1.0.1 over that signed version; relaunched and confirmed all three fields migrated to the new default.
3. **Install over 1.0.0 with a custom folder:** set a different folder in the 1.0.0 settings UI; installed version 1.0.1 over it; relaunched and confirmed the custom source was not overwritten.

All three scenarios passed. The old 1.0.0 APK was downloaded from the public release URL and verified against its known SHA-256 first. Android's system installer accepted the 1.0.1 upgrade; this run did not exercise a user-initiated APK Shelf download/install because that core flow was tested on the otherwise unchanged 1.0.0 version.

The 1.0.0 build passed 37 backend groups including GitHub API processing, file integrity and security boundaries, and earlier Android runtime checks covering remote navigation, actual permission granting, installer handoff and retry. Those historical tests are documented in `VERIFICATION.md`.

## Limits

No test was conducted on Jon's physical Firestick, so the Amazon-specific installer settings and actual D-pad behavior for this version remain to be confirmed. The application supports ordinary APKs stored directly in a GitHub folder, not split APK bundles, release assets, Git LFS pointers, or non-Android Vega devices.

The public `to-shreds/apks` repository was initialized with a non-APK README so the API returns a normal empty list rather than a missing-branch error. Uploading future APKs requires no rebuild; select Refresh.
