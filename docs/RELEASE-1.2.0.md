# Release 1.2.0: reliability and direct playback

Scope: improve actual failures, responsiveness, and operating limits while preserving the working browser-key player. No redesign or new hosting service.

## Publication state

The verified runtime is `081ef97567a0dc6cca45285312bb530c5bde9dac`. GitHub Pages [run 36814776986](https://github.com/to-shreds/torbox-web-player/actions/runs/36814776986) passed verification and deployment. Both the published root and `/key/` boot scripts report `release-1.2.0`.

The matching Render mirror is `7dfdac6ba47158c24e4af1601910c9e94872c356`. Its CI is green, but the live backend still reports v1.1.0 and deployment `dep-dau627hsrm7s73au7bg0`. No automatic deployment appeared. The Render connector rejected a manual trigger because it requires explicit user confirmation of the workspace. The available workspace is `My Workspace`; no deployment, service configuration change, or plan change was made through Render. Backend publication must be completed before treating the changes below as the live backend contract. In particular, the old backend can still relay guest video until it is replaced.

## Archive and rollback

The exact preceding main revision `c978c143cf5362a5c7ddd1bcee34811ca5a0f219` is preserved remotely on `archive/v1.1.0-before-reliability-2026-10-01`. Its runtime is equivalent to the preceding Render mirror revision `1fa271e8418105431a2aae079538e28de3cf2d81`. The archive includes the full source, tests, workflows, documentation, and lockfile. Browser-local history, settings, and encrypted credentials use their existing storage formats.

To roll back, restore that archive's complete tracked tree into a new commit on main, verify it, and mirror the same runtime tree to browser-key-clone. Deploy both sides and confirm `/healthz` and the published boot version. Do not force-reset shared history. Use `/recover/` after rollback if a browser retains the newer shell. The archive restores the OLD guest relay too, so do not use guest playback after rollback without addressing that bandwidth path.

## Fixes tied to evidence

| Failure or delay | Change | Verification |
| --- | --- | --- |
| Guest video still traversed Render | Removed the media relay implementation and its server route path. Every supported stream is a header-only redirect to TorBox. Guests need a key-free direct link or receive a clear failure. | Owner/guest HTTP tests, unsafe-link rejection, 576 seek redirects with zero media-body bytes or upstream media fetches. |
| Other storage could impose a movie-size quota | Disabled new Drive connection/export actions and hid their UI. Kept status/delete for cleanup. | Both creation endpoints reject without an external operation. |
| Devices sharing Viewer 1 replaced one another's requests and resume leases | Scoped playback intents, progress, and operational limits to the authenticated device session. Browser history remains canonical. | Deliberately interleaved requests and progress updates on separate sessions. |
| An episode transition waited for a slow progress write | Save locally immediately and send the temporary server copy in the background with a four-second limit. Background authentication failures do not stop current media. | Browser auto-next test injects a six-second progress delay, verifies a changed media source and actual advancing playback on the identical video DOM element. |
| Startup failed after 22 seconds despite a normal Render cold start | Startup session check gets a bounded 65-second budget, at most two transient retries, and a working Try again button. | Browser successfully starts with a 23-second delayed backend response; simulated 503 failures recover through Try again. |
| Browse waited for status checks | Start catalog loading independently, coalesce simultaneous status checks, and share public catalog cache across sessions. | Catalog renders while a four-second check remains pending; 24 simultaneous checks use one account request and one public status request. |
| Restarted backend forced needless manual sign-in | Single-flight reconnection uses the existing encrypted remembered key when a foreground request is rejected as unauthenticated. | Browser invalidates its backend session, opens a title, and verifies exactly one fresh sign-in. |
| Canceled or older Play/Resume work could open late | Latest-choice cancellation spans source lookup and preparation, plus player request cancellation. Added a Cancel control to Resume. | Slow lookup cancellation, closing a title, rapid episode selections, and 100 queued-choice lifecycle test. |
| A stream never reaching metadata could sit forever | A 25-second initial-media watchdog enters the existing bounded cached-source recovery path. | Browser with withheld media reaches an explicit failure and clears the overlay. The test accelerates only that timer. |
| Resume lacked the normal in-app source fallback | Resume now presents the same explicit Prepare & Play choices while preserving resume/start-over intent. | No torrent write before clicking; one write after explicit selection and actual synthetic playback. |
| Render mirror omitted vault.js | Serve the missing startup module. | HTTP module check and real browser boot. |
| Service worker deleted other applications' caches on the same origin | Scope cache names and cleanup to this application path; scope offline lookup too. | VM activation test preserves unrelated app caches and the legacy /key/ cache. |
| Simultaneous source registration could pass a stale capacity check | Recheck capacity after asynchronous availability work. | Dedicated concurrent registration test. |
| Repeated playback accumulated unused tickets | Keep the eight newest tickets per session under a bounded overall limit. | 24-device, 12-episode test remains bounded at 192 tickets. |

## Test method and limits

Baseline: 322 tests registered, 316 passed, six optional live/account probes skipped. Seven newly written HTTP scenarios failed against the old implementation and passed after the fixes.

Final local verification: 337 tests registered, 331 passed, zero failed, and the same six optional live/account probes skipped; all 13 browser scenarios passed. Independent [release CI run 36814630892](https://github.com/to-shreds/torbox-web-player/actions/runs/36814630892) reproduced those exact totals. The Render mirror also passed [CI run 36814779367](https://github.com/to-shreds/torbox-web-player/actions/runs/36814779367).

The synthetic stress scenario uses 24 independent device sessions, 288 playback starts, and 576 Range requests. Its first measured run completed in 504 ms, with median 37 ms and 95th percentile 50 ms for each local start-plus-two-seeks sequence. These are local fixture timings, not Internet playback benchmarks. The critical result is zero upstream media fetches and zero media response-body bytes.

Browser tests run the real UI and real local application API with injected public metadata and TorBox control responses. A generated, silent 120-second MP4 supplies video. The harness checks the real server's 307 redirect and empty body, then supplies synthetic CDN bytes through Playwright routing because Playwright intercepts only the first URL in a redirect chain. These tests do not verify Jon's live TorBox account or Android hardware codecs.

Reproduce:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

`CHROME_EXECUTABLE` can select an installed compatible Chrome or headless shell. The fixture is generated with:

```sh
ffmpeg -f lavfi -i color=c=navy:s=160x90:r=1 -t 120 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart test/fixtures/fixture.mp4
```

Release-branch CI runs the browser tests. GitHub Pages now requires the same verification before publication. Nothing in these tests downloads a real torrent, accesses a real account, or load-tests public providers.

## Service constraints and remaining acceptance

- TorBox delivers original media directly. MKV/AVI and risky codecs are not newly enabled; no transcoding or paid-plan upgrade was added.
- The existing Render free service still handles metadata, authentication, preparation, and tiny redirects. Its cold starts and outages remain possible. No artificial keepalive or always-on paid instance was introduced.
- Public source providers are anonymous metadata dependencies, with existing timeouts, fallback, caching, and cooldown behavior. Their availability cannot be guaranteed.
- Guest-safe direct links are unavailable if TorBox embeds the owner's master key. The app refuses that guest path rather than expose the key or spend Render bandwidth.
- On owner playback, TorBox's key-bearing URL can still be visible in the owner's browser network stack. It is absent from normal playback JSON and page state.
- Live Android playback, seek behavior, OS fullscreen/PiP policy, and actual account/cache availability still need device acceptance. Synthetic browser verification is not a substitute for that acceptance.

A read-only live probe on 2026-10-01 retrieved The Office metadata (208 episodes) in about five seconds. The S4E3 source lookup reached its ten-second bound and returned 11 Zilean rows with no known browser container in their public metadata. No TorBox credential was used, so this did not establish cache availability or playable files. This release does not claim to resolve that title-specific live acceptance question. The pre-release production health request returned v1.1.0 after about 18.7 seconds, consistent with the need to tolerate a slower backend startup.

Official service references: [Render free service limits](https://render.com/docs/free), [TorBox download-link API](https://github.com/TorBox-App/torbox-sdk-js/blob/main/documentation/services/TorrentsService.md).
