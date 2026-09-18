# TorBox Web Player

Private household, catalog-first browser player. **Version 0.3.0 adds the missing broad catalog and torrent-preparation workflow. It is still a preview, not a fully verified replacement for Stremio.** CarStream and unrelated projects are unchanged.

## Current experience

Sign in to Discover, browse movie or show posters, search Cinemeta's broader catalog, and open a title. Shows have a season selector and numerically ordered episodes, including a separate Specials season where supplied. Search text stays in place when switching to the secondary My TorBox files tab. Titles do not have to be in the TorBox account to appear in Discover.

For a selected movie or episode, the browser requests public torrent-source metadata from Torrentio using its Stremio stream protocol. The server then checks those hashes against TorBox's cache. Choose Play for a cached candidate or Prepare for another candidate. Other versions remain available. Merely searching, browsing, opening a title, or checking source availability does not add a torrent.

Preparation first checks for an existing account torrent by hash. Concurrent requests for the same hash share one operation. An interrupted creation response does not cause an automatic duplicate submission. Preparation status comes from TorBox, not fabricated percentages. When files are available, the app checks the torrent identity and selects the matching episode or asks for an explicit file choice when ambiguous. Source file indexes are never mistaken for TorBox file IDs.

The selected file opens in the existing authenticated player. The TorBox master key stays server-side, and video is relayed through a session-bound opaque media URL. A reachable stream can still contain unsupported browser codecs. **This version does not transcode or convert files.**

## Provider contracts and privacy

Cinemeta provides catalog metadata, not proof of video availability. Its official manifest is https://v3-cinemeta.strem.io/manifest.json. The integration does not require an additional metadata API key. Poster requests are restricted to expected HTTPS image hosts. The footer identifies the providers.

Torrentio's raw stream endpoint is requested directly by the browser with ordinary CORS, no cookies, and no TorBox credentials. Its primary implementation enables CORS: https://github.com/TheBeastLT/torrentio-scraper/blob/master/addon/serverless.js. The public source lookup exposes the selected title/episode identifier and the viewer's network address to that provider. It does not expose the household session or TorBox master key.

A Render-hosted Torrentio request returned HTTP 403 in the integration probe. The implementation does not spoof an address, use a proxy to evade that response, or send the TorBox key to an add-on. It uses the normal browser-client API path, which still needs verification from the actual viewing browser. A source-provider failure is displayed as an error, not as a successful empty result. The catalog and My TorBox files remain independent of that provider.

TorBox account, cache, creation, and playback calls remain server-side. The current contract is https://api.torbox.app/openapi.json. The separate TorBox search API did not complete successfully in the probe and is not silently treated as a working fallback. The previously observed plan restriction on TorBox conversion does not establish a restriction on all other API operations.

## Verification

Read `docs/CATALOG-0.3.0.md` for the measured results and limits. Forty-three new local unit/HTTP tests passed. The existing 57 regression tests are preserved. Render's feature build passed all 100 normal tests, plus the enabled public-sample observation, with zero failures; the separate provider-contract observation was skipped in that build. Both optional observations are disabled during normal builds.

A live Render-hosted check used WebTorrent's freely licensed Big Buck Bunny sample, which was not previously in the account. Real catalog lookup, TorBox cache checking, cached-only source addition, correct-file selection, same-origin playback-link creation, a 1,024-byte HTTP 206 media response, and saved/returned progress all succeeded. The test used an isolated application instance, not a household viewer's real progress store. It added that one cached sample and did not delete or alter existing account files.

That check used WebTorrent's official sample torrent as its source. It does not establish that Torrentio returned a real source list in a household browser. It also does not establish visible picture, audible sound, browser seeking, cross-device resume, or successful codec conversion. Offline Chromium component checks exercised the UI and four viewport sizes with synthetic network/media data, not real TorBox decoding.

## Setup, deployment and credentials

Existing deployment credentials do not need to be changed for v0.3.0. For a new deployment, configure only the salted household password hash and TorBox key in Render: `HOUSEHOLD_PASSWORD_HASH` and `TORBOX_API_KEY`. The `/setup` page can generate the hash locally. Never commit real keys, passwords, hashes, session cookies or private media URLs. The browser does not submit authenticated TorBox API requests.

Build: `npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm test`.

Start: `npm start`.

The service serves the frontend and API from the same origin. Node 24 is selected by `.node-version`. `/healthz` reports v0.3.0. Normal configuration must keep `TORBOX_VERIFY_ON_START`, `CATALOG_CONTRACT_CHECK`, and `CATALOG_LIVE_CHECK` set to `0`. The last flag authorizes a deliberately bounded integration check that may add only the official cached public sample.

The package remains dependency-free. There is no need to install Stremio or obtain another API key to use this preview. External provider availability and browser codec compatibility remain conditions of successful playback.

## Storage, cost and remaining scope

Sessions, source tickets, pending-operation guards, media tickets, caches and progress are in process memory. They are not durable across deployments, restarts or service sleep. Reopening a selected source reconciles against TorBox's account list to reuse existing additions, but uncertain operations are not protected by a durable database transaction. Do not claim persistent exactly-once preparation or durable cross-device progress.

Video travels TorBox CDN -> Render -> browser because the observed TorBox CDN link embeds the master key. Video bytes count toward Render outbound bandwidth. No new paid service, database, persistent disk or subscription upgrade was provisioned. Previous numeric pricing estimates are historical; consult current Render billing information before regular high-volume use.

Still required for the full specification: actual target-device source lookup and playback verification, compatible conversion fallback, persistent profiles/preferences/watchlists/progress, title-mapping corrections, Continue Watching, automatic next episode, database migrations and backup/restore. The current source preference uses filename/codec hints, not a media probe or guarantee.

Implementation source in this repository is authoritative. Readiness and next steps are tracked at `to-shreds/ProjectStatus`, `projects/torbox-web-player/STATUS.md`. Earlier v0.1/v0.2 reports are retained as history; they do not describe the current catalog-first interface.
