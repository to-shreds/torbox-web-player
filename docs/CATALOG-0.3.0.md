# Catalog-first implementation and verification

September 18, 2026. Source implementation commit: cebdd0a3d6d107b761359f9f3b41a3408baddbd0. The final documentation/configuration commit and deployment are recorded in ProjectStatus.

## Implemented

Discover is now the default authenticated view. Cinemeta supplies broad movie/show browsing, debounced search, genre selection, posters, descriptions, and season/episode metadata. My TorBox files remains a secondary tab. Searches and title IDs are independent of account membership. IMDb IDs can be entered directly because provider text matching can omit an exact desired title.

The browser uses Torrentio's public raw torrent-source protocol without debrid credentials or household cookies. Returned hashes are normalized and bounded; unsupported stream URLs are not treated as torrents. The backend checks TorBox cached availability, registers session-bound source selections, and implements explicit Play/Prepare plus read-only status actions. A cache failure preserves the source list with an unknown-availability warning.

Preparation reconciles against the real account by hash before creating a torrent, coalesces concurrent same-hash requests, and stops automatic retries after an ambiguous creation response. An existing source can be recovered after a restart through account reconciliation; the pending-operation record itself is not durable. File selection checks the returned hash, numeric season/episode identity and filenames rather than assuming an add-on file index equals the TorBox file ID. Ambiguous multi-file or multi-episode content requires explicit selection. No search or metadata request enqueues content.

The existing authenticated media relay, owner re-entry, session revocation, progress protections, and browser error diagnostic are preserved. Conversion, automatic next, persistent state and complete title-to-progress mapping are not implemented by this change.

## Live provider observations

At 2026-09-18T04:35:52Z, the opt-in Render build probe observed:

- Cinemeta text search returned HTTP 200 with seven results for Big Buck Bunny, but did not include the exact expected IMDb ID. Direct metadata lookup for tt1254207 returned HTTP 200 with the correct identity and a poster on images.metahub.space.
- A series metadata request returned HTTP 200 and 100 episode rows, including season, episode, IDs and release dates.
- A server-side Torrentio stream request returned HTTP 403, with no usable source list. The app does not retry it through alternate servers, forged headers or proxies. Its normal browser-client CORS path is implemented from the primary source contract but is not yet live-verified on the user's network.
- The separate TorBox search API request failed before a usable HTTP response was recorded. This is not evidence that it returned a plan restriction or an empty successful search. It is not the active source provider.
- The TorBox OpenAPI schema was reachable and confirmed multipart torrent creation, including add_only_if_cached.

At 2026-09-18T05:05:13.97766427Z, the new application ran an isolated, opt-in live pipeline check inside Render. It fetched the official WebTorrent Big Buck Bunny torrent and calculated its info hash from the encoded info dictionary, instead of assuming a remembered hash. The application then recorded:

| Check | Observed result |
| --- | --- |
| Official sample torrent request | HTTP 200 |
| Catalog identity lookup | Expected IMDb ID returned |
| Already in the TorBox account | No |
| Normalized source selections | 1 |
| TorBox cache result | Cached |
| Explicit cached-only preparation | Ready |
| Playback URL exposed to client | Opaque same-origin media ticket |
| Authenticated media request | HTTP 206, video/mp4 |
| Bytes read before closing request | 1,024 |
| Save progress through application API | Saved |
| Reopen and obtain stored position | Correct stored value returned |

The test added the one cached public sample to the TorBox account. It did not remove or modify existing account files. Its application session and progress store were isolated from the household's running process. The source in this test was WebTorrent's public sample, not a successfully retrieved Torrentio response. The progress check exercised API behavior with a known test position; it was not a claim of real browser viewing or seeking.

The report did not log TorBox keys, household passwords, private media URLs, cookies, account identity or private library titles.

## Automated and component checks

Thirty-five new adapter/state tests and eight new real-local-HTTP tests passed on Node 22.16.0. They cover catalog independence, escaping, pagination, malformed/empty/error distinctions, metadata identity, numeric episode order, source bounds, cookie-free public source requests, fixed TorBox destinations, cached-only form construction, duplicate reconciliation, uncertain creation, source-ticket revocation/expiry, wrong-episode prevention, CSRF/origin/authentication, bounded request bodies, static module routes and revocation during an asynchronous request.

All fourteen changed/new code/configuration/test files were checked against their uploaded Git blob hashes. Existing authentication, progress, media relay, TorBox adapter and previous regression-test blobs were preserved.

The Render feature build completed 102 registered tests: 101 passed, zero failed and one was skipped. That includes 100 normal tests and one enabled observational live check. The live observation's measured report above, not its Node pass label alone, is the evidence for provider behavior. With both observations disabled, the normal expected count is 100 passed and two skipped; the final deployment's actual count is recorded separately in ProjectStatus.

Chromium component checks passed with synthetic API/source/media responses. They exercised default Discover, movie -> source list -> explicit preparation -> existing player, no creation before the click, shared search text across tabs, twelve numerically ordered episode rows, the selected episode's source URL, logout cleanup, and four viewport sizes. No horizontal page/dialog overflow or uncaught JavaScript errors was observed. The inspected tablet screenshot showed five episode rows at once.

The browser disallowed navigation with ERR_BLOCKED_BY_ADMINISTRATOR. Offline DOM/component checks therefore loaded local page styles and scripts in memory with synthetic fetch responses. ES-module imports were replaced by equivalent in-memory bindings for that harness. No network block was bypassed, and this was not an end-to-end hosted browser test or real media decoding.

## Remaining acceptance work

Actual Torrentio source retrieval from a household Chrome client remains unverified. Actual Android/desktop video and sound, beginning/middle/end seeking, expiry recovery during viewing, two concurrent household devices, and conversion of incompatible sources remain unverified. The previous conversion-plan restriction remains recorded in the older diagnosis report and was not changed or assumed to block ordinary torrent creation.

The public sample proves that catalog selection and a previously absent torrent can reach the implemented TorBox preparation/relay path. It does not prove every title has a source, that every source matches correctly, or that Chrome decodes arbitrary codecs. Keep those distinctions explicit.

## Primary references

- Cinemeta official manifest and catalog/metadata contract: https://v3-cinemeta.strem.io/manifest.json
- Stremio stream response format: https://stremio.github.io/stremio-addon-sdk/api/responses/stream.html
- Torrentio's public resource router and CORS implementation: https://github.com/TheBeastLT/torrentio-scraper/blob/master/addon/serverless.js
- TorBox API contract: https://api.torbox.app/openapi.json
- TorBox's own separate search integration: https://github.com/TorBox-App/torbox-prowlarr-indexers/blob/main/torbox-torrents.yml
- Official public/Creative Commons torrent samples: https://webtorrent.io/free-torrents

No new provider secret or paid resource was added. Disable the optional probe flags during normal operation. GitHub remains the source of truth; no competing ZIP handoff was created.
