# TorBox Web Player handoff

Read this first. The code repository controls implementation; `to-shreds/ProjectStatus/projects/torbox-web-player/STATUS.md` controls readiness and the next action.

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

Release 1.2.0 is implemented and independently verified. The frontend is live on GitHub Pages, but the Render backend is still v1.1.0. Backend publication is the sole blocked implementation step: the Render connector requires the user to confirm its workspace before `trigger_deploy` can proceed. Do not claim that the v1.2.0 backend or direct-only guest policy is live yet.

- Frontend: https://to-shreds.github.io/torbox-web-player/
- Equivalent legacy entry: `/key/`; permanent recovery entry: `/recover/`.
- Backend: https://torbox-web-player-key.onrender.com
- Render service: `torbox-web-player-key`, `srv-damu91142hec73chb7qg`.
- `main` is authoritative. Render still watches `browser-key-clone`; publish a matching runtime tree there.
- Current frontend build: `release-1.2.0-sports.1`; scope-specific service worker cache. The following 1.2.0 runtime/mirror checks are the preceding baseline; current Sports and artwork publication are recorded above.
- Verified release runtime: `081ef97567a0dc6cca45285312bb530c5bde9dac`, on main and `release/v1.2.0-reliability`.
- Prepared Render mirror: `7dfdac6ba47158c24e4af1601910c9e94872c356`. Its entire tree matches the verified runtime commit.
- Release CI `36814630892`, Pages verification/deployment `36814776986`, and mirror CI `36814779367` all succeeded.
- Both published root and `/key/` boot scripts were checked and report `release-1.2.0`.
- Render still reports live deployment `dep-dau627hsrm7s73au7bg0`, from the prior mirror, and `/healthz` still reports `1.1.0`.
- The exact existing service was inspected: `plan: free`, branch `browser-key-clone`, auto-deploy enabled. No automatic deployment appeared after publication. The manual trigger returned `INVALID_ARGUMENT` because no workspace was confirmed; it did not start a deployment.
- The connector lists one workspace, `My Workspace` (`tea-dakujgmk1f9s73d2v8ng`). It explicitly requires asking the user before selecting or passing that workspace. Do not bypass this gate with another deployment path.
- Exact prior source archive: `archive/v1.1.0-before-reliability-2026-10-01`, commit `c978c143cf5362a5c7ddd1bcee34811ca5a0f219`.
- Prior Render runtime: `1fa271e8418105431a2aae079538e28de3cf2d81`. It differs from the archive only in docs/config comments.

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

Ask the user to confirm `My Workspace` for deployment of the already verified `torbox-web-player-key` service. Once confirmed, recheck deployments first to avoid duplicating a late automatic deploy, then trigger the prepared mirror if still necessary using the confirmed workspace ID. Verify its deployed commit and `/healthz` version 1.2.0, then update this handoff and ProjectStatus last.

After publication, confirm live Android start, resume, seeking, fullscreen/PiP episode transition, and actual Render bandwidth after playback. No live TorBox credential was supplied to the stress-test fixtures. A read-only live source probe returned only 11 Zilean rows for The Office S4E3, with no known browser container in public metadata; cache availability and matching playable files were not checked. Do not claim that specific title's live issue is resolved.
