# TorBox Web Player

Private household, catalog-first browser player. **Version 0.4.2 uses direct TorBox video delivery only. GitHub Pages hosts the UI, Render handles control/API work, and movie/episode bytes never pass through Render.** It remains a preview, not a fully verified replacement for Stremio. CarStream and unrelated projects are unchanged.

## Hosting split

The files in `public/` are the complete static frontend. GitHub Pages publishes only that directory. The frontend contains no TorBox API key and points to the Render backend at `https://torbox-web-player.onrender.com`. Render is configured to accept browser API requests from `https://to-shreds.github.io` plus its own fallback frontend.

Cross-host API login uses a 256-bit opaque session bearer kept in browser `sessionStorage`; Render's existing SameSite cookie remains a fallback for the Render-hosted copy. GitHub Pages does not depend on third-party cookies. API mutations from bearer sessions still require the approved frontend Origin. The authenticated playback response intentionally returns TorBox's temporary CDN URL directly to the signed-in browser. That URL contains TorBox token/key material; this is an explicit private-household tradeoff to keep all video bandwidth off Render.

The GitHub Pages site is live at `https://to-shreds.github.io/torbox-web-player/`. The workflow at `.github/workflows/pages.yml` publishes only `public/`; the Render-hosted frontend remains available as a fallback.

## Current experience

Sign in to Discover, browse movie or show posters, search Cinemeta's broader catalog, and open a title. Shows have a season selector and numerically ordered episodes, including Specials where supplied. Search text stays in place when switching to the secondary My TorBox files tab. A title does not need to be in the TorBox account to appear in Discover.

The browser requests sources from the authenticated `/api/discover/lookup` route on this website. The server queries Zilean's public torrent metadata index by exact IMDb ID and season/episode. The browser no longer contacts Torrentio or another external source provider. Source results are bounded, normalized and checked against TorBox's cache through the existing server-side adapter. Choose Play for a cached candidate or Prepare for another candidate; Other versions remains available. Searching, browsing and availability checks never add torrents.

Preparation checks the account by hash before creation, coalesces concurrent same-hash requests and stops automatic retries after an uncertain response. The returned torrent identity and episode are checked. Ambiguous files require explicit selection; an index release title is not assumed to be a filename or TorBox file ID. The authenticated player receives the temporary TorBox CDN URL directly. There is no Render media endpoint, ticket, proxy, or video-relay fallback.

**This version does not transcode or convert files.** Source ranking now gives H.264 + AAC releases a large priority boost, treats Dolby Digital / E-AC-3 / DTS / TrueHD as possible silent-audio risks in Chrome, and does not auto-start a release flagged with those audio formats. The UI warns before a risky source and offers Play anyway. This substantially improves the default choice but still does not guarantee that every release's metadata matches its actual tracks.

## Provider contracts and privacy

Cinemeta supplies catalog metadata, not proof of video availability. Its manifest is https://v3-cinemeta.strem.io/manifest.json. No additional metadata key is required. Poster requests remain restricted to the configured HTTPS image hosts.

The current source endpoint is the public Zilean instance at `https://zileanfortheweebs.midnightignite.me/dmm/filtered`. This instance is identified by the maintained AIOStreams configuration; Zilean's primary API defines this endpoint as anonymous GET search. References and measured results are in `docs/SOURCE-LOOKUP-0.3.1.md`.

The index receives only public title identifiers and the server's network address. The source adapter has no TorBox-key or household-cookie input. Requests use a fixed destination, no credentials, no redirects, bounded responses, coalescing, short failure caching and rate-limit cooldowns. The GitHub-hosted frontend's browser connections are restricted to the Render backend; source-provider calls remain server-side. There is no arbitrary URL source proxy or fallback that circumvents a provider refusal.

Catalog lookup, source lookup, TorBox cache checking, preparation and media delivery remain distinct. An HTTP error or malformed source response does not become a successful empty result. The upstream Zilean implementation itself can return an empty list after an internal failure, so an empty provider response cannot prove universal absence of sources. No provider guarantees every title is indexed.

## Verification

The replacement's direct Render-hosted provider check returned 63 movie rows and 140 episode rows, all with matching IMDb IDs and valid torrent hashes. A subsequent test ran the actual frontend source function against the application's authenticated routes inside Render. It returned 40 normalized candidates for each selection, registered all of them, and confirmed 22 movie candidates and 24 episode candidates cached in TorBox, with zero unknown cache results. It added no torrents and fetched no video.

Twenty-seven source adapter/client tests remain in the suite. The v0.4.2 Render build registered 143 tests: 138 passed, zero failed, and five optional live checks were skipped. Direct-delivery regressions verify that authenticated playback returns a TorBox CDN URL, that GitHub Pages receives the same direct URL, and that Render's `/media` path is gone and returns 404. See `docs/DIRECT-PLAYBACK-0.4.2.md` and ProjectStatus for deployment status.

The v0.3.0 benchmark remains documented in `docs/CATALOG-0.3.0.md`: a separate earlier test added one cached public Big Buck Bunny sample not previously in the account and verified preparation, media transfer and API resume state. That was not real target-device playback. The source-fix turn made no additions.

Jon confirmed picture and sound on Android Chrome before the direct-delivery switch. The H.264/AAC source preference remains in place. Direct CDN playback now needs a quick device retest because the transport path changed. No codec conversion is claimed. Existing catalog UI, preparation, progress protections and authentication are preserved; the media relay is removed.

## Setup and deployment

Existing credentials require no changes. For a new service, configure `HOUSEHOLD_PASSWORD_HASH` and `TORBOX_API_KEY` directly in Render; `/setup` can generate a salted hash locally. Never commit real passwords, hashes, keys, cookies or private media URLs.

Build: `npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm test`.

Start: `npm start`. Node 24 is selected by `.node-version`. `/healthz` reports v0.4.2. The package remains dependency-free.

Set `FRONTEND_ORIGINS=https://to-shreds.github.io` in Render for the GitHub Pages project site. The value is an origin only, not the repository path. The public frontend's API destination is deliberately non-secret and stored in an `api-origin` meta tag.

Use `SOURCE_PROVIDER=zilean`. Keep `SOURCE_ACCESS_CHECK=0`, `TORBOX_VERIFY_ON_START=0`, `CATALOG_CONTRACT_CHECK=0` and `CATALOG_LIVE_CHECK=0` for normal operation. The optional legacy catalog test may add a cached public sample when explicitly enabled; the new source pipeline test is read-only.

## Storage, costs and remaining scope

Sessions, caches, source tickets, pending-operation guards and progress are process memory, not durable across deployments, restarts or service sleep. Account-hash reconciliation does not replace a durable exactly-once preparation record. Progress remains tied to provider file IDs.

Video travels TorBox CDN -> browser directly. Render is not a video proxy, so ordinary movie/episode bytes do not count as Render outbound bandwidth. The temporary TorBox CDN URL/token is visible to the signed-in browser by design. No paid service, database, persistent disk, new provider secret or subscription upgrade was added.

Still required for the full specification: target-device playback checks, a compatible conversion fallback, persistent profiles/preferences/watchlists/progress, Continue Watching, durable pending preparations, manual title corrections, automatic next, migrations and backup/restore.

Implementation source here is authoritative. Readiness and next steps are in `to-shreds/ProjectStatus`, `projects/torbox-web-player/STATUS.md`. Earlier reports remain history; their Torrentio, original setup and same-origin-only descriptions do not control this version.
