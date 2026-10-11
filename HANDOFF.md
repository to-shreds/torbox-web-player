# TorBox Web Player handoff

Read this first. The code repository controls implementation; `to-shreds/ProjectStatus/projects/torbox-web-player/STATUS.md` controls readiness and the next action.

## Standing Render workspace choice

The user explicitly confirmed **My Workspace** (`tea-dakujgmk1f9s73d2v8ng`) on 2026-10-10 and requested blanket confirmation because this is the account's only workspace. Reuse that workspace for authorized Render work without asking again unless the user changes the choice. Pass its ID explicitly on Render calls.

## Playback startup patch · 2026-10-11

Backend source **1.2.1**, published frontend **release-1.2.1-startup.1**, prepared from main `644faeddaccb9e2f1a152dade1c034cf077d5bd2`. Runtime commit `2a3f8c3f84e108178477c0fb4a8ee23a235d0e12` is on main and `release/v1.2.1-startup`. This section supersedes the preceding runtime version descriptions. Both frontend and Render backend are now live on the 1.2.1 release.

The browser baseline already retained provider caches, stopped after its first usable cached preparation and warmed auto-next during credits. Its remaining delay was the aggregate lookup holding one useful provider behind stalled providers until the ten-second deadline, plus no movie/details-page preparation. New `fast=1` lookup returns useful public metadata after a 200ms grace while remaining providers keep enriching the same cache. `complete=1` waits for the bounded current job; automatic playback falls back to this full batch if the early results are uncached, incompatible or fail catalog/episode identity checks. Recovery also requests complete results. Normal Options behavior, provider identity checks and four-target concurrency remain.

Details and exact episode Play focus now warm cached-only preparation. Play/Resume/next share an eight-entry session-local preparation cache with a 60-second reusable lifetime. Session suspension, viewer/settings changes and source feedback invalidate reuse as appropriate. Closing details aborts pending warm work, and canceling the only foreground/next waiter aborts its API work. A canceled waiter cannot reopen the player or fail another waiter sharing the title warm. Automatic next preparation begins once after thirty seconds of video time (halfway for shorter files), before the existing credits prompt. Playback still requests a fresh link/lease at actual start; no video-byte prefetch or storage was added.

Verified local and release checks: syntax and diff checks passed; **364 Node tests registered, 358 passed, 0 failed, 6 optional live/account checks skipped**; the published commit's full **26-scenario browser suite passed**. Synthetic backend fast batch returned in **203ms** while a second provider was held. Synthetic warmed Play reached its first frame in **50ms** locally and **55ms** in release CI after a 1,000ms delayed lookup had finished, with one lookup/preparation total. These are fixture measurements, not live TorBox timings. Uncached and identity-conflicting first batches waited for the later correct cached source with zero uncached additions. Existing 24-device/288-start/576-seek stress checks still produced zero media-body bytes and zero upstream media fetches.

