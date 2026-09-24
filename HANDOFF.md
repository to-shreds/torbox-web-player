# TorBox Web Player Handoff

Use this file first when resuming the project. The repository controls implementation. `to-shreds/ProjectStatus/projects/torbox-web-player/STATUS.md` controls readiness and the immediate next action.

## Production baseline

The restored browser-key v1.1 player is the only production baseline. Jon reported on 2026-09-20 that the repaired player was working again before the credits/auto-next enhancement below.

- Version: **1.1.0**
- Source of truth: `main`
- Main runtime commit: `d3db9d19a720ef96e26ad7c58798fda90a4c8351`
- Render deployment mirror: `browser-key-clone`
- Mirror runtime commit: `30d9385e12dbed35aca1bd999ef08cbfc8bcdf2c`
- Public app: `https://to-shreds.github.io/torbox-web-player/`
- Legacy URL: `https://to-shreds.github.io/torbox-web-player/key/`
- Render service: `torbox-web-player-key` / `srv-damu91142hec73chb7qg`
- Render URL: `https://torbox-web-player-key.onrender.com`
- Live Render deploy: `dep-daqauq0u01pc73fgq4a0`
- PWA cache: `torbox-player-v1.1-restored12`

Render still deploys `browser-key-clone`. Keep that branch runtime-equivalent to `main` until the service can be repointed to `main`.

## Simplified playback contract

Simple mode must never expose the torrent/source picker as an automatic fallback from Play, Resume, auto-next, or recovery. The source picker is an explicit Full-mode Options tool only.

Automatic playback may use cached sources only. It must never silently begin an uncached download. If no cached browser-compatible source exists, Play may offer one explicit confirmation to prepare a browser-compatible version in TorBox; declining that confirmation must leave the account unchanged. Cached multi-file packages may select a browser-compatible matching file automatically. Known unsupported containers must be rejected before normal Android Chrome playback.

Do not reintroduce automatic `openOptions()`, silent uncached preparation, direct TorBox media URLs, or any failed 2.x source-selection path.

## Catalog contract

IMDb Suggest is fallback discovery only. A fallback suggestion must resolve through Cinemeta metadata before it can appear as a clickable card. A Cinemeta 404 means the title is not available in the catalog, not that the catalog itself is down.

## Architecture to preserve

GitHub Pages serves the UI. Render performs catalog/search, source discovery, TorBox cache/preparation operations, playback-link generation, and protected byte-range relay. The browser receives only an opaque `/media/<ticket>` path. The relay transports original bytes. There is no transcoding, remuxing, or HLS implementation.

## Credits and Up Next behavior

The old behavior waited for the HTML video `ended` event and then started the countdown. That has been replaced.

- Default Up Next lead time is **45 seconds before the end**.
- The lead time is configurable: Off, 20, 30, 45, or 60 seconds.
- Very short videos use a reduced lead window, capped at about 8% of duration with a five-second minimum.
- The existing next-episode countdown remains configurable and defaults to **8 seconds**.
- The countdown is driven by media time, not a wall-clock interval. Pausing freezes it. Buffering does not run it down.
- Seeking backward out of the credits window cancels the pending early transition and its prewarm work.
- The Up Next card now has **Play next now** and **Watch credits**.
- Play next now transitions immediately.
- Watch credits cancels the early countdown for that episode, keeps the next episode prewarmed, and advances immediately when the current episode actually ends.
- If auto-next is disabled, the credits-window card still provides Play next now without a countdown.
- If the early credits logic never arms, `ended` remains the safety net. With auto-next on, it advances immediately rather than starting a new dead-video countdown.
- The next episode is prepared during the credits using the same bounded cached-only source path. No uncached download is started and no source chooser is exposed.
- An episode skipped during credits is marked completed only after the next playback successfully takes over. Its original duration is snapshotted before the old video element is detached so completion history remains accurate.

## Continue Watching behavior

Continue Watching is now a show-level surface rather than a raw episode history list.

