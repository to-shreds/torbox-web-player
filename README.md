# TorBox Web Player

The browser-key player is the production codebase. `main` is authoritative. The existing Render service still watches `browser-key-clone`, so that branch is kept as a deployment mirror of the same code rather than as a separate product line.

Current backend version: **1.2.9**. Frontend **release-1.2.9-stability.1** repairs startup asset routes and asynchronous Trakt/wake-lock races. Verification and publication are recorded in HANDOFF.md.

Deployment evidence and current runtime identifiers are recorded in [HANDOFF.md](HANDOFF.md). Root and `/key/` use the same frontend source; the independent native APK is delivered separately. My Workspace remains the user's standing Render choice.

Frontend: `https://to-shreds.github.io/torbox-web-player/` (legacy mirror: `/key/`)

Backend: `https://torbox-web-player-key.onrender.com`

## Optional Trakt scrobbling

The website includes an optional Trakt OAuth 2.0 with PKCE connection in **Settings → Trakt scrobbling**, plus a compact **Scrobble** toggle in Discover. Each viewer authorizes separately and can independently enable outbound scrobbling. Trakt history import can supplement local Continue Watching and displays completed Trakt activity under Recently watched on Trakt; local resume is never overwritten. The integration requires a Trakt developer app Client ID, registered with the website's OAuth callback and JavaScript origin, and no Client Secret or new paid service.

**Trakt's developer terms prohibit API data use by sites that promote piracy.** Because this player has torrent discovery and Buffstreams, obtain approval from Trakt before activating the integration. A live Trakt account authorization and scrobble has not yet been verified. Full setup and limitations: [Trakt integration](docs/TRAKT.md).

## Watch party

While playing a movie or episode, choose **Watch party → Create party for this video**, then copy the invitation. The other person opens the invitation and joins without connecting TorBox or entering an API key. Both viewers use the host’s TorBox connection, with a separate playback link for each device. Creating a party requires confirming that the invited viewer is trusted with the TorBox account: TorBox CDN links can reveal the host’s full API key. The app limits guest controls to the exact party file; the key itself can grant broader account access outside the app. Both viewers can play, pause and seek; buffering holds playback until both are ready. Tap **Ready to watch** if the browser asks. Video streams directly to each device, with only small control messages using the existing free Render service. No extra account or paid service is required. Parties last up to six hours and end when the host leaves or the service restarts. Source switching and auto-next are held during a party. This feature applies to the movie/episode player. [Details and limits](docs/watch-party.md).

## Playback startup patch

Title details now prepare cached movie/episode files before Play, reuse the completed work briefly and prepare auto-next earlier. The new backend also returns a useful first provider batch promptly and retains slower results for safe fallback and Options. Exact identity/episode checks and cached-only automatic playback remain. See [the startup report](docs/STARTUP-1.2.1.md) for timing fixtures, test results and the separate backend publication gate.

## Games

Open **GAMES** in the top navigation, or use `#games` in the app URL. NES games run directly in your browser without a TorBox login, backend request, or extra service. The catalog is alphabetical and searchable. Open a local uncompressed `.nes` file, or choose a game added to the repository's `public/roms/` folder and `public/games-catalog.json`. The menu currently includes the user-supplied Super Mario Bros. / Duck Hunt cartridge, Super Mario Bros. 3, and Teenage Mutant Ninja Turtles II: The Arcade Game. Catalog entries and safe file naming are described in [the ROM folder README](public/roms/README.md).

The menu also includes **MindMaze (Encarta browser recreation)** through its creator-hosted page. Embedded play uses Tourist without saved profiles; **Open full page** supports the creator's profiles. This is not a bundled Windows executable, and the repository does not redistribute Encarta artwork, audio or questions. [MindMaze details](docs/mindmaze.md).

