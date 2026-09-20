# TorBox Player Handoff

Use this file to start a fresh chat quickly. It is a routing and continuation summary, not the substantive source of truth.

## Read first

1. Read this file.
2. Read the current `README.md` in `to-shreds/torbox-web-player`.
3. Read `to-shreds/ProjectStatus/projects/torbox-web-player-browser-key/STATUS.md`.
4. Inspect the current `main` branch and the exact files relevant to the next task before changing anything.

If this file conflicts with the repo, the repo controls substance. If it conflicts with ProjectStatus about readiness, unresolved work, or next steps, ProjectStatus controls. Fix this handoff when that happens.

## Current production

- Canonical repo: `to-shreds/torbox-web-player`
- Canonical branch: `main`
- Public app: `https://to-shreds.github.io/torbox-web-player/`
- Current production version: **2.1.0**
- Current production source: `673d3f8847c7b8554f134a8a8214cbb2e21dd929`
- Runtime marker: `browser-local-2.1.0`
- Pinned legacy fallback: `/key/` from `d5dd3bd71ee2679178e66440c5240a80eaba41f2`
- `/direct/` redirects to the canonical root.

## Product contract to preserve

The normal experience is browser-local, simple by default, and one-tap for playback. Do not reintroduce a raw TorBox library, a blocking TorBox connection check, a Clear All control for recent items, or automatic source-selection prompts that force ordinary users into choosing torrents.

Preserve: browse/search, title and episode UI, automatic source choice, direct TorBox CDN playback, audio-aware source ranking, Continue Watching with individual removal and resume rewind, My List, Next Up, auto-next, recovery, per-title quality, source learning, pause overlay, Still Watching, sleep timer, Kid Mode, backendless setup transfer, diagnostics, PWA/update repair, Render/Cloudflare bridge redundancy, and the pinned `/key/` fallback.

## Recent work

Version 2.1.0 redesigned Settings:

- Settings opens on **Basic settings**.
- Optional User 1 and User 2 display names.
- Every Basic setting has a plain-English tooltip.
- Advanced tabs: Playback, Home & history, Discover & sources, Kids, Devices & app.
- New advanced controls: home density, starting browse type/feed/genre, search responsiveness, and cached-source preference.
- User names remain display labels only; internal identities remain `viewer-1` and `viewer-2`.
- New ordinary settings are included in backendless setup transfer.
- Final publication run `35490298695`: 309 tests, 303 pass, 0 fail, 6 optional skips; public 2.1.0 verification succeeded.

Version 2.0.8 was a full feature-preservation audit. It added a central product-contract test and fixed stale leaf-module cache-busting imports. Do not undo those release-integrity protections.

## Known acceptance boundary

Automated tests verify source contracts, routing, state behavior, and synthetic browser behavior. They do not prove that a particular real torrent's audio codec works on the user's physical Android device. Physical-device playback remains the final acceptance test for real audio/codec behavior.

## Working rules

Preserve completed work. Make the smallest reliable change. Before fixing a regression, identify the root cause and check that the proposed fix does not undo prior product behavior. Run the existing regression suite and keep the full product-contract tests intact. Do not call a physical-device issue solved solely because CI passes.

## Next action

Use the user's newest request as the next task. Before editing, inspect the exact current implementation involved and check ProjectStatus for any newer unresolved item.

## Persistence

After meaningful work:
- update this `HANDOFF.md` if the cold-start state, major risks, production version, or next action changed;
- update ProjectStatus `STATUS.md` as the final readiness/completion persistence step;
- keep detailed implementation history in Git and ProjectStatus rather than turning this file into a transcript.