- Finished entries never appear in Continue Watching.
- For a series, only the newest history entry for that show is considered. Older partially watched episodes do not reappear underneath a newer episode.
- If the newest entry for a show is completed, the show disappears from Continue Watching until a newer episode actually starts.
- The underlying history is preserved for episode progress and Next Up logic while the card is present; the deduplication itself is a presentation rule.
- Removing a show from Continue Watching removes all stored episode-history rows for that show, so an older episode cannot immediately pop back into the shelf.
- Normal tap still resumes the displayed episode.
- Long-pressing a Continue Watching card opens the title as a whole. For a series, the episode list opens on the season containing the current Continue Watching episode.
- Desktop/right-click context-menu behavior mirrors the long-press shortcut.
- The old setting that allowed finished titles to appear in Recently Played has been removed. Continue Watching now has one unambiguous meaning.
- The long-press setting label is now general rather than poster-specific.

## Fullscreen and Picture in Picture behavior

Jon's physical screenshot showed that the first fullscreen fix did **not** solve the real Android Chrome path. The visible control was still Chrome's native video fullscreen UI, and Android Chrome ignored the attempt to suppress that control. The custom fullscreen/PiP controls were not obvious enough. The implementation was therefore changed again at the architectural level.

- The same actual `<video>` DOM element is now reused across episode changes, auto-next, and recovery. The source URL and playback context change, but the media element itself is not removed.
- This directly targets the real failure: Chrome native fullscreen and standard video PiP are both tied to the media element. Replacing that element used to destroy those presentation modes.
- Native Chrome fullscreen is no longer suppressed. The familiar fullscreen icon can be used.
- A clearly visible **Display** row above the video also provides **Full screen** and **Picture in picture** controls.
- The app-managed Full screen button still targets the persistent `#player-media-shell` for browsers where that works better.
- Rotation tracking and best-effort fullscreen restoration remain.
- PiP is no longer hidden when unsupported. The button reads **PiP unavailable** and is disabled when the browser does not expose the standard API, making the device capability explicit.
- Because auto-next now reuses the same video element, PiP has a materially better chance of surviving episode transitions as well. Chrome/Android can still terminate PiP or fullscreen for OS/browser reasons, which the web app cannot override.
- Event listeners are attached through a per-playback AbortController so the reusable video element does not accumulate stale handlers from prior episodes.

## PiP wake and fullscreen exit behavior

Jon confirmed the stable-video architecture fixed fullscreen persistence and PiP itself. Two follow-up usability issues were then addressed.

- PiP now keeps the existing Screen Wake Lock request active instead of the app explicitly releasing it merely because the main page becomes hidden.
- Entering and leaving PiP refreshes the wake-lock request, and visible playback continues to reacquire it when needed.
- This is a best-effort browser API path. Android Chrome may still revoke Screen Wake Lock automatically when the underlying document is hidden even while a PiP window remains visible. If the screen still sleeps after this build, that remaining behavior is browser/OS policy rather than an app-side release.
- Fullscreen now contains a dedicated **Exit full screen** button in the persistent player shell.
- The button appears when fullscreen is entered or the screen is touched and stays visible for about 3.2 seconds.
- When the button is hidden, the first tap directly on the video is intercepted only to reveal the exit control. That first reveal tap is not allowed to fall through to Chrome's progress bar, preventing the accidental seek Jon reported.
- A second tap can interact normally with the video controls.
- If Chrome enters native video fullscreen, the app makes a best-effort promotion to the persistent player-shell fullscreen so the exit overlay can be rendered.

## Startup-crash correction

The first restored9 fullscreen-exit build contained a selector typo that prevented the module from reaching `bootstrap()`: the HTML element is `fullscreen-exit-overlay`, but the startup event binding looked for `exit-fullscreen-overlay` and called `.addEventListener()` on null. On Android this presented exactly as the app sitting forever on **Opening · Checking this session**.

The selector is corrected. A new regression now scans every static `$('...')` lookup in `app.js` and fails CI if the corresponding published HTML id does not exist, specifically preventing this class of startup failure from recurring.

## Sticky-cache startup recovery

Restored10 corrected the selector typo, but Jon still saw the exact unchanged **Opening · Checking this session** screen. That strongly indicates the device was still executing the previously cached broken module rather than restored10: the corrected app either reaches `bootstrap()` or reports a startup/API error, while the stale restored9 module throws before either can happen.

