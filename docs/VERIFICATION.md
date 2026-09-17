# Verification report: v0.2.0 secure-relay checkpoint

September 17, 2026. This report separates automated checks, live TorBox checks and unperformed browser/device checks.

## Automated checks

The Render build passed `npm run check` and all **41 Node tests** on Node 24.21.0. The suite covers password hashing, session expiry/revocation, login limits, exact-origin and CSRF enforcement, secure cookies, owner re-entry, private-cache headers, provider response whitelisting, readiness flags, paging/cache/coalescing, provider timeouts/rate limits/errors, two-viewer progress isolation, stale-progress rejection and explicit start-over.

Relay-specific tests verify that playback JSON returns only a random same-origin media ticket, never the server-side CDN URL or fixture master key; media tickets are bound to one session; signed-out and wrong-session media requests fail; a single byte range is forwarded and returned as 206; multipart or malformed ranges are rejected before contacting the provider; and an expired upstream URL is resolved only once before one retry. The arbitrary-URL proxy checks still pass.

## Live TorBox and Render checks

The configured Render service authenticated successfully to the real TorBox account. TorBox returned plan code `1`. The first torrent-library page normalized 912 video files, all 912 reporting ready. Web-download and Usenet checks returned zero normalized video files. This does not establish that 912 is the account-wide total.

For a real ready file, TorBox returned the CDN host `store-034.wnam.tb-cdn.io`. A one-byte request to the server-side CDN URL returned HTTP 206 with byte-range support. The tested response was `video/x-matroska`, and its `Content-Range` reported a total size of 1,974,660,908 bytes.

The live diagnostic established that TorBox's generated CDN URL contains the master API key in the `token` query parameter. Removing that parameter caused the same range request to return HTTP 400. The application therefore does not expose that CDN URL to the browser. The hosted startup probe after the relay change successfully created a relay source and again obtained a 206 byte-range response from the actual TorBox CDN.

Render built v0.2.0 from commit `a9115c7226858e85a582ec11aec0b8e52bd3141a`, with 41/41 tests passing, and reported the service live. The diagnostic startup flag is temporary and is disabled after this verification pass.

## Browser component checks from v0.1.0

Earlier Chromium component checks with synthetic API responses showed no horizontal overflow at phone, tablet portrait, tablet landscape and desktop sizes. A generated 18-second H.264/AAC MP4 decoded and sought to 2, 9 and 16 seconds and accepted a fixture resume point. Those remain component checks, not evidence of hosted TorBox playback.

## Still not verified

A complete authenticated browser-to-hosted-relay playback session could not be run from this tool environment because external navigation to the hosted service is blocked here. A direct shell attempt also could not resolve the Render hostname. No bypass was attempted.

Accordingly, the first playback milestone is not yet complete. A real desktop Chrome and Android Chrome session still needs to confirm visible video, audible sound, seeking near the beginning/middle/end, closing and reopening at the correct position, renewal behavior and independence between the two viewers. The first live source tested at the transport layer is MKV, so codec compatibility is specifically unresolved.

Broader discovery, source preparation, conversion/HLS, automatic next, title matching, editable profiles, durable database migrations, backup/restore, restart durability and actual account concurrency remain unverified or unimplemented.

## Bandwidth

The secure relay sends video bytes from Render to the viewing browser. Render currently lists 5 GB of included monthly outbound bandwidth for a Hobby workspace, shared across its services, followed by $0.15 per additional public-internet GB. A fully transferred 2 GB video therefore uses roughly 2 GB of Render outbound bandwidth, with retries, seeking and replay potentially increasing the total. The service remains on free compute and no paid resource was created.
