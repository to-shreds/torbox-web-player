# TorBox Browser-Key Player

This branch is the **browser-key clone** of the household TorBox web player. The original player on `main` remains separate.

Current version: **0.8.1-key-clone**

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