The prior architecture had a recovery trap: service-worker registration lived at the bottom of `app.js`. If `app.js` crashed during module initialization, it never asked Chrome to update the service worker, so a bad cached app could remain sticky across Chrome restarts.

Restored11 changes startup and caching structurally:

- `index.html` loads a tiny, versioned `boot.js?v=restored11` instead of loading `app.js` directly.
- `boot.js` requests the service-worker update **before** importing the application and uses `updateViaCache: 'none'`.
- `app.js` and every startup-module import are versioned with `?v=restored11`, so the old service worker does not recognize or intercept those URLs and the browser cannot satisfy them from the broken unversioned module entry.
- CSS and manifest URLs are versioned as well.
- The new service worker performs shell network refreshes with `cache: 'no-store'`, then stores the fresh responses in the restored11 cache.
- Service-worker registration is no longer dependent on the main app successfully initializing.
- If the app module ever fails during startup again, `boot.js` replaces the indefinite Checking-this-session screen with an explicit startup-failure message and Reload button.
- `boot.js` is also served by the Render static server so Pages and the deployment mirror remain structurally equivalent.

Because an already cached old `index.html` can still point at the broken unversioned app, the one-time recovery URL is `https://to-shreds.github.io/torbox-web-player/?v=restored11`. The unique navigation URL forces a fresh index fetch; from there, the versioned boot/module graph repairs the normal URL for subsequent visits.

## Permanent recovery entry

Jon confirmed the restored11 one-time recovery URL successfully escaped the stale cached frontend.

A permanent cache-busting recovery entry now exists at `https://to-shreds.github.io/torbox-web-player/recover/`.

- The recovery page is intentionally standalone and does not import the normal application or boot loader.
- It immediately redirects to the root player with a unique `?recover=<timestamp>` query on every use.
- Because the redirect query is generated at runtime, the recovery page itself can remain stable forever and does not need a version number.
- The root player remains the normal/default URL. The recovery path is a permanent emergency escape hatch if a future browser or service-worker cache gets stuck.
- The Render static mirror also serves `/recover` and `/recover/`.

## Cached source selection hardening

A physical Android test of The Office exposed a misleading automatic-playback failure: the player said no cached browser-compatible source could be opened even though source torrents plainly existed. The failure was in the automatic selection path, not title discovery.

The automatic path is now less brittle while preserving the cached-only contract:

- Source registration asks TorBox cache availability for file metadata with `list_files=true`. Only sanitized cached file name, size, and MIME information is retained for matching.
- For a cached series source, the server checks the actual cached file list for the requested episode before automatic ranking. A cached source with a matching MP4/M4V/WebM file is preferred. A cached source whose matching files are all known unsupported containers is skipped automatically.
- Unknown cases remain eligible rather than being falsely rejected.
- Initial automatic playback may examine up to **8 cached candidates** instead of 3.
- The initial automatic source path has an **18-second total bound** with a **5-second per-candidate preparation request bound**. This is separate from runtime playback recovery, which remains capped at three attempts.
- Automatic Play, Resume, auto-next, and recovery still cannot start an uncached torrent or open the technical source picker.
- The terminal message now says sources were found but no cached Chrome-compatible version could be opened automatically. It no longer implies that no torrent exists.
- Raw TorBox cached file listings remain server-side. The browser receives only the existing source metadata plus a tri-state cached-browser compatibility hint.
- If The Office Season 4 still fails specifically on one of Cinemeta's split entries such as part 2 of an hour-long broadcast, investigate split-episode numbering versus combined torrent files next. Do not weaken exact episode identity matching without a verified mapping.

## Wrong-title source identity correction

The first cached-source hardening test changed the failure from "no source" to actual playback, but Jon physically confirmed that it opened a different non-English show. This was traced to a real upstream metadata false positive rather than an episode-picker bug.

A live provider probe against The Office US (`tt0386676`), Season 4 Episode 1, found that MediaFusion Torznab was returning this torrent while labeling it with the US show's IMDb/TMDB identity:

- Hash: `ac4a0b102dbf52f95b0a3883ec8d9f67bb4ca4b6`
- Title: `The.Office.PL.2024.S04E01-03.PL.1080p.WEB-DL.H264.DD2.0 - TL.PL`
- MediaFusion itself reported IMDb `0386676` and TMDB `2316`, even though the torrent is the 2024 Polish Office rather than the US 2005 series.

