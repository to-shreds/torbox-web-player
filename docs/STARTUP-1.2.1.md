# Playback startup patch 1.2.1

Source baseline: main `644faeddaccb9e2f1a152dade1c034cf077d5bd2`. Backend version: `1.2.1`. Frontend/cache/module build: `release-1.2.1-startup.1`.

## What the current browser app actually did

The browser app already retained provider caches and prepared the next episode during the credits window. It also stopped preparing alternatives when the first usable cached file was found. These differed from the inspected native baseline. Its remaining avoidable delay was waiting up to the 10-second aggregate-provider deadline when only one useful provider had answered, plus starting movie/episode preparation after Play rather than on the title page.

## Changes

Automatic playback requests the first useful public source batch after a 200ms aggregation grace. The same bounded search continues collecting late results into the existing cache. Options keep their prior aggregation behavior. A `complete=1` request shares the current job and waits for its remaining providers up to the existing deadline; it never turns an incomplete early batch into a permanent exclusion of slower alternatives.

Exact catalog identity/year/episode checks and TorBox cached/file/container checks still precede playback. If the fast batch has no usable cached file or is rejected by identity checks, automatic playback waits for the complete batch before displaying the existing explicit Prepare & Play choices. Recovery requests the complete list so slower alternate sources remain available.

Opening movie details prepares a cached version in the background. Show details warm the applicable resume/next/first episode; focusing or pointing at a Play button warms that exact episode. Warm work and Play/Resume share one short-lived preparation, so Play does not repeat completed lookup/registration/preparation. The device stores only session-local metadata/file identities, capped at eight entries with a 60-second reusable lifetime. No speculative video-byte fetch is added. Playback still requests a fresh media link/lease through the existing API when actually starting.

Automatic next-episode preparation begins after 30 seconds of playback, or halfway through a shorter video, once per episode. The existing credits prompt, media-time countdown, pause handling and Still Watching behavior are preserved. A failed early attempt can still be retried by the established credits/end transition.

Closing a title aborts pending warm work. Closing/canceling a sole Play/Resume/next waiter cancels its API work. A canceled waiter cannot reopen the player or invalidate another waiter sharing a title warm. Completed preparations are cleared on session suspension, viewer change and settings changes. Source feedback is rechecked before reuse. The same video DOM element survives episode changes.

## Verification

- `npm run check` and `git diff --check`: passed.
- Full Node suite: 364 registered, **358 passed, 0 failed, 6 optional live/account checks skipped**.
- Full browser suite on the published commit: **26 passed, 0 failed**, verified in release CI. Actual app UI/API/CSP and generated local media were used, with the production header-only CDN redirect verified before the synthetic media substitution.
- Backend slow-provider fixture: a single useful provider returned the fast batch in approximately **203ms** while another was held. The complete request retained both providers without duplicate lookups. Unsupported-only early results waited for a useful provider. Incomplete-cache expiry, hard bounds, four-target concurrency and authentication/identity contracts passed.
- Browser details warm with a **1,000ms synthetic source-lookup delay**: Play reached the first synthetic frame in **50ms** locally and **55ms** in release CI, with one lookup and one preparation total. This measures removing already-finished source work, not TorBox CDN or physical device performance.
- Fast uncached-first / later cached exact-source browser test: complete batch used, one cached preparation, zero uncached creations, successful playback, no premature fallback chooser.
- Uncached details warm: zero preparation calls, zero creates, no player open. Closing pending warm and canceled Resume prevented late playback. Next episode warmed before credits and reused its file at the transition.
- Existing resume/seek, rapid episode selection, session recovery, fullscreen/PiP DOM preservation, Kid Mode, artwork and Sports regressions passed.
- Existing stress fixture again completed 24 devices, 288 playback starts and 576 seeks with zero upstream media fetches and zero media-body bytes from the application.

## Publication and practical limits

Runtime commit `2a3f8c3f84e108178477c0fb4a8ee23a235d0e12` is published on main and `release/v1.2.1-startup`. Release reliability run [38105436191](https://github.com/to-shreds/torbox-web-player/actions/runs/38105436191) succeeded with 358 Node tests passing, six optional checks skipped and all 26 browser scenarios passing. Pages verification/deployment run [38105435564](https://github.com/to-shreds/torbox-web-player/actions/runs/38105435564) also succeeded on the same commit, including its verification and deploy jobs.

Live asset verification at `2026-10-11T03:15:45Z` fetched the following paths from both `https://to-shreds.github.io/torbox-web-player/` and its `/key/` entry. All fourteen responses returned HTTP 200 and matched the tested repository bytes exactly. HTML, boot, app, source-client and service worker contain the current `release-1.2.1-startup.1` token.

| Path at each entry | Verified SHA-256 |
| --- | --- |
| `index.html` | `eb3820be4ae0cf20c23072890be96932737ba4040716190d20eda21736771861` |
| `boot.js` | `4a3a945d82d91c289f9ff75a27503076d56cd00ff54ea97945bda224153168c7` |
| `app.js` | `7013fc6bb3c0cce6e8cf090ef15bbf4e55dafde4bbec94aa185885a8f25354bf` |
| `source-client.js` | `edf5b68e68002248117f2e80a63f0dfe64a0c17bdfc54c086e64eee794f2f531` |
| `playback-lifecycle.js` | `5c05c804601cdc2f63dcc7a478ad7812b38e867f0d1fe6249a2834171ff632a1` |
| `sw.js` | `6b0e56af13acf0b857d226267bb76f3100ff558ce4d12f7e2b344553153307b7` |
| `recover/index.html` | `39af51066679a7bbc164eeedc0270d8b2dd2db64253d0585b491782a382bb06d` |

The previous runtime is preserved by `archive/web-before-startup-2026-10-10` at baseline SHA `644faeddaccb9e2f1a152dade1c034cf077d5bd2`. Do not reset shared history to roll back; restore the archived tree as a new commit.

The backend rollout is complete. Deployment `dep-db5g8ng473hc73b26ukg` is live from mirror `df150eebe184711772c01faca3a5a0bab15da404`, using exactly tested tree `5d5b2fce9bd1200442e3247bef9d985a59291634`. Mirror CI [38108844386](https://github.com/to-shreds/torbox-web-player/actions/runs/38108844386) succeeded. Render's build reran 364 Node tests: 358 passed, zero failed, six optional checks skipped. The required `SOURCE_PROVIDER=multi` setting was merged without replacing other environment variables and triggered the deployment after the branch push produced no automatic deployment. No redundant manual deployment was triggered.

At 2026-10-11T03:38:11Z, production health returned HTTP 200 and `{"ok":true,"version":"1.2.1","stage":"catalog-first-preview"}`. Session inspection retained `authMode=api-key` and no setup requirement; unauthenticated fast source lookup returned 401. The source-client asset served HTTP 200 with the current startup token. Recent post-deploy error logs were empty. The user confirmed My Workspace and requested it as the standing selection for future authorized Render work; that former gate is resolved.

No real TorBox credential, authenticated CDN start, physical Android/Firestick measurement or promise of instant playback is included. Slow TorBox preparation, source availability, CDN response, device decoding and the existing service-readiness check can still contribute delay. There is no new service, bandwidth relay, persistent video storage or transcoding. Sports, history/settings/PIN formats, TorBox key isolation, cached-only automatic selection and explicit uncached preparation remain intact.
