# TorBox Browser-Key Player

This branch is the **browser-key clone** of the household TorBox web player. The original player on `main` remains separate.

Current version: **0.12.0-key-clone**

Frontend: `https://to-shreds.github.io/torbox-web-player/key/`

Backend: `https://torbox-web-player-key.onrender.com`

## Credential model

The TorBox API key is the clone's only sign-in credential. There is no separate household password. The key is not committed to GitHub and is not stored as a Render environment secret.

When entered, the key is validated against TorBox and held only in that Render process session. The optional **Remember encrypted on this device** feature stores an AES-GCM-encrypted copy locally in the browser using a non-exportable Web Crypto key in IndexedDB.

## Media path

Video is **never relayed through Render**.

Playback path:

`TorBox CDN -> browser`

Render handles only control/API work such as authentication, catalog/source lookup, TorBox cache checks, torrent preparation, playback-link generation and temporary progress. The temporary TorBox playback URL/token is intentionally visible to the signed-in browser.

## Source discovery

Version 0.8.1 uses anonymous multi-source metadata aggregation.

Every uncached movie/episode lookup queries in parallel:

1. **Zilean** filtered search.
2. **MediaFusion Torznab** public search.

The results are normalized and deduplicated by torrent infohash before the existing TorBox cache check. MediaFusion Torznab can provide real seeder counts, which are preserved when available.

If the two primary indexes return fewer than 20 distinct hashes, the backend tries:

3. **StremThru Torz Main**
4. **StremThru Torz ElfHosted**

Provider-specific cooldowns, 15-minute successful-result caching and in-flight request coalescing reduce traffic to the public community services.

No TorBox API key, session bearer or playback URL is sent to Zilean, MediaFusion or StremThru. They receive only public media identifiers such as IMDb ID, season and episode plus the backend's network address.

Comet is not currently an active source because its tested anonymous raw stream endpoint returned HTTP 403 to the public probe. MediaFusion's Stremio stream endpoint returned empty results on the same samples, so the working public Torznab interface is used instead. See `docs/MULTI-SOURCE-0.8.1.md`.

## Player experience

The clone has a compact mobile-first UI.

Movies and episodes expose **Play** and **Options** directly. Play automatically chooses the recommended source, checks TorBox cache state, prepares the source if necessary and starts it. Options opens the detailed source table.

The source table includes release/filename, size, seeders when supplied, quality, TorBox cache status and manual Play/Prepare controls. Resolution filters include Auto, 480p, 720p, 1080p and 4K.

The recommendation algorithm favors cached, browser-compatible H.264/AAC sources, generally prefers 720p in Auto mode, targets about 3 GiB or less for movies and 1 GiB or less for episodes, and heavily penalizes known Dolby/DTS/TrueHD audio risks and known video-compatibility risks.

## Resume, auto-next and recovery

Recently Played is stored locally in the browser and keyed to the canonical movie or exact TV episode, rather than a TorBox file ID. This allows a timestamp to survive switching torrent sources.

TV playback queues the next released episode and attempts to resolve and start it automatically, including across seasons.

If an active stream stalls for about 12 seconds or crashes, the player saves its canonical position and tries a safe lower-resolution source:

- 4K -> 1080p -> 720p -> 480p
- 1080p -> 720p -> 480p
- 720p -> 480p

If no acceptable lower-resolution source works, it makes one fresh-link attempt before stopping.

## Verification

The final v0.8.1 Render build registered **175 tests: 169 passed, 0 failed, 6 optional live checks skipped**.

A separate enabled read-only live observation from Render confirmed MediaFusion Torznab returned 40 normalized movie sources and 40 normalized episode sources for the test titles, with explicit seeder counts on 27 movie results and 20 episode results. That check added zero torrents.

The public provider probe also observed hundreds of anonymous StremThru hashes from GitHub-hosted infrastructure, while the active production design treats those instances only as fallbacks because their availability can vary by caller/network.

## Remaining limitations

- Recently Played/resume is browser-profile local, not cross-device.
- Public source services are community infrastructure and can rate-limit or change.
- Seeder values are shown only when a provider actually supplies them.
- Codec conversion/transcoding is not implemented.
- Automatic buffering detection is heuristic.
- Full physical-device acceptance of every fallback/auto-next case is still ongoing.

Implementation source on this branch is authoritative. Project readiness is tracked in `to-shreds/ProjectStatus/projects/torbox-web-player-browser-key/STATUS.md`.


## Temporary sharing and compact source chooser

Version 0.9 adds scoped temporary guest links. From a movie/show title, the owner can create a 2, 6, 12 or 24 hour link. A guest link can access only that shared movie or show, not search, the TorBox library, owner tools, or the TorBox API key. Series links allow the released episodes of that one show. Guest playback still uses the owner's TorBox connection through a process-memory guest session, and video remains direct TorBox CDN -> guest browser.

Guest links are opaque random tokens stored only in Render process memory. They expire automatically, are invalidated when the sharing owner signs out, and also disappear on a Render restart. Guest playback is restricted to video IDs obtained through source preparation for the shared title.

The mobile source chooser no longer repeats the Recommended torrent in the table. Alternate sources are paginated instead of creating a vertically scrolling list. Mobile pages show three alternatives at a time and compress size, seeders, quality and cache state into each compact row.


## Guest-safe TorBox redirect fix

