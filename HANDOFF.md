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
- Current production version: **2.3.1**
- Current production source: `f0dc5a4596f579d0e8810269963342300c655f9a`
- Runtime marker: `browser-local-2.3.1`
- Pinned legacy fallback: `/key/` from `d5dd3bd71ee2679178e66440c5240a80eaba41f2`
- `/direct/` redirects to the canonical root.

## Product contract to preserve

The normal experience is simple by default and one-tap for playback. GitHub Pages hosts the UI/local state, **Render is the normal control plane for search/source discovery/TorBox preparation/playback links**, and video streams directly from TorBox CDN. Do not move the ordinary path back to sequential browser-direct provider/bridge calls without real-device latency evidence. Do not reintroduce a raw TorBox library, blocking TorBox preflight, Clear All recents, or source-selection prompts for ordinary Play.

Preserve: browse/search, title and episode UI, automatic source choice, direct TorBox CDN playback, audio-aware source ranking, Continue Watching with individual removal and resume rewind, My List, Next Up, auto-next, recovery, per-title quality, source learning, pause overlay, Still Watching, sleep timer, Kid Mode, backendless setup transfer, diagnostics, PWA/update repair, Render/Cloudflare bridge redundancy, and the pinned `/key/` fallback.

## Recent work

Version 2.3.1 repairs the failed 2.3.0 search result shown on physical Android. Restoring Render fixed the architecture/latency path, but the search backend still depended on two Cinemeta search endpoints. On the real service, both could return no relevant result or ignore the query. The earlier test had mocked the secondary Cinemeta endpoint as if it reliably returned Elena, so it did not prove the live search would work.

The Render catalog now races three server-side search sources: Cinemeta primary, the prefixed Cinemeta catalog endpoint, and IMDb's public title-suggestion service. Every result is still filtered for the actual query and requested movie/show type. IMDb suggestion results contribute only IMDb IDs/basic card data; authoritative title details still come from the normal Cinemeta metadata endpoint when a result is opened. This gives search an independent title-index fallback without moving search back into the browser.

The Render backend is live from `browser-key-clone` commit `e6e9bf756ff3400e244fb221a676109827ee8328`, deploy `dep-danv5smk1f9s73a34mhg`. Candidate run `35517730565` passed 335 tests (329 pass, 0 fail, 6 optional skips) and approved `f0dc5a4596f579d0e8810269963342300c655f9a`. Production run `35517804175` repeated the same green suite and publicly verified Pages version 2.3.1 from that SHA.

Version 2.3.0 restored Render as the normal control plane while preserving direct TorBox CDN video and the newer 2.x features. Version 2.2.0 added exact file-variant learning, local recovery snapshots, release gating, production refs, and rollback. Version 2.1.0 added tabbed Settings. Preserve all of them.

## Known acceptance boundary

Automated tests verify source contracts, Render routing, state behavior, release gating, and synthetic browser behavior. They do not prove actual Android latency, live-account playback, or a particular torrent's audio codec. The rollback workflow is implemented and statically covered but has not been intentionally exercised against live Pages, because doing so would temporarily replace the current deployment. Physical-device playback remains the final acceptance test for real audio/codec behavior.

## Working rules

Preserve completed work. Make the smallest reliable change. Before fixing a regression, identify the root cause and check that the proposed fix does not undo prior product behavior. Run the existing regression suite and keep the full product-contract tests intact. Do not call a physical-device issue solved solely because CI passes.

## Next action

On the physical Android device, confirm 2.3.1 and repeat the exact search **Elena of Avalor**. It must return the Elena title rather than unrelated cards or an empty result. Then open the same episode and test Play latency and actual playback. Do not call search or playback repaired until those physical checks pass. For later substantive changes, work on `release-candidate`, let CI advance `release-approved`, then fast-forward `main` only to that exact approved SHA.

## Persistence

After meaningful work:
- update this `HANDOFF.md` if the cold-start state, major risks, production version, or next action changed;
- update ProjectStatus `STATUS.md` as the final readiness/completion persistence step;
- keep detailed implementation history in Git and ProjectStatus rather than turning this file into a transcript.
