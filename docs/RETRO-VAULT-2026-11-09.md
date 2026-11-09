# Retro Vault integration, November 9, 2026

The TorBox Player GAMES tab lists all 26 original retro-style games individually, plus a Retro Vault collection entry. Existing NES cartridges, DOS Defender, Master Mind, Zmiy, SkiFree remake and hosted MindMaze remain available. No actual Windows or proprietary DOS binaries were copied. Each is an original JavaScript implementation using canvas, keyboard/touch and the browser Gamepad API.

## Mechanics

Frontend: `public/games-web/retro-vault/index.html`, `style.css`, `game.js`; 26 unique mode IDs in `public/extra-games-catalog.json`, sanitized and linked by `extra-games-core.js`. Browser player: `extra-games.js` frames the same-origin content and accepts only exact-origin, exact-source exit and status messages; the child accepts only exact-origin, exact-parent pause/resume/restart/close/key messages. Persisted saves, scores and controller mappings are scoped to current viewer, never sent to backend. Bluetooth/USB controllers require OS pairing and browser support; D-pad/sticks select/move, A and B perform actions, Start controls menu/pause, and these button mappings can be changed in the game. On-screen controls work on touch, and keyboard remains supported. The games do not play audio, request TorBox data, or use third-party libraries.

Service worker: advance cache version and cache new game assets; offline navigation with `?game=<id>` maps to the cached common HTML. Host server: allowlist new static files with same-origin framing and self-only CSP. Production: GitHub Pages copies `public/` unchanged to root and `/key/`. `main` frontend publication requires the full preflight and Pages deployment gate. The native Fire Stick APK and Render backend are independent.

## Verification

- The ported game code was syntax-checked with Node and tested in isolated Chromium: 26 modes opened on desktop 1440×900, portrait 390×844, narrow 320×568, landscape 844×390; keyboard input, mode switching, pause/menu, and layout bounds passed, without page errors.
- `test/retro-vault.test.mjs` checks catalog list, strict path/mode validation, no third-party assets and no network requests.
- `test/browser/retro-vault.mjs` exercises the real browser shell, all game cards and four viewports, parent pause/resume/restart/exit, local saves and controller UI.
- Real Bluetooth hardware, physical phone playback and authenticated TorBox media are not exercised by the tests. Check the GitHub CI and release deployment before claiming publication.

## Release-contract compatibility

The new top-level boot and service-worker build is `release-1.2.15-retro.1`; existing cinema application module imports retain `release-1.2.14-ui.1`. Existing DOS and SkiFree launch URLs retain `release-1.2.8-party.1` so their saved behavior and cache keys are not changed merely to add Retro Vault. Only Retro Vault uses `release-1.2.15-retro.1` as its game URL version. The corresponding tests explicitly check the separate build identities.