Version 0.9.1 corrects the first guest-playback implementation. TorBox's ordinary returned playback URL can include the account master API key, so merely rejecting key-bearing URLs caused every real guest playback attempt to fail.

Guest playback now uses TorBox's redirect mode server-side. Render sends the authenticated request to TorBox with `redirect=true`, does not follow the media stream, and reads only the redirect destination. The resulting TorBox CDN destination is then validated against the approved CDN-host allowlist and checked again to ensure it does not contain the literal master API key before being returned to the guest browser.

Render still does not proxy or relay the movie. It performs one small redirect-resolution request; the guest browser then streams directly from the validated TorBox CDN destination.

The existing fail-closed behavior remains: if TorBox does not return a redirect, points outside the approved TorBox CDN hosts, or the redirect target still contains the master key, guest playback is blocked instead of exposing the credential.


## Google Drive temporary-share test

Version 0.10 replaces the broken owner-key guest playback path in the visible Share workflow with a Google Drive export test. The selected movie/episode is resolved through TorBox, TorBox uploads that exact file directly to Google Drive, and the UI measures both TorBox-to-Drive upload time and the additional time until Drive exposes video processing metadata.

A small owner-deployed Google Apps Script bridge supplies TorBox with a short-lived `drive.file` OAuth token, applies an anyone-with-link reader permission, optionally disables download/print/copy for readers, and schedules permanent Drive-file deletion. The bridge stores deletion records and time triggers on Google's side, so an already-scheduled deletion does not depend on the Render process staying alive.

The default Share test is watch-only and deletes the exported Drive copy after 10 minutes. The owner can instead choose 1, 2, 6, 12 or 24 hours and can delete immediately from the test dialog. See `drive-bridge/README.md` for the one-time bridge setup.

The video bytes remain outside Render:

`TorBox -> Google Drive -> viewer`

The old direct TorBox guest-link backend remains isolated for compatibility/testing but its broken title-level Share control is hidden; visible movie/episode Share buttons now start the Drive workflow.


## v0.11 browse fix, discovery-only UI, and easier Drive connection

The browser-key clone is now deliberately discovery-only. The **My files** / TorBox-library view has been removed from the published interface because it does not contribute to the catalog-first use case. TorBox account files remain an internal implementation detail for source preparation and playback, not a user-facing library in this clone.

The browse failure was traced to a concrete Cinemeta response-shape mismatch. Current Cinemeta catalog rows identify titles with `imdb_id`, while the browse normalizer had required `id`. Search continued to work because it followed a different path. Browse normalization now accepts either `id` or `imdb_id`, with an automated regression test for the current response shape.

The Drive timing test no longer requires Apps Script or a Google Cloud project. **Connect Google Drive** opens TorBox's own Google OAuth integration, which requests the narrow `drive.file` scope. TorBox's OAuth callback is fixed to TorBox and ignores attempted custom return-URL parameters, so the GitHub page cannot receive the resulting Google access token automatically. For this zero-setup timing test, after Google/TorBox reports success the owner copies that TorBox success-page address back into the Drive dialog once. The app extracts the short-lived token server-side and clears the pasted URL from the browser input immediately.

This easy OAuth mode is intentionally a short timing test, currently 10, 20, 30, or 45 minutes. It measures TorBox-to-Drive upload time and Drive processing time, applies an optional watch-only reader restriction, and permanently deletes the exported Drive copy while the test remains active. It is not yet the durable multi-hour sharing architecture because the TorBox-issued Google credential is short-lived and the zero-setup flow cannot refresh it after a Render restart.

The media paths remain:

Owner playback: `TorBox CDN -> owner browser`

Drive timing test: `TorBox -> Google Drive -> viewer`

Render still handles only control/API traffic and does not relay video bytes.


## v0.12 catalog redirect fix and player controls

The no-query browse failure is now traced to a second, distinct Cinemeta contract issue. Cinemeta search requests return HTTP 200 directly, while no-query browse requests such as Popular return HTTP 307 to `cinemeta-catalogs.strem.io`. The catalog adapter had deliberately used `redirect: 'error'`, so every browse request failed before normalization while search continued to work.

The adapter now follows a bounded redirect only to the two explicit HTTPS Cinemeta hosts `v3-cinemeta.strem.io` and `cinemeta-catalogs.strem.io`. Arbitrary redirect destinations remain rejected. This is covered by unit tests and a live browse probe.

Recently Played no longer has a Clear-all control. Each card has its own small remove button and requires confirmation before deletion. Opening an item from Recently Played rewinds by 10 seconds by default; Settings can choose 0, 5, 10, 15 or 30 seconds.

The old TorBox connection-check panel is removed. The app instead performs a real availability preflight using both the signed-in TorBox API and TorBox's official status page. An outage warning is shown before playback/share attempts, and actions that need TorBox are blocked when the account API is actually unreachable.

The native HTML5 video controls remain. A custom in-page pause overlay now shows title, episode/movie identity, elapsed time, total time and remaining time. Android Chrome may hide sibling HTML overlays if it promotes the video element into its own native fullscreen surface; the overlay is reliable in the site's normal fullscreen dialog.

A Settings dialog now controls default quality, Recently Played rewind, buffering threshold, Recently Played card count, automatic next episode, automatic recovery, the pause overlay, Drive watch-only default, and a manual TorBox status check.
