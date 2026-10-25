# APK Shelf 1.0.2 GitHub Releases verification

## Source, signature and published artifact

- Tested implementation at `to-shreds/torbox-web-player` commit `af53b2d4e14e0b64fbcb556ab02a66ae28345b84`, built using JDK 17, Android Build Tools 35.0.0.
- APK `APK-Shelf-1.0.2.apk`, Android package `app.apkshelf.firetv`, versionName `1.0.2`, versionCode `3`, 53,803 bytes, SHA-256 `225073fed499eec8fb8ba7a7d4f9243b2c24068fe9d86157841814c6ae6803e6`.
- Same APK Shelf certificate fingerprint as 1.0.0 and 1.0.1: `fac7d2295ccb67ad1b9c0a8748c271d5eccd829ac0d17bf4ee10e63fb556cb14`, signature v1/v2/v3 verified by Android build tools.
- Source archive `APK-Shelf-1.0.2-source.zip`, SHA-256 `894bce53b819ae903021effb6c98d94d193b7eb78e37c86735f6e38a5f016912`.
- [Successful GitHub Actions run 40145494609](https://github.com/to-shreds/ProjectStatus/actions/runs/40145494609).

## Backend and live network checks

- **48 passing Java backend tests**, including all 37 original tests (repository/folder validation, Git blobs, truncation, full tree, checksums, cancellation, credentials, trusted redirects, ZIP manifest) plus 11 new Release tests (merged list, same-name entries, authentic metadata, draft/missing digests, size constraints, malformed downloads, integrity validation, and public/private release URL credential boundaries).
- Live GitHub listing confirmed two published Release assets in `to-shreds/apks`:
  - `baba-is-you617.apk`: **100,240,046 bytes**, SHA-256 `7cf64f53028c645b4c78506454dd934afb73a8bf4a48bf1bf29f3793a7ec8ac7`.
  - `TorBox-TV-0.2.5-test-separate.apk`: **7,329,790 bytes**, SHA-256 `7c76e56c60904ac041db0da87fca112268dd24a3a61256f400d0b6b7c1bb700b`.
- Both files were downloaded **in full from their actual GitHub Release links** during CI. Each passed the correct size, GitHub-provided SHA-256 digest, and APK ZIP/manifest checks. Downloads are temporary in the test; user software binaries are not added to the app source or signing backup.

## Android emulator acceptance

An accelerated Android 11/API 30 emulator with TV display accepted and ran the signed APK:

1. Installed version 1.0.1 first and observed only **two repository-root APKs**. During the test window the user had added TorBox-TV 0.2.4 and TorBox-TV 0.2.5 to the repository root after the initial release was created.
2. Installed version 1.0.2 **over 1.0.1**, with the same signing certificate, preserving saved `to-shreds/apks` folder settings.
3. Opened APK Shelf 1.0.2 and observed a combined list of **four APKs**: two normal repository files plus the two GitHub Release assets, including the TorBox 0.2.5 filename separately from its Release copy.
4. Pressed the remote Menu key to refresh and confirmed both sources remained visible.
5. Chose the **release asset** TorBox 0.2.5 rather than the identically named normal file, completed the actual download/hash/package preflight, granted permission through Android's unknown-app settings, and reached Android's actual package installer.
6. Cancelled the installation, returned to APK Shelf, retried the retained download without downloading again, and reopened then cancelled the system installer successfully.
7. Chose the **100 MB Baba Is You** Release asset, downloaded the full file via the app and passed SHA-256 and Android's package preflight, then opened the real Android package installer for that APK. The test did not confirm installation or gameplay; it cancelled the installer after verifying the handoff.

Every scripted acceptance assertion passed. The APK Shelf 1.0.2 binary was not modified in response to this test. Afterwards APK Shelf 1.0.2 was also added to the repository root to enable easy on-device updates, so a subsequent Refresh should show **five APKs** unless the user uploads or removes files.

## Boundaries / not tested

- A real Amazon Firestick has not yet been tested, so exact permission-screen wording, sideload consent and remote behavior there remain the only practical device acceptance steps.
- Private GitHub Releases are supported through an authenticated API asset path, and mocked backend tests confirm token non-leakage, but no private live Release download was exercised.
- No install of the Baba game itself was attempted or confirmed; Android successfully opened the install screen. Compatibility and licensing of uploaded third-party APKs are separate from the utility's function.
- GitHub Releases assets require SHA-256 digest metadata. Normal repository Git blobs retain their Git SHA verification. Split APK packages, Git LFS pointers, silent install and Vega OS are not supported.