Two identity guards now sit in front of TorBox cache selection:

- MediaFusion Torznab results must explicitly carry the requested IMDb identity. Numeric live-format IDs such as `0386676` are normalized to `tt0386676`; missing or different IDs are rejected.
- Because the provider can still attach the *wrong* matching IMDb ID, source registration separately compares explicit title years against the authoritative catalog run. For a series such as The Office `2005–2013`, any year within the series run is accepted; a conflicting identity year such as `2024` is rejected before TorBox availability is checked.
- Series year filtering deliberately uses the catalog's overall run range rather than Cinemeta episode release timestamps. A live probe exposed bad season release dates from Cinemeta, so those timestamps are not trusted when a reliable run range exists.
- Sources that state a matching catalog year receive a small ranking bonus. Sources with no explicit identity year remain eligible.
- This guard is additive to the existing exact season/episode file matching. It does not weaken episode identity, enable uncached downloads, or expose the Full-mode source picker.

A live post-fix probe against current providers returned 11 Zilean sources and 40 MediaFusion sources. All 11 Zilean sources remained eligible; MediaFusion kept 39 and rejected exactly the Polish 2024 false positive above.

## The Office S4E3 source-coverage correction

After the wrong-title identity fix, Jon physically confirmed that Season 4 Episode 2 could play, but Season 4 Episode 3, **Dunder Mifflin Infinity (1)**, still ended with the cached Chrome-compatible-source error. This was a different failure.

Live probes showed that the existing Zilean and MediaFusion indexes did contain many sources for the episode, but most useful exact matches were MKV/AVI or metadata-only season packs. The same live title/episode queried through Torrentio returned a much richer set of exact file metadata, including multiple MP4 candidates:

- `b298b2ad83576081395c232545fa903e67f93ded` → `The.Office.US.S04E03.Dunder.Mifflin.Infinity.Part.1.mp4`
- `2ccca4b8fdaf48f19ed28531971bf91c9d1f2a5c` → `The Office Superfan Episodes S04e03 Dunder Mifflin Infinity Part 1 (Extended Cut).mp4`
- `e66805bb996d70fb250efe44a9d790371553c2d4` → combined `S04E03-E04 - Dunder Mifflin Infinity.mp4`
- `286f285158bb4ac51412a4e36020f2bfae61c319` → `S04E03 + 04 Dunder Mifflin Infinity.mp4`
- `2d302dd91cefe563a7edd5c5bbf45ff75978027e` → `The Office S04E03+E04 Dunder Mifflin Infinity.mp4`

Torrentio is now a fixed anonymous metadata provider in the server-side multi-source lookup. It receives only the public IMDb/season/episode identity. It never receives the TorBox key, browser credentials, or a TorBox playback URL. TorBox remains the authority for whether a returned hash is actually cached.

The live probe also exposed a numbering hazard: some 14-file releases call **Launch Party** `E03`, while Cinemeta's split 19-entry season calls **Dunder Mifflin Infinity (1)** `E03`. A new episode-title identity guard therefore rejects a source when its filename clearly names a different episode from the selected Cinemeta episode. For example, `E03 Launch Party.mp4` is rejected for Dunder Mifflin Infinity, while exact Dunder filenames and neutral number-only filenames remain eligible.

A live post-change MultiSource probe for The Office S4E3 used Torrentio + Zilean, returned 40 merged source hashes, retained 33 after episode-title identity filtering, and exposed **7 browser-container candidates**. The exact Dunder Mifflin Infinity Part 1 MP4 was among them.

This does **not** guarantee that one of those MP4 hashes is cached in Jon's TorBox account. Anonymous TorBox cache probing returned HTTP 401, so cache state remains account-authenticated and is checked only by the live player. If S4E3 still fails after this deployment, the next fact to establish is whether any of these exact browser-compatible hashes are cached. Do not weaken MKV rejection merely to make the button proceed.

## Explicit browser-version preparation fallback

