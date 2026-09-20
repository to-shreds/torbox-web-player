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
- Current production version: **2.3.4** (released; Elena plays, audio and 480p recovery not yet re-tested)
- Current production source: `efa8989` (2.3.4)
- Runtime marker: `browser-local-2.3.4`
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

## Physical Android findings: five defects on the one Play path

Physical Android testing drove all of these. Each one hid the next, which is why the earlier rounds looked like unrelated random failures. In the order they were found:

1. **Uncached adds were reported as failures** (`lib/discovery.mjs`, live on Render). `TorrentGateway.create()` accepted only the identifier shape a *cached* add returns. An uncached add is accepted by TorBox in a different shape, so a successful addition surfaced as "TorBox accepted the request but did not return a usable identifier". Now reconciles by hash. Never had any test coverage.
2. **Cache availability was read with an exact key** (`lib/discovery.mjs`, live on Render). Source hashes are lowercased before being sent; the returned map was indexed with an exact key, so any other casing matched nothing and **every source was reported uncached**, silently. Every other hash comparison in that file already normalized case. Now case-insensitive.
3. **Source selection preferred uncached** (2.3.2). Commit `2aba8733` put `browserSafe` ahead of `cachedSafe` in the `preferCached` pool, so an uncached browser-friendly source beat a cached risk-free one. Restored to cached-first.
4. **Codec tiers discarded cached sources before selection ran** (2.3.3). `recommendAutomaticSource` filters into codec-confidence tiers and only falls through when a tier is *empty*, so one uncached browser-friendly source removed all cached candidates before `recommendSource` could prefer one. This is why fix 3 appeared to do nothing: the live log showed `{"requested":15,"returned":7,"cached":7}` while Play still downloaded. A risk-free cached source is now tried at each tier first.
5. **Recovery could not reach any alternative, and the audio watchdog stopped running** (2.3.4). `recoverPlayback` iterated only `lowerResolutionOrder()`, which is **empty** for a 480p source, so a title whose sources are all 480p reported "Playback could not recover automatically" without trying a second source. Separately, the silent-audio watchdog is armed once at playback start and abandoned itself permanently if media time had not advanced four seconds inside its window, which is the normal case for a slow start on a phone — so a Dolby/DTS source played silently with no automatic switch. Recovery now tries the requested quality, then lower tiers, then `auto`; the watchdog re-arms, bounded.

Cached-first selection (3 and 4) is only safe **because** the watchdog in 5 catches an unplayable cached source and moves on. Those changes belong together.

Known remaining limit: browser playback needs H.264 with AAC/MP3. Disney-style WEB-DL releases are commonly EAC3 and will never decode in Chrome, so for some titles the correct outcome is switching sources, not decoding. If no browser-playable version is cached anywhere, the experience is still poor. A native player (Stremio) does not have this constraint.

Also unfixed: repeated failures populate the **device-local** source blocklist (`memoryBad` / `memoryAudio === 'bad'`). Once everything is blocked, Play reports "No usable source matches this resolution", which looks like a lookup failure but is local state — Settings → source-learning reset clears it. That message also suggests choosing a lower resolution, but the control writes global settings rather than per-title quality.

## Deployment state

Pages **2.3.4** from `efa8989` is published and publicly verified (production run for that SHA passed its public-version check).

The Render control plane runs `browser-key-clone`. Latest deploy `dep-dao0ivbm8hqs73crb45g` from `9292b5f`, carrying the uncached-identifier reconciliation, the case-insensitive cache read, and the diagnostics. Render runs its own `npm ci && npm run check && npm test` on every build.

`lib/` is shared by both branches, so a backend change must be landed on `browser-key-clone` **and** on `main`; only `browser-key-clone` reaches the live service.

## Deployment facts that previous rounds missed

Render serves `torbox-web-player-key` (`srv-damu91142hec73chb7qg`) from **`browser-key-clone`**, not `main`. A server-side fix merged only to `main` never reaches the live control plane. `lib/` is currently identical on both branches, so backend changes must be landed on both.

Despite `autoDeploy: yes` / `autoDeployTrigger: commit`, **every deploy in this service's entire history has `trigger: "api"`** — the GitHub push webhook has never fired for it. Pushing to `browser-key-clone` alone does **not** deploy; the deploy must be triggered explicitly. Assume a push has not gone live until a new deploy id is confirmed.

That service also has **no request or application logging** beyond Render's own platform lines, which is why previous rounds had to guess.

A second service, `torbox-web-player` (`srv-daln52bl550s73brnhtg`, branch `main`), is also running and consuming a free instance. It does not serve the canonical app.

## Known acceptance boundary

Automated tests verify source contracts, Render routing, state behavior, release gating, and synthetic browser behavior. They do not prove actual Android latency, live-account playback, or a particular torrent's audio codec. The rollback workflow is implemented and statically covered but has not been intentionally exercised against live Pages, because doing so would temporarily replace the current deployment. Physical-device playback remains the final acceptance test for real audio/codec behavior.

## Working rules

Preserve completed work. Make the smallest reliable change. Before fixing a regression, identify the root cause and check that the proposed fix does not undo prior product behavior. Run the existing regression suite and keep the full product-contract tests intact. Do not call a physical-device issue solved solely because CI passes.

## Claude takeover note

The current user request is to have another agent independently audit the project because repeated search/playback regressions have made the current build untrustworthy. The new agent should diagnose from the repo, live Render service, logs, and physical Android evidence before changing architecture again. It should not assume the latest attempted search fixes are correct merely because their tests passed.

## Next action

Retest on the physical device after **Settings → source-learning reset**, with the footer confirmed at 2.3.4:

1. **Elena of Avalor** — it played on 2.3.3 but with no audio. Confirm the re-armed watchdog now switches away from the silent source instead of staying on it.
2. **Salute Your Shorts** — recovery previously had an empty candidate list because its sources are 480p. Confirm it now reaches a second source.
3. If either still fails, read the Render log first. `torbox_cache_checked` gives requested/returned/cached counts, `torbox_episode_unmatched` gives the wanted episode and what parsed, and `torbox_call_failed` gives TorBox's own status and error. Diagnose from those before changing code.
4. Once Play and audio are accepted, retest seeking, resume, auto-next, pause overlay, and Kid Mode on the same device.

Do not rewrite search or the architecture. Search is physically confirmed to open titles correctly.
## Persistence

After meaningful work:
- update this `HANDOFF.md` if the cold-start state, major risks, production version, or next action changed;
- update ProjectStatus `STATUS.md` as the final readiness/completion persistence step;
- keep detailed implementation history in Git and ProjectStatus rather than turning this file into a transcript.
