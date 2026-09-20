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
- Current production version: **2.2.1**
- Current production source: `545197241c7a5053b1ae6558c4977c5c8d93729b`
- Runtime marker: `browser-local-2.2.1`
- Pinned legacy fallback: `/key/` from `d5dd3bd71ee2679178e66440c5240a80eaba41f2`
- `/direct/` redirects to the canonical root.

## Product contract to preserve

The normal experience is browser-local, simple by default, and one-tap for playback. Do not reintroduce a raw TorBox library, a blocking TorBox connection check, a Clear All control for recent items, or automatic source-selection prompts that force ordinary users into choosing torrents.

Preserve: browse/search, title and episode UI, automatic source choice, direct TorBox CDN playback, audio-aware source ranking, Continue Watching with individual removal and resume rewind, My List, Next Up, auto-next, recovery, per-title quality, source learning, pause overlay, Still Watching, sleep timer, Kid Mode, backendless setup transfer, diagnostics, PWA/update repair, Render/Cloudflare bridge redundancy, and the pinned `/key/` fallback.

## Recent work

Version 2.2.1 fixes a real search failure exposed by physical Android use: Cinemeta's v3 search URL could return an HTTP-200 Popular catalog that ignored the search term, and the player accepted that payload before trying the prefixed catalog fallback. The browser runtime now rejects search payloads whose titles are unrelated to the query, continues through the alternate Cinemeta target/relay, and returns an empty search instead of unrelated Popular cards if every search origin ignores the query. Regression coverage reproduces the exact “Elena of Avalor” screenshot pattern. Candidate run `35515505124` and production run `35515547798` both passed 325 tests (319 pass, 0 fail, 6 optional skips); Pages publicly verified source `545197241c7a5053b1ae6558c4977c5c8d93729b`.

Version 2.2.0 added four protection layers:

- Source feedback is keyed to the exact torrent file variant (hash + filename/file index), so “sound works,” “no sound,” or bad-source learning for one file no longer hard-blocks another file under the same torrent hash. Legacy hash-only success data is only a soft hint.
- Local state snapshots keep up to three backups of settings, Continue Watching, My List, searches, source learning, Kid Mode/Parent PIN state, and selected user. The TorBox API key is excluded. A backup is attempted before the first launch of a new version, setup import, settings reset, and manual Restore; Settings → Devices & app also exposes manual backup/restore.
- Releases now use `release-candidate` → full CI → machine-managed `release-approved`. Production Pages refuses to publish a main commit unless it exactly matches `release-approved`.
- Successful production releases create immutable `production-v<version>` and movable `production-current` refs. `rollback-stable` remains pinned to the pre-2.2.0 2.1.0 release at `24f8f7a2ac55a52e58982fac29ddd242b2647f68`. The manual **Roll back TorBox Player** workflow defaults to that ref, reruns tests, republishes it without rewriting main, and moves `production-current`.

Verification: candidate run `35491888111` passed 321 tests (315 pass, 0 fail, 6 optional skips) and approved source `6311a18d9fa48a3d6ac3a03d6c78fb815bc63bf2`. Production run `35491912729` repeated the same green suite, passed the release-approved gate, publicly verified 2.2.0, and created `production-v2.2.0` plus `production-current`.

Version 2.1.0 introduced the tabbed Basic/Advanced Settings UI. Version 2.0.8 added the full product-contract audit and complete browser-module version scan. Preserve both.

## Known acceptance boundary

Automated tests verify source contracts, routing, state behavior, release gating, and synthetic browser behavior. They do not prove that a particular real torrent's audio codec works on the user's physical Android device. The rollback workflow is implemented and statically covered but has not been intentionally exercised against live Pages, because doing so would temporarily replace the current deployment. Physical-device playback remains the final acceptance test for real audio/codec behavior.

## Working rules

Preserve completed work. Make the smallest reliable change. Before fixing a regression, identify the root cause and check that the proposed fix does not undo prior product behavior. Run the existing regression suite and keep the full product-contract tests intact. Do not call a physical-device issue solved solely because CI passes.

## Next action

Use the user's newest request as the next task. For substantive code changes, work on `release-candidate`, let CI advance `release-approved`, then fast-forward `main` only to that exact approved SHA. After 2.2.1 is physically accepted, consider moving `rollback-stable` forward from 2.1.0 to the accepted release.

## Persistence

After meaningful work:
- update this `HANDOFF.md` if the cold-start state, major risks, production version, or next action changed;
- update ProjectStatus `STATUS.md` as the final readiness/completion persistence step;
- keep detailed implementation history in Git and ProjectStatus rather than turning this file into a transcript.
