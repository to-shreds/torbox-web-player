# TorBox Web Player handoff

Read this first. The code repository controls implementation; `to-shreds/ProjectStatus/projects/torbox-web-player/STATUS.md` controls readiness and the next action.

## Current work

Release 1.2.0 is being verified on `release/v1.2.0-reliability`. Production was v1.1.0 / restored16 at the start of this work. Do not claim a production update until GitHub Pages and the Render mirror are verified.

- Frontend: https://to-shreds.github.io/torbox-web-player/
- Equivalent legacy entry: `/key/`; permanent recovery entry: `/recover/`.
- Backend: https://torbox-web-player-key.onrender.com
- Render service: `torbox-web-player-key`, `srv-damu91142hec73chb7qg`.
- `main` is authoritative. Render still watches `browser-key-clone`; publish a matching runtime tree there.
- New frontend build: `release-1.2.0`; scope-specific service worker cache.
- Exact prior source archive: `archive/v1.1.0-before-reliability-2026-10-01`, commit `c978c143cf5362a5c7ddd1bcee34811ca5a0f219`.
- Prior Render runtime: `1fa271e8418105431a2aae079538e28de3cf2d81`. It differs from the archive only in docs/config comments.

## Current contract

No video byte relay is permitted. Owner playback receives an opaque ticket and follows a 307 redirect to TorBox. Guest playback also requires a direct link that does not contain the owner key; otherwise it fails clearly. The old media relay implementation has been removed. New Google Drive exports are disabled; old cleanup routes remain. No paid service, extra video storage, transcoding, or artificial keepalive was added.

TorBox may embed the master API key in the owner CDN URL. This is allowed only for the owner's authenticated ticket path; normal playback JSON and guest responses remain key-free. Source providers receive public title identity only.

## Changes and evidence

See `docs/RELEASE-1.2.0.md` for the full measured report and rollback procedure. Changes address device interference, blocking progress writes, cold-start failure, startup retry, session reconnection, obsolete Play/Resume actions, never-starting media, Resume source fallback, missing vault module, cache isolation, and source/ticket capacity bounds.

The baseline had 316 passing tests and six skipped optional checks. Seven new HTTP scenarios reproduced old failures. The local stress run exercised 24 devices, 288 playback starts, and 576 seeks with zero media-body bytes and zero upstream media fetches. Browser tests use the actual UI/API plus synthetic TorBox data and synthetic video. Physical Android and live TorBox acceptance remain separate.

## Do not break

- Keep the proven browser-key architecture. Do not revive the failed 2.x browser-direct rewrite.
- Automatic Play, Resume, recovery, prewarming and auto-next are cached-only. Uncached additions need an explicit Prepare & Play or Full-mode Prepare action.
- Preserve exact movie/show identity, series run-year filtering, explicit episode-title checks, and season/episode file matching. The Office S4 split-versus-combined numbering is a known hazard.
- Simple mode can show a small curated fallback chooser, never the raw technical source table automatically.
- Preserve browser-container checks, source/audio feedback, credits timing, pause/buffer-aware countdown, Still Watching, and Kid Mode allowances.
- Keep the same video DOM element across episode changes for fullscreen/PiP. Browser/OS presentation and wake-lock policies remain outside app control.
- Continue Watching stays show-level; history, settings, and encrypted credential formats are unchanged. Local resume is authoritative, including backward seeks.
- Keep service-worker registration outside the critical app startup path, version every startup import, and retain the independent recovery entry.
- Preserve frontend/backend equivalence and verify before publishing both.

## Next action

Finish release verification and publication. Then confirm live Android start, resume, seeking, fullscreen/PiP episode transition, and actual Render bandwidth after playback. No live TorBox credential was supplied to the stress-test fixtures.
