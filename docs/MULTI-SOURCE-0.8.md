# Anonymous source fallback chain: v0.8

The browser-key clone no longer depends on a single public torrent metadata index.

## Active zero-credential chain

The production order is:

1. Zilean
2. StremThru Torz main public instance in anonymous P2P mode
3. StremThru Torz ElfHosted public instance in anonymous P2P mode
4. MediaFusion public root stream resource
5. Comet public root stream resource

Zilean remains first. If it returns at least 12 usable hashes, no backup is contacted. If it fails, is rate-limited, is in cooldown, returns no sources, or returns only a very small set, the server moves down the chain. Once 20 distinct hashes have been collected, it stops. Results are deduplicated by torrent infohash before TorBox cache checking.

The fallback requests contain only the public IMDb title/episode identifier. They never receive the user's TorBox API key, browser bearer, cookie, or playback URL.

Each public provider has response-size and timeout bounds, target caching, request coalescing and a provider-wide circuit breaker. 401/403 responses and configuration redirects cool the provider down for hours instead of hammering it. 429 honors Retry-After. Network and 5xx failures receive shorter cooldowns.

Only infoHash-based Stremio streams are accepted. URL-only streams are ignored.

## Public observations on September 19, 2026

A credential-free GitHub Actions probe used movie tt1160419 and series tt0903747 season 1 episode 1:

- StremThru's main public instance returned HTTP 200 with 399 movie and 256 episode streams; every observed stream had a valid 40-character torrent hash.
- StremThru's ElfHosted public instance returned HTTP 200 with 416 movie and 423 episode streams; every observed stream had a valid 40-character torrent hash.
- MediaFusion returned HTTP 200 with empty stream arrays for both tested selections.
- Comet returned HTTP 403 from the hosted runner.
- KnightCrawler redirected to knightcrawler-is-deprecated.elfhosted.com, so it is not an active fallback.
- Jackettio's unconfigured root returned only a URL-style configuration stream, not torrent hashes, so it is not a zero-config fallback.
- AIOStreams' unconfigured root returned only configuration metadata, not torrent hashes. It requires a configured profile/manifest before it can act as a source provider.
- Torrentio previously returned HTTP 403 from this project's Render environment and is not retried or bypassed.

Comet and MediaFusion remain late fallbacks because their public behavior can change and the circuit breaker makes refusal or emptiness cheap. No header spoofing, alternate IP routing, proxy evasion, or other refusal bypass is used.

## TorBox behavior

After anonymous source discovery, the existing app sends normalized torrent hashes to the authenticated TorBox path. TorBox cache checking, duplicate reconciliation, explicit preparation, file/episode matching, recommendation logic and direct TorBox playback are unchanged.

A provider outage cannot silently add a torrent. Browsing and fallback discovery remain read-only.

## Limits

These are still third-party public services. Multiple fallbacks reduce single-provider outage risk but do not create an uptime guarantee. The two independently hosted StremThru Torz instances are currently the strongest verified anonymous backups. They reduce host-level outage risk, although they may still share upstream datasets and therefore are not fully independent source ecosystems.

A truly independent source layer would require self-hosting one or more index/scraper services and their data dependencies.
