# Anonymous source fallback chain: v0.8

The browser-key clone no longer depends on a single public torrent metadata index.

## Active zero-credential chain

The production order is:

1. Zilean
2. StremThru Torz in anonymous P2P mode
3. MediaFusion public root stream resource
4. Comet public root stream resource

Zilean remains first. If it returns at least 12 usable hashes, no backup is contacted. If it fails, is rate-limited, is in cooldown, returns no sources, or returns only a very small set, the server moves down the chain. Once 20 distinct hashes have been collected, it stops. Results are deduplicated by torrent infohash before TorBox cache checking.

The fallback requests contain only the public IMDb title/episode identifier. They never receive the user's TorBox API key, browser bearer, cookie, or playback URL.

Each public provider has response-size and timeout bounds, target caching, request coalescing and a provider-wide circuit breaker. 401/403 responses and configuration redirects cool the provider down for hours instead of hammering it. 429 honors Retry-After. Network and 5xx failures receive shorter cooldowns.

Only infoHash-based Stremio streams are accepted. URL-only streams are ignored.

## Public observations on September 19, 2026

A credential-free GitHub Actions probe used movie tt1160419 and series tt0903747 season 1 episode 1:

- StremThru Torz P2P returned HTTP 200 with 416 and 423 streams respectively; all observed streams had valid 40-character torrent hashes.
- MediaFusion returned HTTP 200 with empty stream arrays for both tested selections.
- Comet returned HTTP 403 from the hosted runner.
- KnightCrawler redirected to knightcrawler-is-deprecated.elfhosted.com, so it is not an active fallback.
- AIOStreams is not a zero-configuration fallback. Its public service requires a configured profile/manifest before it exposes streams.
- Torrentio previously returned HTTP 403 from this project's Render environment and is not retried or bypassed.

Comet and MediaFusion remain late fallbacks because their public behavior can change and the circuit breaker makes refusal or emptiness cheap. No header spoofing, alternate IP routing, proxy evasion, or other refusal bypass is used.

## TorBox behavior

After anonymous source discovery, the existing app sends normalized torrent hashes to the authenticated TorBox path. TorBox cache checking, duplicate reconciliation, explicit preparation, file/episode matching, recommendation logic and direct TorBox playback are unchanged.

A provider outage cannot silently add a torrent. Browsing and fallback discovery remain read-only.

## Limits

These are still third-party public services. Multiple fallbacks reduce single-provider outage risk but do not create an uptime guarantee. StremThru Torz is currently the strongest verified anonymous backup.

A truly independent source layer would require self-hosting one or more index/scraper services and their data dependencies.
