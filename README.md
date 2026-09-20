# TorBox Browser-Key Player

This branch is the browser-key clone of the household TorBox web player. The original player on `main` remains separate and is not modified by this branch.

Current version: **1.1.0**

Frontend: `https://to-shreds.github.io/torbox-web-player/key/`

Backend: `https://torbox-web-player-key.onrender.com`

## Design

The default interface is **Simple**. It is intended to be easy for a family member or child to use without understanding torrents, codecs, source providers, or recovery logic. The normal path is posters, search, episodes, Play, Continue Watching, Next Up, and My list.

Settings can switch the site to **Full** mode. Full mode reveals technical and power-user controls such as source Options, Drive sharing, per-title quality, playback-health details, source feedback, and learned source behavior.

Native HTML5 video controls remain the base player controls. The custom interface adds pause information, recovery state, next-episode countdown, playback-health information in Full mode, sleep timer behavior, screen wake lock where supported, and keyboard seeking.

## Credential and media model

The TorBox API key is the clone's sign-in credential. It is not committed to GitHub and is not stored as a Render environment secret. It is held in the Render process session after sign-in. If the user enables Remember encrypted on this device, the browser stores an AES-GCM encrypted copy using a non-exportable Web Crypto key in IndexedDB.

## v1.1 setup transfer

Settings now includes **Sync & devices → Transfer this setup**. It creates a one-time, ten-minute transfer that copies the remembered TorBox credential plus portable browser state to another device. The transfer package is encrypted in the source browser with AES-GCM; the one-time code derives the encryption key, only a SHA-256 lookup of that code reaches Render, and the temporary encrypted envelope is deleted when redeemed. The code itself is carried in the transfer link URL fragment, so it is not sent to Render in the HTTP request.

Transferred state includes the selected viewer, general settings, Continue Watching history, My list, search history, and Kid Mode/PIN/allowance state. Device-specific source/audio compatibility learning is intentionally not transferred. If the API key is not remembered on the source device, Settings asks for it once and verifies it against the current session before creating the encrypted package. Opening a transfer link on the destination device validates the debrid credential before applying the imported state and stores the credential using the destination browser's existing encrypted vault. This transfer does not yet enable ongoing cloud synchronization.

Video passes through the protected Render relay restored from the last known-good pre-direct architecture. The browser receives only an opaque, expiring media ticket. The TorBox CDN URL and API key remain server-side.

Owner playback path:

`TorBox CDN -> Render relay -> browser`

Render handles control/API operations such as catalog and source lookup, cache checks, preparation, playback-link generation, TorBox status checks, Drive control, and temporary progress leases.

## Discovery and source selection

Cinemeta supplies catalog metadata. Browse supports Popular, Featured, New, genre filters, movies, shows, and search. The browse adapter accepts Cinemeta's current `imdb_id` rows and follows only the bounded HTTPS redirect between the known Cinemeta hosts used by no-query catalog feeds.

Source discovery aggregates Zilean and MediaFusion Torznab, with StremThru fallbacks when needed. Results are deduplicated before TorBox cache checks.

Automatic source selection continues to prioritize browser-friendly cached sources and penalize known risky audio/video formats. It now also supports:

- Data saver, Balanced, and Prefer larger files size profiles.
- Per-title quality overrides.
- Local source success memory.
- Local release-family preference based on sources that have worked.
- Manual Sound works and No sound feedback in Full mode.
- A local bad-source list.
- Automatic exclusion of sources marked bad or known to have no sound on this device.

These preferences are browser-local and do not change TorBox account data.

## v1.0 stable release

Version 1.0.0 marks the browser-key player as the first stable release. The core architecture, media path, discovery model, Simple/Full split, resume behavior, source recovery, PWA shell, and parental-control model are now established product behavior rather than experimental preview behavior.

Search now has a focused interaction model. With an empty search field, the normal home rows remain visible. As soon as a query is active, Recent searches, Next Up, Continue Watching, My list, and browse filters are temporarily hidden so search results appear directly beneath the search area. Clearing the query restores the home experience. Pressing the Android keyboard Search/Enter action immediately runs the query and removes focus from the field so the soft keyboard collapses.

## Home experience

The home screen can show:

- **Next Up**, for the next released episode after a completed episode.
- **Continue Watching**, with canonical movie/episode resume state.
- **My list**, separate from Recently Played.
- **Recent searches**, with individual removal.
- Normal browse and search results.

Recently Played remains individually removable. There is no Clear All button. Resume rewinds 10 seconds by default, with 0, 5, 10, 15, or 30 second choices. Start over is available for saved items.

When the next episode starts, earlier completed episodes from the same show can be cleaned out of local playback history automatically.

Long-pressing a poster opens quick actions. Play, My list, and Details remain useful in Simple mode. Full mode also exposes Share from that quick-action surface.

