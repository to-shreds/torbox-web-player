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
- Full browser suite: **25 passed, 0 failed**, followed by one additional passing exact-episode identity fallback scenario; the current suite has 26 scenarios. Actual app UI/API/CSP and generated local media were used, with the production header-only CDN redirect verified before the synthetic media substitution.
- Backend slow-provider fixture: a single useful provider returned the fast batch in approximately **203ms** while another was held. The complete request retained both providers without duplicate lookups. Unsupported-only early results waited for a useful provider. Incomplete-cache expiry, hard bounds, four-target concurrency and authentication/identity contracts passed.
- Browser details warm with a **1,000ms synthetic source-lookup delay**: Play reached the first synthetic frame in **50ms** on the final run, with one lookup and one preparation total. This measures removing already-finished source work, not TorBox CDN or physical device performance.
- Fast uncached-first / later cached exact-source browser test: complete batch used, one cached preparation, zero uncached creations, successful playback, no premature fallback chooser.
- Uncached details warm: zero preparation calls, zero creates, no player open. Closing pending warm and canceled Resume prevented late playback. Next episode warmed before credits and reused its file at the transition.
- Existing resume/seek, rapid episode selection, session recovery, fullscreen/PiP DOM preservation, Kid Mode, artwork and Sports regressions passed.
- Existing stress fixture again completed 24 devices, 288 playback starts and 576 seeks with zero upstream media fetches and zero media-body bytes from the application.

## Publication and practical limits

This report records the tested local tree. Root publication and CI checks are recorded in HANDOFF after they complete. The previous runtime is preserved by `archive/web-before-startup-2026-10-10` at the baseline SHA. Do not reset shared history to roll back; restore the archived tree as a new commit.

The frontend remains compatible with the last observed live 1.1.0 backend. That backend safely ignores the new optional lookup parameters and lacks completion metadata, so title/episode warming still works, while the new 200ms provider-return path requires the 1.2.1 backend deployment. The existing Render connector workspace confirmation gate remains in force. No backend deployment is claimed by these local tests.

No real TorBox credential, authenticated CDN start, physical Android/Firestick measurement or promise of instant playback is included. Slow TorBox preparation, source availability, CDN response, device decoding and the existing service-readiness check can still contribute delay. There is no new service, bandwidth relay, persistent video storage or transcoding. Sports, history/settings/PIN formats, TorBox key isolation, cached-only automatic selection and explicit uncached preparation remain intact.
