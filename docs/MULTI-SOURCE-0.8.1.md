# Anonymous source aggregation: v0.8.1

The browser-key clone now treats source discovery as metadata aggregation, not a single-provider lookup.

## Active lookup path

Every uncached title/episode lookup queries two anonymous metadata indexes in parallel:

1. Zilean filtered search by IMDb ID and season/episode.
2. MediaFusion's public Torznab search by the same public title/episode identifiers.

Results are normalized to torrent hashes, merged by infohash, and enriched with the richest available filename/release, size, resolution, codec, quality, provider provenance and seeder count. Only hashes/metadata are passed to the existing TorBox cache checker.

If the merged primary result contains fewer than 20 distinct hashes, the app then tries the verified StremThru Torz Main public instance and, if still necessary, the independent ElfHosted StremThru Torz instance. Provider-specific cooldowns prevent repeated hammering after 429, refusal, timeout or outage responses. Successful source results are cached for 15 minutes and duplicate in-flight lookups are coalesced.

No TorBox API key, browser session token, household credential or playback URL is sent to any source index.

## Current public-provider observations

A read-only GitHub-hosted probe on September 19, 2026 observed:

- MediaFusion Torznab: HTTP 200, 100 movie items / 100 valid hashes and 100 episode items / 100 valid hashes. 58 movie results and 54 episode results carried explicit seeder values in that response.
- StremThru Torz Main: 399 movie hashes and 256 episode hashes on the tested titles.
- StremThru Torz ElfHosted: 416 movie hashes and 423 episode hashes on the tested titles.
- Comet's raw anonymous stream resource returned HTTP 403 to the probe, so it is not an active production source.
- MediaFusion's raw Stremio stream resource returned an empty stream array on the same test titles; the working Torznab interface is used instead.
- KnightCrawler redirected to a deprecation host. Jackettio and AIOStreams returned placeholder streams without torrent hashes.

These observations are not promises of permanent availability. The aggregator is specifically designed so one public provider can cool down or fail without turning that into an empty successful result when another provider still works.

## Traffic model

These provider requests are source-discovery metadata only. They return JSON or XML containing torrent hashes and release metadata. They never carry movie/video bytes.

Actual playback remains TorBox CDN -> browser directly. Public source-provider rate limits therefore affect how often new source lists can be requested, not the bandwidth or duration of an already-playing movie.
