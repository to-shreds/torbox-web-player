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
- Current production version: **2.3.0**
- Current production source: `c509af762cec1492437a23565fee5f8a0b1803d1`
- Runtime marker: `browser-local-2.3.0`
- Pinned legacy fallback: `/key/` from `d5dd3bd71ee2679178e66440c5240a80eaba41f2`
- `/direct/` redirects to the canonical root.

## Product contract to preserve

The normal experience is simple by default and one-tap for playback. GitHub Pages hosts the UI/local state, **Render is the normal control plane for search/source discovery/TorBox preparation/playback links**, and video streams directly from TorBox CDN. Do not move the ordinary path back to sequential browser-direct provider/bridge calls without real-device latency evidence. Do not reintroduce a raw TorBox library, blocking TorBox preflight, Clear All recents, or source-selection prompts for ordinary Play.

Preserve: browse/search, title and episode UI, automatic source choice, direct TorBox CDN playback, audio-aware source ranking, Continue Watching with individual removal and resume rewind, My List, Next Up, auto-next, recovery, per-title quality, source learning, pause overlay, Still Watching, sleep timer, Kid Mode, backendless setup transfer, diagnostics, PWA/update repair, Render/Cloudflare bridge redundancy, and the pinned `/key/` fallback.

## Recent work

Version 2.3.0 restores the proven Render-backed control path after physical Android testing showed the browser-direct architecture had become unusably slow: searches took about 20 seconds and Play could wait about 30 seconds before reporting that the TorBox bridge could not be reached.

- Canonical Pages now calls the Render API for catalog/search, source lookup, TorBox cache checks, preparation/status, and playback-link generation.
- Video still goes directly from TorBox CDN to the browser. Render does not relay video.
- Current Settings, local history/My List/Kid Mode, source learning, recovery snapshots, and backendless setup transfer remain.
- Setup transfer now retains the active API credential in memory for export and validates imported credentials through a temporary Render session instead of depending on the stateless TorBox bridge.
- The legacy Drive-sharing experiment remains disabled in the canonical UI.
- Render backend `browser-key-clone` was hardened at `56eb946162b31502e46f94d662d384cc81de96bb`: cross-type search and query relevance run server-side, primary/secondary Cinemeta searches race in parallel, and anonymous source provider fan-in returns after useful results instead of waiting for stragglers. Render deploy `dep-danutv942hec73fr22u0` is live.
- Candidate run `35516939056` passed 333 tests (327 pass, 0 fail, 6 optional skips) and approved `c509af762cec1492437a23565fee5f8a0b1803d1`. Production run `35516974562` repeated the same green suite and publicly verified 2.3.0 from that SHA.
- Candidate approval now refuses to move `release-approved` if a newer candidate commit appeared while an older CI run was executing, preventing the approval pointer from being rewound.

Version 2.2.0 added exact-variant source learning, local state snapshots, candidate/approval gating, production refs, and rollback workflow. Version 2.1.0 introduced tabbed Settings. Version 2.0.8 added the full product-contract audit. Preserve all of them.

## Known acceptance boundary

Automated tests verify source contracts, Render routing, state behavior, release gating, and synthetic browser behavior. They do not prove actual Android latency, live-account playback, or a particular torrent's audio codec. The rollback workflow is implemented and statically covered but has not been intentionally exercised against live Pages, because doing so would temporarily replace the current deployment. Physical-device playback remains the final acceptance test for real audio/codec behavior.

## Working rules

Preserve completed work. Make the smallest reliable change. Before fixing a regression, identify the root cause and check that the proposed fix does not undo prior product behavior. Run the existing regression suite and keep the full product-contract tests intact. Do not call a physical-device issue solved solely because CI passes.

## Next action

On the physical Android device, confirm 2.3.0 and retest the same search and episode that were slow/broken. Search should return through Render promptly and ordinary Play should no longer enter the browser-direct bridge timeout path. Do not call this repaired until that physical retest passes. For later substantive changes, work on `release-candidate`, let CI advance `release-approved`, then fast-forward `main` only to that exact approved SHA.

## Persistence

After meaningful work:
- update this `HANDOFF.md` if the cold-start state, major risks, production version, or next action changed;
- update ProjectStatus `STATUS.md` as the final readiness/completion persistence step;
- keep detailed implementation history in Git and ProjectStatus rather than turning this file into a transcript.