Jon physically retested The Office S4E3 after Torrentio source expansion and still received the same cached Chrome-compatible-source error. At this point source discovery is no longer the useful place to keep widening the search: live discovery already exposes several exact MP4 candidates, but the cached-only path cannot use an uncached MP4 and Android Chrome cannot directly play the cached MKV/AVI alternatives.

The player now converts that terminal dead end into an explicit choice:

- Normal Play remains cached-only first. It still never starts an uncached torrent silently.
- Only after cached-only automatic playback returns `NO_CACHED_BROWSER_SOURCE`, the UI looks for the best **uncached browser-container candidate** already returned by the identity-safe source pipeline.
- Eligible fallback candidates must be MP4/M4V/WebM-class browser containers and cannot be marked browser-unsupported, audio-risk, video-risk, locally bad, or locally no-sound.
- When an ordinary release exists, the fallback avoids titles labeled Superfan or Extended Cut. Alternate cuts are used only when no ordinary browser candidate exists.
- The user receives an explicit confirmation explaining that TorBox will prepare a browser-compatible version, that this starts a torrent download, and that it may take a few minutes.
- Only if the user confirms does the app call the existing explicit preparation path with `waitForPreparation:true`. It then polls TorBox and automatically plays the matching browser-compatible episode file when ready.
- Canceling the confirmation leaves TorBox unchanged and retains the original no-cached-browser-source result.
- The displayed candidate size is the discovered video-file estimate. TorBox may need to download the containing torrent, which can be larger.
- This fallback does not expose the technical source picker in Simple mode.

The frontend cache graph was bumped from `restored11` to **`restored12`** so existing devices load this behavior rather than continuing to execute the old dead-end frontend.

## Verification

- Feature CI run `35958080304` registered **320 tests: 314 passed, 0 failed, 6 optional live checks skipped**.
- New regressions verify that the explicit fallback selects an uncached direct browser-container source, avoids alternate cuts when an ordinary release exists, uses a user confirmation, and enters `waitForPreparation:true` only after the cached-only path fails.
- The existing regression that automatic playback never prepares an uncached source remains green.
- Startup/cache recovery regressions pass with the complete module graph bumped to `restored12`.
- GitHub Pages run `35958151067` succeeded for main runtime commit `d3db9d19`.
- Browser-key clone CI run `35958320533` succeeded for mirror runtime commit `30d9385e` with **320 tests registered, 314 passed, 0 failed, 6 optional live checks skipped**.
- Render deploy `dep-daqauq0u01pc73fgq4a0` completed successfully and is **live** from mirror runtime commit `30d9385e`.
- All **11** modified frontend/regression files are byte-identical between `main` and `browser-key-clone` by Git blob SHA.
- Existing source identity, cached-only automation, TorBox credential isolation, source-picker isolation, startup recovery, PiP/fullscreen, Continue Watching, credits, and security regressions remain green.

## Do not break

- Root and `/key/` must serve the same v1.1 frontend.
- Simple mode must stay torrent-blind.
- Automatic actions may use cached sources only.
- Uncached downloads require an explicit user action. Full-mode Prepare remains available, and Simple-mode Play may offer a one-time explicit Prepare-and-Play confirmation only after cached-only playback has failed.
- The TorBox API key and temporary CDN URL remain server-side.
- AVI/MKV and other known unsupported containers must not be sent to Android Chrome as normal playback.
- Search must not show a fallback card that cannot be opened through the catalog.
- Still Watching must continue across episode transitions.
- Kid Mode must still gate starting a different episode when its allowance is exhausted.

## Immediate next action

Reload the ordinary root player and retry The Office Season 4 Episode 3, **Dunder Mifflin Infinity (1)**. Because this benchmark changes the frontend, the expected restored12 behavior is different: if no cached Chrome-compatible copy exists, Play should present an explicit confirmation offering to prepare a browser-compatible version in TorBox instead of ending immediately on the red error.

Confirming that prompt is intentionally a write action. TorBox may take several minutes to download the containing torrent; the app waits/polls and should play the selected browser-compatible episode when it becomes ready. Declining the prompt makes no TorBox change.

If the old red error appears with **no confirmation prompt after a normal reload**, use the permanent `/recover/` URL once to force the restored12 frontend. If preparation is confirmed but ultimately fails, inspect the TorBox preparation result rather than broadening source discovery again.