The same menu also includes **DOS Defender** (Unlicense/public-domain release), **Master Mind (1999)** (the creator's complete-game CC0 release), **Zmiy Snake** (BSD-2-Clause), and **SkiFree (browser remake)** (MIT). Use the All games / NES / DOS / Browser filter to browse platforms. DOS games run in a self-hosted, pinned DOSBox worker and support their own keyboard/mouse controls, including touch pointer input. The ski game uses a separately licensed canvas remake with freshly drawn graphics; the original Windows SkiFree executable is not included. Each extra player exposes Controls & credits, pause/resume, restart and fullscreen. Closing/restarting a DOS game begins a new session; DOS games do not have the NES save-state system. The ski remake keeps local high scores per viewer and has no audio.

Exact game licenses and provenance are in `public/games-data/licenses/`, `docs/evidence/extra-games/licenses.json`, and `public/games-web/skifree/UPSTREAM.md`. The five unmodified GPL-2.0 DOS runtime files have matching source, original build scripts and dependency notices available under [the DOS source notice](public/vendor/dos/SOURCES.md), including the same-location source archive. The WASM/Blob-worker permissions are confined to the DOS child page; the main app's script policy stays unchanged. Game bundles, WASM and source archives are excluded from the app-shell cache. These games require an adult viewer like the existing Games tab.

The player supports touch controls including diagonals and simultaneous buttons, keyboard input, and up to two standard gamepads. Automatic saves resume each viewer's game on the same browser. Save and Load save use a separate manual slot. Game saves use their own IndexedDB store and do not alter movie history or credential storage. Full screen retains the controls; rotating the device gives a landscape layout. Leaving Games or hiding the app pauses emulation and sound. For Duck Hunt, choose it inside the combined cartridge, turn on **Light gun**, then click or tap the game screen to aim and shoot.

Open **Cheats** in any NES game to manage Game Genie codes. Six-letter and eight-letter codes are supported, including the eight-letter original-byte comparison. You can paste several codes, name them, edit/remove them, switch each code or the whole list on/off, and import/export JSON lists. Lists are saved separately for each viewer and exact ROM on this browser, including local ROM files. The game pauses while the manager is open; **Done & Resume** returns to play. Raw ROM patches accept `AAAA:VV` or `AAAA:VV?CC` with CPU addresses `$8000` through `$FFFF`. Codes apply to ROM reads immediately; codes affecting startup may require **Start fresh**, and effects already written to game RAM can remain until restart. Use codes for the exact game revision. This NES player uses Game Genie formats; codes for GameShark on other consoles are not compatible. If enabled codes overlap, the first matching code in the list wins. Up to 128 codes can be stored per game; ROM files and the save-state format remain unchanged.

Games initially follows Sports' adult-viewer restriction, so it cannot bypass Kid Mode's existing viewing allowances. This release does not add gaming to those allowance rules. Actual ROM compatibility and physical controller/touch/audio behavior still depend on the game and device. The pinned JSNES 2.1.0 engine and Apache 2.0 license are self-hosted under `public/vendor/`. ROM payloads are not added to the application-shell cache.

## Sports

Open **Sports** in the top navigation, or use `#sports` in the app URL. Sports opens without a TorBox login or a running private backend. It bundles 36 live channels with 48 stream choices and 157 dated full event/session replays across 25 sports. Channels include tennis, NFL/NBA classics, MLB, motorsport, golf, rugby, cricket, combat and more. Replays include American football and hockey as well as padel and other sports. No additional subscription, login or VPN is needed by the app. Regional rights still apply, and free channels do not cover every paid event. The replay collection is a release snapshot.

Sports has live/replay, sport and channel filters, text search, 720p by default with quality choices, Go Live, replay resume/Start Over, and clear Retry/channel alternatives. Catalogs omit scores, descriptions and result images. Sports is available to adult viewers. Direct public HLS uses the bundled Apache-licensed hls.js 1.6.15; the native browser HLS fallback selects quality itself. No sports video is relayed through Render. See [the sports expansion report](docs/SPORTS-2026-10-11.md).

The **Buffstreams games** tab within Sports loads the game list inside TorBox. Search teams or games, filter by sport or **Live now**, then press **Watch** to open only the selected direct player in a new tab. No provider directory or event page is opened. The existing [Sports Desk](https://to-shreds.github.io/Misc/SportsDesk/) metadata helper supplies the list and resolves the selected player; it never relays video. Scores, results, descriptions and images are omitted.

**Change Buffstreams address → Check & save** verifies a new HTTPS source before replacing the saved list. Failed, empty, malformed, cancelled or obsolete responses preserve the previous source and games. Saved lists older than five minutes are clearly labelled and do not appear as currently live. A blocked popup exposes a direct-player link. TorBox credentials and referrer data are excluded from external requests. Metadata requests also omit cookies. Existing channels and replays still use the in-app player.

## Artwork patch

Fixes missing posters by accepting the image provider’s exact `live.metahub.space` redirect and adding a title-specific alternate size/one retry. Browser state, playback and the Render service are unchanged. See [the artwork report](docs/ARTWORK-2026-10-10.md).

## Release 1.2.0

See [the release and stress-test report](docs/RELEASE-1.2.0.md) for fixes, evidence, limits, and rollback instructions. The preceding release is preserved at `archive/v1.1.0-before-reliability-2026-10-01`.

This release removes the remaining media relay, isolates playback state between devices, makes progress saves nonblocking, survives slower backend startup, reconnects with a remembered encrypted key, and cancels obsolete Play/Resume actions. The browser gets a visible retry or bounded recovery when startup or playback stalls. Existing history, settings, parental controls, source identity checks, and the persistent fullscreen/PiP video element are preserved.

No paid service was added. GitHub Pages serves the app; the existing free Render service handles small control requests only. Render can still sleep and restart. Anonymous metadata indexes can still fail or rate limit requests. TorBox remains the only paid media service.

## Design

The default interface is **Simple**. It is intended to be easy for a family member or child to use without understanding torrents, codecs, source providers, or recovery logic. The normal path is posters, search, episodes, Play, Continue Watching, Next Up, and My list.

Settings can switch the site to **Full** mode. Full mode reveals technical and power-user controls such as source Options, per-title quality, playback-health details, source feedback, and learned source behavior.

Native HTML5 video controls remain the base player controls. The custom interface adds pause information, recovery state, next-episode countdown, playback-health information in Full mode, sleep timer behavior, screen wake lock where supported, and keyboard seeking.

## Credential and media model

The TorBox API key is the clone's sign-in credential. It is not committed to GitHub and is not stored as a Render environment secret. It is held in the Render process session after sign-in. If the user enables Remember encrypted on this device, the browser stores an AES-GCM encrypted copy using a non-exportable Web Crypto key in IndexedDB.

## v1.1 setup transfer

Settings now includes **Sync & devices → Transfer this setup**. It creates a one-time, ten-minute transfer that copies the remembered TorBox credential plus portable browser state to another device. The transfer package is encrypted in the source browser with AES-GCM; the one-time code derives the encryption key, only a SHA-256 lookup of that code reaches Render, and the temporary encrypted envelope is deleted when redeemed. The code itself is carried in the transfer link URL fragment, so it is not sent to Render in the HTTP request.

Transferred state includes the selected viewer, general settings, Continue Watching history, My list, search history, and Kid Mode/PIN/allowance state. Device-specific source/audio compatibility learning is intentionally not transferred. If the API key is not remembered on the source device, Settings asks for it once and verifies it against the current session before creating the encrypted package. Opening a transfer link on the destination device validates the debrid credential before applying the imported state and stores the credential using the destination browser's existing encrypted vault. This transfer does not yet enable ongoing cloud synchronization.

Normal owner video bytes no longer pass through Render. The browser still receives an opaque, expiring `/media/<ticket>` path, and Render answers that request with a redirect to the TorBox CDN. On this TorBox account the CDN URL itself contains the account API key, so the key can be visible to the signed-in owner's browser network stack during playback even though it is never returned in playback JSON or written into the page. A host can explicitly authorize key-bearing direct playback when creating a watch party, after a notice explains the invited viewer can extract the full key and access the TorBox account outside this app. This consent is per-party and is never a saved preference. Without that consent, guest playback requires a key-free direct TorBox link and fails clearly if TorBox cannot provide one. It never falls back to a video relay.

Owner playback path:

`TorBox CDN -> browser`

Temporary guest playback path:

`TorBox CDN -> guest browser`, with a key-free link or explicit per-party host authorization of account-bearing playback links.

Render handles control/API operations such as catalog and source lookup, cache checks, preparation, playback-link generation, owner redirect issuance, TorBox status checks, and temporary progress leases. It never transports video bytes. New Google Drive exports are disabled because Drive adds a separate storage quota; the old cleanup endpoints remain available for previously exported files.

## Discovery and source selection

Cinemeta supplies catalog metadata. Browse supports Popular, Featured, New, genre filters, movies, shows, and search. The browse adapter accepts Cinemeta's current `imdb_id` rows and follows only the bounded HTTPS redirect between the known Cinemeta hosts used by no-query catalog feeds.

Text search uses Cinemeta's query-aware endpoint and falls back to catalog-validated IMDb suggestions when necessary. The secondary popular feed is used for browsing because it ignores search text. Typing immediately retires the previous query's cards and pagination; canceled or late responses cannot replace the current results. Distinct same-name titles remain visible when a poster or year is missing.

Source discovery aggregates Zilean, Torrentio, and MediaFusion Torznab, with StremThru fallbacks when needed. Results are deduplicated before TorBox cache checks.

Configured add-on paths are preserved for StremThru requests. Explicit audio-language and codec information survives normalization and exact-file merges. User-confirmed sound and compatible audio codec tags rank ahead of unknown audio. Within the same audio confidence, English-only choices rank ahead of mixed-language and unconfirmed-language choices; known foreign-only sources are offered explicitly rather than selected automatically. Subtitle flags and release groups do not establish an audio language. Matroska/MKV is attempted conditionally through native playback, with MP4/WebM preferred when otherwise equivalent. Browser and codec support still vary; no conversion or media relay is added. Playback recovery can copy a small diagnostic report containing public title/episode identity, error codes and counts, without credentials, file URLs or torrent hashes.

Automatic source selection excludes known risky audio/video formats and checks the actual selected filename before playback. The player checks native decoded-audio bytes during advancing playback, so video alone cannot establish source success. A missing audio decoder triggers bounded cached-only recovery without restarting the episode, while unavailable counters, mute, seeking and quiet decoded audio do not count as failure. Automatic observations are kept only for the current tab. The No sound action has been removed; opening the updated player restores its saved negative-audio exclusions without clearing other preferences. In Simple mode, Play never opens the technical torrent/source picker. Cached multi-file packages are resolved to a browser-compatible matching episode file automatically when that can be done safely; otherwise Play reports that no cached browser-compatible source could be opened. The source picker remains an explicit Full-mode Options tool only.

Automatic selection also supports:

- Data saver, Balanced, and Prefer larger files size profiles.
- Per-title quality overrides.
- Local source success memory.
- Local release-family preference based on sources that have worked.
- Manual Sound works confirmation in Full mode.
- A local bad-source list.
- Automatic exclusion of separately blocked sources and tab-local missing-audio observations.

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

Long-pressing a poster opens quick actions. Play, My list, and Details remain useful in Simple mode. Video sharing that needs a relay or a separate storage quota is disabled.

## Playback behavior

Automatic next episode uses a cancellable countdown. The countdown can be immediate or 5, 8, 10, or 15 seconds.

If a stream buffers continuously or fails, automatic recovery can try at most two alternatives, for no more than three sources total. A fresh playback request obtains a new temporary TorBox link if the previous direct link expires. The buffering threshold is configurable.

Full mode includes a playback-health panel that distinguishes states such as Opening, Ready, Playing, Buffering, Stalled, Recovering, Paused, Finished, and failure. It also exposes Sound works and separate Bad source feedback for the current source.

The player can remember a source after sustained successful playback and favor it or its release family later. This learning can be disabled or cleared in Settings.

Additional optional player settings include playback speed, sleep timer, a configurable Still watching? guard, Screen Wake Lock where supported, pause overlay, keyboard seeking, and seek-step length. The Still watching? guard defaults to 90 minutes, can be set to Off, 60, 75, 90, or 120 minutes, and carries across auto-next episodes so short episodes cannot reset unattended playback indefinitely.

## Settings

Settings are browser-local. Current groups include:

- Interface: Simple or Full, long-press shortcuts.
- Playback: default quality, source-size profile, speed, sleep timer, Still watching? timeout, recovery timing, keyboard seeking, wake lock, playback health, source learning.
- Episodes and history: rewind, Continue Watching count, auto-next and countdown, Next Up, watched/resume labels, completed-episode cleanup.
- Discover, My list, and search: My list size, search-history size, remembered browse filters.
- App: TorBox status check, app install, source-learning reset, search-history reset.

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

Implementation source on `main` is authoritative. Current readiness and next steps are tracked in `to-shreds/ProjectStatus/projects/torbox-web-player/STATUS.md`.
