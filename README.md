# TorBox Player

Current version: **2.0.3**

Canonical frontend: `https://to-shreds.github.io/torbox-web-player/`

`/direct/` redirects to that same player. `/key/` remains the pinned v1.1 Render-backed fallback. The original household-password prototype is retained in Git history and the `legacy-household-2026-09-19` branch, not served as the primary product.

## What runs where

The primary product is a static browser application. Cinemeta metadata, source discovery, normalization, ranking, playback selection, settings, Continue Watching, My List, parental limits, and source learning run in the user's browser. Video streams directly from TorBox's CDN to the browser.

Only the required TorBox API operations use a narrow stateless bridge: Render first, Cloudflare backup. Both are configured in `public/relay-config.json`. The bridges receive the user's TorBox credential for each request. They do not provide the player with a database, cloud profile, or shared history. Neither bridge relays the video.

A fast primary-read timeout allows fallback without subjecting the backup and write operations to the same two-second deadline. An upstream TorBox rate-limit response is not treated as permission to bypass the account's quota by switching hosts. Ordinary authentication/validation errors do not fail over. An ambiguous torrent-create failure is reconciled against the account before replay; this reduces duplicate requests but is not a provider-supported exactly-once guarantee.

The working `/key/` backend is still deployed from `browser-key-clone`. Do not repoint or delete that Render service when publishing the static main player. Its stateless bridge is also used by the new player. Cloudflare deployment uses the already-existing Arcade GitHub Actions secrets; never commit those secrets or a real TorBox API key.

## Simple by default

First launch asks only for the user's own TorBox API key. Remembering it is optional and uses the existing encrypted IndexedDB vault. Source selection is automatic. Full mode in Settings exposes technical controls without cluttering the default experience.

Existing features include focused search with Search/Enter keyboard dismissal, Continue Watching with configurable resume rewind, My List, Next Up, auto-next, source recovery, per-title quality, data-saving source preferences, audio/source feedback, sleep timer, Still Watching, and per-viewer Kid Mode with Parent PIN and time/episode/movie limits.

Parental controls are local application controls, not device management. Clearing browser data or using another unrestricted browser can defeat them. Local encryption does not protect credentials against malicious scripts running on this same origin.

## Backendless setup transfer

Open **Settings → Sync & devices → Transfer this setup**. The receiver can use **Receive setup** in Settings or the small link on the connection screen. Transfer is not a mandatory onboarding step.

Only these categories are copied:

- TorBox API credential.
- Ordinary settings, encoded as differences from defaults.
- Continue Watching/recent playback IDs, episode identifiers, positions, durations, completion state, and ordering.
- My List IDs, preserving the existing two viewer lists.

The format deliberately excludes Parent PIN/verifier, Kid Mode configuration, allowances/usage, selected viewer, search history, learned source/audio compatibility, relay configuration, source URLs, posters, titles, and descriptions. Metadata is re-fetched by ID after import. The receiver's existing parental controls remain untouched; a new device starts without inherited parental controls. Imports on a PIN-protected destination require its existing PIN.

The package uses a compact versioned tuple format and lossless DEFLATE compression where available. Small packages become a single URL QR. Larger ones automatically use looping multipart QR, decoded by the receiver's in-page camera scanner. The receiver collects unique frames in any order, ignores duplicates, rejects mixed transfers, and verifies the assembled payload. A normal camera app cannot assemble multipart QR: open this player's Receive setup screen for that mode.

A local `.twsetup` file and private transfer link are always available. File creation, QR generation, camera decoding, payload validation, and import run locally. No transfer package is uploaded to Render, Cloudflare, a QR-generation service, or any database. Camera frames stay in the page; camera tracks stop when the dialog closes or the page is hidden.

### Transfer security

A self-contained QR/link/file without a password is a bearer credential. Anyone who photographs, copies, or receives it can import the account. Compression and an integrity digest do not make it confidential. It is not one-time, has no enforced expiry, and cannot be revoked independently of the underlying API key. Do not publish one or paste it into diagnostic reports.

An optional transfer password (10–200 characters) encrypts the compressed payload using AES-GCM, a random salt/IV, and PBKDF2-SHA-256 at 210,000 iterations. Send the password separately. It is not the Parent PIN. A password is recommended for sending a file or link rather than scanning between trusted nearby devices.

Transfer URL data stays in the fragment and is removed immediately by the receiving page. Browser history, screenshots, clipboard, extensions, and whoever transports a file are still part of the trust boundary. After explicit confirmation, the receiver validates the imported credential through the normal TorBox bridge before replacing the three portable storage records. Save failure restores the prior portable state and remembered key where browser storage remains writable.

The source is not signed out or erased. Later changes do not synchronize. Ongoing cloud sync and additional debrid providers are not implemented by this release.

## Browser state and old addresses

Root, `/direct/`, and `/key/` are paths on the same origin. Existing local settings/history/vault keys are retained; moving to the main address does not intentionally wipe them. These paths are not separate security or storage boundaries. The main service worker handles only an explicit static-asset allowlist and does not intercept `/key/`, arbitrary navigation, APIs, or video. It never clears other projects' caches.

## Optional features

The old server-backed setup transfer, temporary guest sharing, and Drive-sharing experiment are not active in the main browser-local runtime. The previous `/key/` player remains available for legacy optional behavior. App installation, status checks, source-learning reset, and search-history reset remain available in the main Settings screen.

## Development and verification

Source on `main` controls the primary product. The browser-local candidate is verified before promotion. `browser-key-clone` controls the frozen fallback backend/frontend. `browser-direct-experiment` is a historical integration branch, not a second independently maintained UI.

Run `npm ci --ignore-scripts`, `npm run check`, and `npm test`. QR encoder/decoder sources and licenses are vendored in `public/vendor/`; the running app does not depend on an external script CDN. Browser acceptance exercises Chromium, Firefox, and WebKit using synthetic metadata, a fixture credential, and a generated H.264/AAC clip. It tests full static hosting, source URLs, primary-bridge failure, keyboard dismissal, QR decode/import, encrypted-file import, metadata restoration, and old-address migration. These simulations are not a claim of physical Android/iPhone camera or live TorBox playback acceptance.

The six optional live integration tests remain opt-in. No real credentials are needed for normal CI. Build/readiness and remaining physical-device acceptance are recorded in `to-shreds/ProjectStatus/projects/torbox-web-player-browser-key/STATUS.md`.
