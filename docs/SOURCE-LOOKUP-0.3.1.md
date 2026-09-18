# Source lookup repair: v0.3.1

## Failure and scope

Jon reported the exact catch message from the browser's direct Torrentio request. That message establishes that the browser request failed, not whether the cause was DNS, CORS, a network filter, timeout or service refusal. Prior Render requests to Torrentio returned HTTP 403. The repair removes the unverified cross-origin browser dependency rather than claiming a more precise cause than the evidence supports.

Cinemeta catalog search, title/episode UI, authentication, existing TorBox preparation, media relay and progress protections are preserved. This change is source retrieval, not codec conversion or a new streaming architecture.

## Provider investigation actually performed

Read-only probes ran from the existing Render service without logging keys, cookies, private playback URLs or library titles. They did not add torrents or request video.

- September 18, 2026, 05:19:18 UTC: `search-api.torbox.app` returned ENOTFOUND for schema, movie and episode requests. This was not a plan-restriction response and was not presented as an empty search.
- 05:22:27 UTC: MediaFusion's tested public raw-source endpoints returned HTTP 200 with empty stream arrays. Those responses were not accepted as proof of a usable replacement.
- 05:25:22 UTC: the old public `zilean.elfhosted.com` filtered-search paths returned HTTP 404.
- 05:27:21 UTC: the current Zilean host documented by AIOStreams returned HTTP 200 with 63 movie sources for tt1160419 and 140 episode sources for tt0903747 season 1 episode 1. Every returned row had the requested IMDb ID and a valid 40-character hash. The public sample tt1254207 returned an empty array, demonstrating that coverage is not universal.

No alternate IPs, forged headers or third-party credential sharing were used. No unrelated TorBox account settings were changed.

## Implemented repair

`lib/source-lookup.mjs` adds one fixed-host anonymous metadata adapter. It checks exact title identity and numeric episode constraints, bounds results to 40 normalized candidates, keeps release titles separate from filenames, and preserves the existing final TorBox file-selection checks. It has bounded response size and timeout, at most four distinct concurrent lookups, request coalescing, successful/empty/error caching and explicit rate-limit cooldowns. It does not accept a TorBox key, a cookie or a user-supplied destination.

`public/source-client.js` now requests the website's authenticated `/api/discover/lookup` route. Its existing export and normalization contract are retained, so the catalog/title UI and source registration flow are unchanged. It no longer requests Torrentio. The server route requires the existing household session and rechecks it after asynchronous lookup, returns private no-store responses, and distinguishes invalid targets, timeout, refusal, rate limiting and malformed results. Browser connect-src is now self only. Attribution and owner diagnostics identify Zilean.

Source availability can still vary. Zilean's primary implementation catches some internal errors and returns an empty list, so this application cannot distinguish those hidden internal failures from a genuinely empty provider result. It does not claim every title has a playable source or that cache availability proves codec support.

## Verification actually performed

All twelve changed/new application, version and test files were checked against their uploaded Git blob hashes. The pre-change server, touched older tests, package files, entrypoint and HTML were verified against the existing repository before targeted edits. The source-client transcription was aligned with the uploaded bytes and its local tests rerun. Existing catalog, discovery/preparation, auth, progress and media modules were not rewritten.

Twenty-seven new adapter/client tests passed locally on Node 22.16.0. Eight new HTTP tests were run as part of Render's build, in addition to the existing 100 normal tests. They check authentication, same-origin routing, missing episode parameters, refusal of arbitrary destinations, read-only behavior, error mapping, revocation during a lookup and caching headers. Existing source tests were updated only for the changed same-origin contract and stricter connect policy.

At 2026-09-18T05:44:56.140054852Z, an enabled read-only pipeline test ran the actual frontend `loadPublicSources` function against an isolated instance of the real application inside Render, then called the existing source-registration and TorBox-cache route:

| Selection | Normalized sources | Registered | TorBox cached | Unknown cache results |
| --- | ---: | ---: | ---: | ---: |
| Movie tt1160419 | 40 | 40 | 22 | 0 |
| Series tt0903747, season 1 episode 1 | 40 | 40 | 24 | 0 |

Both registration responses were HTTP 200. No master key appeared in the returned source data. The application's preparation-operation map stayed empty; the test did not call Prepare, create a torrent, retrieve media or alter real viewing progress.

The feature build registered 140 tests: 136 passed, zero failed and four optional checks skipped. The 136 includes 135 normal tests and one enabled live pipeline assertion. Unlike a probe that merely logs a failure and passes, the new pipeline test fails if actual lookup or cache checking fails. Render reported implementation commit `7206013e87e555669e35c24bb96cdebf8407a8a2` live at 2026-09-18T05:45:20.754003Z.

This was an application-HTTP and frontend-function test inside Render, not a physical Android/desktop browser test or a public-ingress browser session. It did not decode audio/video. The exact title Jon originally selected is unknown. The previous conversion and durable-state limitations remain.

The final documentation/configuration deployment and normal test count are recorded in ProjectStatus. SOURCE_ACCESS_CHECK must be 0 after verification so routine builds do not repeat the probes.

## Primary references

- Zilean anonymous filtered-search routing and parameters: https://github.com/iPromKnight/zilean/blob/main/src/Zilean.ApiService/Features/Search/SearchEndpoints.cs
- Zilean returned torrent model: https://github.com/iPromKnight/zilean/blob/main/src/Zilean.Shared/Features/Dmm/TorrentInfo.cs
- Maintained public instance configuration: https://github.com/Viren070/AIOStreams/blob/main/packages/core/src/config/schema/builtins.ts
- Existing catalog and preparation benchmark: docs/CATALOG-0.3.0.md

No new secret, paid resource, subscription change or competing source ZIP was created. GitHub remains authoritative.
