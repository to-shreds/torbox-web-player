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

## Latest physical Android result

On production **2.3.1**, search for **Elena of Avalor** returns and opens the correct title/episode list, so the independent search fallback is functioning on the target phone. Pressing Play failed with: **“TorBox accepted the request but did not return a usable identifier. Check status before retrying.”**

## Diagnosed root cause of the Play blocker

`TorrentGateway.create()` in `lib/discovery.mjs` accepted exactly one success shape: a non-negative integer `data.torrent_id`. That is the shape a **cached** add returns. Ordinary one-tap Play sends `onlyCached: source.cached === true` (`public/discover.js`), so whenever the automatically chosen source is **not already cached**, Render calls `createtorrent` with `add_only_if_cached=false`. TorBox accepts that request (`success: true`), but it does not answer with the cached-add identifier, so `validId(data.torrent_id)` was false and an addition that had actually succeeded was reported to the phone as a failure.

This was latent from the first implementation — `create()` is byte-identical across the entire Git history. What changed is how often ordinary Play reaches the uncached branch:

- `de38821d` (v2.0.7) made Play unattended, so no human sees or overrides the automatic choice.
- `2aba8733` (“Prefer known browser-safe audio over cached unknown sources”) moved `browserSafe` ahead of `cachedSafe` in the `preferCached` pool, so an **uncached** H.264/AAC source now outranks a **cached** risk-free one.
- The register-side cached bonus was also reduced from `+20` to `+8`.

None of that is wrong on its own — the audio-safety preference is a deliberate, tested feature (`test/audio-selection.test.mjs`). It simply routes ordinary Play into a branch that never worked.

CI stayed green because the only `createtorrent` test mocked `add_only_if_cached='true'` and returned `{ torrent_id: 0 }`. **The uncached branch had zero test coverage**, which is exactly the class of failure this project keeps hitting: green suite, failing phone.

## Repair applied

`create()` now reconciles by hash through the existing `find()` when TorBox reports success without a usable `torrent_id`, and only reports `CREATE_UNCERTAIN` when reconciliation also cannot confirm the addition. The reconciliation is a read, so an unconfirmed addition still never becomes a duplicate write — any failure inside it falls through to the original error. Source selection and the audio-safety preference were deliberately **not** changed: they are the trigger, not the defect.

The fix is deliberately shape-independent. Egress to `api.torbox.app` is blocked from the investigating environment, so the exact uncached response body could not be observed directly; reconciling by hash avoids guessing TorBox field names. A `torbox_create_identifier_missing` diagnostic now records the response's **field names only** (never values, so neither the infohash nor the account's activity is logged) so the next occurrence is conclusive rather than inferred.

Verified: `npm run check` clean, suite 337 tests / 331 pass / 0 fail / 6 optional skips (was 335/329). The new reconciliation test was confirmed to **fail** against the pre-fix `lib/discovery.mjs` and pass after it.

**Not yet physically verified.** Physical Android Play remains the acceptance test.

## Deployment fact that previous rounds missed

Render auto-deploys `torbox-web-player-key` (`srv-damu91142hec73chb7qg`) from **`browser-key-clone`**, not `main`. A server-side fix merged only to `main` never reaches the live control plane. `lib/` is currently identical on both branches; this repair must land on `browser-key-clone` to take effect. That service also has **no request or application logging** beyond Render's own platform lines, which is why previous rounds had to guess.

## Known acceptance boundary

Automated tests verify source contracts, Render routing, state behavior, release gating, and synthetic browser behavior. They do not prove actual Android latency, live-account playback, or a particular torrent's audio codec. The rollback workflow is implemented and statically covered but has not been intentionally exercised against live Pages, because doing so would temporarily replace the current deployment. Physical-device playback remains the final acceptance test for real audio/codec behavior.

## Working rules

Preserve completed work. Make the smallest reliable change. Before fixing a regression, identify the root cause and check that the proposed fix does not undo prior product behavior. Run the existing regression suite and keep the full product-contract tests intact. Do not call a physical-device issue solved solely because CI passes.

## Claude takeover note

The current user request is to have another agent independently audit the project because repeated search/playback regressions have made the current build untrustworthy. The new agent should diagnose from the repo, live Render service, logs, and physical Android evidence before changing architecture again. It should not assume the latest attempted search fixes are correct merely because their tests passed.

## Next action

1. Land the `create()` reconciliation repair on **`browser-key-clone`** so the live Render control plane actually runs it, and confirm the resulting deploy goes live.
2. Retest Play for **Elena of Avalor** on the physical Android device. That is the acceptance evidence; a green suite is not.
3. If Play still fails, read the new `torbox_create_identifier_missing` line in the Render logs. It names the fields TorBox actually returned, which settles the response shape without another speculative change.
4. Only once Play succeeds, retest audio, seeking, resume, auto-next, pause overlay, and recovery on the same device.

Do not rewrite search or the architecture. Search is physically confirmed to open Elena correctly.

## Persistence

After meaningful work:
- update this `HANDOFF.md` if the cold-start state, major risks, production version, or next action changed;
- update ProjectStatus `STATUS.md` as the final readiness/completion persistence step;
- keep detailed implementation history in Git and ProjectStatus rather than turning this file into a transcript.
