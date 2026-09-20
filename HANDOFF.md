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

Version 2.2.1 fixes a search-integrity failure exposed by a physical Android screenshot: searching “Elena of avalor” displayed a generic Popular catalog (The Gentlemen, Silo, Lanterns, Reacher, Ted Lasso, Lioness, etc.) while still labeling it “Search results.” The root cause was that a Cinemeta search host could return HTTP 200 with a structurally valid but query-ignoring payload, and the player trusted the first 200 response.

Search responses are now relevance-validated before acceptance. A search payload with no reasonable title overlap is rejected and the next Cinemeta origin is tried; if every search origin ignores the query, the player returns an empty search rather than displaying unrelated browse cards. The same guard is implemented in the Cloudflare Cinemeta relay. Dedicated regressions reproduce the Elena screenshot pattern.

Verification:
- release-candidate run `35515505124`: 325 tests, 319 pass, 0 fail, 6 optional skips; approved `545197241c7a5053b1ae6558c4977c5c8d93729b`.
- production run `35515547798`: same green suite; Pages publicly verified 2.2.1 from that SHA and created `production-v2.2.1`.
- Cloudflare relay deployment run `35515640808`: successful, including live health, metadata, browse, and Elena search verification.

Version 2.2.0 added exact file-variant source learning, bounded local recovery snapshots, verified candidate gating, production refs, and one-click rollback. Version 2.1.0 added tabbed Settings. Version 2.0.8 added the full product-contract audit and module-version guard. Preserve all of these.

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