## Playback behavior

Automatic next episode uses a cancellable countdown. The countdown can be immediate or 5, 8, 10, or 15 seconds.

If a stream buffers continuously or fails, automatic recovery can try at most two alternatives, for no more than three sources total. The Render relay renews an expired TorBox link once without rebuilding the player again. The buffering threshold is configurable.

Full mode includes a playback-health panel that distinguishes states such as Opening, Ready, Playing, Buffering, Stalled, Recovering, Paused, Finished, and failure. It also exposes Sound works, No sound, and Bad source feedback for the current source.

The player can remember a source after sustained successful playback and favor it or its release family later. This learning can be disabled or cleared in Settings.

Additional optional player settings include playback speed, sleep timer, a configurable Still watching? guard, Screen Wake Lock where supported, pause overlay, keyboard seeking, and seek-step length. The Still watching? guard defaults to 90 minutes, can be set to Off, 60, 75, 90, or 120 minutes, and carries across auto-next episodes so short episodes cannot reset unattended playback indefinitely.

## Settings

Settings are browser-local. Current groups include:

- Interface: Simple or Full, long-press shortcuts.
- Playback: default quality, source-size profile, speed, sleep timer, Still watching? timeout, recovery timing, keyboard seeking, wake lock, playback health, source learning.
- Episodes and history: rewind, Continue Watching count, auto-next and countdown, Next Up, watched/resume labels, completed-episode cleanup.
- Discover, My list, and search: My list size, search-history size, remembered browse filters.
- Drive sharing and app: Drive defaults, TorBox status check, app install, source-learning reset, search-history reset.

## Kid Mode and parental allowances

Kid Mode is a browser-local parental-control layer for each viewer. A device-level Parent PIN is stored only as a PBKDF2-derived verifier with a random salt; the PIN itself is never stored.

A parent can combine any of these limits:

- Custom playback time in minutes or hours.
- Number of episodes.
- Number of movies.
- Daily automatic reset or manual-only reset.

Actual advancing playback time is counted, not paused or stalled time. Seeking forward does not create watched time. Episode/movie counters persist by canonical title or episode identity across reloads, source changes, and resume.

An episode becomes charged after 5 actual watched minutes or 20% of its runtime, whichever occurs first. A movie becomes charged after 10 actual watched minutes. Hitting an episode/movie count does not interrupt the already charged item; it blocks starting a different item after the allowance has been used. A time allowance pauses immediately when its time is exhausted.

When a limit blocks playback, the child sees a non-dismissible limit screen. Parent PIN access can grant 15 or 30 more minutes, one more episode, one more movie, reset the allowance, or turn Kid Mode off.

Kid Mode forces the Simple interface. Opening Settings, switching away from a restricted viewer, and signing out require the Parent PIN. The selected viewer is persisted in local storage so closing and reopening Chrome does not silently fall back to another viewer.

This is application-level parental control, not an Android device-management system. Clearing site data or otherwise tampering with browser storage can defeat local controls.

## Installable app

The GitHub Pages frontend includes a web-app manifest, icon, and same-origin service worker. Chrome can offer Install app / Add to Home screen when its installability requirements are met.

The service worker caches only the static application shell. It does not intercept the Render API, TorBox media URLs, or video traffic. This is an installable shell, not offline video playback.

## Deliberately excluded from v0.13

Two ideas from the v0.13 feature list were intentionally not implemented:

- A textual source-comparison explanation such as "Recommended because cached, H.264/AAC, 720p..."
- A quick "replay the last 30 seconds" action for completed episodes.

The existing source table still shows technical source metadata in Full mode, but there is no new recommendation-explanation feature.

## Verification

The final v0.13 branch test run is recorded in GitHub Actions. The suite covers authentication and direct playback protections, catalog redirects, source aggregation, recovery, sharing, settings, watchlists, search history, source learning, audio feedback, bad-source exclusion, per-title quality, history cleanup, Simple/Full UI contracts, and PWA shell behavior.

Physical-device acceptance is still required for touch feel, long-press behavior, Android fullscreen overlay behavior, install prompt behavior, and real-world source learning/recovery.

## Remaining limitations

- Personalization, My list, search history, source learning, and canonical resume are local to the browser profile and are not synchronized across devices.
- Public source indexes can rate-limit or change.
- Codec conversion/transcoding is not implemented.
- Buffer detection is heuristic.
- Android Chrome may suppress sibling HTML overlays when it moves the video into its own native fullscreen surface.
- The zero-setup Google Drive timing/share path remains limited by the short-lived TorBox-issued Google credential.
- The first real Drive export/deletion acceptance test is still outstanding.

Implementation source on this branch is authoritative. Current readiness and next steps are tracked in `to-shreds/ProjectStatus/projects/torbox-web-player-browser-key/STATUS.md`.