Publication is verified. Release reliability run [38105436191](https://github.com/to-shreds/torbox-web-player/actions/runs/38105436191) and Pages verification/deployment run [38105435564](https://github.com/to-shreds/torbox-web-player/actions/runs/38105435564) both completed successfully on the exact runtime commit. At `2026-10-11T03:15:45Z`, live root and `/key/` HTML, boot, app, source-client, playback-lifecycle, service worker and recovery HTML all returned HTTP 200 and matched the tested repository files byte for byte. The prior runtime remains at `archive/web-before-startup-2026-10-10`, SHA `644faeddaccb9e2f1a152dade1c034cf077d5bd2`.

Report: [docs/STARTUP-1.2.1.md](docs/STARTUP-1.2.1.md). Prior Sports/artwork, state/PIN/history formats, cached-only automatic selection, exact year/episode/browser-container checks, source feedback, credits behavior, same video DOM and direct TorBox media delivery remain intact. The independent native app is maintained separately.

Backend activation verified at 2026-10-11T03:38:11Z. Render deployment `dep-db5g8ng473hc73b26ukg` is live from mirror commit `df150eebe184711772c01faca3a5a0bab15da404`, whose tree exactly matches tested release `2a3f8c3f84e108178477c0fb4a8ee23a235d0e12`. The branch update produced no automatic deployment during repeated checks. Merging the required non-secret `SOURCE_PROVIDER=multi` setting triggered one deployment, which passed 358 Node tests with zero failures. No separate manual deployment was triggered. Production `/healthz` returned HTTP 200 and version 1.2.1; `/api/session` retained API-key mode, source lookup without login returned 401, and the served source-client asset has the current startup token. No recent post-deploy error logs were returned. Real authenticated TorBox/CDN and physical device timing remain unmeasured.

## Buffstreams investigation · 2026-10-10

The user identified `https://mybuffstreams.plus`, which redirects to `/home6`, and requested football live/replays without subscriptions or VPN dependence. Direct probes of two college-football server choices exposed public HLS through `gooz.aapmains.net` and `chatgpt.hereisman.net`, followed by `red.redirector1.space` and two verified R2 accounts. Native-style requests with the public player Referer returned masters, variants and MPEG-TS segments; a bounded segment probe identified 720p H.264/AAC.

This does **not** establish a compatible standalone browser source. Playlist requests with Origin `https://to-shreds.github.io` returned 403, segment CORS only allowed the provider origin, and the provider's `frame-ancestors` allowlist excludes GitHub Pages. An actual sandboxed Chrome frame test was rejected by that policy. Do not add a nonworking iframe tile, forward TorBox credentials, introduce a media-byte relay, or describe live listing pages as a replay archive.

The separate native project adds a 0.2.1 test connector with refreshable football/NHL listings, server selection and an editable source address. Its current build/verification/readiness is controlled by its own handoff and ProjectStatus. Buffstreams full-game archives remain unverified. This investigation changes documentation only: the web runtime remains `release-1.2.0-sports.1`, with its existing four channels and sixteen padel sessions. Render remains untouched. Next browser action is to find a provider that permits our origin and direct video access, or a materially different user-authorized playback arrangement.

## Sports feature · 2026-10-10

Frontend build **release-1.2.0-sports.1** adds Sports before private-service startup/login. The static app contains its catalog and Apache-licensed hls.js 1.6.15. Four free live channels are T2 tennis, Red Bull TV, Pickleball TV and NHL classics/coverage. Sixteen full Premier Padel sessions cover Paris, Malaga, Bordeaux and Valladolid in 2026. This is a bundled replay snapshot; no automatic event-index refresh or promise of every tennis tournament is implemented.

The current anonymous provider endpoint is `https://api-player.redbull.com/rbcom/videoresource?videoId=<public-rrn>`. Only the public identity is sent, with credentials omitted and no redirects. Playability errors are respected; returned media URLs and HLS requests are restricted to exact verified HTTPS hosts. Scores, result descriptions and images are discarded. Default HLS quality is capped at 720p, with 480p/1080p/Auto options. Live uses Go Live; replay uses local bookmarks and Start Over. Closing/navigation cancels obsolete playback. Sports requires an adult viewer. Browser native-HLS fallback uses the browser's own adaptive selection.

Sports media goes directly from the public provider to the device. It has no TorBox API/login requirement or Render video path. Existing private API CSP remains local; only the static HTML shell permits the exact sports API/CDNs and MediaSource blob playback. TorBox media/key validators and state formats remain unchanged. Module/cache tokens are bumped together. The separate native APK is maintained independently.

Local checks: 351 Node tests registered, **345 passed, 0 failed, 6 optional checks skipped**; all **20 browser scenarios passed**, including five new sports HLS/resume/cancellation/error/Kid Mode scenarios. Browser media tests are synthetic. Real source probes confirmed HLS masters, variants and first segments for T2/Red Bull TV and one full padel replay, including CORS and replay ENDLIST. Real external Chrome playback started for T2, Red Bull TV and a Paris padel replay; details are recorded in the sports report. No authenticated TorBox test or native Firestick acceptance is claimed.

Runtime commit `ac963c89d15c6a2070cfd375aa80ade943121f29` is on main and `release/v1.2.0-sports.1`. Release checks [38090258168](https://github.com/to-shreds/torbox-web-player/actions/runs/38090258168) and Pages verification/deployment [38090379801](https://github.com/to-shreds/torbox-web-player/actions/runs/38090379801) succeeded. The previous main SHA `4e57131b3d981acb80a0e0f7e52256130a8204af` remains at `archive/web-before-sports-2026-10-10`. Published root/key assets are verified against the tested tree. This task does not deploy or reconfigure Render; its earlier backend workspace gate remains.

## Artwork patch · 2026-10-10

The user expressly authorized a narrow artwork fix in both the independent TV app and this browser app. Live probes of Unabomber (tt6933238), East of Eden (tt21097264) and War (tt37972251) showed valid JPEGs redirected from images.metahub.space to **live.metahub.space**. The production HTML image CSP excluded that exact host, causing otherwise valid posters to disappear.

Frontend build **release-1.2.0-artwork.1** adds the exact live image host, an exact-title medium-size fallback and one delayed/cache-bypassed retry. Failures stop after at most three attempts; detached cards do not start more requests. Poster grids, My List, details, Next Up and Continue Watching use the common image binder. The scoped shell cache token and module query versions are bumped consistently so installed PWAs receive the patch. Script sources remain self-only. Playback, catalog/server contracts, settings, credentials and media routing are unchanged.

Local syntax checks passed. The full Node suite reports 345 registered, **339 passed, 0 failed, 6 optional live/account checks skipped**, including eight new artwork regressions. All **15 browser tests passed**, including actual DOM/CSP artwork checks and the existing synthetic-media reliability scenarios. Browser checks cover the new host/CSP and an untrusted-host failure that recovers by exact title ID, plus existing playback/UI scenarios. Publication completed: release reliability run **38078694331** and Pages verification/deployment **38078799950** both succeeded. The published root and `/key/` HTML and boot modules were fetched afterward and confirmed the exact live image host and `release-1.2.0-artwork.1` token. Runtime commit: `a28c9a4b99b001c46ecfe1cc3a6ff28c84c73351`. Rollback branch: `archive/web-before-artwork-2026-10-10`, original SHA `9fc15eccb9a3ffefc6e63ac76e982bfa8d738790`. Original root/backend implementation remains 1.2.0 and the last observed live Render backend remains 1.1.0. Do not mirror or restart Render as part of this frontend fix.

The previous main tree is preserved before publication at an archive branch and in Git history. TorBox TV sources/APKs/releases remain independent. No TV build or rollback changes this frontend.

## Current work

Release 1.2.1 startup implementation and publication are complete. Frontend `release-1.2.1-startup.1` is live on GitHub Pages; Render runtime 1.2.1 is live with `SOURCE_PROVIDER=multi`. Workspace confirmation is resolved and recorded above. Authenticated account/device acceptance remains separate.

- Frontend: https://to-shreds.github.io/torbox-web-player/ and equivalent `/key/`; recovery `/recover/`.
- Backend: https://torbox-web-player-key.onrender.com
- Service: `srv-damu91142hec73chb7qg`, plan free, branch `browser-key-clone`.
- Tested runtime: `2a3f8c3f84e108178477c0fb4a8ee23a235d0e12`, tree `5d5b2fce9bd1200442e3247bef9d985a59291634`.
- Live mirror: `df150eebe184711772c01faca3a5a0bab15da404`, identical tested runtime tree; prior mirror `7dfdac6ba47158c24e4af1601910c9e94872c356` is retained as its parent.
- Live deployment: `dep-db5g8ng473hc73b26ukg`, completed 2026-10-11T03:37:34Z. Health/version and API-key guards verified.
- Mirror CI [38108844386](https://github.com/to-shreds/torbox-web-player/actions/runs/38108844386) succeeded. Original release/Pages CI `38105436191`/`38105435564` and asset verification remain valid.
- Earlier production deployment `dep-dau627hsrm7s73au7bg0`, runtime `1fa271e8418105431a2aae079538e28de3cf2d81`, remains historical rollback evidence.
- Existing startup archive `archive/web-before-startup-2026-10-10` preserves `644faeddaccb9e2f1a152dade1c034cf077d5bd2`. Earlier archive `archive/v1.1.0-before-reliability-2026-10-01` preserves `c978c143cf5362a5c7ddd1bcee34811ca5a0f219`.

## Implemented v1.2.0 contract

No video byte relay is permitted. Owner playback receives an opaque ticket and follows a 307 redirect to TorBox. Guest playback also requires a direct link that does not contain the owner key; otherwise it fails clearly. The old media relay implementation has been removed. New Google Drive exports are disabled; old cleanup routes remain. No paid service, extra video storage, transcoding, or artificial keepalive was added.

TorBox may embed the master API key in the owner CDN URL. This is allowed only for the owner's authenticated ticket path; normal playback JSON and guest responses remain key-free. Source providers receive public title identity only.

## Changes and evidence

See `docs/RELEASE-1.2.0.md` for the full measured report and rollback procedure. Changes address device interference, blocking progress writes, cold-start failure, startup retry, session reconnection, obsolete Play/Resume actions, never-starting media, Resume source fallback, missing vault module, cache isolation, and source/ticket capacity bounds.

The baseline had 316 passing tests and six skipped optional checks. Seven new HTTP scenarios reproduced old failures. Final local and release CI results are 337 registered tests, 331 passed, zero failed, six optional checks skipped, plus all 13 browser scenarios passing. The local stress run exercised 24 devices, 288 playback starts, and 576 seeks with zero media-body bytes and zero upstream media fetches. Browser tests use the actual UI/API plus synthetic TorBox data and synthetic video. Physical Android and live TorBox acceptance remain separate.

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

No implementation or deployment gate remains for this startup release. Use the existing confirmed workspace for future authorized Render work. Preserve the tested runtime tree and prior archives; do not change video delivery into a Render relay.

Next acceptance checks are live Android start, Resume, seeking, fullscreen/PiP episode transition and actual Render bandwidth after playback. No live TorBox credential was supplied to the stress-test fixtures or production verification. The previous Office S4E3 source/cache case has not been retested against an authenticated account; do not claim that specific title's live issue is resolved. Update ProjectStatus last after any new acceptance evidence.
