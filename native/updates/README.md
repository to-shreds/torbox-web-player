# TorBox TV APK updates

Current signed test release: **0.2.4 / code 7**.

[Download TorBox TV 0.2.4](releases/TorBox-TV-0.2.4-test.apk). Install over the existing app without uninstalling it.

This release adds QR phone-browser control in Settings and automatic/manual GitHub update checks. The phone and TV use the same home Wi-Fi; all video stays on the TV and goes directly to approved providers. The app downloads an update only after approval, verifies its package/version/hash and original certificate, and opens the device installer.

APK SHA-256: `c49d0de7577b7e0097fdf2b111e14b8523da064fe181b3b7e882d88610e24a7b`.
Signing certificate SHA-256: `a624a6387fdd119fec69897b8386fbdcb4eeb073987c7abc7ac18626b426cedf`.

Verification: 165 distinct JVM cases passed across the main/live runs, 43 regular Android device cases passed, two actual signed-upgrade cases passed, and six mobile-browser cases passed. Physical Firestick/phone acceptance and authenticated TorBox startup timing remain unmeasured.

This distribution branch leaves the website's main branch and runtime unchanged. Preserve versioned APKs. Publish latest.json and the matching, fully verified original-certificate APK together. Do not publish a temporary CI-key build as an app update. The native source's scripts/prepare_update.py generates and verifies channel files.
