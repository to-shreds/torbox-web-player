# TorBox Web Player Handoff

Use this file first when resuming the project. The repository controls implementation. `to-shreds/ProjectStatus/projects/torbox-web-player/STATUS.md` controls readiness and the immediate next action.

## Production baseline

The restored browser-key v1.1 player is the only production baseline. Jon reported on 2026-09-20 that the repaired player was working again before the credits/auto-next enhancement below.

- Version: **1.1.0**
- Source of truth: `main`
- Main runtime commit: `9244a1ae3d0cc6b424e2841e803d53c97d4e28c7`
- Render deployment mirror: `browser-key-clone`
- Mirror runtime commit: `d043109aba0cf552baac977370cf941bad4400e4`
- Public app: `https://to-shreds.github.io/torbox-web-player/`
- Legacy URL: `https://to-shreds.github.io/torbox-web-player/key/`
- Render service: `torbox-web-player-key` / `srv-damu91142hec73chb7qg`
- Render URL: `https://torbox-web-player-key.onrender.com`
- Live Render deploy: `dep-dao9m1740ujc73eerqg0`
- PWA cache: `torbox-player-v1.1-restored6`

Render still deploys `browser-key-clone`. Keep that branch runtime-equivalent to `main` until the service can be repointed to `main`.

## Simplified playback contract

Simple mode must never expose the torrent/source picker as an automatic fallback from Play, Resume, auto-next, or recovery. The source picker is an explicit Full-mode Options tool only.

Automatic playback may use cached sources only. It must never silently begin an uncached download. Cached multi-file packages may select a browser-compatible matching file automatically. Known unsupported containers must be rejected before normal Android Chrome playback.

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

## Verification

- Browser-key CI run **148** succeeded for mirror runtime commit `d043109a`.
- Final suite: **297 tests registered, 291 passed, 0 failed, 6 optional live checks skipped**.
- GitHub Pages run **131** succeeded for main runtime commit `9244a1ae`.
- Render deploy `dep-dao9m1740ujc73eerqg0` is live from `d043109a`.
- The modified runtime and regression-test files on `main` and `browser-key-clone` are byte-identical by Git blob SHA.
- Dedicated auto-next tests continue to cover the credits behavior. New Continue Watching tests cover one-entry-per-show grouping, completed-latest suppression, list limits after grouping, removal of finished-title mode, long-press title navigation, and opening the current season.

## Do not break

- Root and `/key/` must serve the same v1.1 frontend.
- Simple mode must stay torrent-blind.
- Automatic actions may use cached sources only.
- Uncached downloads require an explicit Full-mode Prepare action.
- The TorBox API key and temporary CDN URL remain server-side.
- AVI/MKV and other known unsupported containers must not be sent to Android Chrome as normal playback.
- Search must not show a fallback card that cannot be opened through the catalog.
- Still Watching must continue across episode transitions.
- Kid Mode must still gate starting a different episode when its allowance is exhausted.

## Immediate next action

Fully close and reopen the installed site or Chrome tab so `torbox-player-v1.1-restored6` activates.

Confirm Continue Watching now shows at most one episode for each show and no finished episodes. Long-press a show there and confirm the title dialog opens directly to the season containing that episode. Also complete the pending credits-flow acceptance: Play next now, Watch credits, pause during countdown, and no torrent/source picker.
